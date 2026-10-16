# lattice117-verify

**Does this schedule actually hold against its own time windows?**

It is easy to find out whether a planner *produced* a route. It is surprisingly
hard to find out whether the route it produced is possible. This answers that,
and when the answer is no it names the stop, the arrival, the window close and
the deficit.

```js
import { verifyFleet } from 'lattice117-verify';

const fleet = await verifyFleet([
  { id: 'VAN-01', stops: [
    { id: 'DEPOT',      close: 600, travel: 0  },
    { id: 'Bilborough', close: 60,  travel: 12 },
    { id: 'Beeston',    close: 90,  travel: 18 },
    { id: 'Clifton',    close: 40,  travel: 15 },
    { id: 'DEPOT',      close: 600, travel: 18 },
  ]},
]);

console.log(fleet.feasibilityRate);   // 0
console.log(fleet.routes[0].violation);
// {
//   stop: 'Clifton',
//   arrival: 45, windowClose: 40, deficit: 5,
//   raw: { arrival: 2949120, windowClose: 2621440, deficit: 327680 }
// }
```

## Install

```sh
npm install lattice117-verify
```

Node 18+, or any bundler. No dependencies.

## Why it exists

**It opens no sockets.** No fetch, no telemetry, no licence check, no network
of any kind. 21 KB of WebAssembly that computes in your process and nowhere
else. Audit the bundle — that is a structural property, not a policy promise,
and it is why this can sit inside a product handling schedules nobody is
allowed to upload.

**It is deterministic.** Every value crossing into the engine is Q16.16 fixed
point on `i32`. There is no floating point in the evaluation path, so the same
input produces a bit-identical verdict on any machine, every run. `verdictDigest()`
gives you a SHA-256 over the inputs and the verdict, so you can prove that
rather than be told it.

**No distance matrix required.** A fixed route only needs the legs actually
driven, so each stop carries `travel` — the time from the stop before it. That
is what a route sheet already contains.

**Out-of-range values are a hard error.** Q16.16 represents −32,768 to +32,767.
Anything outside that throws with the offending field named, rather than
wrapping. A silently wrapped value produces a confident verdict about a
schedule that was never actually checked, which is the worst failure this kind
of tool can have.

## API

### `verifyFleet(routes)` → `FleetResult`

Checks every route and reports the number most operations do not have about
their own schedules: what proportion of what was published is achievable.

```js
{ checked: 8, feasible: 5, infeasible: 3, feasibilityRate: 0.625, routes: [...] }
```

### `verifyRoute(route)` → `RouteResult`

One route. `{ id, feasible, cost, violation }`.

### `verdictDigest(routes, result)` → `string`

Canonical SHA-256 over inputs and verdict, lowercase hex. Re-running the same
schedule must reproduce it, so two parties can confirm they reached the same
conclusion without trusting each other's account of it. **It is not a signature
and does not claim to be.**

It is taken over the Q16.16 integers the engine actually evaluated, not the
values as you supplied them, so `close: 600` and `close: '600'` agree — which
matters, because a CSV or spreadsheet round-trip hands you strings. In 0.1.0
it was taken over the raw input and those two disagreed: same schedule, same
verdict, two digests. Verdicts are unaffected either way; `verifyRoute`
normalises before it computes anything. Digests from 0.1.0 do not carry over.

### `init()` → `Promise`

Pre-loads the WASM module. Optional — the verify functions call it themselves.
Use it to control when the load cost is paid.

### Optional vehicle capacity (0.3.0)

A route may carry `capacity` (or `vehicleCapacity`) and its stops a `demand`,
in whole units: kilograms, parcels, pallets. The result then carries
`load: { total, capacity }` and `capacityViolation`, which names the first stop
whose demand takes the round's running total past the capacity, with the load
and the excess. A route over capacity is not feasible.

- A demand with no capacity is refused rather than passed.
- A fractional load is refused; choose a smaller unit.
- Loads are checked in integer arithmetic in `index.js`; the 21,525-byte WASM
  referee is unchanged.
- **No digest moves for a schedule without loads.** The capacity keys enter
  the canonical form only when a route states a capacity or a stop a demand,
  the same rule the `depart` column follows. `e249d90e…` is unchanged.

## lattice117-mcp: the verifier as tools for AI agents (0.3.0)

```sh
npx -p lattice117-verify lattice117-mcp
```

A Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0).
Add it to an MCP client as a stdio server with that command. It opens no
socket and writes nothing to stdout but protocol messages.

| Tool | What it does |
|---|---|
| `verify_fleet` | Routes against their time windows (and capacity, when given). Returns whether each holds, the first stop that breaks with the exact deficit (and its Q16.16 integers), and the `verdictDigest` |
| `verify_rota` | Shifts against rest and break thresholds, with every shortfall in minutes and a `rotaDigest`. Indicative, not legal advice |
| `resequence_round` | Every order of a round's interior stops (up to 8) against a distance matrix; the referee grades the original and the best order, and the repaired route comes back ready to re-verify |
| `optimize_toolpath` | The cut order that minimises rapid travel for SVG, G-code or a point list (up to 8 cuts searched; cuts never reversed) |
| `self_test` | Re-derives the three published digests |

The loop an agent is meant to run: propose a plan, call `verify_fleet` or
`verify_rota`, read the first failure and its deficit, repair the plan
(`resequence_round` can do it for a round), and verify again. Treat a plan as
certified only when the referee says it holds. `tests/mcp.test.mjs` runs that
loop on the Nottingham round: refused at Chilwell, 11.4 minutes late, with the
published `da1650fc…`; repaired and re-certified with the published `2b9d863c…`.

## What it does not do

It verifies time windows and travel times. It does **not** build routes, does
**not** predict traffic, and has no opinion on whether a schedule is *good* —
only whether it is possible.

That narrowness is deliberate. The check is ironclad *given the travel times
you supply*: a route that fails here cannot work even under your own
assumptions. Route construction is a much harder problem and this does not
claim to have solved it. Verification does not depend on having solved it,
which is why this is the part that is published.

Vehicle capacity is checked only when you give it (above). Service time at a
stop is not modelled: add it to the next leg's travel time.

## Provenance

Extracted from the Lattice117 engine, where it sits under 540 passing tests and
is validated against the published SINTEF Solomon C101 instance and its
published Rochat & Taillard solution.

That parent engine is not published, so read the 540 as our claim rather than
as something you can check. The open repository ships 79 Rust tests and 474
JavaScript checks — that is what `cargo test --all` and `node tests/*.test.mjs`
give you there. What you *can* check is the digest: CI pins the
verdict digest for a known input and fails if Linux, macOS and Windows
disagree, which is the determinism claim this package rests on.

Running that published solution is what caught the most useful bug this code
has had — **in the checker, not in the benchmark.** An earlier version counted
legitimate accumulated waiting time as lateness, so any route with more than
about 152 time-units of honest waiting came back infeasible. C101's published
solution is feasible; a checker that disagrees is broken.

A false *infeasible* is the failure this kind of tool is most likely to have
and least likely to catch, because it doesn't look like a bug — it looks like
being careful. The only thing that finds it is running real published data
against a real published answer.

## Licence

Dual-licensed: **AGPL-3.0-or-later**, or a **commercial licence** for
organisations that cannot release their source.

The AGPL applies to network use as well as distribution (§13). If you are
embedding this in a product you ship or host and cannot open-source that
product, you need the commercial licence —
[kurtisbrierley@gmail.com](mailto:kurtisbrierley@gmail.com).

---

*Built in Nottingham by [Brierley Sovereign Group Ltd](https://github.com/KABCTTRHC/lattice117-verify).*
