/**
 * Fixture B — the convex-position benchmark, and the benchmark harness.
 *
 * Two things are checked here. First, that the JS re-sequencer reaches the same
 * proven optimum on the convex fixture as the Rust reference does, with the
 * same Q16.16 integers — the parity discipline of §5.3 of the white paper,
 * applied to Fixture B as it already is to Fixture A. Second, that the harness
 * in tools/benchmark/ reads the two standard formats correctly, in particular
 * TSPLIB's rounding rule, which is where a benchmark most easily flatters
 * itself.
 *
 * No third-party instance data is involved. docs/FIXTURE-B-BENCHMARK.md records
 * why none ships: TSPLIB's licence is non-commercial and forbids
 * redistribution, and Solomon's instances carry no licence at all. Instances
 * written inline below are ours, trivial, and exist to exercise the parser.
 *
 * Run: node tests/benchmark.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EXACT_LIMIT, parseMatrix, resequenceRound } from '../demo/resequence.js';
import { parseTsplib, parseSolomon, euc2d, solomonDistance, matrixOf }
  from '../tools/benchmark/parse.mjs';
import { N, RADIUS_KM, SPEED_KMH, optimalMinutesExact } from '../tools/fixture/convex.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const okay = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${okay ? 'PASS' : 'FAIL'}  ${name}`);
  if (!okay) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  okay ? pass++ : fail++;
};
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : ' — ' + detail}`);
  cond ? pass++ : fail++;
};

/* ── the theorem, and the engine against it ────────────────────────────── */

console.log('\nThe convex-position optimum, and the engine against it');
{
  const { matrix, n } = parseMatrix(read('tests/fixtures/convex-9.txt'));
  eq('the fixture has 9 nodes', n, N);
  eq('so the interior is exactly EXACT_LIMIT', n - 1, EXACT_LIMIT);

  // n * 2R * sin(pi/n) at 30 km/h. Stated independently of the matrix, so this
  // checks the fixture against the closed form rather than against itself.
  const exact = optimalMinutesExact();
  ok(`closed form is 123.127 min (${exact.toFixed(3)})`, Math.abs(exact - 123.127) < 5e-4);
  eq('from the documented radius and speed', [N, RADIUS_KM, SPEED_KMH], [9, 10, 30]);

  // Handed the worst order the instance has, not a nearly-sorted one.
  const scrambled = [0, 4, 8, 3, 7, 2, 6, 1, 5, 0];
  const round = {
    id: 'convex', departQ: 0,
    stops: scrambled.map((node) => ({
      id: `N${node}`, node, openQ: 0, closeQ: 1440 * 65536, travelQ: 0,
    })),
  };
  const out = resequenceRound(round, matrix, n);
  ok('8 interior stops is searched exhaustively', out.searched);

  /* Direction is not pinned. A symmetric matrix cannot tell a tour from its
     reverse, so the theorem names the hull ORDER and not a heading; which one
     comes back depends on how the stops were listed. */
  const ids = out.bestIds.map((s) => Number(s.slice(1)));
  const forward = [...Array(n).keys()].concat(0);
  const backward = [0, ...[...Array(n - 1).keys()].map((i) => n - 1 - i), 0];
  ok('the result is the convex-hull order, in one direction or the other',
     JSON.stringify(ids) === JSON.stringify(forward)
     || JSON.stringify(ids) === JSON.stringify(backward), ids.join('->'));

  // The same Q16.16 integer the Rust referee test asserts.
  eq('cost is 8 080 587 in Q16.16, matching the Rust reference', out.bestCostQ, 8080587);
  eq('which is 123.3 minutes', Number((out.bestCostQ / 65536).toFixed(1)), 123.3);
}

/* ── the harness reads the formats the literature is written in ─────────── */

