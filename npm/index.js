/**
 * @lattice117/verify — deterministic schedule feasibility verification.
 *
 * Wraps the same Rust `evaluate_order` the command-line auditor calls,
 * compiled to WebAssembly. The browser, Node and the CLI therefore run
 * identical evaluation code rather than three implementations that agree
 * until they don't.
 *
 * Two properties are worth knowing before you use it:
 *
 *  1. **It computes locally.** No fetch, no socket, no telemetry. The module
 *     is 21 KB of WASM and it never leaves the process it is loaded into.
 *     That is a structural property, not a policy — audit the bundle.
 *
 *  2. **It is deterministic.** Every value crossing into the engine is
 *     Q16.16 fixed point on i32. No floating point exists in the evaluation
 *     path, so the same input yields a bit-identical verdict on any machine,
 *     any platform, every run.
 *
 * What it does NOT do: build routes, predict traffic, or have an opinion on
 * whether a schedule is *good*. It answers one question — does this plan hold
 * against its own constraints — and names the stop that breaks when it does
 * not.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Q16.16 scale factor. */
const Q = 65536;
/** Representable range of Q16.16 on i32. */
export const Q16_MAX = 32767;
export const Q16_MIN = -32768;

let _exports = null;
let _loading = null;

/**
 * Loads and instantiates the WebAssembly module. Idempotent and safe to call
 * concurrently — repeated calls share one instance and one in-flight load.
 *
 * Called automatically by `verifyRoute`/`verifyFleet`; call it directly only
 * if you want to control when the (small) load cost is paid.
 */
export async function init() {
  if (_exports) return _exports;
  if (_loading) return _loading;

  _loading = (async () => {
    const url = new URL('./lattice117_wasm.wasm', import.meta.url);
    let bytes;
    if (url.protocol === 'file:') {
      bytes = await readFile(fileURLToPath(url));
    } else {
      bytes = await (await fetch(url)).arrayBuffer();
    }
    const { instance } = await WebAssembly.instantiate(bytes, {});
    _exports = instance.exports;
    return _exports;
  })();

  return _loading;
}

function toQ(value, what) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new RangeError(`${what}: "${value}" is not a finite number`);
  }
  if (n < Q16_MIN || n > Q16_MAX) {
    throw new RangeError(
      `${what}: ${n} is outside the Q16.16 representable range ` +
      `(${Q16_MIN}..${Q16_MAX}). Rescale your time unit — minutes instead of ` +
      `seconds, for example — rather than truncating.`
    );
  }
  return Math.round(n * Q);
}

const fromQ = (v) => v / Q;

function alloc(ex, values) {
  const bytes = values.length * 4;
  const ptr = ex.lattice_alloc(bytes);
  const dv = new DataView(ex.memory.buffer);
  for (let i = 0; i < values.length; i++) dv.setInt32(ptr + i * 4, values[i], true);
  return { ptr, bytes };
}

/**
 * Verifies one route against its own time windows.
 *
 * A fixed route only needs the legs actually driven, not an N×N matrix, so
 * each stop carries the travel time from the stop before it. That is what a
 * route sheet already contains — no distance matrix required.
 *
 * @param {import('./index.d.ts').Route} route
 * @returns {Promise<import('./index.d.ts').RouteResult>}
 */
export async function verifyRoute(route) {
  const ex = await init();
  const stops = route?.stops;
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new TypeError(
      `route "${route?.id ?? '(unnamed)'}" needs at least 2 stops, got ` +
      `${Array.isArray(stops) ? stops.length : 'none'}`
    );
  }

  const k = stops.length;
  const label = route.id ?? '(unnamed)';

  // Per-route matrix: only the consecutive legs are populated. This also
  // sidesteps the case where one stop appears on two routes with different
  // travel times into it, which a shared matrix cannot represent.
  const dist = new Array(k * k).fill(0);
  for (let i = 1; i < k; i++) {
    dist[(i - 1) * k + i] = toQ(stops[i].travel, `${label} → ${stops[i].id} travel`);
  }

  const wins = [];
  for (const s of stops) {
    wins.push(toQ(s.open ?? 0, `${s.id} window open`),
              toQ(s.close ?? 0, `${s.id} window close`));
  }

  const db = alloc(ex, dist);
  const wb = alloc(ex, wins);
  const rb = alloc(ex, stops.map((_, i) => i));
  const ob = alloc(ex, [0, 0, 0, 0, 0, 0]);

  ex.lattice_verify(rb.ptr, k, db.ptr, k, wb.ptr, ob.ptr);

  const dv = new DataView(ex.memory.buffer);
  const out = [];
  for (let i = 0; i < 6; i++) out.push(dv.getInt32(ob.ptr + i * 4, true));

  for (const b of [db, wb, rb, ob]) ex.lattice_free(b.ptr, b.bytes);

  if (out[0] === 0) {
    return { id: label, feasible: true, cost: fromQ(out[5]), violation: null };
  }
  if (out[0] === 1) {
    return {
      id: label,
      feasible: false,
      cost: null,
      violation: {
        stop: stops[out[1]]?.id ?? String(out[1]),
        arrival: fromQ(out[2]),
        windowClose: fromQ(out[3]),
        deficit: fromQ(out[4]),
        raw: { arrival: out[2], windowClose: out[3], deficit: out[4] },
      },
    };
  }
  throw new Error(`route "${label}" was rejected before evaluation (bad shape)`);
}

/**
 * Verifies every route and reports a feasibility rate.
 *
 * The rate is the number most operations do not have about their own
 * schedules: what proportion of what was published is actually achievable.
 *
 * @param {import('./index.d.ts').Route[]} routes
 * @returns {Promise<import('./index.d.ts').FleetResult>}
 */
export async function verifyFleet(routes) {
  if (!Array.isArray(routes)) throw new TypeError('verifyFleet expects an array of routes');
  const results = [];
  for (const r of routes) results.push(await verifyRoute(r));
  const feasible = results.filter((r) => r.feasible).length;
  return {
    checked: results.length,
    feasible,
    infeasible: results.length - feasible,
    feasibilityRate: results.length ? feasible / results.length : 0,
    routes: results,
  };
}

/**
 * Canonical SHA-256 over the inputs and the verdict.
 *
 * Re-running the identical input must reproduce this digest. If it does not,
 * the input changed — that is the entire claim, and it is not a signature.
 *
 * @param {import('./index.d.ts').Route[]} routes
 * @param {import('./index.d.ts').FleetResult} result
 * @returns {Promise<string>} lowercase hex
 */
export async function verdictDigest(routes, result) {
  const canon = JSON.stringify({
    routes: routes.map((r) => [
      r.id,
      r.stops.map((s) => [s.id, s.open ?? 0, s.close ?? 0, s.travel]),
    ]),
    verdict: result.routes.map((r) => [
      r.id, r.feasible, r.violation?.stop ?? null,
      r.violation?.raw?.arrival ?? null,
      r.violation?.raw?.windowClose ?? null,
      r.violation?.raw?.deficit ?? null,
    ]),
  });

  const data = new TextEncoder().encode(canon);
  const subtle = globalThis.crypto?.subtle
    ?? (await import('node:crypto')).webcrypto.subtle;
  const buf = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
