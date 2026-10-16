#!/usr/bin/env node
/**
 * lattice117-mcp — Model Context Protocol server over stdio.
 *
 *   npx -p lattice117-verify lattice117-mcp
 *
 * Add it to an MCP client (Claude Desktop, Claude Code, an agent framework) as
 * a stdio server with that command. It reads newline-delimited JSON-RPC 2.0 on
 * stdin and writes one response per request on stdout. Nothing else is ever
 * written to stdout, and it opens no socket: the tools are in `../mcp.js`.
 */
import { createInterface } from 'node:readline';
import { handleLine } from '../mcp.js';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

// Requests are answered in the order they arrive.
let queue = Promise.resolve();
rl.on('line', (line) => {
  queue = queue.then(async () => {
    const out = await handleLine(line);
    if (out) process.stdout.write(out + '\n');
  });
});
rl.on('close', () => {
  queue.then(() => process.exit(0));
});
