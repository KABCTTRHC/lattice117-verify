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

**Correction to the first draft of this spec.** `lattice117-verify` is a minimal
verification-only extraction; only the branchless evaluator came across. The full
optimization engine lives in the `sovereign_api` repository, which is a single
crate — `lattice117_core` v1.0.0, 82 Rust files, ~24,800 lines. There is no
separate `lattice117-engine` crate; the engine is `src/engine/` inside that one.

Audited directly. The first draft said "the local search does not exist". **That
was wrong.** It exists, it is integer, and it is more determinism-ready than the
plan assumed.

### 2.1 Move generation and construction — present, and in Q16 integers

| Module | Lines | What it is |
|---|---|---|
| `engine/construction.rs` | 223 | `build_insertion_heuristic_fleet`, `find_cheapest_feasible_insertion` — a cheapest-feasible-insertion constructor |
| `engine/recombination.rs` | 620 | `try_cross_exchange`, `splice_at_seam`, `try_recombine_pair`, `validate_candidate`, `route_distance_q16(&[i32]) -> i64` |
| `engine/topological_dp.rs` | 204 | `solve_intra_cluster_branchless` — the same evaluator extracted into `lattice117-verify`'s `dp.rs` |
| `engine/capacity.rs` | 53 | capacity feasibility, zero floats |
| `engine/mod.rs` | 4,575 | orchestration: `compute_cluster_route`, `evaluate_order_with_dp`, all on `distances_q16: &[i32]` |

**Cross-exchange is a real local-search move operator.** There is no 2-opt or
Or-opt by name, but a cross-exchange plus a cheapest-insertion constructor is a
working neighbourhood. November is an *extraction and hardening* job, not a
greenfield solver build.

### 2.2 Determinism posture — stronger than the plan assumed

Three things the plan proposed to build are already true:

- **No wall-clock termination anywhere in the solve path.** `Instant::now()`
  appears only in `sentinel_qbn.rs` phase telemetry and as `_`-prefixed unused
  bindings in `mod.rs`. Nothing branches on elapsed time. The engine is already
  step-bounded rather than time-bounded, which is the single most important
  property in the plan and it is a head start, not a task.
- **The PRNG is a fixed-seed inline LCG.** `seed = 117u32`, then
  `wrapping_mul(1664525).wrapping_add(1013904223)`. No `thread_rng`, no system
  entropy. `recombination.rs` documents itself as seedless by construction —
  "same two routes in, same seam out, always".
- **No `HashMap`/`HashSet` in the VRPTW move path.** `construction.rs`,
  `recombination.rs`, `topological_dp.rs` and `capacity.rs` are all clean.
  `HashMap` appears only in `regression.rs` and as a `[u8; 32]`-keyed cache in
  `sentinel_qbn.rs`, neither of which is on the route path.

### 2.3 Floats — concentrated, and mostly not on the route path

`engine/mod.rs` carries 57 `f32`/`f64` mentions, but they are **other verticals**,
not VRPTW: `origin_lat_lon`, `nominal_viscosity_cst`, `input_flow_rate_m3_hr`,
`pressure_threshold_psi`, `node_congestion_matrix`, `obstacle_coordinates`,
`target_frequency_hz`, `material_density_kg_m3` — the hydro, telecom, drone-swarm
and wafer-fab request types, plus a `total_cost: f64` reporting field. The route
evaluation itself runs on `distances_q16: &[i32]`.

**One real float defect, and it is exactly the paper's §5 class.**
`src/modules.rs:217`, in a function whose own doc comment reads *"Uses Q16
fixed-point math to exactly calculate travel time"*:

```rust
let out_arrival_time = ((arr_d + wait_d + (to_node.service_time as f64 / 65536.0)) * 65536.0) as i32;
```

The entire transition is computed in `f64` and cast back with `as i32` — which
truncates rather than rounds. The comment asserts a representation the code does
not honour. This is a **parallel legacy path**: the live engine uses the integer
route, and `modules.rs` is still compiled (`pub mod modules;` at `lib.rs:15`).
It must not be carried into `lattice117-solve`, and the doc comment should be
corrected in place so nobody trusts it in the meantime.

### 2.4 `service_time` — modelled, not wired

The precise answer, because the first draft under-described it:

- **Declared** as `pub service_time: i32, // Q16.16` at `lib.rs:274` and
  `modules.rs:164`. The Q16.16 representation is already chosen.
- **Used** only in the `f64` legacy path above.
- **Never threaded** into the engine's `time_windows` or the DP — confirmed
  independently by `topological_dp.rs:99` and `bin/lattice117_tournament.rs:221`.

So it is a plumbing job, not a design job: the field, the type and the scale all
exist. That is a smaller November task than the first draft assumed.

### 2.5 What actually blocks the WASM target

This is where the real porting cost sits, and none of it is solver work.

- **`rayon` cannot compile to WASM without threads.** `Cargo.toml:59` pulls it
  in, and `mod.rs:2329` runs `swept_clusters.par_iter()`. `wasm-bindgen-rayon`
  needs `SharedArrayBuffer`, which needs COOP/COEP headers, which **GitHub Pages
  cannot set** and which would end the no-server model. The parallel path must
  compile out to a sequential fallback behind a feature flag.
