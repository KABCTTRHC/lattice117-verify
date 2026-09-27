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
import { readFileSync, existsSync, statSync } from 'node:fs';
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

/* ── the reproduction pack ───────────────────────────────────────────────── */
/* `npx lattice117-verify reproduce` is the ask we make of outside engineers to
   close §8 of the white paper. It has to work on a clean machine with nothing
   installed, which means every file it touches must be in the package's `files`
   list — a CLI that is published without its fixtures fails on the first
   stranger who tries it, and that is the one audience with no patience for it. */
console.log('\nThe reproduction pack is publishable and complete');
{
  const pkg = JSON.parse(read('npm/package.json'));
  ok('npm package exposes the lattice117-verify binary',
     pkg.bin?.['lattice117-verify'] === './bin/lattice117-verify.mjs');
  ok('and the binary exists', here('npm/bin/lattice117-verify.mjs'));
  ok('the package still declares no dependencies',
     !pkg.dependencies || Object.keys(pkg.dependencies).length === 0);

  /* Everything the CLI reads at run time, by name. */
  const needed = [
    'bin/lattice117-verify.mjs', 'index.js', 'digest.js', 'resequence.js',
    'lattice117_wasm.wasm', 'example-route-sheet.csv',
    'example-fleet-nottingham.csv', 'example-fleet-nottingham-matrix.txt',
  ];
  for (const f of needed) {
    ok(`  files[] ships ${f}`, (pkg.files ?? []).includes(f));
    ok(`  and npm/${f} exists`, here(`npm/${f}`));
  }

  /* The copies under npm/ must be the same bytes as demo/, or a stranger
     reproduces a digest from a fixture that is not the documented one. */
  for (const f of ['resequence.js', 'example-route-sheet.csv',
                   'example-fleet-nottingham.csv',
                   'example-fleet-nottingham-matrix.txt']) {
    ok(`  npm/${f} matches demo/${f}`, read(`npm/${f}`) === read(`demo/${f}`));
  }

  /* The three strings the CLI checks are the three the docs quote. A CLI that
     drifted from REPRODUCE.md would send a stranger chasing a value nobody
     publishes. */
  const cli = read('npm/bin/lattice117-verify.mjs');
  const doc = read('REPRODUCE.md');
  for (const [name, d] of [
    ['fleet v1', 'e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d'],
    ['nottingham before', 'da1650fc0e63e26eba33913f25f24fb9fbdc78ce4c55549279cb9582d3119993'],
    ['nottingham after', '2b9d863c5ab89a90a2416a9a708ce09fa8876b6d8d91e58199696181e7da7b15'],
  ]) {
    ok(`  CLI expects the published ${name} digest`, cli.includes(d));
    ok(`  and REPRODUCE.md quotes its prefix`, doc.includes(d.slice(0, 8)));
  }

  ok('REPRODUCE.md gives the one-line command', /npx lattice117-verify reproduce/.test(doc));
  ok('and says plainly that the digest is not a signature',
     /not a signature/i.test(doc));
  ok('an issue template exists for the report',
     here('.github/ISSUE_TEMPLATE/digest-reproduction.yml'));
  ok('and the CLI points at it',
     cli.includes('digest-reproduction.yml'));
}

