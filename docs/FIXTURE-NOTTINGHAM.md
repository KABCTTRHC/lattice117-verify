# Fixture A — the Nottingham geographic benchmark

The official test case for the Tier 5 Enterprise Matrix Optimizer.

Everything below is reproducible from this repository with no network access:

```
node tools/fixture/nottingham.mjs --check   # the matrix and CSV are not stale
node tests/resequence.test.mjs              # the digests and the metrics
cargo test -p lattice117-solve              # the referee pipeline
```

---

## 1. Why this fixture exists

The Tier 5 claim is narrow and it needs to be demonstrable rather than asserted:
**given a distance matrix, re-ordering the stops within a round can turn a
schedule that breaches its time windows into one that does not, and the saving
is graded by a verifier that had no part in producing it.**

Two things would make a demonstration of that worthless:

1. **Inventing the distances.** If the matrix is chosen after the fact so that
   re-sequencing looks good, the fixture proves only that the author can do
   arithmetic backwards. So the matrix here is derived once, from published
   coordinates, by a formula stated in advance, and the generator is in the
   repository.
2. **Reporting the improvement from the optimiser's own arithmetic.** The
   before and after schedules are both handed to `lattice117-verify`, which is
   a separate crate with an empty dependency on the solver, and its verdict is
   what gets reported.

---

## 2. Coordinates

WGS84 locality centroids, Nottingham and its suburbs, to four decimal places
(≈11 m, well inside the error the model below introduces anyway). Node 0 is the
depot, taken as Nottingham city centre.

| Node | Locality | Latitude | Longitude | Straight-line km to depot |
|---:|---|---:|---:|---:|
| 0 | DEPOT (Nottingham city centre) | 52.9548 | −1.1581 | 0.000 |
| 1 | Arnold | 53.0050 | −1.1270 | 5.958 |
| 2 | Beeston | 52.9270 | −1.2130 | 4.805 |
| 3 | Bulwell | 52.9987 | −1.1953 | 5.480 |
| 4 | Carlton | 52.9668 | −1.0913 | 4.669 |
| 5 | Chilwell | 52.9167 | −1.2332 | 6.579 |

These are real places roughly 4–7 km out from the centre in five different
directions, which is what makes the fixture interesting: Beeston and Chilwell
are 1.75 km apart on the same side of the city, while Arnold and Chilwell are
12.1 km apart on opposite sides. A round that visits them in name order crosses
the city four times.

## 3. Derivation

Great-circle distance by the haversine formula on a spherical Earth of radius
**6371.0088 km** (the IUGG mean radius), converted to minutes at a fixed
**30 km/h** urban average, then rounded to **one decimal place**:

```
d_km      = 2R · asin( sqrt( sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2) ) )
minutes   = round( d_km / 30 × 60 , 1 )
```

Three deliberate decisions:

* **Straight-line, not road.** These are not driving distances, and nothing in
  this repository claims they are. The fixture exists to exercise the
  re-sequencer against a matrix with real geometric structure; a road matrix
  would make the saving *larger*, not smaller, because roads punish
  city-crossing more than a straight line does.
* **One fixed speed, stated in advance.** No congestion model, no time-of-day
  profile, nothing fitted. A per-leg speed would be a free parameter and free
  parameters are how a benchmark gets tuned into agreeing with you.
* **Rounded once, at generation time.** The rounded decimal *is* the value.
  Q16.16 represents 0.1 only to within 1/65536, so every surface must start
  from the same decimal string or the digests diverge; rounding once, in the
  generator, is what guarantees that.

The resulting matrix, in minutes, is `demo/example-fleet-nottingham-matrix.txt`:

```
        DEPOT Arnold Beeston Bulwell Carlton Chilwell
DEPOT     0.0   11.9     9.6    11.0     9.3     13.2
Arnold   11.9    0.0    20.8     9.2     9.7     24.2
Beeston   9.6   20.8     0.0    16.1    18.6      3.5
Bulwell  11.0    9.2    16.1     0.0    15.6     18.9
Carlton   9.3    9.7    18.6    15.6     0.0     22.0
Chilwell 13.2   24.2     3.5    18.9    22.0      0.0
```

It is exactly symmetric, which is a consequence of the derivation rather than
an assumption imposed on it.

It does **not** quite satisfy the triangle inequality, and that is worth stating
because it is the kind of detail a benchmark usually hides. One pair breaks it:

```
DEPOT -> Chilwell          13.2
DEPOT -> Beeston -> Chilwell   9.6 + 3.5 = 13.1
```

Beeston sits almost exactly on the line between the depot and Chilwell, so the
detour is genuinely 0.0 km to three decimal places and the 0.1 min gap is purely
the rounding in §3 landing on opposite sides. Nothing in the engine assumes the
triangle inequality — `evaluate_order` walks the sequence it is given and reads
consecutive pairs — so this costs nothing, but a matrix advertised as metric
when it is not would be a defect, and it is not advertised as one.

### 3.1 A correction to an earlier draft

The first version of this matrix was produced by a calculation that was not
kept, and two of its cells — Bulwell→Carlton and Bulwell→Chilwell — were
0.1 min below what the coordinates actually give. It was therefore not
reproducible from any single set of coordinates, which is disqualifying for a
published benchmark whatever the size of the error.

