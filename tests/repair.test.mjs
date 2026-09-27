/**
 * A4 repair, and its parity with the Rust reference.
 *
 * Two implementations of one algorithm is the structural hazard §5.3 of the
 * white paper is about. Every expected number below is taken from the unit
 * tests in crates/lattice117-solve/src/repair.rs, so if the port drifts, this
 * says so.
 *
 * Run: node tests/repair.test.mjs
 */
import {
  repairFixedSequence, roundsFromRows, arrivals, latestFeasibleDeparture, fromQ,
} from '../demo/repair.js';
import { verdictDigest } from '../demo/digest.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};
const Q = 65536;
const lateRound = (depart) => roundsFromRows([{
  id: 'R1', depart,
  stops: [
    { id: 'D', open: 0, close: 600, travel: 0 },
    { id: 'A', open: 60, close: 90, travel: 20 },
    { id: 'B', open: 80, close: 100, travel: 15 },
  ],
}]);

console.log('\nParity with crates/lattice117-solve/src/repair.rs');
{
  // repair.rs: a_round_that_leaves_too_late_is_retimed_to_the_latest_that_works
  const out = repairFixedSequence(lateRound(75));
  eq('leaving too late is retimed to 65', out.changes.map((c) => fromQ(c.toQ)), [65]);
  eq('and the round then holds', [out.feasibleBefore, out.feasibleAfter], [0, 1]);
  eq('with nothing left residual', out.residual.length, 0);
}
{
  // repair.rs: a_round_that_already_holds_is_left_completely_alone
  const out = repairFixedSequence(lateRound(60));
  eq('a passing round is untouched', out.isNoOp, true);
  eq('and counted feasible before', out.feasibleBefore, 1);
}
{
  // repair.rs: a_structurally_infeasible_round_is_not_touched_and_is_reported_exactly
  const out = repairFixedSequence(roundsFromRows([{
    id: 'R2', depart: 0,
    stops: [
      { id: 'D', open: 0, close: 600, travel: 0 },
      { id: 'A', open: 0, close: 42, travel: 7 },
      { id: 'B', open: 0, close: 18, travel: 17 },
    ],
  }]));
  eq('an unfixable round proposes no change', out.isNoOp, true);
  eq('and reports the exact counterfactual', out.residual.map((r) => fromQ(r.deficitQ)), [6]);
}
{
  // repair.rs: waiting_for_a_window_to_open_is_modelled_not_ignored
  const a = arrivals(lateRound(0)[0], 0);
  eq('waits are modelled, not ignored', a.map(fromQ), [0, 60, 80]);
}

console.log('\nThe bundled fleet fixture cannot be re-timed, and says so');
{
  // Every window opens at zero and there is no departure column, so the three
  // failing rounds would have to leave before the start of the day.
  const lines = readFileSync(new URL('../demo/example-route-sheet.csv', import.meta.url), 'utf8')
    .trim().split(/\r?\n/).slice(1);
  const by = new Map();
  for (const l of lines) {
    const [v, , stop, open, close, travel] = l.split(',');
    if (!by.has(v)) by.set(v, { id: v, stops: [] });
    by.get(v).stops.push({ id: stop, open, close, travel });
  }
  const rounds = roundsFromRows([...by.values()]);
  const out = repairFixedSequence(rounds);
  eq('no round is re-timed', out.isNoOp, true);
  eq('three rounds remain infeasible', out.feasibleAfter, 5);
  // Asserted as exact Q16.16 integers, not floats. These are the values the
  // product already prints beside each breach ("6.2000 (406324)"), and they
  // are what accumulated fixed-point arithmetic actually yields — a float
  // expectation written as Math.round(6.2 * Q) takes a different rounding
  // path and disagrees in the last bits, which is the whole reason this
  // engine does not use floats.
  eq('and each reports its own deficit in exact Q16.16',
     out.residual.map((r) => r.deficitQ).sort((a, b) => a - b),
     [406324, 419431, 425984]);
}

console.log('\nThe timed fixture demonstrates a real repair');
{
  const lines = readFileSync(new URL('../demo/example-route-sheet-timed.csv', import.meta.url), 'utf8')
    .trim().split(/\r?\n/).slice(1);
  const by = new Map();
  for (const l of lines) {
    const [v, , stop, open, close, travel, depart] = l.split(',');
    if (!by.has(v)) by.set(v, { id: v, depart, stops: [] });
    by.get(v).stops.push({ id: stop, open, close, travel });
  }
  const out = repairFixedSequence(roundsFromRows([...by.values()]));
  eq('one round is re-timed', out.changes.map((c) => [c.roundId, fromQ(c.fromQ), fromQ(c.toQ)]),
     [['VAN-11', 540, 535]]);
  eq('feasible goes 2 -> 3 of 4', [out.feasibleBefore, out.feasibleAfter, out.roundsTotal], [2, 3, 4]);
  eq('the unfixable round reports 15 minutes',
     out.residual.map((r) => [r.roundId, r.stopId, fromQ(r.deficitQ)]),
     [['VAN-14', 'Mapperley', 15]]);
}

