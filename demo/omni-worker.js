/**
 * Omni-hardware soak worker.
 *
 * Runs lattice117_omni.wasm cycle after cycle, off the page's main thread, so
 * the page stays responsive and the arithmetic is not paused by rendering.
 * Classic worker (no ES modules) so older Safari and Chrome can run it.
 *
 * Messages in:  {cmd:'start', checkpoints:[...], repeatEvery:n}  {cmd:'stop'}
 * Messages out: {t:'ready', version, bytes}
 *               {t:'cycle', seed, ms, len}          one per cycle
 *               {t:'checkpoint', cycles, chain}     at each checkpoint
 *               {t:'repeat', seed, same}            every repeatEvery cycles
 *               {t:'error', message}
 *
 * The kernel is integer-only and cannot read a clock. The time per cycle is
 * measured here, outside it, with performance.now() — whose resolution some
 * browsers coarsen to 0.1 ms or 1 ms on purpose. That limits the latency
 * figures, never the results.
 */
'use strict';

var ex = null, chainPtr = 0, outPtr = 0, repPtr = 0, CAP = 4096;
var running = false, seed = 0, marks = [], repeatEvery = 500;

function hex(ptr, n) {
  var b = new Uint8Array(ex.memory.buffer, ptr, n), s = '';
  for (var i = 0; i < n; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

function sameOutputs(len) {
  var a = new Int32Array(ex.memory.buffer, outPtr, Math.min(len, CAP));
  var b = new Int32Array(ex.memory.buffer, repPtr, Math.min(len, CAP));
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function loop() {
  if (!running) return;
  // A short slice of cycles per task, then yield, so a 'stop' message is seen
  // promptly even on a slow device.
  var sliceEnd = performance.now() + 50;
  do {
    var t0 = performance.now();
    var len = ex.omni_step(seed, chainPtr, outPtr, CAP);
    var ms = performance.now() - t0;
    var done = seed + 1;
    postMessage({ t: 'cycle', seed: seed, ms: ms, len: len });
    if (marks.indexOf(done) >= 0) postMessage({ t: 'checkpoint', cycles: done, chain: hex(chainPtr, 32) });
    if (repeatEvery > 0 && seed % repeatEvery === repeatEvery - 1) {
      var len2 = ex.omni_run(seed, repPtr, CAP);
      postMessage({ t: 'repeat', seed: seed, same: len2 === len && sameOutputs(len) });
    }
    seed = done;
  } while (running && performance.now() < sliceEnd);
  setTimeout(loop, 0);
}

onmessage = function (e) {
  var m = e.data;
  if (m.cmd === 'start') {
    marks = m.checkpoints || [];
    repeatEvery = m.repeatEvery || 500;
    var go = function () {
      new Uint8Array(ex.memory.buffer, chainPtr, 32).fill(0);
      seed = 0; running = true; loop();
    };
    if (ex) { go(); return; }
    fetch(m.url || 'lattice117_omni.wasm')
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (bytes) {
        return WebAssembly.instantiate(bytes, {}).then(function (res) {
          ex = res.instance.exports;
          chainPtr = ex.omni_alloc(32);
          outPtr = ex.omni_alloc(CAP * 4);
          repPtr = ex.omni_alloc(CAP * 4);
          postMessage({ t: 'ready', version: ex.omni_version(), bytes: bytes.byteLength });
          go();
        });
      })
      .catch(function (err) { postMessage({ t: 'error', message: String(err && err.message || err) }); });
  } else if (m.cmd === 'stop') {
    running = false;
  }
};
