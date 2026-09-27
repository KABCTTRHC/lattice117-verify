/**
 * The toolpath adapter, starting with the test that had to come first.
 *
 * # Why the identity test leads this file
 *
 * An earlier audit in this project reported a 42% optimality gap against an
 * invented 17-gon chord table — a "bug" that existed only in the measuring
 * instrument. The distance convention is exactly where that class of mistake
 * lives: the adapter computes a distance, the engine reads a matrix entry, and
 * if those two are not the SAME NUMBER then every saving reported afterwards is
 * fiction, reproducibly and confidently.
 *
 * So before anything is measured: the number the adapter computes for a pair
 * IS the number in the matrix at that pair's index, on random coordinates.
 */
import { strict as assert } from 'node:assert';
import {
  rapidDistance, toQ16, fromQ16, toolpathMatrix, MAX_MM,
  parseSvg, parseGcode, segmentsToRound, cutLength, HOME,
} from '../demo/toolpath.js';
import { resequenceRound } from '../demo/resequence.js';

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};
const throws = (name, fn, re) => {
  try { fn(); ok(name, false); }
  catch (e) { ok(name, re ? re.test(e.message) : true); }
};

/* A deterministic PRNG, so a failure is reproducible from the seed rather than
   "it went red once on CI". Same LCG constants as the Rust annealer. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/* ========================================================================
   1. THE IDENTITY — the adapter's distance IS the matrix entry
   ===================================================================== */
console.log('\nThe distance convention: adapter and matrix agree, on random coordinates');
{
  const rnd = lcg(117);
  for (let trial = 0; trial < 40; trial++) {
    const segs = Array.from({ length: 2 + Math.floor(rnd() * 5) }, (_, i) => ({
      id: `cut${i}`,
      points: [
        { x: rnd() * 600 - 300, y: rnd() * 600 - 300 },
        { x: rnd() * 600 - 300, y: rnd() * 600 - 300 },
      ],
    }));
    const { matrix, n, nodes } = toolpathMatrix(segs);

    let agreed = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        /* The DIAGONAL is excluded, and writing this test first is what forced
           the question. M[i][i] would be "the rapid from cut i's end back to
           its own start" — a real distance, and a journey the machine never
           makes, because you do not travel from a cut to itself. It is 0 by
           definition and asserted as such below. Had this loop not been
           written first, the diagonal would have been whatever fell out. */
        if (i === j) { agreed++; continue; }
        const expected = toQ16(rapidDistance(nodes[i].end, nodes[j].start));
        if (matrix[i * n + j] !== expected) {
          ok(`trial ${trial}: matrix[${i}][${j}] is the adapter's own distance`, false);
          console.log(`        matrix ${matrix[i * n + j]}  adapter ${expected}`);
          i = n; break;
        }
        agreed++;
      }
    }
    if (agreed === n * n && trial === 39) {
      ok('every entry of every matrix equals the adapter distance for that pair', true);
    }
  }
}

/* ========================================================================
   2. ASYMMETRY — a segment has a start and an end, and they differ
   ===================================================================== */
