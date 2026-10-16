/**
 * lattice117-mcp: the protocol, the tools, and the agent repair loop.
 *
 * The test that matters most is the loop an agent will actually run: it
 * proposes a plan, the referee refuses it with the stop and the exact
 * deficit, the agent repairs it, and the referee certifies the repair with a
 * digest that matches the published one. If that loop ever certifies a plan
 * the referee would refuse, or refuses with a number that is not the
 * referee's, these tests fail.
 *
 * The second thing pinned here is the compatibility promise: adding the
 * optional load check must not move a single digest for a schedule that does
 * not use it.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const NPM = join(HERE, '..', 'npm');
const read = (f) => readFileSync(join(NPM, f), 'utf8');

/* Every call below runs with fetch replaced. A tool that reached for the
   network would fail loudly here rather than quietly in someone's agent. */
let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls++; throw new Error('lattice117-mcp must not use the network'); };

const mcp = await import(join(NPM, 'mcp.js'));
const lib = await import(join(NPM, 'index.js'));
const { callTool, handleMessage, handleLine, TOOLS, PUBLISHED, routesFromCsv } = mcp;

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
};
const rejects = async (name, fn, re) => {
  try { await fn(); ok(name, false); }
  catch (e) { ok(`${name} (${e.message.slice(0, 70)})`, re ? re.test(e.message) : true); }
};
const call = (id, method, params) => handleMessage({ jsonrpc: '2.0', id, method, params });

/* ── 1. Protocol ──────────────────────────────────────────────────────────── */
console.log('\nProtocol');
{
  const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  ok('initialize echoes a supported protocol version', init.result.protocolVersion === '2025-06-18');
  ok('initialize names the server', init.result.serverInfo.name === 'lattice117-mcp');
  ok('initialize declares tools', typeof init.result.capabilities.tools === 'object');
  const old = await call(2, 'initialize', { protocolVersion: '1999-01-01' });
  ok('an unknown version gets the newest supported one', old.result.protocolVersion === mcp.PROTOCOL_VERSIONS[0]);
  ok('a notification gets no response',
    (await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })) === null);
  ok('ping answers {}', JSON.stringify((await call(3, 'ping')).result) === '{}');
  ok('a response from the client is ignored', (await handleMessage({ jsonrpc: '2.0', id: 9, result: {} })) === null);
  ok('an unknown method is -32601', (await call(4, 'resources/list')).error.code === -32601);
  ok('an unknown tool is -32602',
    (await call(5, 'tools/call', { name: 'rm_rf', arguments: {} })).error.code === -32602);
  ok('bad JSON is -32700 with id null',
    JSON.parse(await handleLine('{not json')).error.code === -32700 &&
    JSON.parse(await handleLine('{not json')).id === null);
  ok('a non-2.0 request is -32600', (await handleMessage({ id: 6, method: 'ping' })).error.code === -32600);
  const batch = JSON.parse(await handleLine(JSON.stringify([
    { jsonrpc: '2.0', id: 'a', method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'b', method: 'ping' },
  ])));
  ok('a batch answers its requests, in order, and not its notifications',
    batch.length === 2 && batch[0].id === 'a' && batch[1].id === 'b');
  ok('a blank line produces nothing', (await handleLine('   ')) === null);

  const list = await call(7, 'tools/list');
  const names = list.result.tools.map((t) => t.name);
  ok('tools/list names the five tools',
    JSON.stringify(names) === JSON.stringify(['verify_fleet', 'verify_rota', 'resequence_round', 'optimize_toolpath', 'self_test']));
  ok('every tool has an object input schema', TOOLS.every((t) => t.inputSchema?.type === 'object'));
  ok('every tool is declared read-only and closed-world',
    TOOLS.every((t) => t.annotations.readOnlyHint === true && t.annotations.openWorldHint === false));
}

/* ── 2. Published digests through the MCP path ───────────────────────────── */
console.log('\nPublished digests, through the tools');
{
  const self = await callTool('self_test');
  ok('self_test: all three published digests match', self.allMatch === true);
  ok('self_test reports the 21,525-byte engine', self.engineBytes === 21525);

  const fleet = routesFromCsv(read('example-route-sheet.csv'));
  const v = await callTool('verify_fleet', { routes: fleet });
  ok('verify_fleet on the fleet fixture gives e249d90e…', v.verdictDigest === PUBLISHED.fleetV1);
  const direct = await lib.verdictDigest(fleet, await lib.verifyFleet(fleet));
  ok('and the same digest as the library called directly', v.verdictDigest === direct);
}

