/**
 * Tier 5 re-sequencing: parity with the Rust reference, and the Nottingham
 * benchmark's digest_before / digest_after.
 *
 * Two implementations of one algorithm is the structural hazard §5.3 of the
 * white paper is about. Every expected integer below is taken from
 * crates/lattice117-solve/src/resequence.rs and its referee tests, so if the
 * port drifts, this says so.
 *
 * The digests come from the REAL engine — the published WASM binary behind
 * npm/index.js — and the shared canonicalisation in demo/digest.js. Nothing here
 * recomputes a verdict itself, because a solver that graded its own work would
 * not be a referee and the whole commercial claim rests on the grading being
 * independent of the thing being graded.
 *
 * Run: node tests/resequence.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EXACT_LIMIT, applyToRoute, fromQ, parseMatrix, resequenceFleet, resequenceRound,
  roundsFromRows,
} from '../demo/resequence.js';
import { verifyFleet, verdictDigest } from '../npm/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : ' — ' + detail}`);
  cond ? pass++ : fail++;
};

/* ── the fixture, loaded exactly as a surface loads it ──────────────────── */

const { matrix, n, names } = parseMatrix(read('demo/example-fleet-nottingham-matrix.txt'));

/** The CSV as the browser's own mapper hands it over: one route, ordered rows. */
function fixtureRoutes() {
  const lines = read('demo/example-fleet-nottingham.csv').trim().split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.trim());
  const ix = (name) => head.indexOf(name);
  const byVehicle = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const v = c[ix('vehicle')].trim();
    if (!byVehicle.has(v)) byVehicle.set(v, { id: v, depart: c[ix('depart')], stops: [] });
    byVehicle.get(v).stops.push({
      id: c[ix('stop')].trim(),
      open: c[ix('window_open')],
      close: c[ix('window_close')],
      travel: c[ix('travel_mins_from_previous')],
      seq: Number(c[ix('seq')]),
    });
  }
  return [...byVehicle.values()].map((r) => ({ ...r, stops: r.stops.sort((a, b) => a.seq - b.seq) }));
}

const routes = fixtureRoutes();
const rounds = roundsFromRows(routes, (id) => (names.has(id) ? names.get(id) : -1));

/* ── parity with crates/lattice117-solve ───────────────────────────────── */

console.log('\nParity with crates/lattice117-solve/src/resequence.rs');
{
  // referee.rs: the_nottingham_round_resequences_from_99_6_to_60_2_minutes
  const out = resequenceRound(rounds[0], matrix, n);
  eq('searched, and the order moved', [out.searched, out.changed], [true, true]);
  eq('99.6 min before, as the exact Q16.16 integer', out.originalCostQ, 6527386);
  eq('60.2 min after, as the exact Q16.16 integer', out.bestCostQ, 3945267);
  eq('39.4 min saved', out.savingQ, 2582119);
  eq('one window breached before, none after',
     [out.infeasibleBefore, out.infeasibleAfter], [1, 0]);
  eq('the optimum is Beeston -> Chilwell -> Bulwell -> Arnold -> Carlton',
     out.bestIds, ['DEPOT', 'Beeston', 'Chilwell', 'Bulwell', 'Arnold', 'Carlton', 'DEPOT']);

  // The percentage the marketing copy is allowed to quote, in hundredths.
  eq('39.55% of the round, so 39.6% to one place and not 40%',
     Math.trunc((out.savingQ * 10000) / out.originalCostQ), 3955);
}
{
  // referee.rs: the_fleet_pass_reports_the_same_numbers_as_the_single_round_pass
  const single = resequenceRound(rounds[0], matrix, n);
  const fleet = resequenceFleet(rounds, matrix, n);
  eq('the fleet pass agrees with the single-round pass',
     [fleet.totalCostBeforeQ, fleet.totalCostAfterQ, fleet.savingQ],
     [single.originalCostQ, single.bestCostQ, single.savingQ]);
  eq('and counts rounds, not stops',
     [fleet.roundsTotal, fleet.feasibleBefore, fleet.feasibleAfter, fleet.unsearched],
     [1, 0, 1, 0]);
  ok('so the fleet is fully repaired', fleet.fullyRepaired);
}
{
  // resequence.rs: an_inefficient_order_is_improved_and_the_saving_is_real,
  // on the same three-stop line fixture the Rust unit test uses.
  const line = { matrix: [], n: 5 };
  const pos = [0, 1, 2, 3, 0];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) line.matrix.push(Math.abs(pos[i] - pos[j]) * 65536);
  const round = {
    id: 1, departQ: 0,
    stops: [0, 3, 1, 2, 4].map((node, k) => ({
      id: `s${node}`, node, openQ: 0, closeQ: 1000 * 65536, travelQ: 0, k,
    })),
  };
  const out = resequenceRound(round, line.matrix, line.n);
  ok('a zig-zag is beaten by a monotone walk', out.changed);
  ok('and the saving is strictly positive', out.savingQ > 0);
}
{
  // resequence.rs: a_round_too_long_to_search_is_reported_not_guessed
  const size = EXACT_LIMIT + 3;
  const round = {
    id: 9, departQ: 0,
    stops: Array.from({ length: size }, (_, i) =>
      ({ id: `s${i}`, node: i, openQ: 0, closeQ: 30000 * 65536, travelQ: 0 })),
  };
  const out = resequenceRound(round, new Array(size * size).fill(65536), size);
  ok('a round past EXACT_LIMIT is not claimed to be searched', out.searched === false);
  ok('and is returned untouched', out.changed === false);
}
{
  // resequence.rs: the tie-break is total, so repeated calls agree exactly.
  const first = JSON.stringify(resequenceRound(rounds[0], matrix, n));
  let same = true;
  for (let i = 0; i < 8; i++) {
    if (JSON.stringify(resequenceRound(rounds[0], matrix, n)) !== first) same = false;
  }
  ok('re-sequencing is deterministic across repeated calls', same);
}

