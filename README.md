# lattice117-verify

**Deterministic time-window feasibility verification.** Checks whether a
schedule is actually feasible — and when it isn't, names the exact stop that
breaks, when the vehicle arrives, when the window shut, and by how much it was
missed.

It does not build schedules. It checks one somebody else built.

```
  FAIL  0 of 1 routes feasible · 1 violation(s)

  ▸ VAN-01 — stop Bravo-Eng
      arrives           25.0000 minutes   (Q16.16 1638400)
      window shuts      20.0000 minutes   (Q16.16 1310720)
      late by            5.0000 minutes   (Q16.16 327680)

  verdict digest  611eef21de58485fe4727b74f54f4f6a06e1e1bf9567384c989a1e75b5cac085
  re-run this file and the digest is identical, or determinism is broken
```

## Why verification rather than optimisation

Route *construction* is hard and every solver has known limits. Route
*verification* does not: checking a given order against its time windows is an
exact dynamic program.

That distinction is the whole design. This tool is useful regardless of which
planner produced the schedule — OR-Tools, jsprit, VROOM, SAP, or a spreadsheet
— because it never has to be better than them at building. It only has to be
right about whether what they built holds.

**Zero switching cost.** You replace nothing. You check the incumbent's
homework.

## Determinism

No floating point in the evaluation path. Every value is Q16.16 fixed-point
`i32`, so the same input produces a bit-identical result on any machine, on
every run.

The CLI prints a SHA-256 digest over the input and the verdict. Run it twice
and compare: identical, or determinism is broken. You are not asked to trust
the claim — you can check it.

## Air-gapped

The binary opens no sockets. Files in, verdict out. No telemetry, no licence
check, no network of any kind. It runs in an export-controlled or otherwise
disconnected environment because there is nothing in it that wants to phone
home.

## Install

```sh
cargo install lattice117-audit
```

Or build from source:

```sh
git clone https://github.com/KABCTTRHC/lattice117-verify
cd lattice117-verify
cargo build --release
```

## Use

```sh
lattice117-audit --input schedule.json          # human-readable
lattice117-audit --input schedule.json --json   # machine-readable
cat schedule.json | lattice117-audit            # stdin
```

**Exit codes** — `0` feasible, `1` infeasible, `2` bad input. Distinct so it
works as a CI gate: check your planner's output on every commit rather than in
a meeting afterwards.

### Input

```json
{
  "schema": "lattice117.audit.v1",
  "time_unit": "minutes",
  "nodes": [
    {"id": "depot",     "ready": 0, "due": 480},
    {"id": "ACME-Ltd",  "ready": 0, "due": 100},
    {"id": "Bravo-Eng", "ready": 0, "due": 100}
  ],
  "distance_matrix": [[0, 10, 20], [10, 0, 15], [20, 15, 0]],
  "routes": [
    {"vehicle": "VAN-01", "stops": ["depot", "ACME-Ltd", "Bravo-Eng", "depot"]}
  ]
}
```

Travel times and time windows share one unit. The tool never assumes what that
unit is — it echoes your `time_unit` label back and reports in it. Node 0 is
the route origin.

Values outside the Q16.16 representable range (−32,768 to 32,767) are a hard
input error naming the offending field, not a silent wrap. A wrapped value
would produce a confident verdict about a schedule that was never checked.

## Library

```rust
use lattice117_verify::{evaluate_order, Q16_ONE};

match evaluate_order(&route, &distances_q16, node_count, &windows) {
    Ok(final_arrival) => { /* feasible */ }
    Err(v) => println!(
        "stop {} arrives {} but its window shut at {} — late by {}",
        v.node_id, v.arrival_time_q16, v.window_close_q16, v.deficit_q16
    ),
}
```

## Provenance

This verification core is extracted from the Lattice117 engine, where it is
covered by 196 passing tests and has been validated against the **published
SINTEF Solomon C101 benchmark instance and its published solution** — third-party
data, independently checkable. Deterministic bit-identical output is confirmed
to 13,509 nodes.

Running a real published benchmark solution through this checker once surfaced
a genuine defect in that published data.

## Licence

Dual-licensed: **AGPL-3.0-or-later** (see [LICENSE](LICENSE)) or a
**commercial licence** (see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md)) for
organisations that cannot release their source.

Built in Nottingham.