/* ── 3. The agent loop: refused, repaired, re-certified (routing) ──────────── */
console.log('\nAgent loop: a late round');
{
  const [proposed] = routesFromCsv(read('example-fleet-nottingham.csv'));
  const matrixText = read('example-fleet-nottingham-matrix.txt');

  const refused = await callTool('verify_fleet', { routes: [proposed] });
  ok('the proposed round is refused', refused.holds === false);
  ok('the refusal names the first stop that breaks', refused.firstFailure?.stop === 'Chilwell');
  ok('the refusal is a time-window failure', refused.firstFailure?.kind === 'time_window');
  const lib1 = (await lib.verifyFleet([proposed])).routes[0].violation;
  ok('the deficit is the referee\'s own number, exactly',
    refused.firstFailure.raw.deficit === lib1.raw.deficit && refused.firstFailure.deficit === lib1.deficit);
  ok('deficit = arrival - window close, in Q16.16 integers',
    refused.firstFailure.raw.deficit === refused.firstFailure.raw.arrival - refused.firstFailure.raw.windowClose);
  ok('the refusal carries the published "before" digest', refused.verdictDigest === PUBLISHED.nottinghamBefore);

  const repair = await callTool('resequence_round', { route: proposed, matrixText });
  ok('resequence_round searched every order', repair.searched === true);
  ok('it changed the order', repair.changed === true);
  ok('the referee grades the original as refused', repair.before.holds === false);
  ok('and the repair as holding', repair.after.holds === true && repair.after.firstFailure === null);
  ok('the before digest is the published one', repair.before.verdictDigest === PUBLISHED.nottinghamBefore);
  ok('the after digest is the published one', repair.after.verdictDigest === PUBLISHED.nottinghamAfter);

  const recheck = await callTool('verify_fleet', { routes: [repair.repairedRoute] });
  ok('the repaired route, re-verified on its own, holds', recheck.holds === true);
  ok('and re-certifies with the same digest', recheck.verdictDigest === PUBLISHED.nottinghamAfter);

  // The same matrix as a node list and a 2-D array gives the same answer.
  const { matrix, n, names } = (await import(join(NPM, 'resequence.js'))).parseMatrix(matrixText);
  const nodes = [...names.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const times = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => matrix[i * n + j] / 65536));
  const repair2 = await callTool('resequence_round', { route: proposed, matrix: { nodes, times } });
  ok('matrix {nodes, times} gives the same repair as matrixText',
    JSON.stringify(repair2) === JSON.stringify(repair));

  await rejects('a stop missing from the matrix is refused by name',
    () => callTool('resequence_round', {
      route: { id: 'X', stops: [{ id: 'DEPOT', close: 900 }, { id: 'Nowhere', close: 900 }] }, matrixText,
    }), /Nowhere/);
}

