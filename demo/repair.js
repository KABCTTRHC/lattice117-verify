/**
 * A4 — single-sheet repair, browser side.
 *
 * A port of `crates/lattice117-solve/src/repair.rs`, which is the reference
 * implementation. Two implementations of one algorithm is exactly the
 * structural hazard §5.3 of the white paper is about, so `tests/repair.test.mjs`
 * asserts the same cases and the same numbers as the Rust unit tests. If the
 * two ever disagree, that suite says so.
 *
 * Why a port at all: the referee is the published 21,525-byte WASM binary, and
 * it must not change when the solver does. Keeping the solver out of that
 * module is what lets `digest_after` come from the same engine that produced
 * every digest in the white paper and in the nine device captures.
 *
 * Everything here is exact integer arithmetic on whole Q16.16 units. There is
 * no search, no seed and no tie to break: one backward pass for the latest
 * feasible departure, one forward pass for arrivals.
 */

const Q = 65536;

/** Q16.16, refusing anything that is not a finite number. */
function toQ(value, what) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) throw new RangeError(`${what}: "${value}" is not a finite number`);
  return Math.round(n * Q);
}

/**
 * Arrival time at each stop for a given departure, honouring waits.
 *
 * A vehicle that arrives before a window opens waits — it cannot be served
 * early. That wait is what makes the profile non-linear in departure time, and
 * is why `latestFeasibleDeparture` is a backward pass rather than subtraction.
 */
export function arrivals(round, departQ) {
  const out = [];
  let t = departQ;
  round.stops.forEach((s, i) => {
    if (i > 0) t += s.travelQ;
    if (t < s.openQ) t = s.openQ;
    out.push(t);
  });
  return out;
}

/**
 * The latest departure at which every stop still holds, or `null` when none
 * does. Latest rather than earliest: it is the smallest change that works, and
 * a planner asked to move a start time wants the smallest one.
 */
export function latestFeasibleDeparture(round) {
  const n = round.stops.length;
  if (n === 0) return round.departQ;
  let deadline = round.stops[n - 1].closeQ;
  for (let i = n - 1; i >= 1; i--) {
    deadline = Math.min(deadline, round.stops[i].closeQ) - round.stops[i].travelQ;
  }
  const latest = Math.min(deadline, round.stops[0].closeQ);
  return latest < 0 ? null : latest;
}

/** Every stop that misses its window at `departQ`. */
export function violations(round, departQ) {
  const arr = arrivals(round, departQ);
  const out = [];
  round.stops.forEach((s, i) => {
    if (arr[i] > s.closeQ) {
      out.push({
        roundId: round.id,
        stopId: s.id,
        arrivalQ: arr[i],
        closeQ: s.closeQ,
        // The counterfactual: the smallest correction that closes this stop,
        // not an estimate of one.
        deficitQ: arr[i] - s.closeQ,
      });
    }
  });
  return out;
}

/**
 * Repairs what re-timing can repair, and reports precisely what it cannot.
 *
 * A round that already holds is untouched. A round that can be made to hold
 * gets the latest feasible departure. A round that no departure fixes is left
 * alone and its stops reported — a partial re-time that still breaches is
 * worse than an untouched round plus an accurate diagnosis, and re-sequencing
 * it needs a distance matrix this schema has not got.
 */
export function repairFixedSequence(rounds) {
  const changes = [];
  const residual = [];
  let feasibleBefore = 0;
  let feasibleAfter = 0;

  for (const round of rounds) {
    if (violations(round, round.departQ).length === 0) {
      feasibleBefore++; feasibleAfter++;
      continue;
    }
    const latest = latestFeasibleDeparture(round);
    if (latest !== null && violations(round, latest).length === 0) {
      if (latest !== round.departQ) {
        changes.push({ roundId: round.id, fromQ: round.departQ, toQ: latest });
      }
      feasibleAfter++;
    } else {
      for (const r of violations(round, Math.max(latest ?? 0, 0))) residual.push(r);
    }
  }
  return {
    roundsTotal: rounds.length,
    feasibleBefore,
    feasibleAfter,
    changes,
    residual,
    fullyRepaired: feasibleAfter === rounds.length,
    isNoOp: changes.length === 0,
  };
}

/** Rows as the CSV mapper produces them -> the shape the repair works on. */
export function roundsFromRows(routes) {
  return routes.map((r) => ({
    id: r.id,
    departQ: toQ(r.depart ?? 0, `${r.id} departure`),
    stops: r.stops.map((s, i) => ({
      id: s.id,
      openQ: toQ(s.open ?? 0, `${s.id} window open`),
      closeQ: toQ(s.close ?? 0, `${s.id} window close`),
      travelQ: i === 0 ? 0 : toQ(s.travel, `${s.id} travel`),
    })),
  }));
}

/** Q16.16 back to the schedule's own unit, for display. */
export function fromQ(q) {
  return q / Q;
}
