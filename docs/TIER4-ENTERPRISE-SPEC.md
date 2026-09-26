# Tier 4 — Enterprise Optimizer: specification and gating

**Status: specification under review. Not committed to a ship date.**
Written against the repository as it stands at `daa7878`. Everything below is
either checked against the code, or marked as a judgement.

The commercial thesis is sound and the determinism design is the right one. Two
data-model blockers and one liability gate stand between this plan and a
shippable Tier 4, and none of them is a solver problem. They are named first
because the October–January phasing depends on which way each is resolved.

---

## 1. The three gates

### Gate A — you cannot re-sequence a route you have no matrix for

**The spreadsheet path carries no distance matrix.** `demo/example-route-sheet.csv`
is:

```
vehicle,seq,stop,window_open,window_close,travel_mins_from_previous
```

`travel_mins_from_previous` is travel *along the sequence the planner already
chose*. It tells you the cost of the given order and nothing about any other
order. 2-opt and Or-opt both need `d(i,j)` for pairs that are not adjacent in
the current route, and that data does not exist anywhere in the sheet.

The JSON path is different: `lattice117.audit.v1` carries a real
`distance_matrix`, and `solve_intra_cluster_branchless` in `dp.rs` already takes
`distance_matrix: &[i32]`. So the CLI can re-sequence. **The spreadsheet cannot**
— and the spreadsheet is where every Tier 2 and Tier 3 customer is.

Four ways out, with what each costs:

| Option | What it means | Cost |
|---|---|---|
| **A1** Ask for a matrix | Customer supplies a second sheet, or an `n×n` block | Real friction; most planners do not have one |
| **A2** Geocode and compute | Addresses → coordinates → haversine or road distance | **Breaks the product.** Geocoding is a network call. "No data leaves your machine" is the entire GDPR pitch in the care-home outreach and the whole claim of the white paper |
| **A3** Enterprise = JSON/CLI only | Repair ships to the Tier 3 CI/CD buyer, not the spreadsheet buyer | Honest and shippable, but it is not the £499 depot buyer in the plan |
| **A4** Repair without re-sequencing | Keep the order; shift departure times, insert waits, move the break, reassign a whole round between vehicles | Weaker than "re-sequences the stops", but needs **no new data at all** |

**Recommendation: A4 first, A1 as an Enterprise upsell, never A2.** A4 is
shippable on the existing schema and genuinely fixes a large share of real
breaches, because most time-window failures are departure-time and slack
problems rather than ordering problems. Ship A4 as "Repair", then sell A1 as
"Re-sequence" to customers who can export a matrix from their TMS.

Marketing copy must not say "re-sequences the stops" until A1 or A3 is built.

### Gate B — rota repair needs facts the rota does not contain

The same problem, in a form that is easier to miss. `demo/example-rota.csv` is:

```
Staff Name,Date,Shift Start,Shift End,Break (mins)
```

To *detect* a rest breach, that is enough. To *repair* one by "swapping
compliant relief staff", the engine would need to know: who else is employed,
who is qualified for that role, who is contracted for those hours, who is
already at their weekly limit, who has opted out of the 48-hour week, who is
available on that date, and who is a "shift worker" within reg. 22(2). **None of
it is in the sheet, and most of it is not in any sheet.**

A solver that swaps staff without those facts produces a confident, sealed,
digest-bearing rota that may be unlawful, unstaffable, or both. That is the
failure mode `docs/WTR-EXCEPTIONS-REG21-24.md` already rules out for detection —
"inferring any of them from a spreadsheet would produce a confident verdict
about something never checked" — and repair makes it materially worse.

**Recommendation:** rota repair ships as **break placement and shift-time
adjustment within existing assignments only**. Moving a break earlier to clear a
reg. 12 breach, or sliding a shift start to clear a reg. 10(1) rest breach,
needs no data beyond the sheet. Staff swapping needs a staffing model and should
be scoped as a separate product, not a solver mode.

A correction to the plan's wording, per that same note: **reg. 22(1)(a) is not a
configurable threshold.** It is a factual disapplication that turns on whether a
worker is a shift worker who changed shift and could not take rest. A solver
cannot "respect" it. The most it can do is accept a per-worker declaration
supplied as data, and by §5.4 of the white paper that declaration would have to
enter the canonical form because it changes the verdict.

### Gate C — repair changes the liability posture, and one known defect becomes active

This is the gate that matters most, and it is not technical.

Today the product is an **indicative check** that says *look at this*. Every
surface says so, and `SCOPE_NOTE` lists what it does not know. A false positive
costs a manager five minutes. A false negative is disclosed.