/* ── the referee decides, and the digests are the record ────────────────── */

/**
 * Grades a route with the published engine and digests it.
 *
 * `verifyRoute` folds the round's departure into its first leg itself — the
 * engine starts its clock at zero and takes no departure argument — so the route
 * goes in exactly as the sheet describes it and comes out digested the same way.
 * The departure stays a separate `depart` field in the canonical form, so the
 * digest records the schedule a planner would run rather than the encoding used
 * to ask the question.
 */
async function gradeAndDigest(route) {
  const verdict = await verifyFleet([route]);
  return { verdict, digest: await verdictDigest([route], verdict) };
}

console.log('\nThe untouched engine grades before and after');
{
  const { verdict: before, digest: digestBefore } = await gradeAndDigest(routes[0]);
  eq('the alphabetical sheet is INFEASIBLE', [before.feasible, before.infeasible], [0, 1]);
  eq('and the engine names Chilwell, 11.4 late',
     [before.routes[0].violation.stop, before.routes[0].violation.raw.deficit],
     ['Chilwell', 747111]);

  const outcome = resequenceRound(rounds[0], matrix, n);
  const afterRoute = applyToRoute(routes[0], rounds[0], outcome, matrix, n);
  const after = [afterRoute];
  const { verdict: verdictAfter, digest: digestAfter } = await gradeAndDigest(afterRoute);

  eq('the re-sequenced sheet is FEASIBLE',
     [verdictAfter.feasible, verdictAfter.infeasible], [1, 0]);
  ok('and the two digests differ, because the schedule did',
     digestBefore !== digestAfter, `${digestBefore} vs ${digestAfter}`);

  /* Pinned. These two strings are the Tier 5 benchmark's published record: a
     customer who runs the fixture on any machine, on any surface, must get
     them. They are not signatures and they prove nothing about who ran the
     check — only that the same schedule was checked and the same verdict
     reached. If a change here is intentional, the white paper, the docs and
     these values all move together or the evidence stops matching. */
  eq('digest_before is pinned', digestBefore,
     'da1650fc0e63e26eba33913f25f24fb9fbdc78ce4c55549279cb9582d3119993');
  eq('digest_after is pinned', digestAfter,
     '2b9d863c5ab89a90a2416a9a708ce09fa8876b6d8d91e58199696181e7da7b15');

  /* The saving as the referee sees it, not as the solver claims it: the legs
     the applied route carries must sum to what was searched. */
  const applied = afterRoute.stops.slice(1)
    .reduce((a, s) => a + Math.round(Number(s.travel) * 65536), 0);
  eq('the exported sheet costs exactly what was searched', applied, outcome.bestCostQ);
  eq('which is 60.2 minutes', Number(fromQ(applied).toFixed(1)), 60.2);
}

console.log('\nA matrix that does not cover the sheet is refused, not guessed at');
{
  let threw = null;
  try {
    roundsFromRows(routes, () => -1);
  } catch (e) { threw = e; }
  ok('an unnamed stop is a hard error', threw instanceof RangeError,
     threw ? threw.message : 'nothing was thrown');
  ok('and the message says what to do about it',
     Boolean(threw) && /not named in the distance matrix/.test(threw.message));

  const ragged = () => { try { parseMatrix('0 1 2\n1 0\n2 1 0'); return null; } catch (e) { return e; } };
  ok('a ragged matrix is refused', ragged() instanceof RangeError);
  ok('and says which row is wrong', /row 1 has 2 columns/.test(ragged().message),
     ragged().message);

  const bare = parseMatrix('0 1\n1 0');
  eq('a matrix with no legend names its rows by index', [...bare.names], [['0', 0], ['1', 1]]);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
