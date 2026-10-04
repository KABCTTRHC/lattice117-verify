/**
 * The omni soak kernel, checked from outside Rust.
 *
 * 1. demo/lattice117_omni.wasm reproduces the checkpoints pinned in
 *    demo/omni.html (and in the crate's own tests) at 10 and 100 cycles.
 * 2. The chain is recomputed here with node:crypto's SHA-256 over the outputs
 *    the module returns, so the kernel's own SHA-256 is checked by an
 *    implementation it shares no code with.
 * 3. A cycle re-run with omni_run gives the same outputs as the folded one.
 * 4. The page, the worker and the module are complete as a surface: the
 *    service worker caches all three, and every checkpoint the page pins is a
 *    64-character hex value.
 *
 * Run: node tests/omni.test.mjs
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : ' — ' + detail}`);
  cond ? pass++ : fail++;
};

const page = read('demo/omni.html');
const pinned = {};
for (const m of page.matchAll(/^\s*(\d+):\s*'([0-9a-f]{64})',?$/gm)) pinned[Number(m[1])] = m[2];
console.log('omni.html pins');
ok('  at least six checkpoints are pinned', Object.keys(pinned).length >= 6, JSON.stringify(Object.keys(pinned)));
ok('  10 and 100 are among them', pinned[10] && pinned[100]);
const rust = read('crates/lattice117-omni/src/lib.rs');
ok('  the crate pins the same value at 10', rust.includes(`"${pinned[10]}"`));
ok('  the crate pins the same value at 100', rust.includes(`"${pinned[100]}"`));

const { instance } = await WebAssembly.instantiate(readFileSync(join(ROOT, 'demo/lattice117_omni.wasm')), {});
const ex = instance.exports;
const CAP = 4096;
const chainPtr = ex.omni_alloc(32), outPtr = ex.omni_alloc(CAP * 4), repPtr = ex.omni_alloc(CAP * 4);
new Uint8Array(ex.memory.buffer, chainPtr, 32).fill(0);
let mine = Buffer.alloc(32);
let repeatsSame = true;
console.log('demo/lattice117_omni.wasm');
ok('  kernel version is 1', ex.omni_version() === 1);
for (let seed = 0; seed < 100; seed++) {
  const len = ex.omni_step(seed, chainPtr, outPtr, CAP);
  const outs = Buffer.from(new Uint8Array(ex.memory.buffer, outPtr, len * 4));
  const h = createHash('sha256');
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
  h.update(mine); h.update(u32(seed)); h.update(u32(len)); h.update(outs);
  mine = h.digest();
  if (seed % 25 === 24) {
    const len2 = ex.omni_run(seed, repPtr, CAP);
    const again = Buffer.from(new Uint8Array(ex.memory.buffer, repPtr, len2 * 4));
    if (len2 !== len || !again.equals(outs)) repeatsSame = false;
  }
  const wasmChain = Buffer.from(new Uint8Array(ex.memory.buffer, chainPtr, 32)).toString('hex');
  if (seed + 1 === 10 || seed + 1 === 100) {
    ok(`  chain at ${seed + 1} equals the pinned value`, wasmChain === pinned[seed + 1], wasmChain);
    ok(`  node:crypto recomputes the same chain at ${seed + 1}`, mine.toString('hex') === wasmChain, mine.toString('hex'));
  }
}
ok('  omni_run repeats omni_step exactly', repeatsSame);

console.log('surface');
const sw = read('demo/sw.js');
for (const f of ['./omni.html', './omni-worker.js', './lattice117_omni.wasm'])
  ok(`  ${f} is in the offline shell`, sw.includes(`'${f}'`));
ok('  the page loads the worker by its relative path', page.includes("new Worker('omni-worker.js')"));
ok('  the page re-checks the same reference digests as determinism.html',
   page.includes('e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d') &&
   read('demo/determinism.html').includes('e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d'));
ok('  the published referee module is not the soak module',
   !readFileSync(join(ROOT, 'demo/lattice117_wasm.wasm')).equals(readFileSync(join(ROOT, 'demo/lattice117_omni.wasm'))));

// The 4 October soak found the JSON's hiddenMs growing after the run ended
// (a phone put down before its file was saved), while the sealed record said
// 0 s. The page's own handler is run here against a fake clock.
console.log('record and download agree');
{
  const src = page.match(/document\.addEventListener\('visibilitychange', (\(\) => \{[\s\S]*?\n\})\);/)[1];
  let now = 0, state = 'visible';
  const run = { done: false, hiddenMs: 0, minHidden: 0, hiddenSince: 0 };
  const onVis = new Function('document', 'performance', 'keepAwake', 'run', `return ${src};`)(
    { get visibilityState() { return state; } }, { now: () => now }, () => {}, run);
  const flip = (s, t) => { state = s; now = t; onVis(); };
  flip('hidden', 1000); flip('visible', 3000);
  const during = run.hiddenMs;
  run.done = true;
  flip('hidden', 4000); flip('visible', 900000);
  ok('  hidden time during the run is counted', during === 2000, String(during));
  ok('  hidden time after the run ends is not', run.hiddenMs === 2000, String(run.hiddenMs));
  ok('  the record and the JSON carry the same end time',
     page.includes("L.push('ended         ' + endedAt + ") && page.includes('run.endedAt = endedAt;'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
