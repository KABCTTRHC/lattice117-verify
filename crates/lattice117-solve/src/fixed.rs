//! Statically-typed fixed-point: `Q<INT, FRAC>`.
//!
//! # Why the format lives in the type
//!
//! The alternative — a runtime-adaptive shifter that rescales based on observed
//! magnitude — was considered and rejected. It would make the same input
//! produce different results depending on execution history, and this system's
//! entire claim is that it does not do that: *"it will do it every single time,
//! yielding the exact same SHA-256 AEGIS Crypto-Seal."* A dynamic shifter makes
//! the seal non-reproducible.
//!
//! So the format is a compile-time parameter. Conversions are explicit, checked
//! by the compiler, and const-evaluated. There is no runtime variance to have.
//!
//! # The convention, stated because the existing labels are loose
//!
//! Total width is `1 (sign) + INT + FRAC`, and `INT` **excludes** the sign bit.
//!
//! | Alias | Type | Width | Range | Resolution |
//! |---|---|---|---|---|
//! | [`Q16_16`] | `Q<15, 16>` | 32 | ±32768 | 1.53e-5 |
//! | [`Q2_29`] | `Q<2, 29>` | 32 | ±4 | 1.86e-9 |
//! | [`Q2_22`] | `Q<2, 22>` | 25 | ±4 | 2.38e-7 |
//! | [`Q2_15`] | `Q<2, 15>` | 18 | ±4 | 3.05e-5 |
//! | [`Q1_31`] | `Q<0, 31>` | 32 | ±1 | 4.66e-10 |
//! | [`Q12_19`] | `Q<12, 19>` | 32 | ±4096 | 1.91e-6 |
//!
//! Note that what this codebase calls "Q16.16" is really 1 sign + 15 integer +
//! 16 fractional bits in an `i32`. [`Q16_16`] is therefore `Q<15, 16>`, not
//! `Q<16, 16>` — the latter would need 33 bits and fails the width assertion.
//!
//! [`Q2_22`] and [`Q2_15`] are sized for the Zynq-7010's DSP48E1 ports (25×18
//! signed). A `Q2_22 × Q2_15` multiply consumes **one** DSP slice and yields a
//! 43-bit product that drops into the 48-bit accumulator; the same operation in
//! Q16.16 needs four cascaded slices. They are stored in `i32` here because
//! that is what the PS side can hold — the narrowing to 25/18 bits happens at
//! the PL boundary.
//!
//! # `generic_const_exprs` is nightly, so the output format is named
//!
//! `Q<A,B> * Q<C,D> -> Q<A+C, B+D>` cannot be expressed on stable Rust. Rather
//! than move a DAL-A safety firmware to nightly for type-level arithmetic,
//! [`Q::mul`] takes its output format as explicit parameters. More verbose, and
//! arguably what this project wants anyway: every precision boundary has to be
//! written down rather than inferred.
//!
//! # Migration
//!
//! Purely additive. `Q16 = i32` and every existing free function in this crate
//! are untouched, so nothing downstream had to change. `#[repr(transparent)]`
//! means [`Q16_16`] has identical layout to `i32`, so the telemetry frames can
//! adopt it later with no layout change and no re-verification of their offset
//! assertions.

/// A fixed-point value with `INT` integer bits and `FRAC` fractional bits,
/// plus a sign bit, stored in an `i32`.
///
/// Two `Q` types with different parameters are different types and will not
/// silently mix — which is the point. Conversion is [`Q::convert`],
/// multiplication across formats is [`Q::mul`].
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default, Hash)]
pub struct Q<const INT: u8, const FRAC: u8>(i32);

/// Saturating narrow from the `i64` intermediate every operation here computes
/// in.
///
/// Saturating rather than wrapping, matching `q16_mul`'s behaviour — which this
/// crate's own docs record was a fix for a silent-wraparound bug on 2026-08-12.
/// A wrapped overflow flips the sign of a physics quantity, and on this bench
/// that is a veto that does not fire.
#[inline(always)]
pub const fn saturate_i32(value: i64) -> i32 {
    if value > i32::MAX as i64 {
        i32::MAX
    } else if value < i32::MIN as i64 {
        i32::MIN
    } else {
        value as i32
    }
}

