# @lattice117/verify

**Does this schedule actually hold against its own time windows?**

It is easy to find out whether a planner *produced* a route. It is surprisingly
hard to find out whether the route it produced is possible. This answers that,
and when the answer is no it names the stop, the arrival, the window close and
the deficit.

```js
import { verifyFleet } from '@lattice117/verify';

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
npm install @lattice117/verify
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

Canonical SHA-256 over inputs and verdict, lowercase hex. Re-running the
identical input must reproduce it. It proves the same input produced the same
conclusion. **It is not a signature and does not claim to be.**

### `init()` → `Promise`

Pre-loads the WASM module. Optional — the verify functions call it themselves.
Use it to control when the load cost is paid.

## What it does not do

It verifies time windows and travel times. It does **not** build routes, does
**not** predict traffic, and has no opinion on whether a schedule is *good* —
only whether it is possible.

That narrowness is deliberate. The check is ironclad *given the travel times
you supply*: a route that fails here cannot work even under your own
assumptions. Route construction is a much harder problem and this does not
claim to have solved it. Verification does not depend on having solved it,
which is why this is the part that is published.

Vehicle capacity is not yet checked as a hard constraint.

## Provenance

Extracted from the Lattice117 engine, where it sits under 196 passing tests and
is validated against the published SINTEF Solomon C101 instance and its
published Rochat & Taillard solution.

That parent engine is not published, so read the 196 as our claim rather than
as something you can check. The open repository ships 4 tests — that is what
`cargo test` gives you there. What you *can* check is the digest: CI pins the
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
