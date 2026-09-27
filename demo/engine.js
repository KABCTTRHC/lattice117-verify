/**
 * The verification engine, as a module.
 *
 * # Why this file exists
 *
 * `demo/audit.html` owned the only copy of the WebAssembly wiring: loading the
 * module, marshalling Q16.16 integers across the boundary, running a fleet, and
 * canonicalising the result. Every other surface either re-implemented it or
 * did without. The dashboard needed exactly the same four things, and a second
 * copy of a verification path is the one duplication this project cannot
 * tolerate — `digest.js` exists because three surfaces once hashed three
 * different canonical forms for one schedule, and this is the same failure a
 * layer down.
 *
 * So the engine moved here, and `audit.html` imports it. `tests/surfaces.test.mjs`
 * byte-compares shared modules across surfaces; this one now falls under that
 * guarantee like the rest.
 *
 * # What is NOT here
 *
 * The CSV column mapper, the tier gating and every piece of DOM. Those are
 * `audit.html`'s job and they differ per surface. What is here is the part that
 * must not differ: the arithmetic and the canonical form.
 *
 * # The engine handle is explicit
 *
 * `runRoutes` takes the loaded instance rather than reading a module global,
 * and it takes its round limit as an argument rather than reaching for an
 * entitlement object. Both were module-scope state in `audit.html`. Passing
 * them means this file has no hidden inputs, which is what makes it testable
 * without a browser and reusable without a licence.
 *
 * Zero dependencies. No DOM. No network beyond the one `fetch` for the `.wasm`.
 */

import { verdictDigest } from './digest.js';

/** Q16.16 scale, and the representable range on `i32`. */
export const Q = 65536;
export const QMAX = 32767;
export const QMIN = -32768;

/**
 * One value to its Q16.16 integer.
 *
 * Out-of-range input throws by name rather than wrapping. A wrapped value
 * yields a CONFIDENT verdict about a schedule that was never checked, which is
 * the worst failure a checker can have.
 */