impl<const INT: u8, const FRAC: u8> Q<INT, FRAC> {
    /// Width check, evaluated at monomorphization.
    ///
    /// `generic_const_exprs` would let this be a `where` bound; on stable, the
    /// idiom is an associated const that a constructor forces the compiler to
    /// evaluate. Declaring `Q<16, 16>` compiles, but constructing one does not.
    const WIDTH_OK: () = assert!(
        1 + INT as u32 + FRAC as u32 <= 32,
        "Q<INT, FRAC> needs 1 + INT + FRAC <= 32 bits to fit an i32"
    );

    /// Total bits occupied, including the sign bit.
    pub const TOTAL_BITS: u32 = 1 + INT as u32 + FRAC as u32;

    /// `2^FRAC` — the raw value representing 1.0, when `INT >= 1`.
    pub const SCALE: i64 = 1i64 << FRAC;

    /// Wraps a raw integer already in this format. No scaling occurs.
    #[inline(always)]
    pub const fn from_raw(raw: i32) -> Self {
        let () = Self::WIDTH_OK;
        Self(raw)
    }

    /// The underlying raw integer.
    #[inline(always)]
    pub const fn raw(self) -> i32 {
        self.0
    }

    /// Converts to another fixed-point format.
    ///
    /// Widening (`F2 > FRAC`) shifts left and saturates. Narrowing shifts right
    /// **arithmetically**, which truncates toward negative infinity rather than
    /// toward zero. That is deliberate and it matches `q16_mul`'s existing
    /// `>> 16`, so the two rounding behaviours in this crate agree. Rounding
    /// toward nearest would be more accurate and less consistent; consistency
    /// wins, because a rounding disagreement between two code paths is exactly
    /// the divergence the AEGIS seal is supposed to rule out.
    ///
    /// Both branches are const-folded: `FRAC` and `F2` are compile-time.
    #[inline(always)]
    pub const fn convert<const I2: u8, const F2: u8>(self) -> Q<I2, F2> {
        let () = Self::WIDTH_OK;
        let () = Q::<I2, F2>::WIDTH_OK;

        if F2 >= FRAC {
            let shift = (F2 - FRAC) as u32;
            Q::<I2, F2>(saturate_i32((self.0 as i64) << shift))
        } else {
            let shift = (FRAC - F2) as u32;
            Q::<I2, F2>(self.0 >> shift)
        }
    }

    /// Multiplies across formats into an explicitly-named output format.
    ///
    /// The product is formed at `i64` width (so `FRAC + F2` fractional bits,
    /// up to 62) and then shifted to `FO` fractional bits and saturated. No
    /// intermediate precision is lost before the final shift.
    #[inline(always)]
    pub const fn mul<const I2: u8, const F2: u8, const IO: u8, const FO: u8>(
        self,
        rhs: Q<I2, F2>,
    ) -> Q<IO, FO> {
        let () = Self::WIDTH_OK;
        let () = Q::<I2, F2>::WIDTH_OK;
        let () = Q::<IO, FO>::WIDTH_OK;

        let product = self.0 as i64 * rhs.0 as i64;
        let product_frac = FRAC as u32 + F2 as u32;
        let out_frac = FO as u32;

        if product_frac >= out_frac {
            Q::<IO, FO>(saturate_i32(product >> (product_frac - out_frac)))
        } else {
            Q::<IO, FO>(saturate_i32(product << (out_frac - product_frac)))
        }
    }

    /// Saturating addition. Same format only — adding a `Q2_15` to a `Q2_22`
    /// is a compile error, which is the whole reason this type exists.
    #[inline(always)]
    pub const fn add(self, rhs: Self) -> Self {
        Self(self.0.saturating_add(rhs.0))
    }

    /// Saturating subtraction.
    #[inline(always)]
    pub const fn sub(self, rhs: Self) -> Self {
        Self(self.0.saturating_sub(rhs.0))
    }

    /// Saturating absolute value.
    ///
    /// `saturating_abs`, not `abs`: `i32::MIN` has no positive counterpart and
    /// plain `abs` panics on it in a debug build. On bare metal a panic routes
    /// to the LOTOS fail-safe — a safe outcome, but a bench killed by an
    /// arithmetic edge case rather than by physics.
    #[inline(always)]
    pub const fn abs(self) -> Self {
        Self(self.0.saturating_abs())
    }
}

// -----------------------------------------------------------------------------
// The formats this system actually uses
// -----------------------------------------------------------------------------