console.log('\nTSPLIB EUC_2D, including the rounding that is part of the instance');
{
  /* A 4 x 10 rectangle of our own, so the optimum is obvious by inspection:
     the perimeter, 10 + 10 + 10 + 10 = 40. */
  const square = [
    'NAME : square4', 'TYPE : TSP', 'DIMENSION : 4', 'EDGE_WEIGHT_TYPE : EUC_2D',
    'NODE_COORD_SECTION', '1 0 0', '2 10 0', '3 10 10', '4 0 10', 'EOF',
  ].join('\n');
  const inst = parseTsplib(square);
  eq('name and dimension are read', [inst.name, inst.coords.length], ['square4', 4]);

  /* The rounding is load-bearing: TSPLIB defines the weight as
     nint(sqrt(dx^2+dy^2)), and every published optimum is a sum of those
     integers. Full precision would give 14.142 and a smaller, incomparable
     tour — a benchmark flattering itself. */
  eq('the diagonal rounds to 14, not 14.142', euc2d([0, 0], [10, 10]), 14);
  eq('and a whole distance is unchanged', euc2d([0, 0], [10, 0]), 10);

  const { matrix, n } = matrixOf(inst.coords, euc2d);
  const stops = [0, 1, 2, 3, 0].map((node) =>
    ({ id: `N${node}`, node, openQ: 0, closeQ: 1e9, travelQ: 0 }));
  const out = resequenceRound({ id: 't', departQ: 0, stops }, matrix, n);
  eq('the square4 optimum is its perimeter, 40', out.bestCostQ / 65536, 40);

  let threw = null;
  try { parseTsplib('NAME : x\nTYPE : TSP\nEDGE_WEIGHT_SECTION\n1 2 3\n'); }
  catch (e) { threw = e; }
  ok('an explicit-matrix instance is refused, not misread', threw !== null,
     threw ? '' : 'nothing was thrown');
  ok('and the message says which formats are handled',
     Boolean(threw) && /NODE_COORD_SECTION/.test(threw.message));

  let wrongType = null;
  try {
    parseTsplib(['NAME : g', 'EDGE_WEIGHT_TYPE : GEO', 'NODE_COORD_SECTION', '1 0 0', 'EOF'].join('\n'));
  } catch (e) { wrongType = e; }
  ok('a non-EUC_2D weight type is refused rather than silently treated as EUC_2D',
     wrongType !== null && /GEO/.test(wrongType.message));

  let ragged = null;
  try {
    parseTsplib(['NAME : r', 'DIMENSION : 3', 'EDGE_WEIGHT_TYPE : EUC_2D',
                 'NODE_COORD_SECTION', '1 0 0', '2 1 1', 'EOF'].join('\n'));
  } catch (e) { ragged = e; }
  ok('a DIMENSION that disagrees with the coordinate count is refused',
     ragged !== null && /DIMENSION says 3/.test(ragged.message));
}

console.log('\nSolomon format');
{
  const inst = parseSolomon([
    'SYNTH01', '', 'VEHICLE', 'NUMBER     CAPACITY', '  5         200', '',
    'CUSTOMER',
    'CUST NO.  XCOORD.  YCOORD.  DEMAND  READY TIME  DUE DATE  SERVICE TIME', '',
    '    0      40       50        0         0        1236          0',
    '    1      45       68       10        30         900         10',
    '    2      45       70       30        60         800         10',
  ].join('\n'));
  eq('name, fleet and capacity are read',
     [inst.name, inst.vehicles, inst.capacity], ['SYNTH01', 5, 200]);
  eq('three customer rows including the depot', inst.customers.length, 3);
  eq('and the depot row is first with zero demand',
     [inst.customers[0].id, inst.customers[0].demand], [0, 0]);

  /* Solomon distances are plain Euclidean at one decimal place, which is the
     precision Q16.16 represents cleanly and the same rule the bundled fixtures
     use. Stated in a test rather than assumed, because a benchmark silent about
     its rounding is one two people can disagree about while both being right. */
  eq('distance keeps one decimal place',
     solomonDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  eq('and rounds, rather than truncating',
     solomonDistance({ x: 0, y: 0 }, { x: 1, y: 1 }), 1.4);

  let threw = null;
  try { parseSolomon('not a solomon file at all'); } catch (e) { threw = e; }
  ok('a file with no CUSTOMER section is refused', threw !== null);
}

console.log('\nNo third-party instance data ships with this repository');
{
  /* The licence position in docs/FIXTURE-B-BENCHMARK.md is only worth having if
     nothing quietly contradicts it later. best-known.json holds tour lengths,
     which are cited facts; it must never grow coordinates. */
  const known = JSON.parse(read('tools/benchmark/best-known.json'));
  const leaves = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else leaves.push(v);
  };
  walk(known);
  ok('best-known.json records fewer than 100 values, so it is a citation list '
     + 'and not a smuggled dataset', leaves.length < 100, `${leaves.length} values`);
  for (const [name, rec] of Object.entries(known.tsplib)) {
    ok(`  ${name} cites a source`, typeof rec.source === 'string' && rec.source.length > 8);
  }
  ok('every Solomon entry says it is a fleet distance, not a tour length',
     /not comparable/i.test(known.solomon._comment));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
