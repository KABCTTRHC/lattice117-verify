/**
 * SVG and G-code toolpath adapter.
 *
 * # What this optimises, and what it does not
 *
 * On a laser, router or plotter the time spent CUTTING is fixed: those moves
 * are dictated by the part. What is not fixed is the order the cuts are made
 * in, and therefore the RAPID moves between them — tool up, traverse, tool
 * down. On a typical nested sheet those rapids are a third of the cycle and
 * nobody has ever chosen their order deliberately, because the order is
 * whatever the CAD package emitted.
 *
 * So the quantity here is the sum of rapid travel, and the problem is exactly
 * the one `resequence.js` already solves: visit every cut once, start and end
 * at home, minimise the travel between. Zero new solver, zero new Rust.
 *
 * # The distance convention, stated once
 *
 *     M[i][j] = |end(i) → start(j)|
 *
 * The distance from cut i to cut j is the rapid from where cut i FINISHES to
 * where cut j BEGINS. This matrix is therefore **asymmetric**, and that is not
 * an accident to be smoothed over: a cut has a direction, and centre-to-centre
 * or start-to-start would both be wrong in ways that produce a confident
 * saving for a path the machine will not actually take.
 *
 * `tests/toolpath.test.mjs` opens by asserting, on random coordinates, that
 * the number this file computes for a pair IS the number at that pair's index
 * in the matrix. That test was written before any of this, because an earlier
 * audit in this project reported a 42% optimality gap against a distance table
 * that turned out to be invented — the defect was in the instrument, not the
 * engine, and this is precisely where that lives.
 *
 * # Cuts are never reversed
 *
 * Many contours could be cut in either direction, which would give the search
 * a second degree of freedom per segment and find shorter paths. This adapter
 * does NOT use it, because it is a different problem: closed contours carry
 * lead-ins, climb-versus-conventional milling changes the finish, and a
 * reversed segment is not always a segment the machine can run. Silently
 * flipping cuts would produce plans that look better and cut worse. So the
 * saving reported here is a LOWER BOUND on what reordering can achieve, and
 * that is the honest direction for it to be wrong in.
 *
 * # Units
 *
 * Millimetres, Q16.16, so the representable ceiling is 32,767 mm. A machine
 * with a 32-metre axis is not the constraint anyone has; a file in microns is,
 * and that is refused by name rather than wrapped.
 */

/** Q16.16 scale, and the representable ceiling in mm. */
const Q = 65536;
export const MAX_MM = 32767;
export const MIN_MM = -32768;

/** The id given to the tool's home position, which is always node 0. */
export const HOME = 'HOME';

/** Millimetres to Q16.16, refusing anything the format cannot hold. */
export function toQ16(mm, what = 'distance') {
  const n = Number(mm);
  if (!Number.isFinite(n)) throw new RangeError(`${what}: "${mm}" is not a finite number`);
  if (n < MIN_MM || n > MAX_MM) {
    throw new RangeError(
      `${what}: ${n} mm is outside the Q16.16 representable range (${MIN_MM}..${MAX_MM}). ` +
      `Rescale your units — millimetres rather than microns — instead of truncating.`);
  }
  return Math.round(n * Q);
}

/** Q16.16 back to millimetres. */
export function fromQ16(q) { return q / Q; }

/**
 * The rapid move between two points, in millimetres.
 *
 * Plain Euclidean. This is THE distance function: `toolpathMatrix` calls it
 * and nothing else computes a distance anywhere in this file.
 */
export function rapidDistance(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Total cutting length of one segment — invariant under reordering. */
export function cutLength(segment) {
  let total = 0;
  for (let i = 1; i < segment.points.length; i++) {
    total += rapidDistance(segment.points[i - 1], segment.points[i]);
  }
  return total;
}

/* ---------------------------------------------------------------------------
   The matrix
--------------------------------------------------------------------------- */

/**
 * Builds the rapid-travel matrix the re-sequencer consumes.
 *
 * Returns `{matrix, n, nodes}` where `matrix` is a flat row-major n x n array
 * of Q16.16 integers and `nodes[i]` is `{id, start, end}` — the geometry row i
 * stands for. Node 0 is home, whose start and end are the same point.
 */
export function toolpathMatrix(segments, { home = { x: 0, y: 0 } } = {}) {
  if (!segments.length) throw new Error('no cutting segments found');

  const nodes = [
    { id: HOME, start: home, end: home },
    ...segments.map((s) => {
      if (s.points.length < 2) {
        throw new Error(`segment "${s.id}" has ${s.points.length} point(s); at least 2 are needed`);
      }
      return { id: s.id, start: s.points[0], end: s.points.at(-1) };
    }),
  ];

  const n = nodes.length;
  const matrix = new Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matrix[i * n + j] = i === j
        ? 0
        : toQ16(rapidDistance(nodes[i].end, nodes[j].start), `rapid ${nodes[i].id} → ${nodes[j].id}`);
    }
  }
  return { matrix, n, nodes };
}

/**
 * The round the re-sequencer takes: home, every cut, home.
 *
 * Time windows are wide open. A milling machine has no delivery slots, and
 * inventing them would make the search optimise against a constraint nobody
 * stated. `resequence.js` prefers feasibility over cost, so with nothing
 * infeasible it reduces to pure travel minimisation, which is the question.
 */