A repair tier **authors the schedule**. "Not legal advice" is a much weaker
position when the tool produced the rota, sealed it with a digest, and the
operator ran it because the tool said it was clear.

Concretely, one open defect changes character entirely:

> §5.5 of the white paper: rest is measured in **civil** minutes. On the
> spring-forward night, an 11-hour clock gap is 10 real hours, and the engine
> reports it clear.

In diagnostic mode that is a false negative on a rota the customer wrote. **In
repair mode the optimizer would generate that rota**, land on it as a valid
solution, and certify it — because from the solver's view a 10-hour real rest
scores as compliant. The tool would become an active producer of the
non-compliance it exists to catch, once a year, in the unsafe direction.

**Gate: rota repair must not ship before the elapsed-time fix (`lattice117.rota.v2`,
declared UTC offset per shift, specified in `docs/WTR-REG10-CLOCK-CHANGE.md`).**
That is a dependency the October–January plan does not currently show, and it
moves every rota digest, so it is a versioned release in its own right.

Fleet repair does not carry this gate and can proceed independently.

---

## 2. What already exists — audited in `sovereign_api`

**Second correction to this spec.** The first draft said the local search did not
exist; that was wrong. The second draft found it but audited only the root
crate's `src/`. `sovereign_api` is a **six-crate repository**, and three of the
crates that matter most for Tier 4 were outside the directory I looked at.

| Crate | Path | Dependencies |
|---|---|---|
| `lattice117_core` | root `src/` | actix-web, tokio, reqwest, rayon, libloading |
| `kondo_router` | `kondo_router/` | **none** |
| `lattice117_core_math` | `firmware/core_math/` | **none**, and `no_std` |
| `lithos_q` | `firmware/lithos_q/` | bare-metal firmware |
| `quantum_hydro_core` | `lattice117/` | separate engine |
| `lattice117_edge` | `lattice/` | edge gateway |

### 2.1 The VRPTW solver — present, integer, and more complete than described

| Module | Lines | Floats | What it is |
|---|---|---|---|
| `engine/construction.rs` | 223 | 2 (test-only) | `build_insertion_heuristic_fleet`, `find_cheapest_feasible_insertion` |
| `engine/recombination.rs` | 620 | 4 (test-only) | `try_cross_exchange`, `splice_at_seam`, `try_recombine_pair`, `validate_candidate`, `CoverageBitset`, `route_distance_q16` |
| `engine/topological_dp.rs` | 204 | 0 | `solve_intra_cluster_branchless` — already extracted as `dp.rs` |
| `engine/capacity.rs` | 53 | 0 | capacity feasibility |
| `engine/execution_core.rs` | 79 | 0 | — |
| `engine/orchestrator.rs` | 128 | 0 | — |
| `engine/mod.rs` | 4,575 | 57 (other verticals) | `VrptwCoreInput`, `VrptwCoreOutcome`, `evaluate_order_with_dp`, `execute_universal_compute_core`, the three distance-matrix parsers |
| `ffi/vrptw_solve.rs` | 309 | 2 | `#[no_mangle] pub unsafe extern "C" fn lattice117_solve_vrptw` — an end-to-end C-ABI solve |

The `.sqrt()` calls in `construction.rs` and `recombination.rs` are **inside
`#[cfg(test)]`** (from lines 143 and 411 respectively) — Euclidean fixture
builders, not production code. Verified, not assumed.

### 2.2 Two crates that are already WASM-shaped

This is the finding that changes the port estimate most.

**`kondo_router` has no dependencies at all.** 655 lines: `kondo_cluster_nodes`,
`build_inter_cluster_qubo`, `solve_intra_cluster_chain(cluster, distance_matrix,
n_nodes)`, `solve_logistics_kondo`, `extract_cluster_tour`, `validate_tour`. It
compiles to `wasm32-unknown-unknown` essentially as-is.