export const toQ = (v, what) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${what}: "${v}" is not a number`);
  if (!(n >= QMIN && n <= QMAX)) {
    throw new Error(`${what}: ${n} is outside the Q16.16 representable range (${QMIN}..${QMAX})`);
  }
  return Math.round(n * Q);
};

export const fromQ = (v) => v / Q;

/**
 * Loads the WebAssembly engine.
 *
 * Returns `{ exports, byteLength }` — the byte count travels with the instance
 * because every surface displays it, and a surface that recomputed it from a
 * second fetch could disagree with the one it is running.
 *
 * No imports object beyond `{}`: the module opens no sockets, reads no clock
 * and calls nothing back. That is the property the offline claim rests on, and
 * it is visible right here in the instantiate call.
 */
export async function loadEngine(url = 'lattice117_wasm.wasm') {
  const bytes = await (await fetch(url)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return { exports: instance.exports, byteLength: bytes.byteLength };
}

const view = (engine) => new DataView(engine.exports.memory.buffer);

/** Copies an i32 array into engine memory. Caller frees. */
function put(engine, arr) {
  const bytes = arr.length * 4;
  const ptr = engine.exports.lattice_alloc(bytes);
  const dv = view(engine);
  for (let i = 0; i < arr.length; i++) dv.setInt32(ptr + i * 4, arr[i], true);
  return { ptr, bytes };
}

/**
 * Runs a fleet through the engine.
 *
 * `spec` is the one normalised shape every input source produces:
 *   `{unit, routes:[{vehicle, depart?, stops:[{id, ready, due, travel}]}]}`
 * where `travel` is the time from the PREVIOUS stop, and 0 for the first.
 *
 * Checking a fixed round only needs the legs actually driven, so each round is
 * evaluated against its own small matrix rather than a shared N x N one. That
 * is what lets a plain route sheet work at all, and it sidesteps the case where
 * one stop appears on two rounds with different travel times into it.
 *
 * `limit` caps how many rounds are EVALUATED. The cap is applied here, at the
 * point of evaluation, rather than by hiding rows afterwards — a limit that
 * only exists in the presentation layer is not a limit.
 */
export function runRoutes(engine, spec, limit = Infinity) {
  if (!engine) throw new Error('the verification engine is still loading — try again in a moment');
  const results = [];
  let capped = false;

  for (const r of spec.routes) {
    if (results.length >= limit) { capped = true; break; }
    const k = r.stops.length;
    if (k < 2) throw new Error(`round "${r.vehicle}" has ${k} stop(s); at least 2 are needed`);

    const dist = new Array(k * k).fill(0);
    for (let i = 1; i < k; i++) {
      dist[(i - 1) * k + i] = toQ(r.stops[i].travel, `${r.vehicle} → ${r.stops[i].id} travel time`);
    }

    /* The departure time, folded into the leg out of the first stop. The engine
       starts its clock at zero and takes no departure argument, so this is how
       a departure is expressed to it. It is folded HERE, in the verification
       path, and deliberately NOT into the canonical form, where it stays a
       separate `depart` field — the digest records the schedule a planner would
       run, not the encoding used to ask the question.

       This was missing until Tier 5 landed and it was a real defect: the
       `depart` column entered the canonical form when the A4 repair shipped, so
       a sheet carrying `depart: 540` hashed as a 09:00 start while being
       VERIFIED as though it left at midnight.

       Folding zero is a no-op, which is why every digest published before that
       fix — e249d90e…, the nine device captures, the white paper — is
       unaffected. No bundled fixture carried a departure column. */
    dist[1] += toQ(r.depart ?? 0, `${r.vehicle} departure`);

    const wins = [];
    for (const st of r.stops) {
      wins.push(toQ(st.ready, `${st.id} window open`), toQ(st.due, `${st.id} window close`));
    }
    const routeIdx = r.stops.map((_, i) => i);

    const db = put(engine, dist), wb = put(engine, wins);
    const rb = put(engine, routeIdx), ob = put(engine, [0, 0, 0, 0, 0, 0]);
    engine.exports.lattice_verify(rb.ptr, k, db.ptr, k, wb.ptr, ob.ptr);
    const dv = view(engine), o = [];
    for (let i = 0; i < 6; i++) o.push(dv.getInt32(ob.ptr + i * 4, true));
    [db, wb, rb, ob].forEach((x) => engine.exports.lattice_free(x.ptr, x.bytes));

    results.push({
      vehicle: r.vehicle,
      stops: k - 2 > 0 ? k - 2 : k,
      status: o[0],
      node: o[1] >= 0 ? (r.stops[o[1]]?.id ?? String(o[1])) : null,
      arrival: o[2], close: o[3], deficit: o[4], cost: o[5],
    });
  }

  return {
    unit: spec.unit,
    checked: results.length,
    capped,
    totalSubmitted: spec.routes.length,
    feasible: results.filter((r) => r.status === 0).length,
    results,
    spec,
  };
}

/**
 * The verdict digest for a report.
 *
 * Goes through the shared canonicalisation in `digest.js`, so this page, the
 * Excel pane, the Sheets sidebar and the npm package produce the SAME hash for
 * the same schedule. They used to produce three different ones.
 *
 * Only the routes actually EVALUATED are included, which matters on a capped
 * run: a digest covering rounds nobody checked would claim more than it knows.
 */
export async function digestOf(rep) {
  const checked = rep.results.length;
  const routes = rep.spec.routes.slice(0, checked).map((r) => ({
    id: r.vehicle,
    depart: r.depart ?? 0,
    stops: r.stops.map((s) => ({ id: s.id, open: s.ready, close: s.due, travel: s.travel })),
  }));
  const verdict = rep.results.map((r) => ({
    id: r.vehicle,
    feasible: r.status === 0,
    violation: r.status === 1
      ? { stop: r.node, raw: { arrival: r.arrival, windowClose: r.close, deficit: r.deficit } }
      : null,
  }));
  return verdictDigest(routes, verdict);
}

/** RFC4180-ish CSV, tolerant of CRLF and quoted fields. */
export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** The `lattice117.audit.v1` JSON shape to the normalised spec. */
export function fromJson(doc) {
  if (doc.schema !== 'lattice117.audit.v1') {
    throw new Error(`unexpected schema "${doc.schema}" — expected "lattice117.audit.v1"`);
  }
  const nodes = doc.nodes || [], n = nodes.length;
  if (!n) throw new Error('no nodes');
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const M = doc.distance_matrix || [];
  if (M.length !== n) throw new Error(`distance_matrix has ${M.length} rows but there are ${n} nodes`);
  M.forEach((row, i) => {
    if (row.length !== n) throw new Error(`distance_matrix row ${i} has ${row.length} entries, expected ${n}`);
  });
  const routes = (doc.routes || []).map((r) => {
    const stops = r.stops.map((sid, i) => {
      if (!idx.has(sid)) throw new Error(`round "${r.vehicle}" references unknown stop "${sid}"`);
      const nd = nodes[idx.get(sid)];
      return {
        id: sid, ready: nd.ready ?? 0, due: nd.due ?? 0,
        travel: i === 0 ? 0 : M[idx.get(r.stops[i - 1])][idx.get(sid)],
      };
    });
    return { vehicle: r.vehicle, stops };
  });
  return { unit: doc.time_unit || 'units', routes };
}
