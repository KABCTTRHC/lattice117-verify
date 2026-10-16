/**
 * lattice117-mcp — the verifier as Model Context Protocol tools.
 *
 * An AI agent that plans a delivery round, a staff rota or a cutting order can
 * call these tools to have the plan checked by the same deterministic referee
 * the browser, the spreadsheet add-ons and `npx lattice117-verify` use. A plan
 * that does not hold comes back refused, with the first stop or shift that
 * breaks and the exact deficit, so the agent can repair it and check again.
 *
 * # What the tools are
 *
 *   verify_fleet       routes against their time windows (and, optionally,
 *                      vehicle capacity); the 21,525-byte WASM referee
 *   verify_rota        shifts against rest and break thresholds (indicative,
 *                      not legal advice)
 *   resequence_round   the exact best order of one round against a distance
 *                      matrix (up to 8 interior stops), graded before and
 *                      after by the referee
 *   optimize_toolpath  the cut order that minimises rapid travel for an SVG,
 *                      G-code or point list (up to 8 cuts searched)
 *   self_test          re-derives the three published digests
 *
 * # Properties, structural rather than promised
 *
 * - No network. Nothing here or in what it imports opens a socket; the WASM
 *   module is read from the package folder. `tests/mcp.test.mjs` checks the
 *   source for network modules and runs every tool with `fetch` replaced by
 *   a function that fails the test if it is called.
 * - Deterministic. No clock, no randomness, no environment in any result:
 *   the same arguments give the same bytes, and every verdict carries a
 *   digest anyone can recompute.
 * - The referee is never the solver. `resequence_round` and
 *   `optimize_toolpath` propose an order with the exhaustive search in
 *   `resequence.js`; the WASM referee grades it. An agent gets both
 *   verdicts, never a self-certified answer.
 *
 * The transport (newline-delimited JSON-RPC 2.0 on stdin and stdout) is in
 * `bin/lattice117-mcp.mjs`. This file holds the protocol and the tools so a
 * test can drive them without a process.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { verifyFleet, verdictDigest } from './index.js';
import { toQ, rotaDigest, LOAD_MAX } from './digest.js';
import {
  parseMatrix, resequenceRound, roundsFromRows, applyToRoute, EXACT_LIMIT, fromQ,
} from './resequence.js';
import { evaluateRota, DISCLAIMER as ROTA_DISCLAIMER } from './rota.js';
import {
  parseSvg, parseGcode, toolpathMatrix, segmentsToRound, fromQ16, HOME,
} from './toolpath.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, f), 'utf8');

export const SERVER_NAME = 'lattice117-mcp';
export const SERVER_VERSION = JSON.parse(read('package.json')).version;

/**
 * Protocol revisions this server speaks, newest first. A client asking for one
 * of these gets it back; any other request gets the newest, and the client
 * decides whether to continue (the MCP version negotiation rule).
 */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** The three digests `npx lattice117-verify reproduce` checks. */
export const PUBLISHED = Object.freeze({
  fleetV1: 'e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d',
  nottinghamBefore: 'da1650fc0e63e26eba33913f25f24fb9fbdc78ce4c55549279cb9582d3119993',
  nottinghamAfter: '2b9d863c5ab89a90a2416a9a708ce09fa8876b6d8d91e58199696181e7da7b15',
});

const INSTRUCTIONS =
  'Deterministic plan checking. Call verify_fleet or verify_rota on any plan ' +
  'before acting on it. A refused plan names the first stop or shift that ' +
  'breaks and the exact deficit: repair that (resequence_round can reorder a ' +
  'round against a distance matrix) and verify again. Treat a plan as ' +
  'certified only when the referee says it holds, and quote its digest. ' +
  'All times are in the unit you supply; keep them within -32768..32767.';

/* ---------------------------------------------------------------------------
   Input helpers
--------------------------------------------------------------------------- */

/** A tool-input error: reported to the agent as a tool result, not a crash. */
class ToolInputError extends Error {}

function need(cond, message) {
  if (!cond) throw new ToolInputError(message);
}

/** A route sheet CSV as the package's own fixtures are written. */
export function routesFromCsv(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.trim());
  const ix = (n) => head.indexOf(n);
  const byVehicle = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const v = c[ix('vehicle')].trim();
    if (!byVehicle.has(v)) {
      byVehicle.set(v, { id: v, depart: ix('depart') >= 0 ? c[ix('depart')] : 0, stops: [] });
    }
    byVehicle.get(v).stops.push({
      id: c[ix('stop')].trim(),
      open: c[ix('window_open')],
      close: c[ix('window_close')],
      travel: c[ix('travel_mins_from_previous')],
      seq: Number(c[ix('seq')]),
    });
  }
  return [...byVehicle.values()].map((r) => ({
    ...r,
    stops: r.stops.sort((a, b) => a.seq - b.seq).map(({ seq, ...s }) => s),
  }));
}

