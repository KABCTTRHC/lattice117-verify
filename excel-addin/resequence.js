/**
 * Tier 5 — per-vehicle re-sequencing against a supplied distance matrix,
 * browser side.
 *
 * A port of `crates/lattice117-solve/src/resequence.rs`, which is the reference
 * implementation. Two implementations of one algorithm is the structural hazard
 * §5.3 of the white paper is about, so `tests/resequence.test.mjs` asserts the
 * same cases and the same integers as the Rust tests — including the Nottingham
 * benchmark's 6 527 386 -> 3 945 267 — and says so when they diverge.
 *
 * Why a port at all: the referee is the published 21,525-byte WASM binary and it
 * must not change when the solver does. Keeping the solver outside that module
 * is what lets `digest_after` come from the same engine that produced every
 * digest in the paper and in the nine device captures.
 *
 * # What this does and does not decide
 *
 * The vehicle assignment is an input. A sheet that names `VAN-21` carries a
 * decision a planner made, usually encoding things no matrix knows — driver
 * knowledge, vehicle type, customer relationships, bay allocation — and
 * re-clustering the fleet throws all of it away. Only the order *within* each
 * round is searched, and the first and last stops stay pinned because a vehicle
 * that starts somewhere other than its depot is a different problem.
 *
 * # Exhaustive, and where it stops
 *
 * Up to EXACT_LIMIT interior stops every permutation is evaluated and the
 * optimum returned — not a heuristic's guess at one. That is 8! = 40,320 orders
 * at the limit, trivial for a browser, and it means the result carries no tuning
 * parameters at all: no iteration budget, no temperature, no seed. Above the
 * limit the round comes back untouched with `searched: false`, because reporting
 * "not searched" is honest and labelling a heuristic result "optimal" is not.
 *
 * # Determinism
 *
 * Candidates rank by `(infeasible, cost, sequence)`. Feasibility dominates cost
 * — a cheaper route that misses a window is not an improvement — and the
 * sequence breaks remaining ties by position, so the lowest index wins at the
 * first place two tied orders differ. That rule is total: no two distinct orders
 * compare equal, so the search has exactly one answer and it does not depend on
 * generation order. On a symmetric matrix a round and its exact reverse cost the
 * same and the forward one is always returned.
 */

const Q = 65536;

/** Interior stops up to which every permutation is searched. Mirrors Rust. */
export const EXACT_LIMIT = 8;

/** Q16.16, refusing anything that is not a finite number. */
function toQ(value, what) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) throw new RangeError(`${what}: "${value}" is not a finite number`);
  return Math.round(n * Q);
}

/** Q16.16 back to the schedule's own unit, for display. */
export function fromQ(q) {
  return q / Q;
}

/**
 * Total travel for one ordering, plus how many stops miss their window.
 *
 * `order` holds POSITIONS in `stops`; the matrix is indexed by each stop's
 * `node`, which is its row in the matrix. Those two index spaces are distinct
 * and conflating them was a real bug in the Rust original — it surfaced only
 * once a round had been reordered and the positions stopped matching the nodes.
 */
function evaluate(order, stops, matrix, n, departQ) {
  let cost = 0;
  let t = departQ;
  let infeasible = 0;
  for (let k = 1; k < order.length; k++) {
    const leg = matrix[stops[order[k - 1]].node * n + stops[order[k]].node];
    cost += leg;
    t += leg;
    const s = stops[order[k]];
    if (t < s.openQ) t = s.openQ;     // wait for the window to open
    if (t > s.closeQ) infeasible++;
  }
  return { cost, infeasible };
}

/**
 * Every permutation of `items`, in lexicographic order of the input.
 *
 * Heap's algorithm would be faster and would not emit in a defined order. This
 * one does, which is what makes the tie-break reproducible.
 */
function permutations(items) {
  const out = [];
  const used = items.map(() => false);
  const current = [];
  const walk = () => {
    if (current.length === items.length) { out.push(current.slice()); return; }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true; current.push(items[i]);
      walk();
      current.pop(); used[i] = false;
    }
  };
  walk();
  return out;
}

