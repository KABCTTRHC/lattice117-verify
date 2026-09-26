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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