The generator is now `tools/fixture/nottingham.mjs`, it writes both the matrix
and the CSV, and `--check` fails if either is stale. The corrected figures are
the ones quoted throughout this document and pinned in the tests; the earlier
99.5 → 60.1 / 39.5 min pair should not be cited anywhere.

---

## 4. The round

`demo/example-fleet-nottingham.csv`, also generated. One vehicle, five stops,
depot at both ends, in **alphabetical order** — which is how a round arrives
when the stop list lives in a spreadsheet sorted by name or comes out of a CRM
export. This is not a strawman; it is one of the commonest avoidable failures in
the field, and it needs no incompetence to produce, only a default sort.

| | |
|---|---|
| Vehicle | `VAN-21` |
| Departs | 540 (09:00) |
| Stop windows | 480–615 (08:00–10:15) |
| Depot windows | 0–1440 |

## 5. The honest result

### 5.1 What was *not* reproduced

The Tier 4 spec's motivating example is `VAN-14`, a round that breaches on the
leg into Mapperley. **Real Nottingham geography does not reproduce that
failure.** Under the matrix above, with `VAN-14`'s windows:

Taking Mapperley at 52.9800, −1.1200 by the same derivation gives DEPOT→Arnold
11.9, DEPOT→Mapperley 7.6, Arnold→Mapperley 5.6, and both orders hold
comfortably:

```
DEPOT -> Arnold -> Mapperley :  Arnold    @11.9 (closes 30) OK | Mapperley @17.5 (closes 25) OK
DEPOT -> Mapperley -> Arnold :  Mapperley  @7.6 (closes 25) OK | Arnold    @13.2 (closes 30) OK
```

Both orders hold. Worse, with only two interior stops and a symmetric matrix the
two orders cost exactly the same 25.1 minutes, so re-sequencing that round is not
merely unnecessary — it is structurally incapable of changing anything. The
breach in the Tier 4 spec comes from that document's illustrative leg times, not
from where Arnold and Mapperley actually are. Reporting this
is the point: the request was to report whatever verdict real geometry produced,
and it produced "nothing to fix".

### 5.2 What the fixture does demonstrate

The alphabetical five-stop round, graded by `lattice117-verify`:

| | Sequence | Travel | Q16.16 | Verdict |
|---|---|---:|---:|---|
| **Before** | DEPOT → Arnold → Beeston → Bulwell → Carlton → Chilwell → DEPOT | 99.6 min | 6 527 386 | **INFEASIBLE** — Chilwell arrives 626.4, window shut 615.0, late by 11.4 |
| **After** | DEPOT → Beeston → Chilwell → Bulwell → Arnold → Carlton → DEPOT | 60.2 min | 3 945 267 | **FEASIBLE** — every stop inside its window |

**Saving: 39.4 minutes, 39.6% of the round's travel time**, and a schedule that
breached becomes one that does not. No parameters were tuned to get this: the
re-sequencer searched all 5! = 120 interior orders exhaustively and returned the
optimum, so there is no iteration budget, temperature or seed anywhere in the
result.

### 5.2.1 The digests

Graded by the published 21,525-byte WASM engine and canonicalised by the shared
`demo/digest.js`. These are the benchmark's record: a customer who runs the
fixture on any machine, on any of the four surfaces, gets these two strings.

```
digest_before  da1650fc0e63e26eba33913f25f24fb9fbdc78ce4c55549279cb9582d3119993
digest_after   2b9d863c5ab89a90a2416a9a708ce09fa8876b6d8d91e58199696181e7da7b15
```

They are **not signatures**. They prove that the same schedule was checked and
the same verdict reached; they say nothing about who ran the check.

The departure time is handled the way `demo/audit.html` has always handled it,
and the distinction matters: the engine starts its clock at zero and takes no
departure, so 540 is expressed to it by **folding it into the first leg**. It is
*not* folded into the canonical form, where it stays a separate `depart` field.
The digest therefore records the schedule a planner would run, not the encoding
trick used to ask the question.

### 5.2.2 Arrival profile

The arrival profile after re-sequencing, which is what the verifier checks:

```
Beeston  @549.6   Chilwell @553.1   Bulwell @572.0
Arnold   @581.2   Carlton  @590.9   DEPOT   @600.2
```

### 5.3 What this does not show

* **It is not a claim about road networks.** See §3.
* **It is not a VRP result.** The vehicle assignment was given and is preserved;
  only the order within the round was searched. Re-clustering the fleet is
  `kondo::solve_logistics_kondo`, a different and much weaker guarantee.
* **It is not evidence about large rounds.** Exhaustive search stops at
  `resequence::EXACT_LIMIT` = 8 interior stops, above which the round is
  returned untouched with `searched: false`. A heuristic answer labelled
  "optimal" would be worth less than an honest refusal.

---

## 6. Fixture B, and why it is not here yet

A published benchmark instance — Solomon VRPTW (`C101`, `R101`) or a TSPLIB
case — is the right second fixture, because its optimum is a number other
people have already agreed on, so it tests the solver against the literature
rather than against itself.

It is not in this commit because it needs the licence position established
first. Solomon's instances are widely redistributed but the canonical set comes
with terms worth reading rather than assuming, and TSPLIB's are distributed
under terms that permit research use with attribution. Vendoring someone else's
data into an AGPL repository under a commercial dual licence is a decision to
make deliberately. The test harness that Fixture A now uses is instance-shaped
and will take a Solomon file unchanged.