/** Lexicographic compare of two equal-length position lists. */
function beforeIn(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** `(infeasible, cost, sequence)` ordering, lowest wins. */
function better(a, b) {
  if (a.infeasible !== b.infeasible) return a.infeasible < b.infeasible;
  if (a.cost !== b.cost) return a.cost < b.cost;
  return beforeIn(a.order, b.order);
}

/**
 * Searches one round's interior orderings against a supplied matrix.
 *
 * `matrix` is a flat row-major n x n array of Q16.16 integers in the same time
 * unit as the windows. `round.stops[i].node` indexes into it.
 */
export function resequenceRound(round, matrix, n) {
  const m = round.stops.length;
  const original = Array.from({ length: m }, (_, i) => i);
  const base = evaluate(original, round.stops, matrix, n, round.departQ);

  const out = {
    roundId: round.id,
    searched: false,
    original,
    best: original.slice(),
    originalCostQ: base.cost,
    bestCostQ: base.cost,
    infeasibleBefore: base.infeasible,
    infeasibleAfter: base.infeasible,
  };

  if (m < 3) { out.searched = true; return finish(out, round); }
  const interior = Array.from({ length: m - 2 }, (_, i) => i + 1);
  // searched stays false: nothing returned below would be a search result.
  if (interior.length > EXACT_LIMIT) return finish(out, round);
  out.searched = true;

  let best = { infeasible: base.infeasible, cost: base.cost, order: original };
  for (const perm of permutations(interior)) {
    const order = [0, ...perm, m - 1];
    const { cost, infeasible } = evaluate(order, round.stops, matrix, n, round.departQ);
    const cand = { infeasible, cost, order };
    if (better(cand, best)) best = cand;
  }
  out.infeasibleAfter = best.infeasible;
  out.bestCostQ = best.cost;
  out.best = best.order;
  return finish(out, round);
}

/** Adds the derived fields a UI wants, so no surface computes them twice. */
function finish(out, round) {
  out.changed = out.searched && out.best.some((p, i) => p !== out.original[i]);
  out.savingQ = out.originalCostQ - out.bestCostQ;
  out.originalIds = out.original.map((p) => round.stops[p].id);
  out.bestIds = out.best.map((p) => round.stops[p].id);
  return out;
}

/**
 * Re-sequences every round against one shared matrix.
 *
 * Rounds never interact: the assignment is an input, not something this
 * searches. So the pass is order-independent — swapping two rounds in the input
 * swaps two entries in `outcomes` and changes nothing else.
 *
 * Aggregates are over ROUNDS, never over stops. "3 of 4 rounds hold" is a
 * sentence a planner can act on; "17 of 22 stops hold" is not.
 */
export function resequenceFleet(rounds, matrix, n) {
  const outcomes = rounds.map((r) => resequenceRound(r, matrix, n));
  const sum = (f) => outcomes.reduce((a, o) => a + f(o), 0);
  const totalBefore = sum((o) => o.originalCostQ);
  const totalAfter = sum((o) => o.bestCostQ);
  return {
    roundsTotal: rounds.length,
    feasibleBefore: outcomes.filter((o) => o.infeasibleBefore === 0).length,
    feasibleAfter: outcomes.filter((o) => o.infeasibleAfter === 0).length,
    unsearched: outcomes.filter((o) => !o.searched).length,
    totalCostBeforeQ: totalBefore,
    totalCostAfterQ: totalAfter,
    savingQ: totalBefore - totalAfter,
    fullyRepaired: outcomes.every((o) => o.infeasibleAfter === 0),
    isNoOp: outcomes.every((o) => !o.changed),
    outcomes,
  };
}

/**
 * Applies an outcome's ordering, rewriting each leg from the matrix.
 *
 * Returns a route in the SAME shape the CSV mapper produces, so it can go
 * straight back through the verifier and `digest.js` with nothing special-cased.
 * That is the whole point: `digest_after` must be produced by exactly the path
 * that produced `digest_before`.
 */
export function applyToRoute(route, round, outcome, matrix, n) {
  return {
    ...route,
    stops: outcome.best.map((p, pos) => ({
      ...route.stops[p],
      travel: pos === 0
        ? 0
        : fromQ(matrix[round.stops[outcome.best[pos - 1]].node * n + round.stops[p].node]),
    })),
  };
}

/**
 * Rows as the CSV mapper produces them -> the shape the search works on.
 *
 * `nodeOf` maps a stop id to its matrix row. A stop the matrix does not name is
 * a hard error rather than a default: silently routing an unknown stop to node 0
 * would produce a confident answer about a schedule nobody checked, and that is
 * the worst failure this kind of tool can have.
 */
export function roundsFromRows(routes, nodeOf) {
  return routes.map((r) => ({
    id: r.id,
    departQ: toQ(r.depart ?? 0, `${r.id} departure`),
    stops: r.stops.map((s, i) => {
      const node = nodeOf(s.id);
      if (!Number.isInteger(node) || node < 0) {
        throw new RangeError(
          `${r.id}: stop "${s.id}" is not named in the distance matrix. Add a ` +
          `row for it, or remove the stop — a matrix that does not cover the ` +
          `sheet cannot be used to re-sequence it.`
        );
      }
      return {
        id: s.id,
        node,
        openQ: toQ(s.open ?? 0, `${s.id} window open`),
        closeQ: toQ(s.close ?? 0, `${s.id} window close`),
        travelQ: i === 0 ? 0 : toQ(s.travel, `${s.id} travel`),
      };
    }),
  }));
}

/**
 * Parses an uploaded or pasted distance matrix.
 *
 * Accepts the fixture's own format and the shapes people actually paste:
 * whitespace- or comma-separated rows, blank lines ignored, `#` comments
 * ignored except for a `# nodes: 0=NAME, 1=NAME` legend, which names the rows.
 * Without a legend the rows are named by their index, which is what a bare
 * matrix out of a routing tool looks like.
 *
 * Throws on anything ragged. A matrix that is not square, or whose legend does
 * not cover its rows, cannot be used to re-sequence anything, and guessing at
 * the missing part would be the same defect as defaulting an unknown stop to
 * node 0.
 */
export function parseMatrix(text) {
  const names = new Map();
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const legend = /^#\s*nodes\s*:(.*)$/i.exec(line);
      if (legend) {
        for (const entry of legend[1].split(',')) {
          const pair = /^\s*(\d+)\s*=\s*(.+?)\s*$/.exec(entry);
          if (pair) names.set(pair[2], Number(pair[1]));
        }
      }
      continue;
    }
    const cells = line.split(/[\s,;]+/).filter((c) => c !== '');
    rows.push(cells.map((c, j) => toQ(c, `matrix row ${rows.length} column ${j}`)));
  }
  const n = rows.length;
  if (n === 0) throw new RangeError('the distance matrix is empty');
  const ragged = rows.findIndex((r) => r.length !== n);
  if (ragged !== -1) {
    throw new RangeError(
      `the distance matrix is not square: it has ${n} rows but row ${ragged} has ` +
      `${rows[ragged].length} columns. Every stop needs a distance to every ` +
      `other stop.`
    );
  }
  if (names.size === 0) {
    for (let i = 0; i < n; i++) names.set(String(i), i);
  } else if (names.size !== n) {
    throw new RangeError(
      `the matrix legend names ${names.size} nodes but the matrix has ${n} rows.`
    );
  }
  return { matrix: rows.flat(), n, names };
}
