//! Deterministic schedule repair and VRPTW optimisation.
//!
//! # Provenance
//!
//! Extracted from `KABCTTRHC/sovereign_api`, which is where this engine was
//! written and where its full form still lives. What came across, and from
//! where:
//!
//! | Module | Source |
//! |---|---|
//! | `fixed` | `firmware/core_math/src/fixed.rs` |
//! | Q16 arithmetic below | `firmware/core_math/src/lib.rs` |
//! | `kondo` | `kondo_router/src/lib.rs` |
//! | `miqubo` | `src/engine/universal_miqubo.rs` |
//!
//! `firmware/core_math`'s `horner` module is deliberately **not** here: it
//! carries a NEON `asm!` block for the firmware's sensor path and has no
//! bearing on routing. Importing it would have meant importing an
//! architecture-specific assembly block into a crate whose whole point is to
//! compile identically everywhere.
//!
//! # Why no dependencies
//!
//! This crate compiles to `wasm32` and runs inside a browser page, an Excel
//! task pane and a Google Sheets sidebar. `sovereign_api`'s root crate pulls
//! actix-web, tokio, reqwest and rayon, none of which reach WASM, and rayon in
//! particular would need `SharedArrayBuffer` and therefore COOP/COEP headers
//! that GitHub Pages cannot set. So the two source crates that were already
//! dependency-free are the ones that came across first.
//!
//! # Determinism contract
//!
//! Everything here is integer. No `f32`, no `f64`, and no libm transcendental
//! — CI enforces both, and the second guard exists because the first would not
//! have caught the real defect: `kondo`'s Metropolis acceptance used to call
//! `f64::exp()` on an already-`f64` value, which introduced no new float token
//! while putting a function that is not required to be correctly rounded, and
//! is free to differ between platforms, in the accept/reject decision.
//!
//! Search is step-bounded, never wall-clock bounded. The PRNG is a fixed-seed
//! LCG. Ties resolve by lowest index, never by iteration order.
//!
//! # Status
//!
//! This is the extraction, not the product. The A4 single-sheet repair loop
//! and the referee pipeline described in `docs/TIER4-ENTERPRISE-SPEC.md` are
//! not built yet, and no licence tier grants anything until they are.

#![forbid(unsafe_code)]
#![cfg_attr(not(test), no_std)]

pub mod fixed;
pub mod kondo;
pub mod miqubo;

/// Q16.16 fixed point on `i32`: one integer scaled by 65,536.
pub type Q16 = i32;
/// Q32.32 intermediate, so a Q16.16 multiply or divide cannot overflow.
pub type Q64 = i64;

/// One unit in Q16.16.
pub const Q16_ONE: Q16 = 65_536;

/// Saturating Q16.16 addition.
#[inline(always)]
pub fn q16_add(a: Q16, b: Q16) -> Q16 {
    a.saturating_add(b)
}

/// Saturating Q16.16 subtraction.
#[inline(always)]
pub fn q16_sub(a: Q16, b: Q16) -> Q16 {
    a.saturating_sub(b)
}

/// Q16.16 multiply. Saturates rather than wrapping — a wrapped value yields a
/// *confident* answer about a schedule that was never checked, which is worse
/// than a clamped one.
#[inline(always)]
pub fn q16_mul(a: Q16, b: Q16) -> Q16 {
    ((a as Q64 * b as Q64) >> 16).clamp(Q16::MIN as Q64, Q16::MAX as Q64) as Q16
}

/// Q16.16 divide. Returns 0 on a zero divisor rather than trapping: this code
/// runs in a WASM module with no handler to catch a panic.
#[inline(always)]
pub fn q16_div(a: Q16, b: Q16) -> Q16 {
    if b == 0 {
        return 0;
    }
    (((a as Q64) << 16) / b as Q64).clamp(Q16::MIN as Q64, Q16::MAX as Q64) as Q16
}

/// Absolute value in Q16.16.
#[inline(always)]
pub fn q16_abs(a: Q16) -> Q16 {
    a.abs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn q16_arithmetic_saturates_rather_than_wrapping() {
        assert_eq!(q16_add(Q16::MAX, Q16_ONE), Q16::MAX);
        assert_eq!(q16_sub(Q16::MIN, Q16_ONE), Q16::MIN);
        assert_eq!(q16_mul(Q16::MAX, Q16::MAX), Q16::MAX);
    }

    #[test]
    fn q16_divide_by_zero_returns_zero_rather_than_trapping() {
        assert_eq!(q16_div(5 * Q16_ONE, 0), 0);
    }

    #[test]
    fn q16_round_trips_whole_numbers() {
        for n in [-32_000, -1, 0, 1, 32_000] {
            assert_eq!(q16_div(q16_mul(n * Q16_ONE, Q16_ONE), Q16_ONE), n * Q16_ONE);
        }
    }
}
