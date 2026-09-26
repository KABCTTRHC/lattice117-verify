# Running Lattice117 against published benchmark instances

This directory runs the Tier 5 solver against **instance files you supply**. It
ships no instance data, and that is deliberate — see
[`docs/FIXTURE-B-BENCHMARK.md`](../../docs/FIXTURE-B-BENCHMARK.md) for the
licence position that forced it.

```
# Solomon VRPTW, once you have obtained C101.txt yourself
node tools/benchmark/run.mjs --solomon /path/to/C101.txt

# TSPLIB, EUC_2D coordinate instances
node tools/benchmark/run.mjs --tsplib /path/to/berlin52.tsp
```

## What it measures, and what it cannot

The runner is honest about the mismatch between what these instances ask and
what this engine does:

| | Solomon VRPTW | What Lattice117 does |
|---|---|---|
| Objective | minimise vehicles first, then distance | minimise distance on one tour |
| Capacity | hard constraint | **not modelled** |
| Fleet | many vehicles | one tour, or the assignment you supply |

So the published best-known value for a Solomon instance is **not** a number
this engine's global path can be compared against directly: it is the total
distance of a multi-vehicle, capacity-feasible solution, and ours is a single
uncapacitated tour. The runner says so rather than printing a ratio that looks
like a score. What it does report for a Solomon file is:

* whether every time window in the instance is satisfiable at all under a
  single tour (usually not, which is itself the honest answer);
* the per-round re-sequencing result if you pass an assignment, which is the
  path Tier 5 is actually sold on.

A TSPLIB `EUC_2D` instance **is** directly comparable — single tour, minimise
distance — so `--tsplib` reports the true gap against the published optimum when
you give it one with `--optimum`.

## Distances

TSPLIB `EUC_2D` is defined as `nint(sqrt(dx² + dy²))` — rounded to the nearest
integer, which is part of the instance definition rather than a display choice.
The runner reproduces that exactly, then scales to Q16.16, so a tour length it
reports is comparable to a published one without a conversion argument.

Solomon distances are conventionally left as real Euclidean values; the runner
keeps one decimal place, matching the fixtures in this repository and the
precision Q16.16 represents cleanly.