/* ---------------------------------------------------------------------------
   THE ENGINE SIZE BADGE, ON EVERY SURFACE

   21,525 bytes is 21.0 KiB and 21.5 kB. A badge that says "21.0 KB" is
   ambiguous between the two and disagrees with the figure the white paper
   cites, which is the byte count.

   This is asserted across ALL FIVE surfaces because the fix was previously
   applied to three of them — Excel, Sheets and the npm CLI — while
   demo/index.html and demo/audit.html kept dividing by 1024, and the only
   test looking at it looked at the sidebar. A per-surface check is what turns
   "fixed" into "fixed everywhere".
--------------------------------------------------------------------------- */
{
  console.log('\nThe engine size badge reports bytes on every surface');
  for (const f of ['demo/index.html', 'demo/audit.html',
                   'excel-addin/taskpane.html', 'sheets-addon/Sidebar.html',
                   'sheets-addon/sidebar.template.html']) {
    const src = read(f);
    ok(`  ${f} does not divide byteLength by 1024`, !/byteLength\s*\/\s*1024/.test(src));
    // Sheets decodes base64 into a Uint8Array, so its count is `.length`
    // rather than `.byteLength`. Both are the byte count; what matters is
    // that the badge says "bytes" and nothing divides.
    ok(`  ${f} renders the byte count`,
       /\.(byteLength|length)\.toLocaleString\('en-GB'\)/.test(src) && /\bbytes\b/.test(src));
  }
}

