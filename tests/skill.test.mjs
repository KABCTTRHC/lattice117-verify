// The agent skill in skills/schedule-feasibility-check must not drift from
// the engine it describes. Every tool it names must exist in lattice117-mcp
// and every tool the server offers must be documented; every set-up template
// must pin the package version in npm/package.json; and every worked example
// must still give the summary and digest it promises.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TOOLS, handleLine } from '../npm/mcp.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'skills', 'schedule-feasibility-check');
const skill = readFileSync(join(dir, 'SKILL.md'), 'utf8');
const version = JSON.parse(readFileSync(join(root, 'npm', 'package.json'), 'utf8')).version;

test('SKILL.md frontmatter follows the agent skills format', () => {
  const fm = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, 'frontmatter present');
  const name = fm[1].match(/^name:\s*(\S+)\s*$/m)?.[1];
  const description = fm[1].match(/^description:\s*(.+)$/m)?.[1];
  assert.equal(name, 'schedule-feasibility-check');
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(name.length <= 64);
  assert.ok(description && description.length <= 1024, `description is ${description?.length} characters`);
  assert.match(description, /lattice117-verify/, 'the description states the MCP requirement');
});

test('every server tool is documented, and nothing else is', () => {
  const offered = TOOLS.map((t) => t.name).sort();
  const documented = [...skill.matchAll(/^### `([a-z_]+)`/gm)].map((m) => m[1]).sort();
  assert.deepEqual(documented, offered);
});

test('the set-up lines pin the package version being published', () => {
  const pin = `lattice117-verify@${version}`;
  for (const f of readdirSync(join(dir, 'mcp'))) {
    assert.ok(readFileSync(join(dir, 'mcp', f), 'utf8').includes(pin), `${f} pins ${pin}`);
  }
  assert.ok(skill.includes(`claude mcp add lattice117 -- npx -y -p ${pin} lattice117-mcp`));
  const pinned = [...skill.matchAll(/lattice117-verify@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  assert.ok(pinned.length > 0 && pinned.every((v) => v === version), `every pin is ${version}`);
});

test('every worked example gives the summary and digest it promises', async () => {
  let id = 0;
  for (const f of readdirSync(join(dir, 'examples')).sort()) {
    const ex = JSON.parse(readFileSync(join(dir, 'examples', f), 'utf8'));
    const out = await handleLine(JSON.stringify({
      jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: ex.tool, arguments: ex.arguments },
    }));
    const r = JSON.parse(JSON.parse(out).result.content[0].text);
    assert.equal(r.summary, ex.expect.summary, f);
    for (const k of ['verdictDigest', 'rotaDigest']) {
      if (ex.expect[k]) assert.equal(r[k], ex.expect[k], `${f} ${k}`);
    }
    if (ex.expect.orderAfter) {
      assert.deepEqual(r.orderAfter, ex.expect.orderAfter, f);
      assert.equal(r.before.verdictDigest, ex.expect.beforeDigest, f);
      assert.equal(r.after.verdictDigest, ex.expect.afterDigest, f);
    }
  }
});

test('the digests quoted in SKILL.md are the ones the examples produce', () => {
  const late = JSON.parse(readFileSync(join(dir, 'examples', 'route-late.json'), 'utf8'));
  assert.ok(skill.includes(late.expect.verdictDigest.slice(0, 8)), 'route-late digest prefix');
  for (const d of ['e249d90e', 'da1650fc', '2b9d863c']) assert.ok(skill.includes(d), `published digest ${d}`);
});
