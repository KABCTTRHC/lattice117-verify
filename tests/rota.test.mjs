/**
 * Rota rest/break checks — boundaries and negative controls.
 *
 * The boundary cases matter more here than anywhere else in the product. A
 * false positive at exactly 11 hours would have someone rewriting a lawful
 * rota, and a false negative would have them trusting an unlawful one. Both
 * are tested in both directions.
 *
 * Run: node tests/rota.test.mjs
 */
import { evaluateRota, RULES, breakToMinutes, toMinutes,
         DISCLAIMER, RULES_NOTE, CLOCK_NOTE } from '../demo/rota.js';
import { rotaDigest, canonicaliseRota } from '../demo/digest.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};
const shift = (staff, date, start, end, brk = 30) => ({ staff, date, start, end, break: brk });
const kinds = (rows) => evaluateRota(rows).breaches.map((b) => `${b.kind}:${b.staff}:${b.shortfall}`);

console.log('\nRest boundary (threshold 660 minutes)');
// 22:00 -> next day 09:00 is exactly 11h. Lawful, must NOT flag.
eq('exactly 11h rest is clear',
   kinds([shift('A','2026-01-01','14:00','22:00'), shift('A','2026-01-02','09:00','17:00')]), []);
// one minute less must flag, by exactly one minute
eq('10h59m rest flags, shortfall 1',
   kinds([shift('A','2026-01-01','14:00','22:00'), shift('A','2026-01-02','08:59','17:00')]),
   ['rest:A:1']);
eq('8h rest flags, shortfall 180',
   kinds([shift('A','2026-01-01','14:00','22:00'), shift('A','2026-01-02','06:00','14:00')]),
   ['rest:A:180']);

console.log('\nBreak boundary (>6h shift needs 20m)');
// exactly 6h is NOT "more than 6 hours" - must not flag even with no break
eq('exactly 6h shift, no break, is clear',
   kinds([shift('A','2026-01-01','08:00','14:00', 0)]), []);
eq('6h01m shift with no break flags, shortfall 20',
   kinds([shift('A','2026-01-01','08:00','14:01', 0)]), ['break:A:20']);
eq('6h01m shift with exactly 20m break is clear',
   kinds([shift('A','2026-01-01','08:00','14:01', 20)]), []);
eq('6h01m shift with 19m break flags, shortfall 1',
   kinds([shift('A','2026-01-01','08:00','14:01', 19)]), ['break:A:1']);

console.log('\nMidnight crossing');
// 22:00 -> 06:00 is an 8h night shift, not a -16h one.
eq('night shift is 8h, not negative',
   kinds([shift('A','2026-01-01','22:00','06:00')]), []);
eq('night shift then 20:00 next day is clear (14h rest)',
   kinds([shift('A','2026-01-01','22:00','06:00'), shift('A','2026-01-02','20:00','04:00')]), []);

console.log('\nOverlap');
eq('overlapping shifts flag as overlap',
   kinds([shift('A','2026-01-01','08:00','17:00'), shift('A','2026-01-01','16:00','23:00')]),
   ['overlap:A:60']);

console.log('\nIsolation and ordering');
eq('two people do not interact',
   kinds([shift('A','2026-01-01','14:00','22:00'), shift('B','2026-01-02','06:00','14:00')]), []);
eq('rows supplied out of order are sorted before checking',
   kinds([shift('A','2026-01-02','06:00','14:00'), shift('A','2026-01-01','14:00','22:00')]),
   ['rest:A:180']);

console.log('\nParsing');
eq('break "0:30" == 30', breakToMinutes('0:30'), 30);
eq('break "1h 15m" == 75', breakToMinutes('1h 15m'), 75);
eq('break blank == 0', breakToMinutes(''), 0);
eq('UK date 28/09/2026 equals ISO 2026-09-28',
   toMinutes('06:00','28/09/2026'), toMinutes('06:00','2026-09-28'));
eq('combined datetime equals date+time columns',
   toMinutes('2026-09-28 06:00'), toMinutes('06:00','2026-09-28'));

console.log('\nFree-tier cap is applied at evaluation');
const four = ['A','B','C','D'].flatMap((s) =>
  [shift(s,'2026-01-01','14:00','22:00'), shift(s,'2026-01-02','06:00','14:00')]);
