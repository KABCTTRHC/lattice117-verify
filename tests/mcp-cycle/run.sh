#!/usr/bin/env bash
# lattice117-mcp, full cycle: pack the npm package, install the tarball into an
# empty project, and drive the installed server over stdio with the official
# MCP SDK client (client.mjs). Then a raw session: stdout must carry only
# JSON-RPC, and end of input must end the server with exit 0.
#
#   bash tests/mcp-cycle/run.sh            (needs npm and the npm registry)
#
# Where unprivileged namespaces are allowed (unshare -rn), the server also runs
# with no network at all.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
SDK_VERSION=1.32.1
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

(cd "$root/npm" && npm pack --silent --pack-destination "$work" > "$work/packed.txt")
tarball="$work/$(tail -n 1 "$work/packed.txt")"
echo "packed:    $(basename "$tarball") ($(wc -c < "$tarball") bytes)"
mkdir -p "$work/agent" && cd "$work/agent"
npm init -y > /dev/null
npm install --silent --no-audit --no-fund "$tarball" "@modelcontextprotocol/sdk@$SDK_VERSION" > /dev/null
pkg="$work/agent/node_modules/lattice117-verify"
echo "installed: lattice117-verify $(node -p "require('$pkg/package.json').version"), MCP SDK $SDK_VERSION"
cp "$here/client.mjs" .

fail=0
node client.mjs "$pkg" || fail=1
if unshare -rn true 2>/dev/null; then
  node client.mjs "$pkg" --no-network || fail=1
else
  echo "(unshare -rn not permitted here: the no-network run is skipped)"
fi

# Raw stdio: three requests, then end of input.
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"raw","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"self_test","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"no/such/method"}' \
  | node "$pkg/bin/lattice117-mcp.mjs" > raw.out 2> raw.err; code=$?
lines=$(wc -l < raw.out)
if [ "$code" = 0 ] && [ "$lines" = 3 ] && node -e '
  const r = require("fs").readFileSync("raw.out", "utf8").trim().split("\n").map(JSON.parse);
  process.exit(r[0].id === 1 && r[1].id === 2 && r[1].result.structuredContent.allMatch === true
    && r[2].id === 3 && r[2].error.code === -32601 ? 0 : 1);'; then
  echo "  PASS  raw stdio: 3 answers for 3 requests (none for the notification), only JSON on stdout, exit 0 at end of input"
else
  echo "  FAIL  raw stdio: exit $code, $lines line(s) on stdout"; cat raw.out raw.err; fail=1
fi
[ "$fail" = 0 ] && echo "mcp-cycle: ALL PASS"
exit "$fail"