/* ---------------------------------------------------------------------------
   BRAND ASSETS

   Every icon a surface REFERENCES must exist, be non-empty, and — for the demo
   pages — be in the offline shell. This is the same defect class as the one
   that made audit.html a dead page offline: sw.js cached everything except
   resequence.js, which audit.html imports, so the online page worked and the
   offline one did not run at all. A missing favicon is cosmetic; a missing
   header lockup is a broken image on the page a sceptic reloads with their
   Wi-Fi off, which is the worst possible moment to look half-built.

   The icons are duplicated into demo/brand/ because demo/ is the deployed
   root and a page there cannot reference a sibling of its own parent. A copy
   is fine; a copy that has drifted is not, so they are byte-compared against
   brand/ exactly as the shared modules are.
--------------------------------------------------------------------------- */
{
  console.log('\nBrand assets exist, match their master copies, and are cached offline');

  const bytes = (p) => (here(p) ? statSync(join(ROOT, p)).size : 0);
  const same = (a, b) =>
    here(a) && here(b) && readFileSync(join(ROOT, a)).equals(readFileSync(join(ROOT, b)));

  /* The generator's own output. If these are missing nothing else here can
     pass, so it is worth saying so separately. */
  for (const f of ['brand/lattice117-mark-master.webp', 'brand/glyph-32.png',
                   'brand/glyph-48.png', 'brand/mark-128.png', 'brand/mark-180.png']) {
    ok(`  ${f} exists and is not empty`, bytes(f) > 0);
  }
  ok('  the icon generator is committed alongside them',
     here('tools/brand/icons.py'));

  /* Copies on the deployed surfaces, byte-identical to the master set. */
  for (const f of ['glyph-32.png', 'glyph-48.png', 'mark-180.png']) {
    ok(`  demo/brand/${f} matches brand/${f}`, same(`demo/brand/${f}`, `brand/${f}`));
  }
  ok('  excel-addin/assets/glyph-48.png matches brand/glyph-48.png',
     same('excel-addin/assets/glyph-48.png', 'brand/glyph-48.png'));
  ok('  excel-addin/assets/icon-32.png matches brand/glyph-32.png',
     same('excel-addin/assets/icon-32.png', 'brand/glyph-32.png'));
  ok('  store-assets/workspace/icon-128.png matches brand/mark-128.png',
     same('store-assets/workspace/icon-128.png', 'brand/mark-128.png'));

  /* Every local image a demo page references must be in the shell. A regex
     over the actual href/src is deliberate: a hard-coded list here would go
     stale the moment someone adds an asset, which is exactly how the last one
     was missed. */
  const sw = read('demo/sw.js');
  for (const page of ['index.html', 'audit.html', 'determinism.html', 'splash.html',
                      'dashboard.html']) {
    const html = read(`demo/${page}`);
    const refs = [...html.matchAll(/(?:href|src)="(\.\/brand\/[^"]+)"/g)].map((m) => m[1]);
    ok(`  demo/${page} references at least one brand asset`, refs.length > 0);
    for (const r of new Set(refs)) {
      const rel = r.replace('./', 'demo/');
      ok(`    ${r} exists`, bytes(rel) > 0);
      ok(`    ${r} is in the offline shell`, sw.includes(`'${r}'`));
    }
  }

  /* The splash is the first thing a visitor sees, so it is the worst thing to
     find missing from the offline shell. It is also the only surface carrying
     the COMPANY mark: BSG presents, Lattice117 is presented, and neither name
     may exist only as pixels. */
  {
    const splash = read('demo/splash.html');
    ok('  the splash is itself in the offline shell', sw.includes("'./splash.html'"));
    ok('  it presents the company mark', splash.includes('bsg-crest-560.webp'));
    ok('  and the product mark', splash.includes('mark-512.webp'));
    ok('  both names are in text, not only in the images',
       /Brierley Sovereign Group/.test(splash) && /Lattice117/.test(splash));
    /* A splash is a delay with a picture on it. For someone who has asked for
       no motion the honest version is the final frame, immediately. */
    ok('  it honours prefers-reduced-motion',
       /@media \(prefers-reduced-motion:\s*reduce\)/.test(splash));
    /* Every `var()` used in an `animation` shorthand must resolve, because one
       that does not invalidates the whole declaration rather than falling back
       — which is how the "Presented by" line spent its first outing invisible. */
    const used = new Set([...splash.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    const declared = new Set([...splash.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
    const undeclared = [...used].filter((v) => !declared.has(v));
    ok(`  every custom property it uses is declared${undeclared.length ? ` (missing: ${undeclared.join(', ')})` : ''}`,
       undeclared.length === 0);
  }

  /* The dashboard is the densest surface and the easiest place for a number to
     appear that nothing computed. It may show only what the engine produced. */
  {
    const dash = read('demo/dashboard.html');
    ok('  the dashboard is in the offline shell', sw.includes("'./dashboard.html'"));
    ok('  it uses the shared engine module rather than its own copy',
       /from '\.\/engine\.js'/.test(dash) && !/WebAssembly\.instantiate/.test(dash));
    ok('  it applies the licence round cap at evaluation',
       /runRoutes\(engine, spec, maxRounds\)/.test(dash) &&
       !/runRoutes\(engine, [a-zA-Z]+, Infinity\)/.test(dash));
    /* #10b981 vs #f43f5e is deltaE 5.6 under deuteranopia — below the floor at
       which colour may carry meaning even WITH secondary encoding. So holds and
       breaks must never be distinguished by colour alone anywhere on the page. */
    ok('  holds/breaks carries a glyph and a word, not colour alone',
       dash.includes("'✓' : '✕'") && dash.includes("'HOLDS' : 'BREAKS'"));
    ok('  and the failing bar segment is hatched as well as coloured',
       /\.bar i\.bad\{[^}]*repeating-linear-gradient/s.test(dash));
  }

  /* Apps Script serves the sidebar from a sandboxed iframe and will not serve
     sibling files, so the Sheets glyph has to be inlined rather than linked.
     A relative <img src> there would be a broken image in every install. */
  const sidebar = read('sheets-addon/Sidebar.html');
  ok('  the Sheets sidebar inlines its glyph rather than linking one',
     sidebar.includes('data:image/png;base64,') &&
     !/<img[^>]+src="(?!data:)/.test(sidebar));

  /* The lockup must carry the name in text. An <img alt=""> beside a wordmark
     is correct; an image that IS the only name is not readable by anything
     that cannot see it. */
  for (const [label, html] of [
    ['demo/index.html', read('demo/index.html')],
    ['demo/audit.html', read('demo/audit.html')],
    ['excel-addin/taskpane.html', read('excel-addin/taskpane.html')],
    ['sheets-addon/Sidebar.html', sidebar],
  ]) {
    ok(`  ${label} spells "Lattice117" in text, not only in the image`,
       /class="wordmark">Lattice117</.test(html));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