/** The first route that does not hold, in route order, or null. */
function firstFailure(results) {
  for (const r of results) {
    if (r.feasible) continue;
    if (r.violation) {
      return {
        route: r.id, kind: 'time_window', stop: r.violation.stop,
        arrival: r.violation.arrival, windowClose: r.violation.windowClose,
        deficit: r.violation.deficit,
        // The exact Q16.16 integers the referee compared (value x 65536).
        raw: r.violation.raw,
      };
    }
    if (r.capacityViolation) {
      return { route: r.id, kind: 'capacity', ...r.capacityViolation };
    }
  }
  return null;
}

function failureSentence(f) {
  if (!f) return null;
  if (f.kind === 'time_window') {
    return `Route ${f.route} reaches stop ${f.stop} at ${f.arrival}, but its window ` +
      `closes at ${f.windowClose}: ${f.deficit} late.`;
  }
  return `Route ${f.route} reaches a load of ${f.load} at stop ${f.stop}, over its ` +
    `capacity of ${f.capacity} by ${f.excess}.`;
}

/* ---------------------------------------------------------------------------
   Tools
--------------------------------------------------------------------------- */

const num = { type: ['number', 'string'] };
const whole = { type: ['integer', 'string'] };

const STOP_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Stop identifier, echoed back in results.' },
    travel: { ...num, description: 'Travel time from the previous stop. Ignored on the first stop.' },
    open: { ...num, description: 'Window opens. Defaults to 0.' },
    close: { ...num, description: 'Window closes: the latest allowed arrival.' },
    demand: { ...whole, description: `Optional load here, whole units (0..${LOAD_MAX}). Needs a route capacity.` },
  },
  required: ['id', 'close'],
};

const ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Vehicle, round or duty identifier.' },
    depart: { ...num, description: 'Departure time from the first stop. Defaults to 0.' },
    capacity: { ...whole, description: 'Optional vehicle capacity, same whole units as demand.' },
    vehicleCapacity: { ...whole, description: 'Alias of capacity.' },
    stops: { type: 'array', minItems: 2, items: STOP_SCHEMA, description: 'Stops in visit order.' },
  },
  required: ['id', 'stops'],
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: 'verify_fleet',
    title: 'Verify routes against their time windows',
    description:
      'Checks each route against its own time windows (and vehicle capacity when given) ' +
      'with the deterministic Q16.16 referee. Returns, per route, whether it holds; for ' +
      'the first route that does not, the stop that breaks and the exact deficit; and a ' +
      'SHA-256 verdictDigest over the inputs and verdict that anyone can recompute.',
    inputSchema: {
      type: 'object',
      properties: { routes: { type: 'array', minItems: 1, items: ROUTE_SCHEMA } },
      required: ['routes'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'verify_rota',
    title: 'Check a rota against rest and break thresholds',
    description:
      'Indicative arithmetic check of shifts against rest and break thresholds (default: ' +
      '11 h between shifts, a 20-minute break in a shift over 6 h). Not legal advice. ' +
      'Returns every breach with the exact shortfall in minutes, and a rotaDigest.',
    inputSchema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              staff: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD; the day the shift starts.' },
              start: { type: 'string', description: 'HH:MM, or a full date-time.' },
              end: { type: 'string', description: 'HH:MM; before start means it ends the next day.' },
              break: { ...num, description: 'Break minutes (or H:MM).' },
            },
            required: ['staff', 'start', 'end'],
          },
        },
        rules: {
          type: 'object',
          description: 'Optional thresholds in whole minutes. They enter the digest.',
          properties: {
            restMinutes: { type: 'integer' },
            longShiftMinutes: { type: 'integer' },
            breakMinutes: { type: 'integer' },
          },
        },
      },
      required: ['rows'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'resequence_round',
    title: 'Re-order one round, then have the referee grade both orders',
    description:
      `Searches every order of a round's interior stops (up to ${EXACT_LIMIT}; the first ` +
      'and last stay fixed) against a distance matrix, preferring orders that hold over ' +
      'cheaper ones. The referee then grades the original and the best order. Returns ' +
      'both verdicts and digests, and the repaired route ready for verify_fleet.',
    inputSchema: {
      type: 'object',
      properties: {
        route: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            depart: num,
            capacity: whole,
            vehicleCapacity: whole,
            stops: {
              type: 'array',
              minItems: 2,
              items: {
                type: 'object',
                properties: { id: { type: 'string' }, open: num, close: num, demand: whole },
                required: ['id', 'close'],
              },
            },
          },
          required: ['id', 'stops'],
        },
        matrix: {
          type: 'object',
          description: 'Travel times between named stops, in the same unit as the windows.',
          properties: {
            nodes: { type: 'array', items: { type: 'string' } },
            times: { type: 'array', items: { type: 'array', items: num } },
          },
          required: ['nodes', 'times'],
        },
        matrixText: {
          type: 'string',
          description: 'Alternative to matrix: rows of numbers with a "# nodes: 0=A, 1=B" legend.',
        },
      },
      required: ['route'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'optimize_toolpath',
    title: 'Order cuts to minimise rapid travel',
    description:
      `Finds the cut order (up to ${EXACT_LIMIT} cuts searched exhaustively) that minimises ` +
      'rapid travel between cuts, starting and ending at home. Cuts are never reversed, so ' +
      'the saving is a lower bound. Millimetres. Give one of svg, gcode or segments.',
    inputSchema: {
      type: 'object',
      properties: {
        svg: { type: 'string', description: 'SVG text; <path> M/L/H/V/Z only.' },
        gcode: { type: 'string', description: 'G-code text; G0/G1 moves.' },
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              points: {
                type: 'array',
                minItems: 2,
                items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
              },
            },
            required: ['id', 'points'],
          },
        },
        home: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
      },
    },
    annotations: READ_ONLY,
  },
  {
    name: 'self_test',
    title: 'Re-derive the published digests',
    description:
      'Runs the bundled fixtures through the referee and compares the three digests with ' +
      'the published values. Use it once to confirm this installation is the published engine.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ_ONLY,
  },
];

