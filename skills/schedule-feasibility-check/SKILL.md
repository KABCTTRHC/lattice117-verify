---
name: schedule-feasibility-check
description: Check whether a delivery route, visit round or staff rota actually works before anyone acts on it. Re-derives every arrival against every time window (and vehicle capacity when given) with exact integer arithmetic, names the first stop that breaks and by how much, and returns a SHA-256 digest anyone can recompute to confirm the same verdict. Can also re-order one round so it holds, and check a rota against rest and break thresholds. Use when a user or agent proposes a schedule, route, round or rota and asks whether it is feasible, or before a plan is sent to drivers or staff. Requires the free lattice117-mcp server from the npm package lattice117-verify (Node.js 18 or newer), which the user installs once; it runs locally with no account and no telemetry.
license: AGPL-3.0-or-later
compatibility: Needs Node.js 18+ and an agent that can run a local MCP server over stdio (Claude Code, Claude Desktop, Cursor, VS Code with Copilot, and others).
metadata:
  author: Brierley Sovereign Group Ltd
  version: "1.0.0"
  mcp-server: "lattice117-verify@0.3.0 (bin: lattice117-mcp)"
  homepage: https://github.com/KABCTTRHC/lattice117-verify
---

# Schedule feasibility check

This skill turns "does this schedule work?" into a checked answer. The agent
does not judge feasibility itself. It sends the schedule to a deterministic
referee, the `lattice117-mcp` server, and reports what the referee found: which
routes hold, the first stop that breaks, by exactly how much, and a digest of
the inputs and the verdict.

## Requirement: install the MCP server once

This skill needs the `lattice117-mcp` server, which ships in the npm package
`lattice117-verify`. The skill does not bundle it. It runs on the user's own
machine over stdio. It opens no socket and sends nothing anywhere; `npx`
downloads the package once.

- **Claude Code:** `claude mcp add lattice117 -- npx -y -p lattice117-verify@0.3.0 lattice117-mcp`
  (on native Windows, not WSL, start it through `cmd /c`:
  `claude mcp add lattice117 -- cmd /c npx -y -p lattice117-verify@0.3.0 lattice117-mcp`)
- **Claude Desktop, Cursor:** add `mcp/claude-desktop.json` (or `mcp/cursor.json`)
  to the client's MCP settings. On Windows, use `mcp/windows-claude-desktop.json`.
- **VS Code with Copilot:** put `mcp/vscode-copilot.json` in `.vscode/mcp.json`.
- **Any other MCP client:** a stdio server started with
  `npx -y -p lattice117-verify@0.3.0 lattice117-mcp`.

Then call `self_test` once. It re-derives the three published digests from
the bundled fixtures; `allMatch: true` means this installation computes what
the published engine computes. If the tools are missing, tell the user the
server is not installed and show the line for their agent. Do not judge
feasibility by hand instead.

## When to use it

- Someone proposes or pastes a route, delivery run, visit round, shift
  pattern or rota and asks whether it works.
- An agent (you included) has produced a plan with times and windows, and it
  is about to be sent to people who will act on it.
- A plan failed and the user wants the earliest feasible order of one round.
- The user wants a record that someone else can re-check later.

## The tools

All five are read-only and deterministic: the same input gives the same
output, digest included, on any machine.

### `verify_fleet`: routes against their time windows

Input: `routes`, each with `id`, optional `depart` (default 0), optional
`capacity`, and `stops` in visit order. Each stop has `id`, `close` (the
latest allowed arrival), optional `open` (default 0), `travel` (time from the
previous stop; ignored on the first stop) and optional whole-number `demand`
(needs a route `capacity`).

Output: `holds` (true only if every route holds), per-route results,
`firstFailure` (route, stop, arrival, window close, deficit; or load,
capacity, excess), a plain `summary` sentence and `verdictDigest`.

Example (`examples/route-late.json`): stop B is reached at 55 and its window
closes at 50. The referee answers "Route R1 reaches stop B at 55, but its
window closes at 50: 5 late.", with digest `cdd2e750…`.

### `resequence_round`: repair the order of one round

Input: one `route` (first and last stops stay fixed) and a travel-time
`matrix` (`nodes` and `times`) or `matrixText`. It searches every order of up
to 8 interior stops, preferring orders that hold over cheaper ones, then has
the referee grade both the original and the best order. Output: both
verdicts and digests, `orderAfter`, and `repairedRoute`, ready to pass back to
`verify_fleet`.

Example (`examples/resequence-round.json`): Depot, A, B, End is refused (B is
5 late); Depot, B, A, End holds.

### `verify_rota`: rest and break thresholds

Input: `rows` with `staff`, `date`, `start`, `end` and `break` minutes;
optional `rules` (`restMinutes`, `longShiftMinutes`, `breakMinutes`; defaults
660, 360 and 20). Output: every breach with the exact shortfall in minutes,
and `rotaDigest`. This is an arithmetic check against thresholds, **not legal
advice**: say so whenever you report it.

### `optimize_toolpath`: cut order for a cutter or plotter

Input: SVG (`<path>` with M/L/H/V/Z), G-code (G0/G1) or `segments`, in
millimetres. Output: the cut order with the least rapid travel, searched
exhaustively up to 8 cuts. Cuts are never reversed, so the saving is a lower
bound.

### `self_test`: confirm the installation

No input. Re-derives the three published digests (`e249d90e…`, `da1650fc…`,
`2b9d863c…`) and reports `allMatch`.

## Rules for the agent

1. **Never call a schedule feasible without the referee.** Call
   `verify_fleet` (or `verify_rota`) and quote its `summary` and digest.
2. **Pass the numbers as given.** All times on a route are in one unit
   (usually minutes). Do not round, convert or "tidy" them; the referee works
   in fixed point to 1/65,536 of a unit and its `raw` fields show the exact
   integers it used.
3. **Report the first failure precisely:** route, stop, arrival, window
   close and deficit. If a matrix is available, offer `resequence_round`, then
   run `verify_fleet` on the repaired route before presenting it.
4. **Keep the digest.** Identical inputs give the identical digest anywhere;
   a different digest means different inputs or a different verdict.
5. **Stay inside what was checked.** The referee checks the travel times,
   windows and capacities it is given. It knows nothing about traffic,
   service times that were not included, drivers' hours law or anything else
   not in the input. Say what was checked, not more.

## Limits

- Feasibility is checked, not optimised: apart from `resequence_round`
  (one round, up to 8 interior stops), nothing searches for a better plan.
- Results are only as good as the inputs; garbage travel times give a
  confident verdict about garbage.
- The rota check is indicative arithmetic, not employment-law advice.

## About

`lattice117-verify` is published by Brierley Sovereign Group Ltd under
AGPL-3.0-or-later, with a commercial licence for closed-source use. Source,
white paper and the reproduction steps:
https://github.com/KABCTTRHC/lattice117-verify