eq('uncapped checks 4 people', evaluateRota(four).checked, 4);
eq('capped at 1 checks 1 person',  evaluateRota(four, { maxPeople: 1 }).checked, 1);
eq('capped at 1 reports 3 withheld', evaluateRota(four, { maxPeople: 1 }).capped, 3);

console.log('\nBundled fixture demonstrates both breaches');
const rows = readFileSync(new URL('../demo/example-rota.csv', import.meta.url), 'utf8')
  .trim().split(/\r?\n/).slice(1).map((l, i) => {
    const c = l.split(','); return { staff:c[0], date:c[1], start:c[2], end:c[3], break:c[4], row:i+2 };
  });
const r = evaluateRota(rows);
eq('4 people, 2 clear', [r.checked, r.clear], [4, 2]);
eq('one rest breach and one break breach',
   r.breaches.map((b) => b.kind).sort(), ['break','rest']);
eq('rest breach is 8h against 11h, 3h short',
   r.breaches.filter(b=>b.kind==='rest').map(b=>[b.actual,b.expected,b.shortfall]), [[480,660,180]]);
eq('break breach is 15m against 20m, 5m short',
   r.breaches.filter(b=>b.kind==='break').map(b=>[b.actual,b.expected,b.shortfall]), [[15,20,5]]);

console.log('\nDigest');
const d1 = await rotaDigest(r.people, r.verdict, r.rules);
const d2 = await rotaDigest(evaluateRota(rows).people, evaluateRota(rows).verdict, RULES);
eq('same rota reproduces the same digest', d1, d2);
// Negative control: a digest that cannot change is not a digest.
const bent = { ...RULES, restMinutes: 600 };
const d3 = await rotaDigest(r.people, r.verdict, bent);
eq('changing the threshold changes the digest', d1 !== d3, true);
const nudged = JSON.parse(JSON.stringify(r.people));
nudged[0].shifts[0].start += 1;
const d4 = await rotaDigest(nudged, r.verdict, r.rules);
eq('moving one shift by one minute changes the digest', d1 !== d4, true);
eq('canonical form contains no floating point',
   /\d+\.\d/.test(canonicaliseRota(r.people, r.verdict, r.rules)), false);

/* The clock-time convention is the one case where this check is knowingly
   optimistic (see docs/WTR-REG10-CLOCK-CHANGE.md), so the caveat disclosing it
   is treated as a product requirement, not copy. A surface that emphasised the
   legal line and dropped the caveat would be the worst of both. */
console.log('\nDisclosure of the clock-time convention');
eq('DISCLAIMER carries both parts',
   DISCLAIMER === RULES_NOTE + ' ' + CLOCK_NOTE, true);
eq('the caveat names the direction of the error',
   /clocks go forward/.test(CLOCK_NOTE) && /10 real hours/.test(CLOCK_NOTE), true);
for (const [surface, file] of [
  ['browser page',     'demo/audit.html'],
  ['Excel task pane',  'excel-addin/taskpane.html'],
  ['Sheets template',  'sheets-addon/sidebar.template.html'],
  ['Sheets bundle',    'sheets-addon/Sidebar.html'],
]) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  eq(`${surface} renders the clock-time caveat`, src.includes('CLOCK_NOTE'), true);
}
// audit.html states the same caveat statically, before any CSV is chosen — a
// legal notice should not depend on a module having loaded. Static text drifts,
// so it is pinned to the module's wording here rather than trusted.
{
  const flat = (t) => t.replace(/\s+/g, ' ');
  const page = flat(readFileSync(new URL('../demo/audit.html', import.meta.url), 'utf8'));
  const firstSentence = CLOCK_NOTE.slice(0, CLOCK_NOTE.indexOf('. ') + 1);
  eq('audit.html states the caveat before upload too', page.includes(flat(firstSentence)), true);
}

// Every copy of the module must agree, or one surface disclaims differently.
for (const copy of ['npm/rota.js', 'excel-addin/rota.js']) {
  eq(`${copy} matches demo/rota.js`,
     readFileSync(new URL('../' + copy, import.meta.url), 'utf8')
       === readFileSync(new URL('../demo/rota.js', import.meta.url), 'utf8'), true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