- **The crate's dependency set is server-shaped.** `actix-web`, `tokio`,
  `reqwest`, `libloading` — none of them reach WASM. `lattice117-solve` must be a
  *thin extraction* of `engine/{construction, recombination, topological_dp,
  capacity}` and their integer helpers, not a compile of `lattice117_core`.
- **One comment gives false comfort and should be fixed now.** `mod.rs:2319`
  justifies bit-identical output on the grounds that `par_iter` is an
  `IndexedParallelIterator`. The conclusion is right — rayon's `collect()` into a
  `Vec` preserves input order — but the reasoning is not: `filter_map` yields an
  *unindexed* iterator, so indexedness is not what is saving it. The distinction
  matters because a later refactor to `reduce` or `fold` would silently lose the
  guarantee while the comment still claims it.
- `tests/golden_vrptw.rs` already exists and should be ported alongside the
  engine as the regression anchor.

### 2.6 What this does *not* change

**Gate A stands exactly as written.** `route_distance_q16` takes
`distance_matrix: &[i32]`, and `find_cheapest_feasible_insertion` needs the same.
A better solver does not conjure `d(i,j)` out of a CSV that only carries
`travel_mins_from_previous`. The engine being ready makes the JSON/TMS path
(A1/A3) much cheaper to ship; it does nothing for the single-sheet path, where
A4 remains the answer.

**Gate C stands unchanged**, and the engine's readiness makes it *more* urgent,
not less: the sooner fleet repair can ship, the sooner the temptation arrives to
ship rota repair beside it before `lattice117.rota.v2` lands.

### 2.7 Carried over from the first draft, still true

- The `f32`/`f64` CI guard is live in `lattice117-verify` and covers only
  `lattice117-verify` and `lattice117-wasm`. `lattice117-solve` must be added to
  that step or it ships unguarded.
- `tier: 'enterprise'` needs no new licensing infrastructure.
- Q16.16 memory at 1,000 stops is 4 MB dense `i32`, 8 MB `i64` — comfortable on
  the 4 GB tablet already in the determinism matrix.
- Call it a **digest**, not a seal.

---

## 3. Determinism design

The step-bounded approach is right, and §2.2 shows it is largely how the engine
already behaves. Four requirements, each a category from the taxonomy:

1. **Total ordering on ties (structural).** When two moves score equally the
   winner must be chosen by a defined rule — lowest `(i, j)` index pair — not by
   whichever the iterator reached first. Audit `try_cross_exchange` and
   `find_cheapest_feasible_insertion` for this specifically; a `>` where a `>=`
   belongs is enough to make the result depend on visit order.
2. **Single-threaded, or provably order-preserving (structural).** Per §2.5 the
   WASM build is single-threaded by necessity. The native build may keep rayon
   only while every parallel stage ends in an order-preserving `collect()`.
   Assert it rather than comment it.
3. **The canonical form must pin the whole search, not just the input
   (semantic).** `lattice117.solve.v1` has to cover: input schedule, ruleset,
   PRNG seed, step budget, **the move set and its order**, the tie-break rule,
   and the engine version. Omit any one and two builds reproduce different
   repairs from identical inputs — §5.4's failure, one level up.
4. **`digest_after` must come from the untouched verifier.** Keep
   `lattice117-verify` as an independent referee that knows nothing about the
   solver. This was the best decision in the original plan.

---

## 4. Revised phasing

The audit moves work earlier and changes its character: November is extraction
and hardening, not construction.

**October 2026 — distribution, and one question.**
Clear AppSource and Workspace review; onboard Free/Pro/Fleet users; collect real
breach shapes. Add one question to onboarding: *can you export a distance matrix
from your TMS?* That answer decides Gate A, and asking now costs nothing.

In parallel, two small jobs in `sovereign_api` that are cheap today and expensive
later: correct the `modules.rs:217` doc comment so it stops claiming fixed-point
maths it does not do, and fix the `mod.rs:2319` rayon-ordering rationale.

**November 2026 — extract `lattice117-solve`.**
Lift `engine/{construction, recombination, topological_dp, capacity}` into a new
crate with no `actix-web`/`tokio`/`reqwest`/`libloading`, and rayon behind a
feature that is off for `wasm32`. Add the crate to the `f32`/`f64` CI guard. Port
`tests/golden_vrptw.rs`. Thread `service_time` into `time_windows` and the DP —
the field and scale already exist. Audit tie-breaks per §3.1. Ship A4
timing/slack/wait repair on the existing single-sheet schema.

**December 2026 — canonicalisation, and the rota blocker.**
Define `lattice117.solve.v1` per §3.3. Re-run the device harness across Linux,
Windows, macOS, Android V8 and iOS JavaScriptCore for bit-identical *repairs*,
not just verdicts. **In parallel ship `lattice117.rota.v2`** — the elapsed-time
fix — because rota repair cannot launch without it and it moves every rota
digest, so it needs its own release and re-verification.

**January 2027 — launch what is ready.**
Fleet repair (A4) to Enterprise licence holders on all three surfaces. If
October's answer to the matrix question was yes for a meaningful share of
customers, A1 re-sequencing ships here too — the engine for it already exists,
which is the main thing this audit changes. Rota repair **only if** `rota.v2`
shipped and Gate B is scoped to break placement and shift-time adjustment.

If anything slips, launch fleet-only at the lower price point. A tier that ships
on time with one working half beats a tier that ships with a rota optimizer
nobody should run.

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
