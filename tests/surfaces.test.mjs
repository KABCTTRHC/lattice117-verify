/**
 * Every surface must be complete on its own.
 *
 * This suite exists because two bugs of the same shape got through in one day,
 * and neither was the kind a unit test catches:
 *
 *   1. taskpane.html gained `import ... from './resequence.js'` and
 *      excel-addin/ never gained the file. A real sideload would have 404'd on
 *      load. My smoke harness served demo/ as a fallback directory, so it
 *      passed — a harness more forgiving than production tests the harness.
 *   2. demo/sw.js's SHELL list did not gain resequence.js either. That one is
 *      worse than a slow load: the service worker is cache-first, so offline
 *      the import fails, the module never executes, and audit.html is a dead
 *      page — while the product's whole claim is that it works with the Wi-Fi
 *      off.
 *
 * Both are cheap to check and invisible until someone is standing in front of
 * a customer, so they are checked here.
 *
 * Run: node tests/surfaces.test.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const here = (p) => existsSync(join(ROOT, p));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : ' — ' + detail}`);
  cond ? pass++ : fail++;
};

/** Relative ES module specifiers a page imports: `from './x.js'`. */
const importsOf = (html) =>
  [...html.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]);

/* Bundled data files a page can reach at run time.
   Matching `fetch('x.csv')` alone is not enough: Story mode fetches through
   `storyFile(NOTT_CSV)`, where the name is a constant declared elsewhere, and a
   regex that only understands the call site would have declared that file
   cached when it is not. So this takes EVERY string literal in the page that
   names a file which actually exists in demo/, which over-matches harmlessly
   and under-matches never. */
