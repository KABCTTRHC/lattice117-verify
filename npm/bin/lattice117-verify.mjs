#!/usr/bin/env node
/**
 * lattice117-verify — independent digest re-derivation.
 *
 *   npx lattice117-verify reproduce
 *
 * Runs the published fixtures through the published engine and prints the
 * digests, next to the values they are supposed to be. It needs no arguments,
 * no configuration, no account and no network, and it writes nothing outside
 * stdout.
 *
 * # Why this command exists
 *
 * §8 of the white paper records an open gap: every digest in it was produced by
 * us. Nine device captures across three phones are still nine captures on
 * hardware we held. The claim the product rests on — same schedule, same
 * verdict, same digest, anywhere — is not something we can close by running it
 * again ourselves, however many times.
 *
 * Closing it takes one person who is not us, on a machine we have never
 * touched, getting the same strings. This command exists to make that take
 * thirty seconds rather than an afternoon, because an ask that costs an
 * afternoon does not get done.
 *
 * A NON-MATCH IS THE MORE USEFUL RESULT. If your output differs from the
 * expected values, please report it: that is a defect in a claim we are selling,
 * and we would rather learn it from you than from a customer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { arch, platform, release, cpus, totalmem } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const read = (f) => readFileSync(join(PKG, f), 'utf8');

const { verifyFleet, verdictDigest } = await import(join(PKG, 'index.js'));
const { parseMatrix, resequenceRound, roundsFromRows, applyToRoute } =
  await import(join(PKG, 'resequence.js'));

/** The three strings this command exists to reproduce. */
const EXPECTED = [
  ['fleet v1',            'e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d'],
  ['nottingham before',   'da1650fc0e63e26eba33913f25f24fb9fbdc78ce4c55549279cb9582d3119993'],
  ['nottingham after',    '2b9d863c5ab89a90a2416a9a708ce09fa8876b6d8d91e58199696181e7da7b15'],
];

/** A route sheet CSV as the engine's own surfaces read one. */
function routesFrom(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.trim());
  const ix = (n) => head.indexOf(n);
  const byVehicle = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const v = c[ix('vehicle')].trim();
    if (!byVehicle.has(v)) {
      byVehicle.set(v, { id: v, depart: ix('depart') >= 0 ? c[ix('depart')] : 0, stops: [] });
    }
    byVehicle.get(v).stops.push({
      id: c[ix('stop')].trim(),
      open: c[ix('window_open')],
      close: c[ix('window_close')],
      travel: c[ix('travel_mins_from_previous')],
      seq: Number(c[ix('seq')]),
    });
  }
  return [...byVehicle.values()]
    .map((r) => ({ ...r, stops: r.stops.sort((a, b) => a.seq - b.seq) }));
}

const line = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);

console.log('\nLattice117 — independent digest re-derivation');
console.log('='.repeat(62));

console.log('\nEnvironment');
line('node', process.version);
line('platform', `${platform()} ${release()} (${arch()})`);
line('cpu', (cpus()[0]?.model ?? 'unknown').trim());
line('cores', String(cpus().length));
line('memory', `${Math.round(totalmem() / 1024 ** 3)} GB`);
line('package', JSON.parse(read('package.json')).version);
line('engine bytes', String(readFileSync(join(PKG, 'lattice117_wasm.wasm')).length));

const got = [];

/* ── 1. Fleet v1 ─────────────────────────────────────────────────────────
   The digest the white paper cites and the nine device captures record. Eight
   rounds, no departure column, so this is the v1 canonical form exactly. */
{
  const routes = routesFrom(read('example-route-sheet.csv'));
  const verdict = await verifyFleet(routes);
  got.push(await verdictDigest(routes, verdict));
  console.log('\n1. Fleet fixture (example-route-sheet.csv)');
  line('rounds checked', String(verdict.checked));
  line('feasible', `${verdict.feasible} of ${verdict.checked}`);
}

/* ── 2 and 3. The Tier 5 Nottingham benchmark ────────────────────────────
   One round handed over in alphabetical order, which breaches, and the same
   round re-sequenced against a distance matrix derived from real coordinates.
   The solver proposes the order; the engine above grades both. */
{
  const { matrix, n, names } = parseMatrix(read('example-fleet-nottingham-matrix.txt'));
  const routes = routesFrom(read('example-fleet-nottingham.csv'));
  const rounds = roundsFromRows(routes, (id) => (names.has(id) ? names.get(id) : -1));

  const before = await verifyFleet([routes[0]]);
  got.push(await verdictDigest([routes[0]], before));

  const outcome = resequenceRound(rounds[0], matrix, n);
  const after = applyToRoute(routes[0], rounds[0], outcome, matrix, n);
  const afterVerdict = await verifyFleet([after]);
  got.push(await verdictDigest([after], afterVerdict));

  console.log('\n2/3. Nottingham benchmark (Tier 5 re-sequencing)');
  line('before', `${(outcome.originalCostQ / 65536).toFixed(1)} min, ` +
                 `${before.feasible ? 'FEASIBLE' : 'INFEASIBLE'}`);
  line('after', `${(outcome.bestCostQ / 65536).toFixed(1)} min, ` +
                `${afterVerdict.feasible ? 'FEASIBLE' : 'INFEASIBLE'}`);
  line('order found', outcome.bestIds.join(' -> '));
}

console.log('\nDigests');
let mismatched = 0;
EXPECTED.forEach(([label, want], i) => {
  const ok = got[i] === want;
  if (!ok) mismatched++;
  console.log(`\n  ${ok ? 'MATCH   ' : 'MISMATCH'}  ${label}`);
  console.log(`    expected  ${want}`);
  console.log(`    got       ${got[i]}`);
});

console.log(`\n${'='.repeat(62)}`);
if (mismatched === 0) {
  console.log('\nAll three digests match.\n');
  console.log('Please paste this entire output into a reproduction report:');
  console.log('  https://github.com/KABCTTRHC/lattice117-verify/issues/new'
              + '?template=digest-reproduction.yml\n');
  console.log('That is the whole ask. It closes an open gap in the white paper');
  console.log('that we cannot close ourselves, because every digest in it so far');
  console.log('was produced on hardware we held.\n');
} else {
  console.log(`\n${mismatched} of ${EXPECTED.length} digests DID NOT MATCH.\n`);
  console.log('This is the more useful result, and we would rather hear it from');
  console.log('you than from a customer. Please report it with this output:');
  console.log('  https://github.com/KABCTTRHC/lattice117-verify/issues/new'
              + '?template=digest-reproduction.yml\n');
}
process.exit(mismatched === 0 ? 0 : 1);