/// The UART wire format, and what `Q16 = i32` means everywhere else in this
/// crate. 1 sign + 15 integer + 16 fractional.
pub type Q16_16 = Q<15, 16>;

/// Taylor / Horner evaluation format on the Cortex-A9 NEON unit.
///
/// Two integer bits of headroom, chosen over [`Q1_31`] deliberately: Q1.31
/// represents only `[-1, 1)`, so any Horner intermediate exceeding unit
/// magnitude saturates *silently* and the polynomial result is simply wrong.
/// Since the coefficient set cannot be guaranteed to stay inside unit magnitude
/// across the Gauntlet's chaotic stress tests, headroom beats precision here.
///
/// (The NEON `horner` path that motivated this layout stayed in the firmware
/// effective 27 fractional bits, not 29.
pub type Q2_29 = Q<2, 29>;

/// PL side: the DSP48E1's 25-bit port. Spin configurations, node probabilities.
pub type Q2_22 = Q<2, 22>;

/// PL side: the DSP48E1's 18-bit port. Edge weights, Kondo constraints.
pub type Q2_15 = Q<2, 15>;

/// The format `VQDMULH.S32` is natively built for. Kept for reference and for
/// code that can guarantee unit-magnitude operands; [`Q2_29`] is what the
/// Horner path uses.
pub type Q1_31 = Q<0, 31>;

/// High-precision intermediate buffer. 1 sign + 12 integer + 19 fractional.
///
/// Eight times finer than [`Q16_16`] — a resolution of `2^-19` ≈ 1.907e-6
/// against `2^-16` ≈ 1.526e-5 — bought by giving up integer range: ±4,095
/// instead of ±32,767.
///
/// # What it is for, and what it is not for
///
/// It is for **intermediate** values in a chain of Q16.16 operations, where the
/// inputs and the answer are both comfortably inside ±4,095 but the arithmetic
/// between them would otherwise lose bits to repeated truncation. Utilisation
/// ratios are the clearest case: a pod's CPU request over a node's allocatable
/// is a number between 0 and 1, and summing a hundred of those in Q16.16 throws
/// away three decimal digits that Q12.19 keeps.
///
/// It is **not** a general replacement for Q16.16 and must not become one. The
/// range is the reason: ±4,095 is under three days in a schedule measured in
/// minutes,
/// and [`crate::repair`] marks an off-sequence leg with `i32::MAX / 2`, which is
/// not
/// representable here at all. Converting a value that exceeds the range
/// saturates, and a saturated capacity ceiling is a veto that does not fire.
///
/// Use [`q16_to_q12_19`] and [`q12_19_to_q16`] rather than `Q::convert`, not
/// because they do anything different — they delegate — but because they are
/// greppable, and the places this format is used should be a list someone can
/// read.
pub type Q12_19 = Q<12, 19>;

/// Q16.16 raw → Q12.19 raw, saturating.
///
/// Widening the fraction by 3 bits is a left shift, so precision is gained and
/// nothing is lost — but the integer part narrows from 15 bits to 12, so a
/// magnitude above 4,095 saturates. That is why this returns the raw `i32` and
/// why [`q16_fits_q12_19`] exists next to it: a caller that cannot tolerate
/// saturation should ask first rather than discover it in a verdict.
#[inline(always)]
pub const fn q16_to_q12_19(raw_q16: i32) -> i32 {
    let widened = (raw_q16 as i64) << 3;
    saturate_i32(widened)
}

/// Q12.19 raw → Q16.16 raw.
///
/// Narrowing the fraction by 3 bits is an ARITHMETIC right shift, which floors
/// toward negative infinity rather than truncating toward zero: `-1 >> 3` is
/// `-1`, not `0`. That is the same rule [`Q::convert`] documents, and it is
/// deliberate — a consistent direction is what makes the conversion
/// reproducible, and floor is the direction the rest of this crate uses.
///
/// The integer part widens, so this never saturates.
#[inline(always)]
pub const fn q12_19_to_q16(raw_q12_19: i32) -> i32 {
    raw_q12_19 >> 3
}

/// Whether a Q16.16 raw value survives the trip into Q12.19 unsaturated.
///
/// `±4,095.999998` is the representable range. Ask before converting anything
/// that decides something.
#[inline(always)]
pub const fn q16_fits_q12_19(raw_q16: i32) -> bool {
    let widened = (raw_q16 as i64) << 3;
    widened >= i32::MIN as i64 && widened <= i32::MAX as i64
}

