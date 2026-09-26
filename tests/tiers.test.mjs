/**
 * The entitlement model, and the two failure modes that cost money.
 *
 * Run: node tests/tiers.test.mjs
 */
import { FREE_TIER, canonicalTier, ISSUABLE_TIERS } from '../demo/licence.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
};

console.log('\nTier names resolve, including the paid aliases');
eq('tier4 is itself',            canonicalTier('tier4'), 'tier4');
eq('tier5 is itself',            canonicalTier('tier5'), 'tier5');
eq('enterprise_249 -> tier4',    canonicalTier('enterprise_249'), 'tier4');
eq('enterprise_499 -> tier5',    canonicalTier('enterprise_499'), 'tier5');
eq('pro still resolves',         canonicalTier('pro'), 'pro');
// The degrade-to-Standard fallback is correct for a forged key and wrong for a
// typo at issue time, which is why issue.mjs refuses rather than relying on it.
eq('an unknown tier is null, not Standard', canonicalTier('tier_5'), null);
eq('case matters',               canonicalTier('Tier5'), null);
eq('empty is null',              canonicalTier(''), null);
eq('undefined is null',          canonicalTier(undefined), null);

console.log('\nCapabilities are a ladder, and every tier states all of them');
const SHAPE = ['maxRounds', 'certificate', 'repair', 'matrixSolver', 'label'];
eq('FREE_TIER declares the full shape',
   SHAPE.every((k) => k in FREE_TIER), true);
eq('free grants no repair and no solver',
   [FREE_TIER.repair, FREE_TIER.matrixSolver], [false, false]);

console.log('\nissue.mjs cannot drift from the tiers licence.js enforces');
{
  const src = readFileSync(new URL('../licence/issue.mjs', import.meta.url), 'utf8');
  eq('issue.mjs imports the list rather than restating it',
     /import\s*\{[^}]*ISSUABLE_TIERS[^}]*\}\s*from\s*'\.\/licence\.js'/.test(src), true);
  eq('issue.mjs refuses an unknown tier', /Refusing to issue unknown tier/.test(src), true);
  eq('free is not issuable', ISSUABLE_TIERS.includes('free'), false);
  eq('both enterprise tiers are issuable',
     ISSUABLE_TIERS.includes('tier4') && ISSUABLE_TIERS.includes('tier5'), true);
}

console.log('\nEvery surface carries the same licence module');
{
  const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const base = read('demo/licence.js');
  for (const copy of ['excel-addin/licence.js', 'licence/licence.js']) {
    eq(`${copy} matches demo/licence.js`, read(copy) === base, true);
  }
  eq('the Sheets bundle inlines tier5',
     read('sheets-addon/Sidebar.html').includes('matrixSolver'), true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
