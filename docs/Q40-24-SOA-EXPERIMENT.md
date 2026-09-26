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

## The dataset — resolved

It is **`usa13509`, a standard TSPLIB instance**: 13,509 US cities, road-network
derived, public and citable. `LATTICE117_DATAROOM_BENCHMARKS_AND_DATASETS.md`
names it directly alongside `d18512`, `d15112`, `brd14051`, `pcb3038`, `pr2392`
and `rl11849`. So the benchmark is independently reproducible by a third party,
which is worth considerably more than a synthetic generator would have been.

What is missing from the repository is only the *derived* pair
`datasets/matrix_13509.txt` and `datasets/constraints_13509.txt`, and there is a
good reason for that:

| Representation | Size |
|---|---|
| Dense 13,509² matrix as text | **1.46 GB** (0.73 GB upper-triangle only) |
| Dense in RAM as `i32` (Q16.16) | 0.73 GB |
| Dense in RAM as `i64` (Q40.24) | **1.46 GB** |
| The 13,509 coordinate pairs | **216 KB** |

Two consequences follow, and they change the experiment.

**Reproduction is a fetch plus a conversion, not a generator.** Download
`usa13509.tsp` from TSPLIB, parse the `NODE_COORD_SECTION`, and compute EUC_2D
distances. Record the source URL and a SHA-256 of the downloaded `.tsp` in the
results so the run is checkable. The constraints file is *not* from TSPLIB —
`usa13509` is a distance-only single-vehicle instance with **no time windows**,
so any constraints used with it were synthesised locally. That distinction has
to be stated wherever the 13,509 figure is quoted, because the product is sold
on time-window verification and this instance does not test it.

**Q40.24 doubles the footprint of the thing that is already the bottleneck.**
Widening a dense matrix from `i32` to `i64` takes 13,509 nodes from 0.73 GB to
1.46 GB of RAM. On the current workstation that is not viable, so a naive
"same matrix, wider integers" port makes large instances worse, not better.

**The SoA representation that actually matters is therefore coordinates, not a
matrix.** 13,509 `(x, y)` pairs are 216 KB; distances are computed on demand.
That is what TSP solvers do, it is ~6,700× smaller, and it largely removes the
motivation for memory-mapping the matrix at all — part 2 of the brief may be
solving a problem that the right representation deletes.

## Why Q40.24 at all — the concrete number

`usa13509` coordinates run to ~1e5–1e6, so Euclidean distances reach roughly
1e6. **Q16.16 saturates at 32,767** — the instance overflows it by about two
orders of magnitude and cannot be represented at all without rescaling. That,
not speed, is the real argument for a wider fixed-point type, and it is a
checkable fact rather than a preference.

## The f64-staging question, corrected

The cross-architecture framing in the original brief is the wrong test, and the
dataset cannot exercise the right one.

- **x86_64 and aarch64 will not disagree.** IEEE-754 binary64 is fully
  specified and both implement it. The classic divergence sources are `x87`
  80-bit excess precision (32-bit x86 only) and FMA contraction altering
  `a*b+c` rounding — neither applies to a parse-then-scale on either 64-bit
  target. Run it as a **control** that should show zero difference; treat any
  difference as a bug in the harness before believing it is architectural.
- **The real exposure is magnitude, not architecture.** Q40.24 keeps 24
  fractional bits and `f64` has a 53-bit significand, so an f64-staged value is
  exact only while its integer part stays below `2^(53-24) = 2^29 = 536,870,912`.
  Above that, f64 staging silently drops low fractional bits that a direct
  ASCII→integer parse retains.
- **`usa13509` cannot show this.** Its magnitudes (~1e6) are roughly 500× below
  the 2^29 threshold, so f64 staging is *exact* for this dataset and the
  benchmark will show no divergence whatsoever. A null result there means
  nothing.

So the correctness experiment needs its own fixture: values swept across
2^20 → 2^40, comparing direct ASCII→Q40.24 against f64→Q40.24, to locate the
divergence point empirically and confirm it lands where the arithmetic predicts.
That is a few hundred lines and no dataset at all.

A precedent on this engine points the same way: 36,014 realistic Q16.16 values
showed **zero** divergence between the double path and exact decimal arithmetic
— because those magnitudes were small. Q40.24 exists to allow larger ones, which
is exactly where that guarantee stops.

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
| 4 | Synthetic sweep 2^20 → 2^40 locates the direct-parse vs f64-staged divergence point, and it matches the predicted 2^29 |
| 5 | x86_64 vs aarch64 identical (control — a difference here is a harness bug until proven otherwise) |
| 6 | Binary size delta and wall time on `usa13509`, quoted with the source URL and the .tsp SHA-256, and stating that its constraints are synthetic and it has no time windows |
| 7 | Coordinate-SoA (216 KB) measured against dense-matrix (1.46 GB) before any mmap work — if coordinates win, part 2 of the brief is moot |

Criteria 1–3 are non-negotiable. 4–6 are the experiment.