async function verifyFleetTool(args) {
  const routes = args?.routes;
  need(Array.isArray(routes) && routes.length > 0, 'routes must be a non-empty array');
  for (const r of routes) {
    need(r && typeof r === 'object' && Array.isArray(r.stops), 'every route needs an id and a stops array');
  }
  const result = await verifyFleet(routes);
  const digest = await verdictDigest(routes, result);
  const first = firstFailure(result.routes);
  return {
    checked: result.checked,
    feasible: result.feasible,
    infeasible: result.infeasible,
    holds: result.infeasible === 0,
    verdictDigest: digest,
    firstFailure: first,
    summary: `${result.feasible} of ${result.checked} route(s) hold.` +
      (first ? ' ' + failureSentence(first) : ''),
    routes: result.routes,
  };
}

const RULE_KEYS = ['restMinutes', 'longShiftMinutes', 'breakMinutes'];

async function verifyRotaTool(args) {
  const rows = args?.rows;
  need(Array.isArray(rows) && rows.length > 0, 'rows must be a non-empty array');
  let rules;
  if (args.rules !== undefined) {
    need(args.rules && typeof args.rules === 'object', 'rules must be an object');
    rules = {};
    for (const [k, v] of Object.entries(args.rules)) {
      need(RULE_KEYS.includes(k), `unknown rule "${k}"; expected ${RULE_KEYS.join(', ')}`);
      need(Number.isInteger(v) && v >= 0 && v <= 10080, `${k} must be whole minutes, 0..10080`);
      rules[k] = v;
    }
  }
  const rep = evaluateRota(
    rows.map((r, i) => ({ staff: r.staff, date: r.date, start: r.start, end: r.end, break: r.break, row: i + 1 })),
    rules ? { rules } : {},
  );
  const digest = await rotaDigest(rep.people, rep.verdict, rep.rules);
  const breaches = rep.breaches.map((b) => ({
    kind: b.kind, staff: b.staff, row: b.row, date: b.label,
    actualMinutes: b.actual, expectedMinutes: b.expected, shortfallMinutes: b.shortfall,
  }));
  const first = breaches[0] ?? null;
  return {
    checked: rep.checked,
    clear: rep.clear,
    holds: breaches.length === 0 && rep.rejected.length === 0,
    rotaDigest: digest,
    breaches,
    rejected: rep.rejected,
    rules: rep.rules,
    summary: `${rep.clear} of ${rep.checked} people clear.` + (first
      ? ` First breach: ${first.staff}, row ${first.row} (${first.kind}): ` +
        `${first.actualMinutes} min against ${first.expectedMinutes}, short by ${first.shortfallMinutes}.`
      : '') + (rep.rejected.length ? ` ${rep.rejected.length} row(s) could not be read.` : ''),
    disclaimer: ROTA_DISCLAIMER,
  };
}

