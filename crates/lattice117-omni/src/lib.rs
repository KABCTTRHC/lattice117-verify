// Lattice117
// Copyright (C) 2026 Brierley Sovereign Group Ltd <kurtisbrierley@gmail.com>
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
// for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
//
// Alternatively, this file is available under a commercial licence from
// Brierley Sovereign Group Ltd. See LICENSE-COMMERCIAL.md.

//! Omni-hardware soak kernel.
//!
//! One **cycle** is a whole, generated planning problem taken through every
//! integer stage this workspace ships:
//!
//! 1. an instance of 6 to 40 nodes is generated from the cycle's seed (fixed
//!    LCG, integer coordinates, integer Euclidean distances in Q16.16);
//! 2. `lattice117-solve::global` plans a tour (exhaustive search up to nine
//!    nodes, the Kondo QUBO annealer and 2-opt above that);
//! 3. `lattice117-verify::evaluate_order` referees that tour against
//!    generated time windows;
//! 4. `resequence` searches the best order of the tour's first stops exactly;
//! 5. `repair` re-times that round, or says exactly why it cannot be.
//!
//! Every result is written out as `i32`s and folded into a SHA-256 chain:
//! `chain' = SHA-256(chain || seed || length || outputs)`. Two devices that
//! run cycles `0..k` must hold the same chain at `k`, bit for bit, however
//! hot, slow or throttled either became. That is the claim the soak page
//! tests for half an hour at a time.
//!
//! The published referee module (`lattice117_wasm.wasm`, 21,525 bytes) is
//! untouched: every digest in the white paper and the device captures came
//! from it. This is a second module, loaded beside it.
//!
//! Integer only. No floats, no clock, no host calls: the kernel cannot tell
//! how long it took, which is why the page measures that from outside.

#![forbid(unsafe_op_in_unsafe_fn)]

use lattice117_solve::repair::{repair_fixed_sequence, Round, Stop};
use lattice117_solve::{global, resequence, Q16};
use lattice117_verify::evaluate_order;

/// Bumped whenever a cycle's outputs change meaning, so a capture names the
/// kernel it ran.
pub const OMNI_KERNEL_VERSION: u32 = 1;

const Q: i64 = 65_536;
/// Largest instance a cycle generates, depot included.
pub const MAX_NODES: usize = 40;
/// Smallest instance a cycle generates, depot included.
pub const MIN_NODES: usize = 6;

/// Knuth's MMIX LCG. Wrapping `u64` arithmetic: identical on every target.
struct Lcg(u64);

