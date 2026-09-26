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
  ok('exactly one OAuth scope', m.oauthScopes.length === 1, JSON.stringify(m.oauthScopes));
  ok('and it is spreadsheets.currentonly',
     m.oauthScopes[0] === 'https://www.googleapis.com/auth/spreadsheets.currentonly');
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
  for (const [file, marker] of [
    ['demo/digest.js',   'lattice117.rota.v1'],
    ['demo/rota.js',     'restMinutes: 660'],
    ['demo/licence.js',  'bMDjl_8U9_4dqVifNUhDPSKGdOo1bZyA4_e_wevdyXI'],
    ['demo/freetier.js', 'routeStops: 6'],
  ]) {
    ok(`${file.split('/')[1]} is inlined`, html.includes(marker) && read(file).includes(marker));
  }
  const kb = (html.length / 1024).toFixed(0);
  ok(`bundle is a single file under 200 KB (${kb} KB)`, html.length < 200 * 1024);
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