/* ── 4. The agent loop: rota ─────────────────────────────────────────────── */
console.log('\nAgent loop: a rota with a short rest');
{
  const rows = readFileSync(join(HERE, '..', 'demo', 'example-rota.csv'), 'utf8')
    .trim().split(/\r?\n/).slice(1).map((l) => l.split(','))
    .map((c) => ({ staff: c[0], date: c[1], start: c[2], end: c[3], break: c[4] }));
  const r = await callTool('verify_rota', { rows });
  ok('verify_rota reproduces the pinned rota digest 83c66e6d…',
    r.rotaDigest === '83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf');
  ok('the rota is refused', r.holds === false);
  const rest = r.breaches.find((b) => b.kind === 'rest');
  ok('the rest breach is Nadia Okafor, 480 min against 660, short by 180',
    rest?.staff === 'Nadia Okafor' && rest.actualMinutes === 480 &&
    rest.expectedMinutes === 660 && rest.shortfallMinutes === 180);
  ok('every result carries the not-legal-advice disclaimer', /not legal advice/i.test(r.disclaimer));

  // The agent moves the early shift back by the shortfall, and gives Tom his break.
  const fixed = rows.map((x) => ({ ...x }));
  const nadia = fixed.findIndex((x) => x.staff === 'Nadia Okafor' && x.date === '2026-09-29');
  fixed[nadia] = { ...fixed[nadia], start: '09:00', end: '17:00' };
  const tom = fixed.findIndex((x) => x.staff === 'Tom Whitmore' && x.date === '2026-09-28');
  fixed[tom] = { ...fixed[tom], break: '20' };
  const r2 = await callTool('verify_rota', { rows: fixed });
  ok('the repaired rota holds', r2.holds === true && r2.breaches.length === 0);
  ok('and its digest differs from the refused one', r2.rotaDigest !== r.rotaDigest);

  const strict = await callTool('verify_rota', { rows: fixed, rules: { restMinutes: 720 } });
  ok('stricter rules are applied and recorded', strict.rules.restMinutes === 720 && strict.holds === false);
  await rejects('an unknown rule is refused', () => callTool('verify_rota', { rows, rules: { naps: 3 } }), /unknown rule/);
}

/* ── 5. Optional vehicle capacity ─────────────────────────────────────────── */
console.log('\nOptional capacity');
{
  const base = {
    id: 'VAN-9',
    stops: [
      { id: 'Depot', close: 600 },
      { id: 'A', travel: 10, close: 600, demand: 40 },
      { id: 'B', travel: 10, close: 600, demand: 30 },
      { id: 'C', travel: 10, close: 600, demand: 50 },
    ],
  };
  const over = await callTool('verify_fleet', { routes: [{ ...base, capacity: 100 }] });
  ok('a load over capacity is refused', over.holds === false);
  ok('at the first stop that takes it over: C, load 120, excess 20',
    JSON.stringify(over.firstFailure) ===
    JSON.stringify({ route: 'VAN-9', kind: 'capacity', stop: 'C', load: 120, capacity: 100, excess: 20 }));
  ok('the time windows still hold on that route', over.routes[0].violation === null);

  const fits = await callTool('verify_fleet', { routes: [{ ...base, vehicleCapacity: 120 }] });
  ok('the same load fits a 120 vehicle (vehicleCapacity alias)', fits.holds === true);
  ok('and its load is reported', JSON.stringify(fits.routes[0].load) === JSON.stringify({ total: 120, capacity: 120 }));
  ok('capacity enters the digest', fits.verdictDigest !== over.verdictDigest);

  await rejects('demand with no capacity is refused, not passed',
    () => callTool('verify_fleet', { routes: [base] }), /states no capacity/);
  await rejects('a fractional demand is refused',
    () => callTool('verify_fleet', { routes: [{ ...base, capacity: 200, stops: [base.stops[0], { ...base.stops[1], demand: 2.5 }] }] }),
    /not a whole number/);
  await rejects('capacity and vehicleCapacity that disagree are refused',
    () => callTool('verify_fleet', { routes: [{ ...base, capacity: 100, vehicleCapacity: 90 }] }), /disagree/);

  // Compatibility: no load fields, no change. The fixture already proved the
  // headline digest; this proves the result object too.
  const plain = { id: 'P', stops: [{ id: 'S', close: 600 }, { id: 'T', travel: 5, close: 600 }] };
  const r = (await lib.verifyFleet([plain])).routes[0];
  ok('a route without loads has no load fields in its result', !('load' in r) && !('capacityViolation' in r));
  const nulls = { ...plain, capacity: null, stops: plain.stops.map((s) => ({ ...s, demand: null })) };
  ok('null load fields count as absent',
    (await lib.verdictDigest([nulls], await lib.verifyFleet([nulls]))) ===
    (await lib.verdictDigest([plain], await lib.verifyFleet([plain]))));
  ok('the canonical form gains loads only when a load is given',
    !lib.canonicalise([plain], [r]).includes('"loads"') &&
    lib.canonicalise([{ ...base, capacity: 100 }], over.routes).includes('"loads"'));
}