**`lattice117_core_math` has no dependencies and is `no_std`.** 1,144 lines, four
float mentions. Its own manifest comment states the constraint: *"This crate must
build for any bare-metal target with nothing but core — no alloc, no libm, no
OS."* That is the WASM constraint, already met. It carries `q16_add/sub/mul/div/
abs`, `horner_eval`, `horner_eval_q2_29`, and a **generic fixed-point type
`Q<const INT: u8, const FRAC: u8>(i32)`** — which is the Q16.16 → Q40.24 path
§8 of the white paper describes as future work, already written.

### 2.3 The one genuine determinism blocker, and its fix is already in the repo

`kondo_router`'s `default_qubo_solver` is simulated annealing, and its
Metropolis acceptance test is:

```rust
next_rand() < (-(delta as f64) / t.max(1e-6)).exp()
```

**`f64::exp()` is a libm transcendental.** §2 of the white paper names exactly
this as the classic divergence source: library implementations of transcendental
functions are not required to be correctly rounded and differ between platforms.
The RNG beside it is a fixed-seed LCG (`117`, 1664525/1013904223) and so is fine,
but it yields `f64`, and the temperature schedule is `f64` too.

So `kondo_router` would compile to WASM and would **not** be bit-identical across
platforms. It is the single highest-risk component found in either repository,
and it is the only libm transcendental left in any production route path —
confirmed by scanning `engine/` and `kondo_router/` for `.exp/.ln/.log/.sin/.cos/
.tan/.powf/.sqrt`.

**The replacement already exists.** `math_vault/feynman.rs:48` and
`engine/sentinel_qbn.rs:26` both define:

```rust
pub fn fast_exp_negative(x: i32) -> i32
```

— a branchless `i128`-intermediate rational approximation of `e^-x` in Q16.16,
with a documented clamp and no float anywhere. Porting the annealer means
swapping the acceptance test onto it and moving the temperature schedule to
Q16.16. That is a contained change to one function, not a rewrite.

### 2.4 Repair primitives already exist

`governor/xai_surrogate.rs` (97 lines) defines `CounterfactualSuggestion` and
`explain_violation(&TimeParadoxViolation) -> CounterfactualSuggestion`. It
returns the node id and `required_change_q16`, which is the violation's own
`deficit_q16` carried through unchanged — the minimal single-node correction, in
pure Q16.16. Its single `f64` is in the human-readable `description` string, not
the arithmetic.

Its doc comment is admirably precise about what it is not: *"This function does
not search a space of alternatives."* That is exactly the **A4 repair primitive
in embryo** — it already computes how much a stop must move; what is missing is
the loop that applies the shift and re-verifies.

### 2.5 `service_time` — modelled, not wired

Unchanged from the second draft and worth restating precisely: declared
`pub service_time: i32, // Q16.16` at `lib.rs:274` and `modules.rs:164`; used
only in the `f64` legacy path at `modules.rs:217`; never threaded into the
engine's `time_windows` or the DP — confirmed independently by
`topological_dp.rs:99` and `bin/lattice117_tournament.rs:221`. The field, type
and scale exist. It is plumbing.

### 2.6 What this does *not* change

**Gate A stands.** `route_distance_q16`, `find_cheapest_feasible_insertion` and
`solve_intra_cluster_chain` all take a distance matrix. No amount of solver
maturity conjures `d(i,j)` from a CSV carrying only `travel_mins_from_previous`.
What the audit changes is that the **JSON/TMS path (A1/A3) is now close to
free** — `parse_text_distance_matrix`, `parse_binary_distance_matrix` and a
whole C-ABI solve entry already exist. A4 remains the single-sheet answer.

**Gate C stands, and gets more urgent** for the same reason: the less work fleet
repair needs, the sooner the temptation arrives to ship rota repair beside it
before `lattice117.rota.v2` lands.

### 2.7 Carried over, still true

- The `f32`/`f64` CI guard covers only `lattice117-verify` and
  `lattice117-wasm`. `lattice117-solve` must join it, and the guard should
  tolerate `#[cfg(test)]` float fixtures or it will fail on ported tests.
- `rayon` (`Cargo.toml:59`, used at `mod.rs:2329`) cannot reach WASM without
  `SharedArrayBuffer`, which needs COOP/COEP headers GitHub Pages cannot set.
  It must compile out for `wasm32`.
- `mod.rs:2319` justifies order preservation by `IndexedParallelIterator`;
  `filter_map` is unindexed, so the reasoning is wrong even though rayon's
  `collect()` does preserve order. Fix the comment before someone refactors to
  `reduce`.
- `tests/golden_vrptw.rs` (98 lines) is the regression anchor to port. Note its
  test is `async`, so it pulls tokio — it needs desugaring for a WASM harness.
- `tier: 'enterprise'` needs no new licensing infrastructure.
- Q16.16 at 1,000 stops is 4 MB dense `i32`, 8 MB `i64`.
- Call it a **digest**, not a seal.

---

## 3. Determinism design

The step-bounded approach is right, and §2 shows most of it is how the engine
already behaves. Four requirements, each a taxonomy category:

1. **Total ordering on ties (structural).** Audit `try_cross_exchange` and
   `find_cheapest_feasible_insertion` for tie-breaks specifically; a `>` where a
   `>=` belongs makes the result depend on visit order.
