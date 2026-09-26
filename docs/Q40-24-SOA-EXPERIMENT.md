# Q40.24 / SoA native ingestion — specification

**Status: SPECIFICATION ONLY. No prototype exists on this branch yet.**
Nothing here has been built, benchmarked or measured. The numbers this
experiment is meant to produce are the whole point of it, and none of them
exist. Do not cite anything in this file as a result.

This branch exists so the work is isolated before it starts. It must never be
merged into `main`, and it must not alter the published WASM or the npm 0.2.0
targets.

---

## What is being asked

A native-only ingestion path for NRE-scale datasets, in four parts.

1. **SoA schedule representation over `Vec<i64>` in Q40.24** — 40 integer bits,
   24 fractional. Range roughly ±5.5e11 with a resolution of 1/16,777,216,
   against Q16.16's ±32,768 at 1/65,536. The range is what matters: Q16.16 caps
   a schedule at ~22 days in minutes, which is the limit a large instance hits
   first.
2. **`memmap2` behind `#[cfg(not(target_arch = "wasm32"))]`** so the browser and
   Excel builds never see it.
3. **Benchmark direct ASCII→Q40.24 parsing against `fast-float` / `lexical-core`
   → Q40.24**, and test whether an `f64` intermediate introduces 1-ULP
   divergence across x86_64 and aarch64.
4. **Report** binary size delta, wall time on the 13,509-node benchmark, and
   whether determinism holds across architectures.

## What has to be true before this is worth doing

**The 13,509-node dataset is not in this repository.** `TRL-POSITION` records
that the large datasets "are not distributed and no generator for them
survives". Without it, part 4 cannot be measured, and an unmeasured performance
claim is exactly the class of statement the engineering records exist to
prevent. Either the dataset is located, or a generator is written and the
results are labelled as synthetic.

## The question that decides the whole experiment

Part 3 is not really a benchmark, it is a correctness test, and the expected
answer is worth stating up front so the result is interpretable:

- **An `f64` intermediate is deterministic across architectures.** IEEE-754
  binary64 arithmetic is fully specified; x86_64 and aarch64 both implement it.
  The divergence risk is not the architecture, it is `x87` 80-bit excess
  precision on 32-bit x86 targets, and FMA contraction changing `a*b+c`
  rounding. Neither applies to a straightforward parse-then-scale on either
  64-bit target.
- **It is not exact, though.** Q40.24 has 24 fractional bits; `f64` has 52 bits
  of mantissa, so for values under ~2^28 the scaling is exact and above that it
  is not. Q16.16 never exposed this because the range was too small to reach it.
  **This is the finding to look for** — not a cross-architecture difference, but
  a magnitude above which `f64` staging silently loses the low fractional bits
  while direct ASCII→integer parsing does not.
- Therefore the measurement that matters is **direct-parse vs f64-staged at
  large magnitudes on one machine**, with the cross-architecture run as the
  control that should show no difference at all.

A prior measurement on this engine already found the same shape of problem in
the opposite direction: 36,014 realistic Q16.16 values showed **zero**
divergence between the double path and exact decimal arithmetic, because the
magnitudes were small. Q40.24 is being adopted precisely to allow larger
magnitudes, which is where that guarantee stops holding.

## Why it must stay off main

- Q16.16 on `i32` is what every published digest was computed with. A
  Q40.24 path that ever touched the shared evaluation core would invalidate
  `611eef21…`, `e249d90e…` and every certificate issued to a customer.
- `memmap2` is a dependency, and the WASM module's selling point is that it has
  none. The `cfg` gate must be proven by building for `wasm32-unknown-unknown`
  and confirming the dependency does not appear, not assumed from the attribute.

## Acceptance criteria

| # | Criterion |
|---|---|
| 1 | `cargo build --target wasm32-unknown-unknown` succeeds and the WASM is byte-identical to main's |
| 2 | `cargo tree --target wasm32-unknown-unknown` shows no `memmap2` |
| 3 | Q16.16 digests on main's fixtures are unchanged |
| 4 | Direct-parse and f64-staged results compared at increasing magnitude, divergence point identified |
| 5 | x86_64 vs aarch64 results identical, or the difference explained |
| 6 | Binary size delta and wall time reported against a named, reproducible dataset |

Criteria 1–3 are non-negotiable. 4–6 are the experiment.
