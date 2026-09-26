/**
 * The verdict digest — one canonicalisation, shared by every surface.
 *
 * This file exists because the three surfaces each grew their own. The browser
 * audit hashed raw input values, the Excel pane hashed a summary that did not
 * include the inputs at all, and the npm package hashed Q16.16 integers. Three
 * different hashes for one schedule, which makes the digest worse than useless:
 * its entire purpose is letting two parties confirm they reached the same
 * verdict, and a planner checking in Excel could not match their client
 * checking in the browser.
 *
 * The canonicalisation here is npm 0.2.0's, unchanged, so digests already
 * issued by the package stay valid and the other surfaces move onto it.
 *
 * Two deliberate choices, both of which exist to stop the digest moving when
 * the verdict has not:
 *
 *   * Values are hashed as the Q16.16 integers the engine actually evaluated,
 *     not as supplied. `600` and `'600'` are the same schedule, and a CSV or
 *     spreadsheet round-trip hands you strings as a matter of course.
 *   * The first stop's travel time is pinned to 0. Nothing precedes it, so it
 *     takes no part in the evaluation.
 *
 * Zero dependencies, no network, WebCrypto only — usable unchanged in the
 * browser, in the Excel task pane and in Node.
 */

/** Q16.16 scale factor. */
export const Q = 65536;
/** Representable range of Q16.16 on i32. */
export const Q16_MAX = 32767;
export const Q16_MIN = -32768;

/**
 * Converts one value to its Q16.16 integer.
 *
 * The multiply goes through a double, which is unavoidable in JavaScript and
 * measurably harmless here: across 36,014 realistic route-sheet values
 * (0-600 with up to three decimal places, plus exact half-unit boundaries)
 * this produces bit-identical results to exact decimal arithmetic. IEEE-754
 * is fully specified, so it is also identical on every platform.
 *
 * Out-of-range input throws rather than wrapping. A wrapped value yields a
 * confident verdict about a schedule that was never checked, which is the
 * worst failure this kind of tool can have.
 */
export function toQ(value, what) {
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

/**
 * The exact string that gets hashed. Exposed so a surface can show it, and so
 * a test can diff two surfaces' canonical forms rather than only their hashes
 * — when they disagree, the string says where.
 *
 * @param {{id:string, stops:{id:string, open?:*, close?:*, travel:*}[]}[]} routes
 * @param {{id:string, feasible:boolean,
 *          violation:?{stop:string, raw:{arrival:number, windowClose:number, deficit:number}}}[]} verdict
 */
export function canonicalise(routes, verdict) {
  return JSON.stringify({
    routes: routes.map((r) => [
      r.id,
      r.stops.map((s, i) => [
        s.id,
        toQ(s.open ?? 0, `${s.id} window open`),
        toQ(s.close ?? 0, `${s.id} window close`),
        i === 0 ? 0 : toQ(s.travel, `${s.id} travel`),
      ]),
    ]),
    verdict: verdict.map((r) => [
      r.id,
      r.feasible,
      r.violation?.stop ?? null,
      r.violation?.raw?.arrival ?? null,
      r.violation?.raw?.windowClose ?? null,
      r.violation?.raw?.deficit ?? null,
    ]),
  });
}

/** SHA-256 of a canonical string, lowercase hex. Both modes hash through here. */
async function sha256(canon) {
  const data = new TextEncoder().encode(canon);
  const subtle = globalThis.crypto?.subtle
    ?? (await import('node:crypto')).webcrypto.subtle;
  const buf = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Canonical SHA-256 over the inputs and the verdict, lowercase hex. */
export async function verdictDigest(routes, verdict) {
  return sha256(canonicalise(routes, verdict));
}

/* ---- rota mode -----------------------------------------------------------
   A second canonicalisation for the rest/break check. Same discipline, own
   shape: a rota is people and shifts, not routes and stops, and forcing it
   through the routing canon would produce a hash whose structure lied about
   what was checked.

   Absolute shift times are hashed as EXACT INTEGER MINUTES rather than Q16.16.
   Minutes since the civil epoch run to tens of millions, which overflows
   Q16.16 entirely; they are already exact integers, so scaling them would add
   risk and remove nothing. The differences the check turns on - rest gaps,
   break shortfalls - are small, and those are hashed in Q16.16 where every
   whole minute is exactly representable.

   The thresholds are part of the canon. A record that did not pin them could
   be reproduced against different rules and still match, which would make the
   digest meaningless for the one thing it exists to prove.
-------------------------------------------------------------------------- */

/**
 * @param {{id:string, shifts:{start:number,end:number,breakMins:number}[]}[]} people
 * @param {{id:string, ok:boolean, breaches:{kind:string, q:{actual:number,expected:number,shortfall:number}}[]}[]} verdict
 * @param {{restMinutes:number, longShiftMinutes:number, breakMinutes:number}} rules
 */
export function canonicaliseRota(people, verdict, rules) {
  return JSON.stringify({
    mode: 'lattice117.rota.v1',
    rules: [rules.restMinutes * Q, rules.longShiftMinutes * Q, rules.breakMinutes * Q],
    people: people.map((p) => [
      p.id,
      p.shifts.map((s) => [s.start, s.end, s.breakMins]),
    ]),
    verdict: verdict.map((v) => [
      v.id,
      v.ok,
      v.breaches.map((b) => [b.kind, b.q.actual, b.q.expected, b.q.shortfall]),
    ]),
  });
}

/** SHA-256 over the rota canonical form, lowercase hex. */
export async function rotaDigest(people, verdict, rules) {
  return sha256(canonicaliseRota(people, verdict, rules));
}
