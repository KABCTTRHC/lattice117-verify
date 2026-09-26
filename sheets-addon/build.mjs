#!/usr/bin/env node
/**
 * Deterministic bundler for the Google Sheets sidebar.
 *
 * Apps Script serves a sidebar from a sandboxed googleusercontent.com iframe
 * and will not serve sibling files, so `<script type="module" src="...">` has
 * nothing to point at. Everything the sidebar needs — the four shared modules
 * and the 21 KB WASM engine — has to arrive inside one HTML file.
 *
 * ## Why modules are wrapped rather than concatenated
 *
 * digest.js exports `Q`, and rota.js declares its own `const Q`. Pasting the
 * sources together is a redeclaration error, and the next collision after that
 * one would be silent rather than loud. Each module is therefore wrapped in an
 * IIFE that returns its exports, so the files keep exactly the scope they have
 * as modules and stay byte-identical to the copies CI compares.
 *
 * ## Determinism
 *
 * No timestamps, no build ids, no hashing of the clock. The same inputs
 * produce the same bytes, so CI can rebuild and diff to prove the committed
 * Sidebar.html is not stale — which is the only way a bundled copy of shared
 * logic stays honest.
 *
 *   node sheets-addon/build.mjs           write Sidebar.html
 *   node sheets-addon/build.mjs --check   fail if the committed file is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'demo');
const OUT = join(HERE, 'Sidebar.html');

/** Modules, in dependency order, with the namespace each is bound to. */
const MODULES = [
  ['digest.js',   'L117_DIGEST'],
  ['rota.js',     'L117_ROTA'],
  ['licence.js',  'L117_LICENCE'],
  ['freetier.js', 'L117_FREETIER'],
];

/** Collects the names a module exports, then strips the keyword. */
function wrap(source, ns) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  if (!names.size) throw new Error(`${ns}: no exports found — the bundler would emit an empty namespace`);
  const body = source.replace(/^export\s+/gm, '');
  return `/* ---- ${ns} ---- */\nconst ${ns} = (function(){\n${body}\nreturn { ${[...names].join(', ')} };\n})();\n`;
}

const wasm = readFileSync(join(SRC, 'lattice117_wasm.wasm'));
const modules = MODULES
  .map(([f, ns]) => wrap(readFileSync(join(SRC, f), 'utf8'), ns))
  .join('\n');

const UI = readFileSync(join(HERE, 'sidebar.template.html'), 'utf8');

const html = UI
  .replace('/*__MODULES__*/', () => modules)
  .replace('__WASM_B64__', () => wasm.toString('base64'));

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
  if (current !== html) {
    console.error('Sidebar.html is stale. Run: node sheets-addon/build.mjs');
    process.exit(1);
  }
  console.log(`Sidebar.html is current (${(html.length / 1024).toFixed(1)} KB, wasm ${wasm.length} bytes inlined).`);
} else {
  writeFileSync(OUT, html);
  console.log(`Wrote Sidebar.html — ${(html.length / 1024).toFixed(1)} KB, ` +
              `${MODULES.length} modules, wasm ${wasm.length} bytes inlined as base64.`);
}
