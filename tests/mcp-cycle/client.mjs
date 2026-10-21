/**
 * lattice117-mcp, full cycle, as an agent sees it: the official MCP SDK client
 * (@modelcontextprotocol/sdk, pinned in run.sh) drives the server installed
 * from the packed npm tarball, over stdio. Nothing here imports the server's
 * own code; every check goes through the protocol.
 *
 *   node client.mjs <installed package dir> [--no-network]
 *
 * --no-network runs the server under `unshare -rn` (a namespace with no
 * network at all), so a tool that reached for the network would fail here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pkg = process.argv[2];
const isolated = process.argv.includes('--no-network');
const server = join(pkg, 'bin', 'lattice117-mcp.mjs');
const read = (f) => readFileSync(join(pkg, f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); }
};

const transport = new StdioClientTransport(isolated
  ? { command: 'unshare', args: ['-rn', process.execPath, server], stderr: 'pipe' }
  : { command: process.execPath, args: [server], stderr: 'pipe' });
const client = new Client({ name: 'lattice117-mcp-cycle', version: '1.0.0' });
await client.connect(transport);

// Tool results: structuredContent, which must equal the text content's JSON.
const tool = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content?.[0]?.text ?? 'isError');
  const fromText = JSON.parse(r.content[0].text);
  if (JSON.stringify(fromText) !== JSON.stringify(r.structuredContent)) throw new Error(`${name}: text and structuredContent differ`);
  return r.structuredContent;
};
const toolError = async (name, args) => {
  try { const r = await client.callTool({ name, arguments: args }); return r.isError ? r.content[0].text : null; }
  catch (e) { return `protocol error ${e.code}: ${e.message}`; }
};

console.log(`\nHandshake${isolated ? ' (server in a namespace with no network)' : ''}`);
const info = client.getServerVersion();
ok(`server identifies as ${info?.name} ${info?.version}`, info?.name === 'lattice117-mcp' && /^\d+\.\d+\.\d+/.test(info?.version ?? ''));
ok('it offers tools', !!client.getServerCapabilities()?.tools);
ok('it gives instructions to the agent', /verify_fleet/.test(client.getInstructions() ?? ''));
await client.ping();
ok('ping answers', true);

console.log('\nTools');
const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
ok(`tools/list: ${names.join(', ')}`,
  JSON.stringify(names) === JSON.stringify(['verify_fleet', 'verify_rota', 'resequence_round', 'optimize_toolpath', 'self_test']));
ok('every tool is read-only and closed-world',
  tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.openWorldHint === false));

console.log('\nPublished digests');
const self = await tool('self_test');
ok('self_test: every published digest matches, 21,525-byte engine', self.allMatch === true && self.engineBytes === 21525);
// The client parses the fixtures itself (vehicle, seq, stop, window_open,
// window_close, travel_mins_from_previous[, depart]); it does not borrow the
// package's CSV helper.
const routesFrom = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.trim());
  const at = (c, n) => c[head.indexOf(n)];
  const byVehicle = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const v = at(c, 'vehicle').trim();
    if (!byVehicle.has(v)) byVehicle.set(v, { id: v, depart: head.includes('depart') ? at(c, 'depart') : 0, stops: [] });
    byVehicle.get(v).stops.push({ seq: Number(at(c, 'seq')), id: at(c, 'stop').trim(),
      open: at(c, 'window_open'), close: at(c, 'window_close'), travel: at(c, 'travel_mins_from_previous') });
  }
  return [...byVehicle.values()].map((r) => ({ ...r,
    stops: r.stops.sort((a, b) => a.seq - b.seq).map(({ seq, ...stop }) => stop) }));
};
const routes = routesFrom(read('example-route-sheet.csv'));
const fleet = await tool('verify_fleet', { routes });
ok(`verify_fleet, route-sheet fixture: ${fleet.verdictDigest.slice(0, 8)}… (published e249d90e…)`,
  fleet.verdictDigest === 'e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d');
const again = await tool('verify_fleet', { routes });
ok('the same call twice gives identical bytes', JSON.stringify(again) === JSON.stringify(fleet));

console.log('\nAgent loop: refused, repaired, re-certified');
const [proposed] = routesFrom(read('example-fleet-nottingham.csv'));
const refused = await tool('verify_fleet', { routes: [proposed] });
ok(`refused at ${refused.firstFailure?.stop}, ${refused.firstFailure?.kind}, deficit ${refused.firstFailure?.deficit}`,
  refused.holds === false && refused.firstFailure?.stop === 'Chilwell' && refused.firstFailure?.kind === 'time_window');
ok('deficit = arrival - window close, in Q16.16 integers',
  refused.firstFailure.raw.deficit === refused.firstFailure.raw.arrival - refused.firstFailure.raw.windowClose);
ok('the refusal carries the published "before" digest da1650fc…',
  refused.verdictDigest === 'da1650fc0e63e26eba33913f25f24fb9fbdc78ce4c55549279cb9582d3119993');
const repair = await tool('resequence_round', { route: proposed, matrixText: read('example-fleet-nottingham-matrix.txt') });
ok('resequence_round searched every order and changed it', repair.searched === true && repair.changed === true);
ok('the repair holds, with the published "after" digest 2b9d863c…',
  repair.after.holds === true && repair.after.verdictDigest === '2b9d863c5ab89a90a2416a9a708ce09fa8876b6d8d91e58199696181e7da7b15');
const recheck = await tool('verify_fleet', { routes: [repair.repairedRoute] });
ok('the repaired route, re-verified on its own, holds with the same digest',
  recheck.holds === true && recheck.verdictDigest === repair.after.verdictDigest);

console.log('\nCapacity');
const base = { id: 'VAN-9', stops: [
  { id: 'Depot', close: 600 }, { id: 'A', travel: 10, close: 600, demand: 40 },
  { id: 'B', travel: 10, close: 600, demand: 30 }, { id: 'C', travel: 10, close: 600, demand: 50 }] };
const over = await tool('verify_fleet', { routes: [{ ...base, capacity: 100 }] });
ok('120 units on a 100 vehicle: refused at C, excess 20',
  over.holds === false && over.firstFailure?.kind === 'capacity' && over.firstFailure?.stop === 'C' && over.firstFailure?.excess === 20);
const fits = await tool('verify_fleet', { routes: [{ ...base, capacity: 120 }] });
ok('the same load on a 120 vehicle holds, with a different digest', fits.holds === true && fits.verdictDigest !== over.verdictDigest);

console.log('\nRota');
const rota = await tool('verify_rota', { rows: [
  { staff: 'A. Shift', date: '2026-09-28', start: '14:00', end: '22:00', break: '30' },
  { staff: 'A. Shift', date: '2026-09-29', start: '06:00', end: '14:00', break: '30' }] });
ok(`verify_rota: an 8-hour rest is refused, short by ${rota.breaches?.find((b) => b.kind === 'rest')?.shortfallMinutes} min`,
  rota.holds === false && rota.breaches.some((b) => b.kind === 'rest' && b.shortfallMinutes === 180) && /not legal advice/i.test(rota.disclaimer));
const rested = await tool('verify_rota', { rows: [
  { staff: 'A. Shift', date: '2026-09-28', start: '14:00', end: '22:00', break: '30' },
  { staff: 'A. Shift', date: '2026-09-29', start: '09:00', end: '17:00', break: '30' }] });
ok('moved to an 11-hour rest, it holds', rested.holds === true && rested.rotaDigest !== rota.rotaDigest);

console.log('\nToolpath');
const toolpath = await tool('optimize_toolpath', { segments: [
  { id: 'far-right', points: [{ x: 100, y: 0 }, { x: 110, y: 0 }] },
  { id: 'near-left', points: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
  { id: 'mid-right', points: [{ x: 70, y: 0 }, { x: 80, y: 0 }] },
  { id: 'mid-left', points: [{ x: 40, y: 0 }, { x: 50, y: 0 }] }] });
ok(`optimize_toolpath: ${toolpath.orderAfter?.join(' > ')}, saving ${toolpath.savingMm} mm`,
  toolpath.searched === true && toolpath.savingMm > 0 &&
  JSON.stringify(toolpath.orderAfter) === JSON.stringify(['near-left', 'mid-left', 'mid-right', 'far-right']));

console.log('\nErrors are answers, and the server stays up');
const e1 = await toolError('rm_rf', {});
ok(`an unknown tool is refused (${e1?.slice(0, 50)})`, !!e1);
const e2 = await toolError('verify_fleet', { routes: [] });
ok(`bad arguments come back as an error result (${e2?.slice(0, 50)})`, !!e2 && /non-empty/.test(e2));
const e3 = await toolError('verify_fleet', { routes: [{ ...base }] });
ok(`demand with no capacity is refused, not passed (${e3?.slice(0, 50)})`, !!e3 && /no capacity/.test(e3));
await client.ping();
ok('the server still answers after the errors', true);

await client.close();
console.log(`\nmcp-cycle: ${pass} passed, ${fail} failed${isolated ? ' (server had no network)' : ''}`);
process.exit(fail ? 1 : 0);