/** `{matrix, n, names}` from either matrix form. */
function matrixFrom(args) {
  if (typeof args.matrixText === 'string') return parseMatrix(args.matrixText);
  const m = args.matrix;
  need(m && Array.isArray(m.nodes) && Array.isArray(m.times), 'give matrix {nodes, times} or matrixText');
  const n = m.nodes.length;
  need(n > 0 && m.times.length === n, `matrix has ${m.nodes.length} nodes but ${m.times.length} rows`);
  const names = new Map();
  m.nodes.forEach((id, i) => {
    need(!names.has(String(id)), `matrix node "${id}" is named twice`);
    names.set(String(id), i);
  });
  const flat = [];
  m.times.forEach((row, i) => {
    need(Array.isArray(row) && row.length === n, `matrix row ${i} has ${row?.length} entries, expected ${n}`);
    row.forEach((v, j) => flat.push(toQ(v, `matrix ${m.nodes[i]} → ${m.nodes[j]}`)));
  });
  return { matrix: flat, n, names };
}

async function resequenceRoundTool(args) {
  const route = args?.route;
  need(route && typeof route === 'object' && Array.isArray(route.stops) && route.stops.length >= 2,
    'route needs an id and at least two stops');
  const { matrix, n, names } = matrixFrom(args);
  const nodeOf = (id) => (names.has(String(id)) ? names.get(String(id)) : -1);

  // The route as planned, with each leg's travel read from the matrix.
  const planned = {
    ...route,
    stops: route.stops.map((s, i) => {
      const node = nodeOf(s.id);
      need(node >= 0, `stop "${s.id}" is not named in the matrix`);
      const prev = i === 0 ? node : nodeOf(route.stops[i - 1].id);
      return { ...s, travel: i === 0 ? 0 : fromQ(matrix[prev * n + node]) };
    }),
  };
  const [round] = roundsFromRows([planned], nodeOf);
  const outcome = resequenceRound(round, matrix, n);
  const repaired = applyToRoute(planned, round, outcome, matrix, n);

  const grade = async (r) => {
    const v = await verifyFleet([r]);
    const res = v.routes[0];
    return {
      holds: res.feasible,
      firstFailure: firstFailure(v.routes),
      verdictDigest: await verdictDigest([r], v),
    };
  };
  const before = await grade(planned);
  const after = await grade(repaired);
  return {
    route: route.id,
    searched: outcome.searched,
    exactLimit: EXACT_LIMIT,
    changed: outcome.changed,
    orderBefore: outcome.originalIds,
    orderAfter: outcome.bestIds,
    travelBefore: fromQ(outcome.originalCostQ),
    travelAfter: fromQ(outcome.bestCostQ),
    lateStopsBefore: outcome.infeasibleBefore,
    lateStopsAfter: outcome.infeasibleAfter,
    before,
    after,
    repairedRoute: repaired,
    summary: (outcome.searched
      ? `Searched every order of ${round.stops.length - 2} interior stop(s). `
      : `Not searched: more than ${EXACT_LIMIT} interior stops; the round is returned unchanged. `) +
      `Referee: before ${before.holds ? 'holds' : 'refused'}, after ${after.holds ? 'holds' : 'refused'}.` +
      (after.firstFailure ? ' ' + failureSentence(after.firstFailure) : ''),
  };
}

async function optimizeToolpathTool(args) {
  const given = ['svg', 'gcode', 'segments'].filter((k) => args?.[k] !== undefined);
  need(given.length === 1, 'give exactly one of svg, gcode or segments');
  let segments;
  if (args.svg !== undefined) segments = parseSvg(String(args.svg));
  else if (args.gcode !== undefined) segments = parseGcode(String(args.gcode));
  else {
    need(Array.isArray(args.segments), 'segments must be an array');
    segments = args.segments.map((s, i) => ({
      id: String(s?.id ?? `cut${i + 1}`),
      points: (s?.points ?? []).map((p) => ({ x: Number(p.x), y: Number(p.y) })),
    }));
  }
  need(segments.length > 0, 'no cutting segments found');
  const home = args.home ? { x: Number(args.home.x ?? 0), y: Number(args.home.y ?? 0) } : { x: 0, y: 0 };
  const { matrix, n, nodes } = toolpathMatrix(segments, { home });
  const round = segmentsToRound(segments, nodes);
  const outcome = resequenceRound(round, matrix, n);
  const cuts = (ids) => ids.filter((id) => id !== HOME);
  const savingBps = outcome.originalCostQ > 0
    ? Math.floor((outcome.savingQ * 10000) / outcome.originalCostQ)
    : 0;
  return {
    cuts: segments.length,
    searched: outcome.searched,
    exactLimit: EXACT_LIMIT,
    changed: outcome.changed,
    orderBefore: cuts(outcome.originalIds),
    orderAfter: cuts(outcome.bestIds),
    rapidBeforeMm: fromQ16(outcome.originalCostQ),
    rapidAfterMm: fromQ16(outcome.bestCostQ),
    savingMm: fromQ16(outcome.savingQ),
    savingPercent: savingBps / 100,
    summary: outcome.searched
      ? `Rapid travel ${fromQ16(outcome.originalCostQ)} mm to ${fromQ16(outcome.bestCostQ)} mm. ` +
        'Cuts are never reversed, so this is a lower bound on what reordering can save.'
      : `Not searched: more than ${EXACT_LIMIT} cuts. The order is returned unchanged.`,
  };
}