/* ── 6. Toolpath ──────────────────────────────────────────────────────────── */
console.log('\nToolpath');
{
  // Four short cuts handed over in a zig-zag order.
  const segments = [
    { id: 'far-right', points: [{ x: 100, y: 0 }, { x: 110, y: 0 }] },
    { id: 'near-left', points: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
    { id: 'mid-right', points: [{ x: 70, y: 0 }, { x: 80, y: 0 }] },
    { id: 'mid-left', points: [{ x: 40, y: 0 }, { x: 50, y: 0 }] },
  ];
  const t = await callTool('optimize_toolpath', { segments });
  ok('optimize_toolpath searched every order', t.searched === true);
  ok('it orders the cuts left to right',
    JSON.stringify(t.orderAfter) === JSON.stringify(['near-left', 'mid-left', 'mid-right', 'far-right']));
  ok('and the rapid travel falls', t.rapidAfterMm < t.rapidBeforeMm && t.savingMm > 0);
  ok('two calls give identical bytes',
    JSON.stringify(await callTool('optimize_toolpath', { segments })) === JSON.stringify(t));
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, points: [{ x: i, y: 0 }, { x: i, y: 1 }] }));
  const big = await callTool('optimize_toolpath', { segments: many });
  ok('more than 8 cuts: not searched, order unchanged, saving 0',
    big.searched === false && big.changed === false && big.savingMm === 0);
  await rejects('two inputs at once are refused',
    () => callTool('optimize_toolpath', { segments, svg: '<svg/>' }), /exactly one/);
}

/* ── 7. Tool errors are results, not crashes ──────────────────────────────── */
console.log('\nErrors');
{
  const bad = await call(20, 'tools/call', { name: 'verify_fleet', arguments: { routes: [] } });
  ok('bad arguments come back as isError, with the reason',
    bad.result?.isError === true && /non-empty/.test(bad.result.content[0].text));
  const big = await call(21, 'tools/call', {
    name: 'verify_fleet',
    arguments: { routes: [{ id: 'X', stops: [{ id: 'a', close: 600 }, { id: 'b', travel: 99999, close: 600 }] }] },
  });
  ok('an out-of-range time is refused by name, not wrapped',
    big.result?.isError === true && /outside the Q16.16/.test(big.result.content[0].text));
  const good = await call(22, 'tools/call', { name: 'self_test', arguments: {} });
  ok('a good call returns text and structured content that agree',
    good.result.isError === false &&
    JSON.stringify(JSON.parse(good.result.content[0].text)) === JSON.stringify(good.result.structuredContent));
}

/* ── 8. No network ────────────────────────────────────────────────────────── */
console.log('\nNo network');
{
  ok('no tool called fetch', fetchCalls === 0);
  const NET = /node:(net|http|https|http2|dgram|dns|tls)\b|\bfetch\s*\(|WebSocket|XMLHttpRequest/;
  for (const f of ['mcp.js', 'bin/lattice117-mcp.mjs', 'resequence.js', 'rota.js', 'toolpath.js', 'digest.js']) {
    ok(`${f} names no network module or call`, !NET.test(read(f)));
  }
  // index.js has one fetch, for browsers loading the WASM over http(s). Under
  // Node the module is a file: URL and that branch is never taken; the
  // fetchCalls count above proves it for every tool.
  const idx = read('index.js');
  ok('index.js fetches only when the module URL is not a file',
    (idx.match(/fetch\s*\(/g) || []).length === 1 && /url\.protocol === 'file:'/.test(idx));
}

/* ── 9. Over stdio, as a client sees it ──────────────────────────────────── */
console.log('\nOver stdio');
{
  const child = spawn(process.execPath, [join(NPM, 'bin', 'lattice117-mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'self_test', arguments: {} } },
  ];
  child.stdin.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const code = await new Promise((res) => child.on('close', res));
  const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
  ok('the server exits cleanly when stdin closes', code === 0);
  ok('three requests, three responses, no notification response', msgs.length === 3);
  ok('responses come back in order', msgs.map((m) => m.id).join(',') === '1,2,3');
  ok('stdout carries only JSON-RPC', msgs.every((m) => m.jsonrpc === '2.0'));
  ok('the session negotiated 2025-03-26', msgs[0].result.protocolVersion === '2025-03-26');
  ok('and self_test matched over the wire', msgs[2].result.structuredContent.allMatch === true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0);
process.exit(fail ? 1 : 0);