console.log('\nThe published digest is unchanged by the depart column');
{
  // A schedule where every vehicle leaves at zero IS the v1 schedule, so the
  // canonical form must not grow a key. The white paper and nine device
  // captures cite e249d90e for this fixture.
  const stops = [{ id: 'S', open: 0, close: 10, travel: 0 }];
  const routes = [{ id: 'A', stops }];
  const verdict = [{ id: 'A', feasible: true, violation: null }];
  const a = await verdictDigest(routes, verdict);
  const b = await verdictDigest([{ id: 'A', depart: 0, stops }], verdict);
  const c = await verdictDigest([{ id: 'A', depart: 5, stops }], verdict);
  eq('absent and zero depart hash identically', a === b, true);
  eq('a non-zero depart changes the digest', a !== c, true);
}

/* ── the regression this suite did not catch the first time ──────────────── */
console.log('\nThe engine actually applies the departure it is given');
{
  /* The `depart` column entered the CANONICAL FORM when the A4 repair shipped,
     but no verification path applied it. So a sheet carrying `depart: 540`
     hashed as a 09:00 start while being verified as though it left at midnight,
     and the repair's own "2 of 4 held" count could disagree with the headline
     verdict on the same sheet. Nothing failed, which is exactly why it survived.

     verifyRoute now folds the departure into the leg out of the first stop. The
     two assertions below are the ones that would have caught it: a departure
     that pushes a round past its window must change the verdict, and a zero
     departure must change nothing at all. */
  const { verifyFleet } = await import('../npm/index.js');
  const stops = [
    { id: 'D', open: 0, close: 600, travel: 0 },
    { id: 'A', open: 0, close: 100, travel: 20 },
  ];
  const atZero = await verifyFleet([{ id: 'R', depart: 0, stops }]);
  const absent = await verifyFleet([{ id: 'R', stops }]);
  const late = await verifyFleet([{ id: 'R', depart: 90, stops }]);

  eq('a zero departure verifies as feasible', atZero.routes[0].feasible, true);
  eq('and an absent one is identical to a zero one',
     JSON.stringify(absent.routes[0]), JSON.stringify(atZero.routes[0]));
  eq('leaving 90 late breaches the window', late.routes[0].feasible, false);
  eq('by exactly 10 units, not a rounded guess',
     late.routes[0].violation.raw.deficit, 10 * 65536);
  eq('and the engine names the stop that broke', late.routes[0].violation.stop, 'A');
}

/* ── the two digests the V5 sign-off ledger cites ────────────────────────── */
console.log('\nThe repair fixture seals a before and an after digest');
{
  /* PART VI Section A test 2 of the V5 Master Build Spec quotes
     `b7267d76… -> ade84da2…` for this fixture. Those values were correct, but
     nothing in either repository asserted them, so they were not reproducible
     from the tests — a figure on a sign-off ledger that no test emits is a
     figure nobody can check. These two assertions are what make them real.

     They also pin the thing the repair is FOR: moving one departure from 540 to
     535 must change the sealed state. If a refactor made the digest blind to
     the depart column again (the §5.3 hazard this file already guards in the
     other direction), `digest_before === digest_after` and this fails. */
  const { verifyFleet } = await import('../npm/index.js');
  const { verdictDigest } = await import('../demo/digest.js');

  const rows = readFileSync(new URL('../demo/example-route-sheet-timed.csv', import.meta.url), 'utf8')
    .trim().split(/\r?\n/).slice(1);
  const grouped = new Map();
  for (const l of rows) {
    const [v, , stop, open, close, travel, depart] = l.split(',');
    if (!grouped.has(v)) grouped.set(v, { id: v, depart: Number(depart), stops: [] });
    grouped.get(v).stops.push({
      id: stop, open: Number(open), close: Number(close), travel: Number(travel),
    });
  }
  const routesBefore = [...grouped.values()];

  const before = await verifyFleet(routesBefore);
  const digestBefore = await verdictDigest(routesBefore, before.routes);

  // Apply exactly what the repair proposes — it reports changes, it does not
  // mutate the sheet.
  const out = repairFixedSequence(roundsFromRows(routesBefore));
  const moved = new Map(out.changes.map((c) => [c.roundId, fromQ(c.toQ)]));
  const routesAfter = routesBefore.map(
    (r) => (moved.has(r.id) ? { ...r, depart: moved.get(r.id) } : r));

  const after = await verifyFleet(routesAfter);
  const digestAfter = await verdictDigest(routesAfter, after.routes);

  eq('digest_before is the published value',
     digestBefore,
     'b7267d761617cc609f1d5543ee1fc41e7855ded95b1de0e554eb8569eff4ff02');
  eq('digest_after is the published value',
     digestAfter,
     'ade84da208ea2fc2deeae3227654848bfed7a285bb0f6cc7b5cd51d8389679cf');
  eq('and re-timing one round does change the seal', digestBefore !== digestAfter, true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
