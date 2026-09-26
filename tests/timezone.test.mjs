/**
 * Timezone independence of the rota path.
 *
 * `demo/rota.js` parses dates with an integer civil-date algorithm and never
 * constructs a `Date`. That is deliberate: `new Date('2026-09-28 06:00')` is
 * interpreted against the viewer's zone, so a Date-based parser would let a
 * traveller's laptop settings change a compliance verdict.
 *
 * The nine device captures in docs/WHITEPAPER-OUTLINE-determinism.md were all
 * taken in Europe/London, so they do not test this. These tests do.
 *
 * Run: node tests/timezone.test.mjs
 */
import { evaluateRota, RULES } from '../demo/rota.js';
import { rotaDigest } from '../demo/digest.js';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Child processes import by path, and `new URL(...).pathname` yields "/C:/..."
// on Windows, which is not an importable specifier. This job runs on Ubuntu
// today; fileURLToPath keeps it correct if it ever does not.
const path = (rel) => fileURLToPath(new URL(rel, import.meta.url));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};
const shift = (staff, date, start, end, brk = 30) => ({ staff, date, start, end, break: brk });

/* -- 1. the source may not reach for the host clock or locale -------------- */

console.log('\nStatic guards');
for (const f of ['demo/rota.js', 'demo/digest.js']) {
  // strip block and line comments before searching, so the explanatory
  // comment in rota.js that names `new Date` does not trip the guard.
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  eq(`${f} constructs no Date`, /\bnew\s+Date\b|\bDate\s*\.\s*(parse|now|UTC)\b/.test(src), false);
  eq(`${f} reads no locale or zone`, /toLocale|Intl\.|getTimezoneOffset/.test(src), false);
}

/* -- 2. the fixture digest must not move with TZ --------------------------- */

const rows = readFileSync(new URL('../demo/example-rota.csv', import.meta.url), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((l, i) => {
    const c = l.split(','); return { staff:c[0], date:c[1], start:c[2], end:c[3], break:c[4], row:i+2 };
  });
const r = evaluateRota(rows);
const reference = await rotaDigest(r.people, r.verdict, r.rules);

// Zones picked for awkwardness: whole-hour, 45-minute, half-hour, the far
// side of the date line, and a southern-hemisphere DST schedule.
const ZONES = [
  'UTC', 'Europe/London', 'America/Los_Angeles', 'Asia/Kathmandu',
  'Australia/Lord_Howe', 'Pacific/Kiritimati', 'Pacific/Marquesas',
  'Asia/Kolkata', 'Pacific/Chatham',
];
const child = `
  import { evaluateRota } from ${JSON.stringify(pathToFileURL(path('../demo/rota.js')).href)};
  import { rotaDigest } from ${JSON.stringify(pathToFileURL(path('../demo/digest.js')).href)};
  import { readFileSync } from 'node:fs';
  const rows = readFileSync(${JSON.stringify(path('../demo/example-rota.csv'))}, 'utf8')
    .trim().split(/\\r?\\n/).slice(1).map((l, i) => {
      const c = l.split(','); return { staff:c[0], date:c[1], start:c[2], end:c[3], break:c[4], row:i+2 };
    });
  const r = evaluateRota(rows);
  process.stdout.write(await rotaDigest(r.people, r.verdict, r.rules));
`;

console.log(`\nFixture digest across ${ZONES.length} timezones`);
const seen = new Map();
for (const tz of ZONES) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', child],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  seen.set(tz, out.trim());
  eq(`TZ=${tz}`, out.trim(), reference);
}
eq('all zones agree on one digest', new Set(seen.values()).size, 1);

/* -- 3. rest and break durations must not move with TZ -------------------- */

console.log('\nBoundary cases across the date line');
// The engine's own boundary tests, re-asserted here because a Date-based
// parser would shift these by the host offset and silently pass or fail.
const b = (rows) => evaluateRota(rows).breaches.map((x) => `${x.kind}:${x.shortfall}`);
eq('exactly 11h rest is clear regardless of host zone',
   b([shift('A','2026-01-01','14:00','22:00'), shift('A','2026-01-02','09:00','17:00')]), []);
eq('10h59m rest flags by 1 regardless of host zone',
   b([shift('A','2026-01-01','14:00','22:00'), shift('A','2026-01-02','08:59','17:00')]), ['rest:1']);
// A shift written across the new year, where a zone offset would change the day.
eq('rest across a year boundary measures 11h',
   b([shift('A','2025-12-31','14:00','22:00'), shift('A','2026-01-01','09:00','17:00')]), []);
// 2028 is a leap year; 29 February must exist and be one day after 28 February.
eq('rest across 29 February measures 11h',
   b([shift('A','2028-02-28','14:00','22:00'), shift('A','2028-02-29','09:00','17:00')]), []);
eq('rest across 29 February at 10h59m flags by 1',
   b([shift('A','2028-02-28','14:00','22:00'), shift('A','2028-02-29','08:59','17:00')]), ['rest:1']);

/* -- 4. DST: pinned, and a KNOWN SEMANTIC LIMITATION ---------------------- */

console.log('\nDST transitions (pinning current behaviour — see note)');
// Europe/London 2026: clocks go FORWARD 01:00 -> 02:00 on Sunday 29 March.
// 22:00 Sat to 09:00 Sun is 11 hours of CIVIL time but only 10 hours elapsed.
// The engine measures civil time, so it reports this night clear.
//
//   *** This is a false negative in the direction that matters. ***
//
// It is not a determinism defect — every platform agrees — it is a policy
// choice that follows from refusing to consult the host zone, and it is
// recorded in §7.5 and §9 of docs/WHITEPAPER-OUTLINE-determinism.md.
// Do not "fix" this test; changing it changes published verdict digests.
eq('spring-forward night reports clear (11h civil, 10h elapsed)',
   b([shift('A','2026-03-28','14:00','22:00'), shift('A','2026-03-29','09:00','17:00')]), []);
// Clocks go BACK 02:00 -> 01:00 on Sunday 25 October 2026: 12 hours elapsed,
// measured as 11. Conservative direction, so harmless.
eq('autumn-back night reports clear (11h civil, 12h elapsed)',
   b([shift('B','2026-10-24','14:00','22:00'), shift('B','2026-10-25','09:00','17:00')]), []);
// The shortfall arithmetic is unaffected by the transition either way.
eq('spring-forward night at 10h59m civil still flags by 1',
   b([shift('A','2026-03-28','14:00','22:00'), shift('A','2026-03-29','08:59','17:00')]), ['rest:1']);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