async function selfTestTool() {
  const got = {};
  const fleet = routesFromCsv(read('example-route-sheet.csv'));
  got.fleetV1 = await verdictDigest(fleet, await verifyFleet(fleet));

  const { matrix, n, names } = parseMatrix(read('example-fleet-nottingham-matrix.txt'));
  const routes = routesFromCsv(read('example-fleet-nottingham.csv'));
  const rounds = roundsFromRows(routes, (id) => (names.has(id) ? names.get(id) : -1));
  got.nottinghamBefore = await verdictDigest([routes[0]], await verifyFleet([routes[0]]));
  const outcome = resequenceRound(rounds[0], matrix, n);
  const after = applyToRoute(routes[0], rounds[0], outcome, matrix, n);
  got.nottinghamAfter = await verdictDigest([after], await verifyFleet([after]));

  const results = Object.keys(PUBLISHED).map((k) => ({
    name: k, expected: PUBLISHED[k], got: got[k], match: PUBLISHED[k] === got[k],
  }));
  return {
    allMatch: results.every((r) => r.match),
    engineBytes: readFileSync(join(HERE, 'lattice117_wasm.wasm')).length,
    package: SERVER_VERSION,
    results,
  };
}

const HANDLERS = {
  verify_fleet: verifyFleetTool,
  verify_rota: verifyRotaTool,
  resequence_round: resequenceRoundTool,
  optimize_toolpath: optimizeToolpathTool,
  self_test: selfTestTool,
};

/** Calls one tool directly. Throws on bad input; the server turns that into isError. */
export async function callTool(name, args = {}) {
  const fn = HANDLERS[name];
  if (!fn) throw new Error(`unknown tool "${name}"`);
  return fn(args);
}

/* ---------------------------------------------------------------------------
   JSON-RPC 2.0 / MCP
--------------------------------------------------------------------------- */

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/**
 * One message in, one response out, or null for a notification. Never throws.
 */
export async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return fail(null, INVALID_REQUEST, 'a message must be a JSON object');
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  // A response from the client (to nothing we sent): ignore it.
  if (msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)) return null;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return hasId ? fail(msg.id ?? null, INVALID_REQUEST, 'expected a JSON-RPC 2.0 request') : null;
  }
  if (!hasId) return null; // notifications/initialized, notifications/cancelled, ...
  const id = msg.id;
  const params = msg.params ?? {};

  switch (msg.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: 'Lattice117 verifier', version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string' || !HANDLERS[name]) {
        return fail(id, INVALID_PARAMS, `unknown tool "${name}"`);
      }
      try {
        const structured = await HANDLERS[name](params.arguments ?? {});
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify(structured) }],
          structuredContent: structured,
          isError: false,
        });
      } catch (e) {
        // A bad plan or bad input is the agent's to fix: say exactly what.
        return reply(id, {
          content: [{ type: 'text', text: `Error: ${e?.message ?? String(e)}` }],
          isError: true,
        });
      }
    }
    default:
      return fail(id, METHOD_NOT_FOUND, `method "${msg.method}" is not supported`);
  }
}

/**
 * One line of the stdio stream in, one line out (or null). Handles a JSON-RPC
 * batch array for clients on older protocol revisions.
 */
export async function handleLine(line) {
  const text = String(line).trim();
  if (!text) return null;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return JSON.stringify(fail(null, PARSE_ERROR, 'not valid JSON'));
  }
  if (Array.isArray(msg)) {
    if (msg.length === 0) return JSON.stringify(fail(null, INVALID_REQUEST, 'empty batch'));
    const out = [];
    for (const m of msg) {
      const r = await handleMessage(m);
      if (r) out.push(r);
    }
    return out.length ? JSON.stringify(out) : null;
  }
  const r = await handleMessage(msg);
  return r ? JSON.stringify(r) : null;
}
