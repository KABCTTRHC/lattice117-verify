#!/usr/bin/env node
/**
 * Run by `npm publish` (prepublishOnly), after the digest reproduction.
 *
 * It refuses to publish a package that would break on someone else's machine:
 *
 *   - a shipped file is missing, or
 *   - a shipped text file has Windows line endings. A bin script whose first
 *     line ends in "\r" fails on Linux and macOS with
 *     "env: node\r: No such file or directory", and that cannot be fixed
 *     after publishing: npm never lets a version number be reused.
 *
 * The repository's .gitattributes keeps a fresh clone LF on every platform;
 * this catches a file that was re-saved with CRLF by an editor afterwards.
 * It is not in the package's `files`, so it is never published.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
const problems = [];

for (const f of pkg.files ?? []) {
  const p = join(HERE, f);
  if (!existsSync(p)) { problems.push(`${f}: missing`); continue; }
  if (f.endsWith('.wasm')) continue;
  if (readFileSync(p).includes(0x0d)) problems.push(`${f}: has Windows (CRLF) line endings`);
}
for (const [name, bin] of Object.entries(pkg.bin ?? {})) {
  // npm 11 rewrites "./bin/x.mjs" to "bin/x.mjs" at publish time and warns that
  // the original "was invalid and removed" (seen publishing 0.3.0). Keep the
  // form npm stores, so the manifest published is the one in this file.
  if (bin.startsWith('./') || bin.includes('\\')) problems.push(`bin ${name}: write "${bin.replace(/^\.\//, '')}" (no leading ./, forward slashes)`);
  const first = readFileSync(join(HERE, bin), 'utf8').split('\n', 1)[0];
  if (first !== '#!/usr/bin/env node') problems.push(`${bin}: first line is not "#!/usr/bin/env node"`);
}

if (problems.length) {
  console.error('\nNot publishing. Fix these first:\n  ' + problems.join('\n  '));
  console.error('\nA fresh clone (git clone ...) gives LF files on every platform.\n');
  process.exit(1);
}
console.log(`prepublish check: ${(pkg.files ?? []).length} files present, LF line endings, bin shebangs OK`);