impl Lcg {
    fn new(seed: u32) -> Self {
        // Spread the seed so consecutive seeds do not start in step.
        Lcg((seed as u64) ^ 0x9E37_79B9_7F4A_7C15) // float-guard: allow (hex constants)
    }
    fn next(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) as u32
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

/// Integer square root, floor, by Newton's method on `u64`.
fn isqrt(v: u64) -> u64 {
    if v < 2 {
        return v;
    }
    let mut x = v;
    let mut y = x.div_ceil(2);
    while y < x {
        x = y;
        y = (x + v / x) / 2;
    }
    x
}

fn push_i64(out: &mut Vec<i32>, v: i64) {
    out.push(v as i32);
    out.push((v >> 32) as i32);
}

/// Runs one cycle and returns its outputs. Pure: the same seed gives the same
/// vector on every target.
pub fn cycle(seed: u32) -> Vec<i32> {
    let mut r = Lcg::new(seed);
    let n = MIN_NODES + r.below((MAX_NODES - MIN_NODES + 1) as u32) as usize;

    // Coordinates on a 1,000-unit square; distances are the integer floor of
    // the Euclidean distance, in whole units, scaled to Q16.16. A tour of 40
    // such points is a few thousand units, well inside the 32,767-unit range
    // Q16.16 times can hold, so the referee judges real arrivals.
    let pts: Vec<(i64, i64)> = (0..n)
        .map(|_| (r.below(1000) as i64, r.below(1000) as i64))
        .collect();
    let mut matrix = vec![0 as Q16; n * n];
    for i in 0..n {
        for j in 0..n {
            let (dx, dy) = (pts[i].0 - pts[j].0, pts[i].1 - pts[j].1);
            matrix[i * n + j] = (isqrt((dx * dx + dy * dy) as u64) as i64 * Q) as Q16;
        }
    }

    let mut out = Vec::with_capacity(4 * MAX_NODES + 64);
    out.push(n as i32);

    // 2. Plan.
    let plan = global::solve_unassigned_default(&matrix, n);
    push_i64(&mut out, plan.cost_q16);
    push_i64(&mut out, plan.pipeline_cost_q16);
    push_i64(&mut out, plan.uncrossed_q16);
    out.push(plan.clusters as i32);
    out.push(plan.qubo_valid as i32);
    out.push(plan.exact as i32);
    out.push(plan.tour.len() as i32);
    out.extend(plan.tour.iter().map(|&v| v as i32));

    // 3. Referee the plan against generated windows. Half the cycles get
    // windows wide enough to pass and half get windows that should bite, so
    // both the accept and the violation path run all the time.
    let tight = seed % 2 == 1;
    let mut windows: Vec<(Q16, Q16)> = Vec::with_capacity(n);
    for i in 0..n {
        let open = if i == 0 { 0 } else { r.below(2000) as i64 };
        // Wide windows close at 30,000 units: open-ended in practice, and
        // still a value Q16.16 can hold (32,767 is the ceiling).
        let close = if tight {
            open + 50 + r.below(400) as i64
        } else {
            30_000
        };
        windows.push(((open * Q) as Q16, (close * Q) as Q16));
    }
    match evaluate_order(&plan.tour, &matrix, n, &windows) {
        Ok(arrival) => {
            out.push(0);
            out.push(arrival);
        }
        Err(v) => {
            out.push(1);
            out.push(v.node_id as i32);
            out.push(v.arrival_time_q16);
            out.push(v.window_close_q16);
            out.push(v.deficit_q16);
        }
    }

    // 4 and 5. The tour's first stops as one round, resequenced exactly and
    // re-timed.
    let k = (n - 1).min(resequence::EXACT_LIMIT);
    let mut stops = Vec::with_capacity(k + 2);
    let mut prev = 0usize;
    for (pos, &id) in plan.tour.iter().take(k + 1).enumerate() {
        let (open, close) = windows[id];
        let travel = if pos == 0 { 0 } else { matrix[prev * n + id] };
        stops.push(Stop {
            id,
            open_q16: open,
            close_q16: close,
            travel_q16: travel,
        });
        prev = id;
    }
    stops.push(Stop {
        id: 0,
        open_q16: 0,
        close_q16: Q16::MAX,
        travel_q16: matrix[prev * n],
    });
    let round = Round {
        id: seed as usize,
        depart_q16: 0,
        stops,
    };

    let rs = resequence::resequence_round(&round, &matrix, n);
    out.push(rs.searched as i32);
    out.push(rs.best.len() as i32);
    out.extend(rs.best.iter().map(|&p| p as i32));
    push_i64(&mut out, rs.saving_q16());

    let rep = repair_fixed_sequence(core::slice::from_ref(&round));
    out.push(rep.feasible_before as i32);
    out.push(rep.feasible_after as i32);
    out.push(rep.changes.len() as i32);
    for c in &rep.changes {
        out.push(c.from_q16);
        out.push(c.to_q16);
    }
    out.push(rep.residual.len() as i32);
    for res in &rep.residual {
        out.push(res.stop_id as i32);
        out.push(res.arrival_q16);
        out.push(res.deficit_q16);
    }
    out
}

/// Folds one cycle into the chain: `SHA-256(chain || seed || len || outputs)`,
/// every integer little-endian.
pub fn fold(chain: &[u8; 32], seed: u32, outputs: &[i32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(chain);
    h.update(&seed.to_le_bytes());
    h.update(&(outputs.len() as u32).to_le_bytes());
    for v in outputs {
        h.update(&v.to_le_bytes());
    }
    h.finish()
}

/// The chain after cycles `0..count`, from the all-zero start.
pub fn chain_to(count: u32) -> [u8; 32] {
    let mut c = [0u8; 32];
    for seed in 0..count {
        c = fold(&c, seed, &cycle(seed));
    }
    c
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), integer only. In the kernel rather than in JavaScript
// so a cycle is one synchronous call; tests check it against the standard's
// vectors, and tests/omni.test.mjs checks the whole chain against node:crypto.

#[rustfmt::skip]
const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, // float-guard: allow (hex constants)
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, // float-guard: allow (hex constants)
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, // float-guard: allow (hex constants)
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, // float-guard: allow (hex constants)
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

pub struct Sha256 {
    state: [u32; 8],
    block: [u8; 64],
    used: usize,
    total: u64,
}

impl Default for Sha256 {
    fn default() -> Self {
        Self::new()
    }
}

impl Sha256 {
    #[rustfmt::skip]
    pub fn new() -> Self {
        Sha256 {
            state: [
                0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, // float-guard: allow (hex constants)
                0x5be0cd19,
            ],
            block: [0; 64],
            used: 0,
            total: 0,
        }
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.total = self.total.wrapping_add(data.len() as u64);
        while !data.is_empty() {
            let take = (64 - self.used).min(data.len());
            self.block[self.used..self.used + take].copy_from_slice(&data[..take]);
            self.used += take;
            data = &data[take..];
            if self.used == 64 {
                let b = self.block;
                self.compress(&b);
                self.used = 0;
            }
        }
    }

    pub fn finish(mut self) -> [u8; 32] {
        let bits = self.total.wrapping_mul(8);
        self.update(&[0x80]);
        while self.used != 56 {
            self.update(&[0]);
        }
        self.update(&bits.to_be_bytes());
        let mut out = [0u8; 32];
        for (i, w) in self.state.iter().enumerate() {
            out[i * 4..i * 4 + 4].copy_from_slice(&w.to_be_bytes());
        }
        out
    }

    fn compress(&mut self, b: &[u8; 64]) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b2, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b2) ^ (a & c) ^ (b2 & c);
            let t2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b2;
            b2 = a;
            a = t1.wrapping_add(t2);
        }
        for (s, v) in self.state.iter_mut().zip([a, b2, c, d, e, f, g, h]) {
            *s = s.wrapping_add(v);
        }
    }
}

