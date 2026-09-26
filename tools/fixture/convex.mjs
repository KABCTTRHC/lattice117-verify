/**
 * Fixture B — a benchmark whose optimum is a theorem, not a download.
 *
 * ## Why this shape
 *
 * Fixture B exists to test the solver against an answer someone other than us
 * agreed on. The obvious way to do that is to vendor a published benchmark
 * instance — Solomon's VRPTW set, or a TSPLIB case — and compare. We do not,
 * and docs/FIXTURE-B-BENCHMARK.md records why: TSPLIB's own licence permits
 * non-commercial use only and forbids redistribution without written
 * permission, which is disqualifying for a repository under AGPL with a
 * commercial dual licence, and Solomon's instances carry no licence statement
 * at all — they are redistributed by academic custom rather than by grant.
 * Vendoring either would be taking an unquantified risk quietly.
 *
 * So the external standard here is a **theorem** instead of a dataset:
 *
 *   For points in convex position, the optimal travelling-salesman tour is the
 *   convex-hull order.
 *
 * That is elementary and old — any tour with two crossing edges can be shortened
 * by uncrossing them (the triangle inequality), so an optimal tour has no
 * crossings, and the only non-crossing cyclic order of points in convex position
 * is the hull order. A regular polygon is the cleanest case: the optimum is the
 * perimeter, and its length is `n · 2R · sin(π/n)` in closed form.
 *
 * This is a better test than a downloaded instance in three ways. It is
 * redistributable, because we generated it. It is checkable by the reader
 * without trusting us, because the closed form is one line of trigonometry. And
 * the optimum is exact rather than best-known, so a failure is unambiguous.
 *
 * What it does NOT do is measure the solver against the state of the art on a
 * hard instance. That is what `tools/benchmark/` is for, and it needs an
 * instance file the user supplies themselves.
 *
 * ## Shape of the instance
 *
 * Nine nodes on a circle, node 0 as the depot, which leaves eight interior
 * stops — exactly `resequence::EXACT_LIMIT`. That is deliberate: the fixture
 * sits on the documented boundary of exhaustive search, so it proves the exact
 * path returns the optimum at the largest size it claims to.
 *
 * Run:  node tools/fixture/convex.mjs          (writes the fixture)
 *       node tools/fixture/convex.mjs --check  (fails if it is stale)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'tests/fixtures/convex-9.txt');
/* A second, larger ring. Nine nodes is inside the exact bound, so it measures
   the exhaustive path; sixteen is past it, so it measures the heuristic. The
   theorem is the same at both sizes, which is what makes the pair useful: one
   number is "did the exact path find the optimum" and the other is "how far off
   is the heuristic", and both are against the same known answer. */
const OUT_BIG = join(ROOT, 'tests/fixtures/convex-16.txt');
export const N_BIG = 16;

/** Nodes on the circle. Nine, so the interior is exactly EXACT_LIMIT. */
export const N = 9;
/** Circle radius in km. Round numbers keep the derivation readable. */
export const RADIUS_KM = 10;
/** The same fixed urban average the Nottingham fixture uses. */
export const SPEED_KMH = 30;

/** Node `i` at angle `2πi/n`, counter-clockwise from due east. */
export function coordinates(n = N) {
  return [...Array(n)].map((_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [RADIUS_KM * Math.cos(t), RADIUS_KM * Math.sin(t)];
  });
}

/**
 * The matrix, in minutes rounded to one decimal place.
 *
 * Rounded once, here, for the same reason the Nottingham fixture is: Q16.16
 * holds 0.1 only to within 1/65536, so every surface must start from the same
 * decimal string or the digests diverge.
 *
 * The rounding is also why this generator is not the whole story. Rounding can
 * in principle break the theorem — a rounded matrix is not exactly Euclidean,
 * so "no crossings" no longer follows for free. The referee test therefore
 * checks the claim against THIS matrix by exhaustive search rather than
 * asserting it from the geometry. It holds, with 24.0 minutes between the
 * optimum and the second-best order.
 */
export function matrixMinutes(n = N) {
  const p = coordinates(n);
  return p.map((a) =>
    p.map((b) => Number(((Math.hypot(a[0] - b[0], a[1] - b[1]) / SPEED_KMH) * 60).toFixed(1))));
}

/** The optimal tour length in minutes, closed form: n · 2R · sin(π/n). */
export function optimalMinutesExact(n = N) {
  return ((n * 2 * RADIUS_KM * Math.sin(Math.PI / n)) / SPEED_KMH) * 60;
}

function render(n = N) {
  const m = matrixMinutes(n);
  const role = n <= 9
    ? 'inside EXACT_LIMIT, so it measures the exhaustive path'
    : 'past EXACT_LIMIT, so it measures the heuristic path';
  return [
    `# Lattice117 Fixture B - convex-position benchmark, ${n} nodes`,
    `# ${role}.`,
    '#',
    '# Nodes on a circle of radius 10 km, equally spaced, travel at a fixed',
    `# ${SPEED_KMH} km/h. For points in convex position the optimal tour is the`,
    '# convex-hull order, so the optimum here is the perimeter and its length is',
    `# n * 2R * sin(pi/n) = ${optimalMinutesExact(n).toFixed(3)} min exactly, and the`,
    '# rounded sum of its legs once each is taken to 1 dp. The external standard',
    '# is a theorem, not a downloaded dataset: see docs/FIXTURE-B-BENCHMARK.md',
    '# for why that choice was forced.',
    '#',
    '# GENERATED by tools/fixture/convex.mjs - do not hand-edit.',
    `# nodes: ${[...Array(n)].map((_, i) => `${i}=N${i}`).join(', ')}`,
    ...m.map((r) => r.map((v) => v.toFixed(1)).join(' ')),
    '',
  ].join('\n');
}

/* Only act on argv when run as a script. These modules are imported by the
   test suite, and a `--check` meant for the importer must not be read as one
   for the generator — nor may an import ever write a file. */
const RUN_AS_SCRIPT = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];

const artifacts = [[OUT, render(N)], [OUT_BIG, render(N_BIG)]];

if (RUN_AS_SCRIPT && process.argv.includes('--check')) {
  const stale = artifacts.filter(([path, want]) => {
    let have = '';
    try { have = readFileSync(path, 'utf8'); } catch { /* missing counts as stale */ }
    return have.replace(/\r\n/g, '\n') !== want;
  });
  if (stale.length) {
    console.error(`stale, run node tools/fixture/convex.mjs:\n  ` +
                  stale.map(([p]) => p).join('\n  '));
    process.exit(1);
  }
  console.log('convex fixtures are up to date');
} else if (RUN_AS_SCRIPT) {
  for (const [path, want] of artifacts) {
    writeFileSync(path, want);
    console.log(`wrote ${path}`);
  }
}