2. **No libm transcendentals in the evaluation path (representational).** Per
   §2.3 this currently fails in one place. Extend the CI float guard to catch
   `.exp()`, `.ln()`, `.powf()` and friends, not just `f32`/`f64` declarations —
   the existing guard would not have found this.
3. **Single-threaded, or provably order-preserving (structural).** WASM is
   single-threaded by necessity; the native build may keep rayon only while every
   parallel stage ends in an order-preserving `collect()`. Assert it.
4. **The canonical form must pin the whole search (semantic).**
   `lattice117.solve.v1` covers input schedule, ruleset, PRNG seed, step budget,
   **the move set and its order**, the tie-break rule, the annealing schedule,
   and the engine version. `digest_after` comes from the untouched verifier.

---

## 4. Revised phasing

Tier 4 is a **port-and-canonicalise job**, not a solver build. That is the single
biggest change from the first draft, and it should be said plainly to Mr F.

**October 2026 — distribution, and three cheap fixes.**
Clear AppSource and Workspace review; onboard Free/Pro/Fleet users; ask every
customer whether their TMS exports a distance matrix, because that decides
Gate A. In `sovereign_api`, three small jobs that are cheap now and expensive
later: correct the `modules.rs:217` doc comment that claims fixed-point maths it
does not do; fix the `mod.rs:2319` rayon rationale; and swap
`default_qubo_solver`'s `.exp()` onto the existing `fast_exp_negative`.

**November 2026 — extract `lattice117-solve`.**
Start from the two dependency-free crates: `kondo_router` and
`lattice117_core_math` lift essentially as-is. Then extract
`engine/{construction, recombination, topological_dp, capacity, execution_core,
orchestrator}` from `lattice117_core`, leaving actix/tokio/reqwest/libloading
behind and putting rayon behind a non-wasm feature. Add the crate to the float
guard, extended per §3.2. Port `golden_vrptw.rs`, desugaring its `async`. Thread
`service_time` into `time_windows`. Audit tie-breaks. Ship A4 timing/slack/wait
repair on the existing single-sheet schema, built on `explain_violation`.

**December 2026 — canonicalisation, and the rota blocker.**
Define `lattice117.solve.v1` per §3.4. Re-run the device harness across all five
platforms for bit-identical *repairs*, not just verdicts — this is where the
annealer fix gets proven rather than assumed. **In parallel ship
`lattice117.rota.v2`**, the elapsed-time fix, because rota repair cannot launch
without it and it moves every rota digest.

**January 2027 — launch what is ready.**
Fleet repair (A4) to Enterprise licence holders on all three surfaces. A1
re-sequencing ships here too if October's customers can export a matrix — the
parsers, the constructor, the cross-exchange and the C-ABI entry all already
exist. Rota repair **only if** `rota.v2` shipped and Gate B is scoped to break
placement and shift-time adjustment.

If anything slips, launch fleet-only at the lower price point.

---

## 5. Commercial notes

The revenue-share arithmetic checks out: £29 × 12.5% = £3.62/mo; £499 × 12.5% =
£62.37/mo, £748.50/yr, which is 17.2 Pro customers. Those figures can be used as
written.

The margin figures are **conservative in the safe direction**, which is the right
way round for a pitch. On UK domestic card rates the per-transaction cost on £29
is well under the 4% implied by "~96%". Do not revise them upward — quoting a
lower margin that turns out better is a good problem.

State plainly to Mr F that Tier 4 is **specification, not code**. The determinism
work that makes it credible is done and published; the solver is not written. On
the evidence of this repository the engineering is achievable by January. The
honest framing is that his £20,000 funds the October distribution push and the
November–December solver build, and that fleet repair is the January deliverable
with rota repair gated behind a legal fix that is already specified.

---

## 6. Corrections to the marketing copy

Three errors to fix before any of this is sent:

- **The free tier checks 1 staff member, not 2.** `freetier.js` reads
  `rotaPeople: 1, rotaShifts: 4`. It also shows only the first 6 stops of the one
  round it checks (`routeStops: 6`), which the copy omits. Overstating a free
  tier is the one direction that costs a sale twice.
- **"Re-sequences infeasible routes (VRPTW)"** cannot be claimed until Gate A is
  resolved. Until then the honest claim is "repairs infeasible rounds".
- **"Zero GDPR upload risk"** is nearly right and worth tightening to "no staff
  data leaves the device". The processing still happens and the controller's
  obligations still apply; what the product removes is the transfer. Care-home
  operations directors are advised by people who will notice the difference, and
  the precise claim is the more impressive one.

The rest of the outreach is good. The one-click, no-signup, works-on-your-own-CSV
offer is the correct wedge, and the reason to lead with it is exactly the reason
the white paper exists.