const dataFilesOf = (html) =>
  [...new Set([...html.matchAll(/['"]\.?\/?([A-Za-z0-9._-]+\.(?:csv|json|txt|wasm))['"]/g)]
    .map((m) => m[1]))].filter((f) => here(`demo/${f}`));

/* Only the pages that actually use ES modules. demo/index.html is a plain
   page with inline scripts, so asserting it imports something would be a test
   of nothing. */
console.log('\nEvery module a page imports sits beside it');
for (const [page, dir] of [
  ['demo/audit.html', 'demo'],
  ['excel-addin/taskpane.html', 'excel-addin'],
]) {
  const mods = importsOf(read(page));
  ok(`${page} imports at least one module`, mods.length > 0, 'none found — has the regex gone stale?');
  for (const m of mods) ok(`  ${dir}/${m} exists`, here(`${dir}/${m}`));
}

console.log('\nShared modules are byte-identical on every surface that copies them');
for (const m of ['licence.js', 'digest.js', 'rota.js', 'freetier.js', 'repair.js', 'resequence.js']) {
  if (!here(`excel-addin/${m}`)) continue;   // npm carries its own subset
  ok(`excel-addin/${m} matches demo/${m}`, read(`excel-addin/${m}`) === read(`demo/${m}`));
}

/* The Excel pane fetches its examples from files beside it rather than having
   them inlined, so those copies can drift where the Sheets bundle's cannot. */
console.log('\nSo are the example sheets the Excel pane offers');
for (const f of ['example-route-sheet.csv', 'example-route-sheet-timed.csv',
                 'example-rota.csv', 'example-fleet-nottingham.csv',
                 'example-fleet-nottingham-matrix.txt']) {
  ok(`excel-addin/${f} exists`, here(`excel-addin/${f}`));
  if (here(`excel-addin/${f}`)) {
    ok(`  and matches demo/${f}`, read(`excel-addin/${f}`) === read(`demo/${f}`));
  }
}

console.log('\nThe offline shell covers everything audit.html needs');
{
  const sw = read('demo/sw.js');
  const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  /* Both pages, because index.html loads the fixtures too and a visitor who
     reloads there offline is the same visitor. */
  const page = read('demo/audit.html') + read('demo/index.html');

  /* A module missing here is not a slow load offline. It is a page that does
     not run at all: the import fails and the module script never executes. */
  for (const m of importsOf(page)) {
    ok(`sw.js caches ${m}`, shell.includes(m),
       `add './${m}' to SHELL in demo/sw.js and bump CACHE`);
  }
  /* A fixture missing here is a feature that silently stops working offline —
     Story mode and the bundled examples both fetch theirs. */
  for (const f of dataFilesOf(page)) {
    ok(`sw.js caches ${f}`, shell.includes(f),
       `add './${f}' to SHELL in demo/sw.js and bump CACHE`);
  }
  ok('every SHELL entry actually exists',
     shell.filter((p) => p && p !== '').every((p) => here(`demo/${p}`)),
     shell.filter((p) => p && !here(`demo/${p}`)).join(', '));
}

/* ── onboarding and upsell, on both spreadsheet surfaces ─────────────────── */
/* Opening the Sheets sidebar live on a blank sheet showed the whole problem:
   a Check button with nothing to check, a Clear button, and a licence box
   quoting a free tier. No columns explained, no data to try, no sign the paid
   tiers existed. Each of those is a reason to close the pane and not return,
   and none of them is the kind of thing a unit test notices — so they are
   asserted here, against both surfaces, by the same checks. */
console.log('\nBoth spreadsheet surfaces onboard and upsell');
{
  const SURFACES = [
    ['sheets-addon/Sidebar.html', 'Sheets sidebar'],
    ['excel-addin/taskpane.html', 'Excel task pane'],
  ];
  const STRIPE = {
    standard: 'buy.stripe.com/9B6dR8eSf5ZF2sn5LfgEg0g',
    pro: 'buy.stripe.com/7sYdR8dOb2Ntc2XflPgEg0h',
    tier4: 'buy.stripe.com/eVq00i6lJ3Rx6ID5LfgEg0i',
    tier5: 'buy.stripe.com/14AfZg5hF87Nc2Xb5zgEg0j',
  };

  for (const [file, label] of SURFACES) {
    const html = read(file);
    console.log(`  — ${label}`);

    // Onboarding: the steps and the one-click examples.
    for (const id of ['howBox', 'howSteps', 'exRoutes', 'exTimed', 'exRota',
                      'exNottingham', 'exampleState']) {
      ok(`    has #${id}`, html.includes(`id="${id}"`));
    }
    ok('    explains the route columns by name',
       /travel time from the previous stop/i.test(html));
    ok('    explains the rota columns by name',
       /shift start/i.test(html) && /break/i.test(html));

    // Tier 4 and Tier 5 are visible and labelled, not hidden behind a run.
    for (const id of ['repairBox', 'matrixBox', 'repairLock', 'matrixLock']) {
      ok(`    has #${id}`, html.includes(`id="${id}"`));
    }
    ok('    neither tier panel is display:none in the markup',
       !/id="(repairBox|matrixBox)"[^>]*display:\s*none/.test(html));
    const norm = html.replace(/\\u00a3/g, '\u00a3').replace(/\\u00b7/g, '\u00b7');
    ok('    the locks name the tier and the price',
       norm.includes('Tier 4 \u00b7 \u00a3249/mo') && norm.includes('Tier 5 \u00b7 \u00a3499/mo'));

    // Pricing, with every live Stripe link present and opened safely.
    ok('    has a plans drawer', html.includes('id="plansBox"') && html.includes('id="planCards"'));
    for (const [tier, url] of Object.entries(STRIPE)) {
      ok(`    carries the ${tier} Stripe link`, html.includes(url));
    }
    ok('    every plan link is target=_blank rel=noopener',
       /target="_blank" rel="noopener"/.test(html));
    /* Prices appear as a literal pound sign in some places and as the escape
       \u00a3 in others, because half this copy lives in HTML and half in a JS
       string. Both mean the same thing to a reader, so the check normalises
       rather than pinning one spelling. */
    const plain = html.replace(/\\u00a3/g, '\u00a3').replace(/\\u00b7/g, '\u00b7');
    ok('    states all four prices',
       ['29', '99', '249', '499'].every((p) => plain.includes(`\u00a3${p}`)));
    ok('    gives the three activation steps',
       /Checkout is handled by Stripe/.test(html)
       && /licence key emailed/.test(html)
       && /public-key signature/.test(html));

    /* The paper says determinism is not correctness, discloses the
       spring-forward false negative and calls the rota check indicative. The
       upsell copy must not quietly promise more than that. */
    ok('    the upsell promises no compliance certification',
       !/compliance (certificate|certification|guarantee)|legally compliant|certified compliant/i
         .test(html));

    // The badge that got reported as stale. 21,525 bytes is 21.0 KiB and
    // 21.5 kB; the byte count is what the paper cites and cannot be misread.
    ok('    reports the engine size in bytes, not an ambiguous KB',
       /bytes/.test(html) && !/WebAssembly, '\+\(b\.byteLength\/1024\)/.test(html));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
