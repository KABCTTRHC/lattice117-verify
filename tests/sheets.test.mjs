/**
 * Google Sheets add-on: bundle freshness, and the claims the OAuth review
 * will be checking.
 *
 * Digest parity is proved in the browser harness, because it needs WebAssembly
 * and WebCrypto. What is checked here is everything a reviewer or a customer
 * could verify by reading the repository.
 *
 * Run: node tests/sheets.test.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : ' — ' + detail}`);
  cond ? pass++ : fail++;
};

/* Comments are where we DESCRIBE not calling these services, so a naive grep
   matches its own documentation. Strip them before asserting. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\nBundle freshness');
{
  let fresh = true, out = '';
  try { out = execFileSync('node', [join(ROOT, 'sheets-addon/build.mjs'), '--check'], { encoding: 'utf8' }); }
  catch (e) { fresh = false; out = (e.stdout || '') + (e.stderr || ''); }
  ok('Sidebar.html matches a fresh build of the shared modules', fresh, out.trim());
}

console.log('\nCode.gs calls no network or cross-file service');
{
  const code = stripComments(read('sheets-addon/Code.gs'));
  for (const svc of ['UrlFetchApp', 'DriveApp', 'PropertiesService', 'MailApp', 'GmailApp', 'CacheService']) {
    ok(`no ${svc}`, !new RegExp('\\b' + svc + '\\b').test(code));
  }
  ok('uses getDisplayValues, not getValues',
     /getDisplayValues\(\)/.test(code) && !/\.getValues\(\)/.test(code));
}

console.log('\nappsscript.json is scoped as narrowly as it claims');
{
  const m = JSON.parse(read('sheets-addon/appsscript.json'));
  /* Exactly two scopes, and which two is the whole privacy claim.
     It was one until a live install threw
     "Specified permissions are not sufficient to call Ui.showSidebar" —
     script.container.ui is what lets an add-on draw its own sidebar, and
     without it the add-on cannot open at all. It grants UI, not data.
     Both are asserted by name, and the count is asserted too, so a third
     scope cannot be added without this test being edited deliberately. */
  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
    'https://www.googleapis.com/auth/script.container.ui',
  ];
  ok('exactly two OAuth scopes', m.oauthScopes.length === 2, JSON.stringify(m.oauthScopes));
  for (const s of SCOPES) ok(`  requests ${s.split('/auth/')[1]}`, m.oauthScopes.includes(s));
  ok('and nothing beyond those two',
     m.oauthScopes.every((s) => SCOPES.includes(s)), JSON.stringify(m.oauthScopes));
  ok('spreadsheets.currentonly, not the full spreadsheets scope',
     !m.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
  ok('no urlFetchWhitelist', !('urlFetchWhitelist' in m));
  ok('no drive or userinfo scope', !m.oauthScopes.some((s) => /drive|userinfo|script\.external/.test(s)));
}