// ---------------------------------------------------------------------------
// C ABI for the page. Same memory protocol as `lattice117-wasm`.

/// Allocates `size` bytes in linear memory. Return it with [`omni_free`].
#[no_mangle]
pub extern "C" fn omni_alloc(size: usize) -> *mut u8 {
    let mut buf: Vec<u8> = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// Returns a block from [`omni_alloc`].
///
/// # Safety
///
/// `ptr` must have come from [`omni_alloc`] with the same `size`.
#[no_mangle]
pub unsafe extern "C" fn omni_free(ptr: *mut u8, size: usize) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, 0, size) });
    }
}

/// The kernel version, so a capture names what it ran.
#[no_mangle]
pub extern "C" fn omni_version() -> u32 {
    OMNI_KERNEL_VERSION
}

/// Runs cycle `seed`, folds it into the 32-byte chain at `chain_ptr` in place,
/// and copies up to `cap` output `i32`s to `out_ptr`. Returns the number of
/// outputs the cycle produced (which may exceed `cap`; only `cap` are copied).
///
/// # Safety
///
/// `chain_ptr` must point at 32 writable bytes; `out_ptr` at `cap` writable
/// `i32`s (or be null with `cap == 0`).
#[no_mangle]
pub unsafe extern "C" fn omni_step(
    seed: u32,
    chain_ptr: *mut u8,
    out_ptr: *mut i32,
    cap: usize,
) -> usize {
    let outputs = cycle(seed);
    let chain = unsafe { &mut *(chain_ptr as *mut [u8; 32]) };
    *chain = fold(chain, seed, &outputs);
    if !out_ptr.is_null() {
        let dst = unsafe { core::slice::from_raw_parts_mut(out_ptr, cap) };
        for (d, s) in dst.iter_mut().zip(outputs.iter()) {
            *d = *s;
        }
    }
    outputs.len()
}

