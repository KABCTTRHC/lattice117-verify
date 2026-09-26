/**
 * Readers for the two standard benchmark formats.
 *
 * These parse instance files the USER supplies. No instance data ships with
 * this repository — docs/FIXTURE-B-BENCHMARK.md records why — so everything
 * here is format knowledge, which is not anyone's dataset.
 */

/**
 * TSPLIB `NODE_COORD_SECTION` with `EDGE_WEIGHT_TYPE: EUC_2D`.
 *
 * The rounding is load-bearing. TSPLIB defines EUC_2D as
 * `nint(sqrt(dx^2 + dy^2))` — nearest integer — and that rounding is part of
 * the instance, not a display choice. Every published optimum is a sum of those
 * integers, so a reader that kept full precision would compute a different,
 * incomparable number and quietly look better than the literature.
 */
export function parseTsplib(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  const header = {};
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^NODE_COORD_SECTION\b/i.test(lines[i])) { at = i + 1; break; }
    const kv = /^([A-Z_]+)\s*:\s*(.*)$/i.exec(lines[i]);
    if (kv) header[kv[1].toUpperCase()] = kv[2].trim();
  }
  if (at === -1) {
    throw new Error(
      'no NODE_COORD_SECTION found. This reader handles coordinate instances ' +
      '(EDGE_WEIGHT_TYPE: EUC_2D); an explicit EDGE_WEIGHT_SECTION matrix is ' +
      'not supported yet.'
    );
  }
  const type = (header.EDGE_WEIGHT_TYPE || 'EUC_2D').toUpperCase();
  if (type !== 'EUC_2D') {
    throw new Error(
      `EDGE_WEIGHT_TYPE ${type} is not supported. Only EUC_2D is, because that ` +
      'is the one whose rounding rule this reader reproduces exactly.'
    );
  }
  const coords = [];
  for (let i = at; i < lines.length; i++) {
    const l = lines[i];
    if (!l || /^(EOF|DISPLAY_DATA_SECTION|TOUR_SECTION)\b/i.test(l)) break;
    const f = l.split(/\s+/);
    if (f.length < 3) continue;
    coords.push([Number(f[1]), Number(f[2])]);
  }
  if (!coords.length) throw new Error('NODE_COORD_SECTION held no coordinates');
  const stated = header.DIMENSION ? Number(header.DIMENSION) : coords.length;
  if (stated !== coords.length) {
    throw new Error(`DIMENSION says ${stated} nodes but ${coords.length} coordinates were read`);
  }
  return { name: header.NAME || 'unnamed', coords, type };
}

/** TSPLIB EUC_2D edge weight: nearest integer, ties away from zero. */
export const euc2d = (a, b) =>
  Math.round(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2));

/**
 * Solomon VRPTW text format: a name, a VEHICLE block, then CUSTOMER rows of
 * `id x y demand ready due service`.
 */
export function parseSolomon(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim());
  const name = lines.find((l) => l) || 'unnamed';
  let vehicles = null, capacity = null, at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^VEHICLE\b/i.test(lines[i])) {
      const nums = (lines.slice(i + 1, i + 4).join(' ').match(/-?\d+/g) || []).map(Number);
      if (nums.length >= 2) { vehicles = nums[0]; capacity = nums[1]; }
    }
    if (/^CUSTOMER\b/i.test(lines[i])) { at = i + 1; }
  }
  if (at === -1) throw new Error('no CUSTOMER section found — is this a Solomon instance?');
  const customers = [];
  for (let i = at; i < lines.length; i++) {
    const f = lines[i].split(/\s+/).filter(Boolean).map(Number);
    if (f.length < 7 || f.some((v) => !Number.isFinite(v))) continue;
    const [id, x, y, demand, ready, due, service] = f;
    customers.push({ id, x, y, demand, ready, due, service });
  }
  if (!customers.length) throw new Error('CUSTOMER section held no usable rows');
  return { name, vehicles, capacity, customers };
}

/**
 * Solomon distances: plain Euclidean, kept to one decimal place.
 *
 * One place, not full precision, for the same reason the bundled fixtures use
 * it: Q16.16 holds 0.1 only to within 1/65536, so the value that gets hashed
 * has to be a decimal string everyone agrees on. It is stated here rather than
 * assumed, because a benchmark that is silent about its rounding is a benchmark
 * two people can disagree about while both being right.
 */
export const solomonDistance = (a, b) =>
  Number(Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toFixed(1));

/** Row-major Q16.16 matrix from nodes and a distance function. */
export function matrixOf(nodes, distance) {
  const n = nodes.length;
  const m = new Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) m[i * n + j] = Math.round(distance(nodes[i], nodes[j]) * 65536);
  }
  return { matrix: m, n };
}