console.log('\nSidebar.html is genuinely self-contained');
{
  const html = read('sheets-addon/Sidebar.html');
  const urls = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)/gi)].map((m) => m[1]);
  ok('no external src or href', urls.length === 0, urls.join(', '));
  ok('no fetch() call', !/\bfetch\s*\(/.test(html));
  ok('no XMLHttpRequest', !/XMLHttpRequest/.test(html));
  ok('no importScripts', !/importScripts/.test(html));
  ok('wasm is inlined as base64', /const WASM_B64 = "[A-Za-z0-9+/=]{4000,}"/.test(html));
  ok('no module import statement survived bundling', !/^\s*import\s/m.test(html));

  // Each shared module must be present verbatim, minus the export keyword.
  //
  // Markers are STRUCTURAL constants, not values that legitimately change.
  // licence.js used to be marked by the literal public key, which meant a key
  // rotation — a routine, correct operation — failed this test and read as a
  // stale bundle. The marker is now the storage key, which identifies the
  // module without pinning a value that is supposed to move.
  for (const [file, marker] of [
    ['demo/digest.js',   'lattice117.rota.v1'],
    ['demo/rota.js',     'restMinutes: 660'],
    ['demo/licence.js',  'lattice117.licence'],
    ['demo/freetier.js', 'routeStops: 6'],
    ['demo/repair.js',   'latestFeasibleDeparture'],
    ['demo/resequence.js', 'EXACT_LIMIT'],
  ]) {
    ok(`${file.split('/')[1]} is inlined`, html.includes(marker) && read(file).includes(marker));
  }

  // The invariant the old marker was reaching for, stated properly: whatever
  // public key demo/licence.js carries, the bundle must carry the same one.
  // Derived from the source at run time, so a rotation updates it for free and
  // a bundle left un-rebuilt after one still fails.
  const keyOf = (src) => {
    const m = src.match(/\bx:\s*'([A-Za-z0-9_-]{20,})'/);
    return m && m[1];
  };
  const srcKey = keyOf(read('demo/licence.js'));
  ok('demo/licence.js carries a public key', Boolean(srcKey));
  ok('bundle carries the same public key as demo/licence.js',
     Boolean(srcKey) && html.includes(srcKey),
     srcKey ? `source key ${srcKey.slice(0, 12)}… absent from Sidebar.html` : 'no key found');
  const kb = (html.length / 1024).toFixed(0);
  ok(`bundle is a single file under 200 KB (${kb} KB)`, html.length < 200 * 1024);

  /* The example sheets are inlined so the sidebar can write one into a blank
     spreadsheet with one click. They must be the SAME bytes demo/ ships and
     this suite pins: an onboarding example that has drifted from its fixture
     hands a new user a digest that does not match the documentation, which is
     the one failure this product cannot afford. */
  const examples = {
    routes: 'demo/example-route-sheet.csv',
    timed: 'demo/example-route-sheet-timed.csv',
    rota: 'demo/example-rota.csv',
    nottingham: 'demo/example-fleet-nottingham.csv',
    matrix: 'demo/example-fleet-nottingham-matrix.txt',
  };
  const inlined = /const L117_EXAMPLES = (\{[\s\S]*?\});/.exec(html);
  ok('the example sheets are inlined', Boolean(inlined));
  if (inlined) {
    const got = JSON.parse(inlined[1]);
    ok(`all ${Object.keys(examples).length} examples are present`,
       Object.keys(examples).every((k) => typeof got[k] === 'string'));
    for (const [key, file] of Object.entries(examples)) {
      ok(`  ${key} matches ${file} byte for byte`, got[key] === read(file));
    }
  }

  /* Writing into the sheet is the one new thing Code.gs does. It must still
     reach nothing beyond the open spreadsheet — the whole scope claim rests on
     that, and a writer is exactly the kind of addition that quietly widens it. */
  const code = stripComments(read('sheets-addon/Code.gs'));
  ok('Code.gs can write an example into the sheet', /function writeExample\(/.test(code));
  ok('and still uses only SpreadsheetApp', !/\b(DriveApp|UrlFetchApp|PropertiesService)\b/.test(code));
}

console.log('\nCanonical digests the Sheets bundle must reproduce');
{
  /* The bundle inlines these exact modules (proved by the freshness check
     above), so pinning what the modules produce here pins what the sidebar
     produces — without needing a browser in CI. The browser harness confirms
     the live sidebar returns the same two values. */
  const { verifyFleet, verdictDigest } = await import('../npm/index.js');
  const { evaluateRota } = await import('../demo/rota.js');
  const { rotaDigest } = await import('../demo/digest.js');

  const rows = (f) => read(f).trim().split(/\r?\n/).map((l) => l.split(','));

  const fr = rows('demo/example-route-sheet.csv');
  const h = fr[0].map((x) => x.trim()), ix = (n) => h.indexOf(n);
  const byVeh = new Map();
  for (const r of fr.slice(1)) {
    const v = r[ix('vehicle')].trim();
    if (!byVeh.has(v)) byVeh.set(v, []);
    byVeh.get(v).push({ id: r[ix('stop')].trim(), open: r[ix('window_open')],
      close: r[ix('window_close')], travel: r[ix('travel_mins_from_previous')],
      seq: Number(r[ix('seq')]) });
  }
  const fleet = [...byVeh].map(([id, stops]) => ({ id, stops: stops.sort((a, b) => a.seq - b.seq) }));
  const fleetDigest = await verdictDigest(fleet, await verifyFleet(fleet));
  ok('fleet fixture digest is e249d90e…',
     fleetDigest === 'e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d', fleetDigest);

  const rr = rows('demo/example-rota.csv').slice(1).map((c, i) =>
    ({ staff: c[0], date: c[1], start: c[2], end: c[3], break: c[4], row: i + 2 }));
  const rep = evaluateRota(rr);
  const rd = await rotaDigest(rep.people, rep.verdict, rep.rules);
  ok('rota fixture digest is 83c66e6d…',
     rd === '83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf', rd);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