export function segmentsToRound(segments, nodes, { id = 'toolpath' } = {}) {
  const open = 0, close = toQ16(MAX_MM);
  const stop = (node, idx) => ({ id: node.id, node: idx, open, close, travel: 0 });
  return {
    id,
    departQ: 0,
    stops: [
      stop(nodes[0], 0),
      ...segments.map((_, k) => stop(nodes[k + 1], k + 1)),
      stop(nodes[0], 0),
    ],
  };
}

/* ---------------------------------------------------------------------------
   SVG
--------------------------------------------------------------------------- */

/**
 * Pulls polyline segments out of an SVG's `<path>` elements.
 *
 * Deliberately handles M/L/H/V/Z only, absolute and relative. Curves are NOT
 * flattened: a C or an A would need a tolerance parameter, and a tolerance
 * silently chosen here would change the geometry the digest is taken over. A
 * file containing them is reported rather than approximated.
 */
export function parseSvg(text) {
  const segments = [];
  const paths = [...text.matchAll(/<path\b([^>]*)>/gi)];
  if (!paths.length) throw new Error('no <path> elements found in this SVG');

  paths.forEach((m, index) => {
    const attrs = m[1];
    const d = (attrs.match(/\bd\s*=\s*"([^"]*)"/i) ?? attrs.match(/\bd\s*=\s*'([^']*)'/i))?.[1];
    if (!d) return;
    const id = (attrs.match(/\bid\s*=\s*"([^"]*)"/i) ?? [])[1] ?? `path-${index + 1}`;

    const curve = d.match(/[CcSsQqTtAa]/);
    if (curve) {
      throw new Error(
        `path "${id}" contains a curve command "${curve[0]}". Flattening a curve needs a ` +
        `tolerance, and a tolerance chosen here would silently change the geometry the ` +
        `digest is taken over. Export the file with curves already flattened to polylines.`);
    }

    const tokens = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
    const points = [];
    let cx = 0, cy = 0, cmd = null, closed = false, startX = 0, startY = 0;

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (/[MmLlHhVvZz]/.test(t)) {
        cmd = t;
        if (t === 'Z' || t === 'z') {
          if (points.length) { points.push({ x: startX, y: startY }); closed = true; }
        }
        continue;
      }
      const num = Number(t);
      const rel = cmd === cmd?.toLowerCase();
      if (cmd === 'H' || cmd === 'h') { cx = rel ? cx + num : num; points.push({ x: cx, y: cy }); continue; }
      if (cmd === 'V' || cmd === 'v') { cy = rel ? cy + num : num; points.push({ x: cx, y: cy }); continue; }
      const y = Number(tokens[++i]);
      cx = rel ? cx + num : num;
      cy = rel ? cy + y : y;
      points.push({ x: cx, y: cy });
      if (cmd === 'M') { startX = cx; startY = cy; cmd = 'L'; }
      else if (cmd === 'm') { startX = cx; startY = cy; cmd = 'l'; }
    }

    if (points.length >= 2) segments.push({ id, points, closed });
  });

  if (!segments.length) throw new Error('no usable path geometry found in this SVG');
  return segments;
}

/* ---------------------------------------------------------------------------
   G-code
--------------------------------------------------------------------------- */

/**
 * Splits G-code into cutting segments.
 *
 * G0 is a rapid: it ENDS the current cut and positions the tool for the next.
 * G1/G2/G3 are cutting moves. Arcs (G2/G3) are taken as their endpoints, which
 * is a real approximation of their LENGTH — but their length is cutting time,
 * which no reordering changes, so it does not affect the quantity being
 * optimised. Their endpoints are exact, and endpoints are what the matrix is
 * built from.
 *
 * Coordinates are modal, as the standard requires: `G1 X50` after `Y10` is
 * (50, 10), not (50, 0). Getting that wrong moves every subsequent point.
 */
export function parseGcode(text) {
  const segments = [];
  /* `prevX/prevY` are where the tool WAS before this line. A new cut begins
     there, because G1 describes where the move ENDS. They were module-level
     and updated after a `continue`, so a rapid left them stale and every
     segment after the first began at the point before its own rapid — the
     bug the "starts where its rapid left the tool" assertion caught. */
  let cur = null, x = 0, y = 0, prevX = 0, prevY = 0, index = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').replace(/\([^)]*\)/g, '').trim();
    if (!line) continue;

    const g = line.match(/\bG(\d{1,3})\b/i);
    const gx = line.match(/\bX(-?\d*\.?\d+)/i);
    const gy = line.match(/\bY(-?\d*\.?\d+)/i);
    if (!g && !gx && !gy) continue;

    const code = g ? Number(g[1]) : null;
    if (gx) x = Number(gx[1]);
    if (gy) y = Number(gy[1]);

    if (code === 0) {
      if (cur && cur.points.length >= 2) segments.push(cur);
      cur = null;
      prevX = x; prevY = y;          // a rapid still MOVES the tool
      continue;
    }
    if (code === 1 || code === 2 || code === 3 || (code === null && (gx || gy))) {
      if (!cur) cur = { id: `cut-${++index}`, points: [{ x: prevX, y: prevY }], closed: false };
      cur.points.push({ x, y });
    }
    prevX = x; prevY = y;
  }
  if (cur && cur.points.length >= 2) segments.push(cur);
  if (!segments.length) throw new Error('no G1/G2/G3 cutting moves found in this G-code');
  return segments;
}