/// Saturating Q12.19 addition on raw values.
#[inline(always)]
pub const fn q12_19_add(a: i32, b: i32) -> i32 {
    saturate_i32(a as i64 + b as i64)
}

/// Saturating Q12.19 subtraction on raw values.
#[inline(always)]
pub const fn q12_19_sub(a: i32, b: i32) -> i32 {
    saturate_i32(a as i64 - b as i64)
}

/// Saturating Q12.19 multiplication on raw values.
///
/// The product of two Q12.19 values has 38 fractional bits, so the `i64`
/// intermediate is shifted right by 19 to land back in Q12.19. Computed in
/// `i64` because the intermediate needs up to 62 bits.
#[inline(always)]
pub const fn q12_19_mul(a: i32, b: i32) -> i32 {
    saturate_i32(((a as i64) * (b as i64)) >> 19)
}

impl Q16_16 {
    /// Adopts a raw `Q16` from the telemetry wire format.
    ///
    /// Zero-cost: `#[repr(transparent)]` means this is a no-op at runtime. It
    /// exists to mark the point where an untyped wire value becomes a typed
    /// compute value.
    #[inline(always)]
    pub const fn from_wire(raw: crate::Q16) -> Self {
        Self::from_raw(raw)
    }

    /// Returns to the raw `Q16` wire representation.
    #[inline(always)]
    pub const fn to_wire(self) -> crate::Q16 {
        self.raw()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn q16_16(v: f64) -> i32 {
        (v * 65536.0) as i32
    }

    #[test]
    fn total_bits_match_the_convention() {
        assert_eq!(Q16_16::TOTAL_BITS, 32);
        assert_eq!(Q2_29::TOTAL_BITS, 32);
        assert_eq!(Q2_22::TOTAL_BITS, 25, "must fit the DSP48E1 25-bit port");
        assert_eq!(Q2_15::TOTAL_BITS, 18, "must fit the DSP48E1 18-bit port");
        assert_eq!(Q1_31::TOTAL_BITS, 32);
    }

    #[test]
    fn q16_16_to_q2_22_is_an_exact_left_shift_by_six() {
        // The property the Hemiunu derivation depends on. 22 - 16 = 6, and the
        // shift is lossless for any value that fits, so the two domains can
        // represent the identical rational number.
        let wire = Q16_16::from_wire(56_229);
        let dsp: Q2_22 = wire.convert();
        assert_eq!(dsp.raw(), 56_229 << 6);
        assert_eq!(dsp.raw(), 3_598_656);
    }

    #[test]
    fn narrowing_truncates_toward_negative_infinity_like_q16_mul() {
        // Documented, deliberate, and consistent with the existing `>> 16` in
        // q16_mul. Not the most accurate choice - the consistent one.
        let v = Q2_22::from_raw(-1);
        let narrowed: Q2_15 = v.convert();
        assert_eq!(
            narrowed.raw(),
            -1,
            "arithmetic shift floors, it does not truncate to 0"
        );

        let v = Q2_22::from_raw(1);
        let narrowed: Q2_15 = v.convert();
        assert_eq!(narrowed.raw(), 0);
    }

    #[test]
    fn widening_saturates_rather_than_wrapping() {
        // A wrapped overflow flips the sign of a physics quantity, which on
        // this bench is a veto that does not fire.
        let big = Q16_16::from_raw(i32::MAX);
        let widened: Q2_29 = big.convert();
        assert_eq!(widened.raw(), i32::MAX);

        let small = Q16_16::from_raw(i32::MIN);
        let widened: Q2_29 = small.convert();
        assert_eq!(widened.raw(), i32::MIN);
    }

    #[test]
    fn round_trip_is_lossless_for_values_representable_in_both_formats() {
        // Q2.29 spans ±4, so the Q16.16 raws that survive are within
        // ±4 × 65536 = ±262_144. Inside that window the round trip is exact.
        for raw in [
            0, 1, -1, 65_536, -65_536, 56_229, -56_229, 262_143, -262_143,
        ] {
            let start = Q16_16::from_raw(raw);
            let wide: Q2_29 = start.convert();
            let back: Q16_16 = wide.convert();
            assert_eq!(back.raw(), raw, "round trip lost data for {raw}");
        }
    }

    #[test]
    fn widening_past_the_destination_range_saturates_and_does_not_round_trip() {
        // The companion to the test above, and the more important one: Q16.16
        // holds ±32768 while Q2.29 holds ±4, so most of Q16.16's range simply
        // does not fit. 1_000_000 raw is 15.26, well outside Q2.29.
        //
        // It must clamp to the top of Q2.29 rather than wrap, and the round
        // trip must NOT come back equal - a silent round trip here would mean
        // the saturation had wrapped into a plausible-looking small value.
        let start = Q16_16::from_raw(1_000_000);
        let wide: Q2_29 = start.convert();
        assert_eq!(wide.raw(), i32::MAX, "must clamp, not wrap");

        let back: Q16_16 = wide.convert();
        assert_ne!(back.raw(), 1_000_000, "information was genuinely lost");
        assert_eq!(back.raw(), i32::MAX >> 13, "clamped value, shifted back");

        // Same on the negative side.
        let start = Q16_16::from_raw(-1_000_000);
        let wide: Q2_29 = start.convert();
        assert_eq!(wide.raw(), i32::MIN);
        assert!(wide.raw() < 0, "must clamp negative, never flip sign");
    }

    #[test]
    fn multiply_places_the_result_in_the_named_output_format() {
        // 2.0 * 3.0 = 6.0, expressed across three different formats.
        let a = Q2_22::from_raw(2 << 22);
        let b = Q2_15::from_raw(3 << 15);
        let product: Q2_22 = a.mul::<2, 15, 2, 22>(b);
        assert_eq!(product.raw(), 6 << 22);
    }

    #[test]
    fn multiply_keeps_full_precision_until_the_final_shift() {
        // The i64 intermediate means no bits are lost before the output shift.
        // 0.5 * 0.5 = 0.25 exactly, even though the intermediate has 37
        // fractional bits.
        let a = Q2_22::from_raw(1 << 21); // 0.5
        let b = Q2_15::from_raw(1 << 14); // 0.5
        let product: Q2_22 = a.mul::<2, 15, 2, 22>(b);
        assert_eq!(product.raw(), 1 << 20, "0.25 in Q2.22");
    }

    #[test]
    fn multiply_saturates_on_overflow() {
        let a = Q2_22::from_raw(i32::MAX);
        let b = Q2_15::from_raw(i32::MAX);
        let product: Q2_22 = a.mul::<2, 15, 2, 22>(b);
        assert_eq!(product.raw(), i32::MAX);
    }

    #[test]
    fn add_and_sub_saturate() {
        let a = Q2_29::from_raw(i32::MAX);
        assert_eq!(a.add(Q2_29::from_raw(1)).raw(), i32::MAX);

        let b = Q2_29::from_raw(i32::MIN);
        assert_eq!(b.sub(Q2_29::from_raw(1)).raw(), i32::MIN);
    }

    #[test]
    fn abs_saturates_instead_of_panicking_on_i32_min() {
        assert_eq!(Q2_29::from_raw(i32::MIN).abs().raw(), i32::MAX);
    }

    #[test]
    fn the_wire_boundary_is_a_no_op() {
        // repr(transparent): adopting a wire value costs nothing at runtime.
        let raw: crate::Q16 = q16_16(0.858);
        assert_eq!(Q16_16::from_wire(raw).to_wire(), raw);
        assert_eq!(
            core::mem::size_of::<Q16_16>(),
            core::mem::size_of::<crate::Q16>()
        );
        assert_eq!(
            core::mem::align_of::<Q16_16>(),
            core::mem::align_of::<crate::Q16>()
        );
    }

    #[test]
    fn distinct_formats_are_distinct_types() {
        // Not a runtime assertion - the point is that this compiles only
        // because every cross-format step is explicit. `a.add(b)` where a is
        // Q2_22 and b is Q2_15 does not compile, which is the feature.
        let a = Q2_22::from_raw(1 << 22);
        let b: Q2_15 = a.convert();
        let c: Q2_22 = b.convert();
        assert_eq!(c.raw(), 1 << 22);
    }
    // ---- Q12.19 -----------------------------------------------------------

    #[test]
    fn q12_19_fits_an_i32_with_its_sign_bit() {
        assert_eq!(Q12_19::TOTAL_BITS, 32);
        assert_eq!(Q12_19::SCALE, 1 << 19);
        // Eight times finer than Q16.16, which is the whole reason it exists.
        assert_eq!(Q12_19::SCALE, Q16_16::SCALE * 8);
    }

    #[test]
    fn the_round_trip_is_exact_for_anything_inside_the_range() {
        // Q12.19 has MORE fractional bits, so a Q16.16 value that fits the
        // narrower integer range survives the trip untouched.
        for raw in [
            0,
            1,
            -1,
            65_536,
            -65_536,
            56_229,
            4_095 * 65_536,
            -4_095 * 65_536,
        ] {
            assert_eq!(q12_19_to_q16(q16_to_q12_19(raw)), raw, "raw {raw}");
        }
    }

    #[test]
    fn the_extra_precision_is_real_and_not_decorative() {
        // One Q12.19 tick is an eighth of a Q16.16 tick. Three values that are
        // all the same number in Q16.16 stay distinct in Q12.19.
        let a = q16_to_q12_19(1) + 1;
        let b = q16_to_q12_19(1) + 2;
        assert_ne!(a, b, "Q12.19 must distinguish sub-Q16.16 differences");
        // ...and collapse to the same Q16.16 value, which is the precision the
        // buffer exists to hold on to between operations.
        assert_eq!(q12_19_to_q16(a), q12_19_to_q16(b));
    }

    #[test]
    fn a_value_past_the_narrower_integer_range_saturates_and_says_so() {
        // 4,096 in Q16.16 is outside Q12.19's +/-4,095 integer range.
        let too_big = 4_096 * 65_536;
        assert!(!q16_fits_q12_19(too_big), "the range check must catch this");
        assert_eq!(
            q16_to_q12_19(too_big),
            i32::MAX,
            "and the conversion saturates"
        );

        // The case that would actually bite: repair's unreachable-leg sentinel.
        assert!(
            !q16_fits_q12_19(i32::MAX / 2),
            "an i32::MAX/2 sentinel must never be silently squeezed into Q12.19"
        );
    }

    #[test]
    fn narrowing_floors_rather_than_truncating_toward_zero() {
        // Arithmetic shift right: -1 >> 3 is -1, not 0. Consistent with
        // Q::convert, and a consistent direction is what makes it reproducible.
        assert_eq!(q12_19_to_q16(-1), -1);
        assert_eq!(q12_19_to_q16(-7), -1);
        assert_eq!(q12_19_to_q16(-8), -1);
        assert_eq!(q12_19_to_q16(7), 0);
    }

    #[test]
    fn q12_19_arithmetic_saturates_rather_than_wrapping() {
        assert_eq!(q12_19_add(i32::MAX, 1), i32::MAX);
        assert_eq!(q12_19_sub(i32::MIN, 1), i32::MIN);
        assert_eq!(q12_19_mul(i32::MAX, i32::MAX), i32::MAX);
    }

    #[test]
    fn q12_19_multiply_is_correct_on_hand_checkable_values() {
        let one = 1 << 19;
        assert_eq!(q12_19_mul(one, one), one, "1.0 * 1.0 == 1.0");
        assert_eq!(q12_19_mul(one * 3, one * 4), one * 12);
        let half = one / 2;
        assert_eq!(q12_19_mul(half, half), one / 4);
    }

    /// The worked case the type was added for: summing a hundred utilisation
    /// ratios. Q16.16 loses ground to repeated truncation; Q12.19 does not.
    #[test]
    fn a_hundred_ratios_accumulate_more_accurately_in_q12_19() {
        // 1/3 of a unit, as close as each format can hold it.
        let third_q16 = 65_536 / 3; // 21845, i.e. 0.33332
        let third_q12 = (1 << 19) / 3; // 174762, i.e. 0.3333320
        let mut sum_q16 = 0i64;
        let mut sum_q12 = 0i64;
        for _ in 0..100 {
            sum_q16 += third_q16 as i64;
            sum_q12 += third_q12 as i64;
        }
        // Exact answer is 33.3333...; measure each format's error in parts per
        // million of a unit, integer arithmetic only.
        let err_q16 = (100 * 65_536 / 3 - sum_q16).abs() * 1_000_000 / 65_536;
        let err_q12 = (100 * (1 << 19) / 3 - sum_q12).abs() * 1_000_000 / (1 << 19);
        assert!(
            err_q12 < err_q16,
            "Q12.19 accumulated error {err_q12} ppm should beat Q16.16's {err_q16} ppm"
        );
    }
}