/// Runs cycle `seed` without touching any chain, copying up to `cap` outputs
/// to `out_ptr`. The page re-runs a cycle it has already folded and compares
/// the two output vectors: the same seed must give the same integers on the
/// same device however hot it has become. Returns the output count.
///
/// # Safety
///
/// `out_ptr` must point at `cap` writable `i32`s.
#[no_mangle]
pub unsafe extern "C" fn omni_run(seed: u32, out_ptr: *mut i32, cap: usize) -> usize {
    let outputs = cycle(seed);
    let dst = unsafe { core::slice::from_raw_parts_mut(out_ptr, cap) };
    for (d, s) in dst.iter_mut().zip(outputs.iter()) {
        *d = *s;
    }
    outputs.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    #[test]
    fn sha256_matches_the_fips_vectors() {
        let h = |s: &[u8]| {
            let mut x = Sha256::new();
            x.update(s);
            hex(&x.finish())
        };
        assert_eq!(
            h(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            h(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            h(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        let mut x = Sha256::new();
        for _ in 0..1000 {
            x.update(&[b'a'; 1000]);
        }
        assert_eq!(
            hex(&x.finish()),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    #[test]
    fn a_cycle_is_a_pure_function_of_its_seed() {
        for seed in [0u32, 1, 2, 117, 4_000_000_000] {
            assert_eq!(cycle(seed), cycle(seed));
        }
        assert_ne!(cycle(0), cycle(1));
    }

    #[test]
    fn both_referee_paths_run() {
        let (mut ok, mut bad) = (0, 0);
        for seed in 0..64u32 {
            let o = cycle(seed);
            let tour_len = o[10] as usize;
            match o[11 + tour_len] {
                0 => ok += 1,
                1 => bad += 1,
                x => panic!("unexpected referee status {x}"),
            }
        }
        assert!(ok > 0 && bad > 0, "accepted {ok}, violations {bad}");
    }

    #[test]
    fn every_tour_visits_every_node() {
        for seed in 0..64u32 {
            let o = cycle(seed);
            let n = o[0] as usize;
            let tour: Vec<usize> = o[11..11 + o[10] as usize]
                .iter()
                .map(|&v| v as usize)
                .collect();
            let mut seen = vec![0; n];
            for &v in &tour[..tour.len() - 1] {
                seen[v] += 1;
            }
            assert!(seen.iter().all(|&s| s == 1), "seed {seed}: {tour:?}");
        }
    }

    /// The checkpoints the page compares against. If one of these moves, every
    /// capture taken with the old kernel stops matching: bump
    /// OMNI_KERNEL_VERSION and the page's EXPECT together.
    #[test]
    fn checkpoints_are_pinned() {
        assert_eq!(hex(&chain_to(10)), CHECKPOINT_10);
        assert_eq!(hex(&chain_to(100)), CHECKPOINT_100);
    }

    /// Every seed in a long range runs clean in a debug build (overflow
    /// checks on). Ignored by default because it takes a while; CI-sized
    /// coverage is the 64-seed tests above. `cargo test -p lattice117-omni --
    /// --ignored` runs it.
    #[test]
    #[ignore]
    fn three_thousand_seeds_run_clean() {
        for seed in 0..3000u32 {
            let o = cycle(seed);
            let n = o[0] as usize;
            assert_eq!(o[10] as usize, n + 1, "seed {seed}: tour length");
        }
    }

    const CHECKPOINT_10: &str = "445986e880b974951c9e892707b7b231ddd4a54d24f5625361ddd5cac0a489eb";
    const CHECKPOINT_100: &str = "9a89085eb18263d2a44862603237c93b96bf9f1ccdbdf51974b0a46565c6d6c3";
}
