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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