console.log('\nThe matrix is asymmetric, because a cut has a direction');
{
  /* Two horizontal cuts. Going A->B leaves A's END and arrives at B's START;
     going B->A leaves B's END and arrives at A's START. Those are different
     journeys and a symmetric matrix would quietly average them away. */
  const segs = [
    { id: 'A', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    { id: 'B', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
  ];
  const { matrix, n, nodes } = toolpathMatrix(segs);
  const iA = nodes.findIndex((v) => v.id === 'A');
  const iB = nodes.findIndex((v) => v.id === 'B');
  // A ends at (100,0); B starts at (0,50)  -> sqrt(100^2+50^2) = 111.803...
  // B ends at (100,50); A starts at (0,0)  -> the same by symmetry of THIS pair,
  // so use a deliberately lopsided pair for the real asymmetry check.
  ok('A→B and B→A are computed from end→start, not centre→centre',
     matrix[iA * n + iB] === toQ16(rapidDistance({ x: 100, y: 0 }, { x: 0, y: 50 })));

  const lop = [
    { id: 'P', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    { id: 'Q', points: [{ x: 90, y: 0 }, { x: 100, y: 0 }] },
  ];
  const r = toolpathMatrix(lop);
  const p = r.nodes.findIndex((v) => v.id === 'P');
  const q = r.nodes.findIndex((v) => v.id === 'Q');
  // P ends at 10, Q starts at 90 -> 80.  Q ends at 100, P starts at 0 -> 100.
  ok('and the two directions genuinely differ (80 vs 100)',
     fromQ16(r.matrix[p * r.n + q]) === 80 && fromQ16(r.matrix[q * r.n + p]) === 100);
  ok('the diagonal is zero', matrix[iA * n + iA] === 0 && matrix[iB * n + iB] === 0);
}

/* ========================================================================
   3. HOME — the tool starts and returns somewhere
   ===================================================================== */
console.log('\nHome is node 0, and it is a real position rather than a fiction');
{
  const segs = [{ id: 'A', points: [{ x: 3, y: 4 }, { x: 10, y: 0 }] }];
  const { matrix, n, nodes } = toolpathMatrix(segs, { home: { x: 0, y: 0 } });
  ok('node 0 is home', nodes[0].id === HOME);
  ok('home→A is the distance from home to A\'s START (3,4) = 5',
     fromQ16(matrix[0 * n + 1]) === 5);
  ok('A→home is the distance from A\'s END (10,0) to home = 10',
     fromQ16(matrix[1 * n + 0]) === 10);
}

/* ========================================================================
   4. RANGE — Q16.16 refuses rather than wraps
   ===================================================================== */
console.log('\nOut-of-range geometry is refused, not wrapped');
{
  ok(`MAX_MM is the Q16.16 ceiling (${MAX_MM})`, MAX_MM === 32767);
  throws('a coordinate past the ceiling throws by name',
    () => toQ16(MAX_MM + 1), /Q16\.16|range/i);
  throws('and a bed larger than the format is refused at matrix build',
    () => toolpathMatrix([{ id: 'X', points: [{ x: 0, y: 0 }, { x: 40000, y: 0 }] }]),
    /range|Q16\.16/i);
  throws('NaN is refused', () => toQ16(NaN), /finite|number/i);
}

/* ========================================================================
   5. PARSERS — real files, no invented geometry
   ===================================================================== */
console.log('\nSVG');
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <path id="outer" d="M 10 10 L 90 10 L 90 90 L 10 90 Z"/>
    <path id="slot"  d="M120,20 L180,20"/>
    <path d="M 20 150 L 80 150 L 50 190 Z"/>
  </svg>`;
  const segs = parseSvg(svg);
  ok('three paths become three segments', segs.length === 3);
  ok('the id attribute is used when present', segs[0].id === 'outer' && segs[1].id === 'slot');
  ok('an unnamed path gets a positional id', /^path-3$|^path3$|3/.test(segs[2].id));
  ok('Z closes the contour back to its first point',
     segs[0].closed === true &&
     segs[0].points.at(-1).x === segs[0].points[0].x &&
     segs[0].points.at(-1).y === segs[0].points[0].y);
  ok('comma and space separators both parse',
     segs[1].points[0].x === 120 && segs[1].points[1].x === 180);
}

console.log('\nG-code');
{
  const g = [
    'G21 ; millimetres',
    'G0 X0 Y0',
    'G0 X10 Y10',      // rapid: positions the tool, starts a cut
    'G1 X50 Y10 F300', // cut
    'G1 X50 Y40',      // cut, same segment
    'G0 X90 Y90',      // rapid: ends that cut, starts the next
    'G1 X120 Y90',     // cut
    'M2',
  ].join('\n');
  const segs = parseGcode(g);
  ok('two cutting segments are found', segs.length === 2);
  ok('the first runs (10,10)→(50,10)→(50,40)',
     segs[0].points.length === 3 && segs[0].points.at(-1).y === 40);
  ok('the second starts where its rapid left the tool',
     segs[1].points[0].x === 90 && segs[1].points[0].y === 90);
  ok('rapids are not themselves cuts',
     segs.every((s) => s.points.length >= 2));
  ok('modal coordinates carry forward (G1 X50 Y40 keeps X)',
     segs[0].points[2].x === 50);
}

/* ========================================================================
   6. THE ROUND — what the engine actually receives
   ===================================================================== */
console.log('\nThe round handed to the re-sequencer');
{
  const segs = [
    { id: 'A', points: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
    { id: 'B', points: [{ x: 50, y: 0 }, { x: 60, y: 0 }] },
  ];
  const { matrix, n, nodes } = toolpathMatrix(segs);
  const round = segmentsToRound(segs, nodes);
  ok('it opens and closes at home',
     round.stops[0].id === HOME && round.stops.at(-1).id === HOME);
  ok('with one stop per cut in between', round.stops.length === segs.length + 2);
  ok('every stop carries its matrix row', round.stops.every((s) => typeof s.node === 'number'));
  ok('windows are wide open — a mill has no delivery slots',
     round.stops.every((s) => s.open === 0 && s.close >= MAX_MM - 1));
  ok('the matrix is square and complete', matrix.length === n * n);
}

/* ========================================================================
   7. END TO END — a measured saving, on geometry in this file
   ===================================================================== */
console.log('\nEnd to end: six cuts in CAD emission order, re-sequenced');
{
  /* Two rows of cuts, interleaved in the path list the way a CAD package
     emits them when the operator drew them alternately. Nothing about this
     is adversarial — it is what an untouched export looks like. */
  const svg = '<svg>' + [
    ['a', 10, 10, 60, 10], ['b', 200, 180, 250, 180], ['c', 70, 12, 120, 12],
    ['d', 260, 180, 300, 180], ['e', 130, 14, 180, 14], ['f', 150, 180, 190, 180],
  ].map(([id, x1, y1, x2, y2]) =>
    `<path id="${id}" d="M ${x1} ${y1} L ${x2} ${y2}"/>`).join('') + '</svg>';

  const segs = parseSvg(svg);
  const { matrix, n, nodes } = toolpathMatrix(segs);
  const out = resequenceRound(segmentsToRound(segs, nodes), matrix, n);

  ok('six cuts parsed', segs.length === 6);
  ok('four interior stops is under the exact limit, so this IS the optimum',
     out.searched === true);
  ok('the order changed', out.changed === true);

  const before = fromQ16(out.originalCostQ), after = fromQ16(out.bestCostQ);
  ok(`rapid travel 1367.3 -> 573.1 mm  (got ${before.toFixed(1)} -> ${after.toFixed(1)})`,
     before.toFixed(1) === '1367.3' && after.toFixed(1) === '573.1');
  ok('which is 58.1% of the rapid travel, not of cycle time',
     (100 * out.savingQ / out.originalCostQ).toFixed(1) === '58.1');

  /* The cutting length is the same whatever order the cuts are made in. That
     is the whole reason this is the right quantity to optimise, and asserting
     it stops anyone later reporting the saving as a share of cycle time. */
  const cut = segs.reduce((a, sg) => a + cutLength(sg), 0);
  ok(`cutting length is invariant under reordering (${cut.toFixed(1)} mm)`,
     cut.toFixed(1) === '280.0');

  ok('the found order groups each row rather than alternating',
     out.bestIds.join(' ') === 'HOME a c e f b d HOME');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
