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

## 2. What already exists, and what does not

Checked, not assumed:

| Claim in the plan | Reality |
|---|---|
| "Wire the deterministic Rust VRPTW local-search and DP pass (`dp.rs`)" | The **DP pass exists**: `solve_intra_cluster_branchless` evaluates a *given* order against windows, branchlessly, in `i32`. The **local search does not exist** — there is no 2-opt, Or-opt or move generator anywhere in the crate. The name is misleading; it is an evaluator, not a solver. |
| "CI enforcement against f32/f64 in the evaluation path" | **Already live** — added at `9b24983`, guards `lattice117-verify` and `lattice117-wasm`. A new `lattice117-solve` crate must be added to that step or it is unguarded. |
| "`tier: 'enterprise'` needs no new licensing infrastructure" | **Correct.** `issue.mjs` signs an arbitrary `tier` string and `licence.js` exposes it. Gating is a UI condition. |
| "Q16.16 / sparse Q40.24 under 15 MB for 100–1,000 stops" | **Correct.** Dense `i32` at 1,000 stops is 1000² × 4 B = 4 MB; `i64` is 8 MB. Comfortable on the 4 GB Galaxy Tab A11 already in the determinism matrix. |
| "before-and-after SHA-256 verification digest" | Sound, but call it a **digest**, not a seal. §8 of the white paper says explicitly it is not a signature, and a repair tier is exactly where that distinction will be tested. |

One documented gap that repair will hit immediately, from `dp.rs`'s own comment:
**`service_time` is not threaded into the arrival-time computation at all.** For
detection on a sheet that bakes service into `travel_mins_from_previous`, that is
survivable. For repair it is not — you cannot move a stop without knowing how
long it takes to serve. This must be fixed before any re-sequencing work.

---

## 3. Determinism design

The step-bounded approach is right, and it is the correct application of §5.6.
Wall-clock budgets are non-determinism by construction, and the plan is correct
to reject them.

Four additions the plan does not cover, each a category from the taxonomy:

1. **Total ordering on ties (structural).** When two moves score equally the
   winner must be chosen by a defined rule — lowest `(i, j)` index pair — not by
   whichever the iterator reached first. Any iteration over a hash map anywhere
   in the move loop breaks determinism regardless of the seed.
2. **Single-threaded, or deterministic reduction (structural).** Web Workers are
   fine as *one* background thread. The moment work is split across several, the
   order in which improvements are applied varies and the result diverges.
   Prohibit this in the crate, and assert it.
3. **The canonical form must pin the whole search, not just the input
   (semantic).** `lattice117.solve.v1` has to cover: input schedule, ruleset,
   PRNG seed, step budget, **the move set and its order**, the tie-break rule,
   and the engine version. Omit any one and two builds reproduce different
   repairs from identical inputs — §5.4's failure, one level up.
4. **The repaired schedule must be re-verified by the untouched verifier.** The
   plan already says this and it is the single best decision in it. Keep
   `lattice117-verify` as an independent referee that knows nothing about the
   solver, and make `digest_after` come from the referee, never the solver.

---

## 4. Revised phasing

The original four-month shape survives; the gates change what lands when.

**October 2026 — distribution, and one decision.**
Clear AppSource and Workspace review; onboard Free/Pro/Fleet users; collect real
breach shapes. Add one question to every onboarding: *can you export a distance
matrix from your TMS?* That answer decides Gate A, and it costs nothing to ask
now rather than in December.

**November 2026 — fleet repair, A4 scope.**
New crate `lattice117-solve`, added to the f32/f64 CI guard. Departure-time,
slack and waiting repairs on the existing schema. Fix the `service_time` gap.
No re-sequencing, because Gate A is unresolved until October's answer.

**December 2026 — canonicalisation, and the rota blocker.**
Define `lattice117.solve.v1` per §3 above. Re-run the device harness across all
five platforms for bit-identical repairs. **In parallel, ship
`lattice117.rota.v2`** — the elapsed-time fix — because rota repair cannot launch
without it and it moves every rota digest, so it needs its own release and its
own re-verification.

**January 2027 — launch what is ready.**
Fleet repair (A4) to Enterprise licence holders across all three surfaces. Rota
repair **only if** `rota.v2` shipped and Gate B is scoped to break placement and
shift-time adjustment. If either slipped, launch fleet-only at the lower price
point and hold rota repair. A tier that launches on time with one working half
beats a tier that launches with a rota optimizer nobody should run.

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
