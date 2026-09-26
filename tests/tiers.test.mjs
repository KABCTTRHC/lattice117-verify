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

console.log('\nOne slug per tier, and no aliases');
eq('tier4 resolves',             canonicalTier('tier4'), 'tier4');
eq('tier5 resolves',             canonicalTier('tier5'), 'tier5');
eq('pro resolves',               canonicalTier('pro'), 'pro');
// Removed deliberately: two names for one entitlement is the same drift hazard
// as two canonicalisations for one schedule, and a price is not an identity.
eq('enterprise_249 is gone',     canonicalTier('enterprise_249'), null);
eq('enterprise_499 is gone',     canonicalTier('enterprise_499'), null);
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
  // standard is a live product at £29/month with a live Stripe link. If it
  // ever stops being issuable, a paying customer cannot receive a key.
  eq('standard is still issuable', ISSUABLE_TIERS.includes('standard'), true);
  eq('exactly one slug per tier', ISSUABLE_TIERS.length, 5);
  eq('no alias slugs survive',
     ISSUABLE_TIERS.filter((t) => /^enterprise_/.test(t)), []);
}

console.log('\nAnything with a live Stripe link must be issuable');
{
  // The failure this catches is silent and expensive: a card takes money for a
  // tier whose slug issue.mjs refuses, so the customer pays and no key exists.
  const page = readFileSync(new URL('../demo/audit.html', import.meta.url), 'utf8');
  for (const [constant, tier] of [
    ['STANDARD_STRIPE_URL', 'standard'],
    ['PRO_STRIPE_URL', 'pro'],
    ['TIER4_STRIPE_URL', 'tier4'],
    ['TIER5_STRIPE_URL', 'tier5'],
  ]) {
    const live = new RegExp(`${constant}\\s*=\\s*'https`).test(page);
    if (live) eq(`${tier} is for sale and issuable`, ISSUABLE_TIERS.includes(tier), true);
  }
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
