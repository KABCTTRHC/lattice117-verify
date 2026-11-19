# Agensi listing: Schedule feasibility check

**Status, 19 November 2026:** listed, free, through Agensi's own MCP server
from the owner's Claude Code: https://agensi.io/skills/schedule-feasibility-check
(its status shows on the Agensi dashboard). `lattice117-verify@0.3.0` is on npm
(`docs/RELEASES.md`), and the listed skill carries the native-Windows set-up
line (zip SHA-256 `898f1161…`). Agensi's terms, from its
email of 16 November: a skill is a zip with `SKILL.md` at the root;
Agensi does not host MCP servers, so the skill carries the instructions and a
config template and states the requirement plainly; a free listing needs no
Stripe Connect; paid listings split 70/30 with Stripe fees on Agensi; Agensi
(Netherlands) is merchant of record and remits sales taxes; listing is
non-exclusive, transfers no IP, and can be updated or removed at any time.

agensi.io could not be opened from the build machine, so the field names below
follow the email and the usual listing form. Match them to the form at
agensi.io/sell when you fill it in.

## The steps

1. Publish the package: `cd npm && npm publish` (the `prepublishOnly` script
   re-derives the three digests first). Check with
   `npx -y -p lattice117-verify@0.3.0 lattice117-mcp` in an empty folder.
2. Build the zip: `python3 tools/build_skill_zip.py skills/schedule-feasibility-check`.
   It writes `target/skills/schedule-feasibility-check.zip` and prints its
   SHA-256. The same files always give the same bytes.
3. At agensi.io/sell: create the listing with the text below, upload the zip,
   price it at **free**, and submit.
4. When it is live, add the listing link to the repository README and reply
   to Agensi with it.

## The listing text

**Title:** Schedule Feasibility Check

**Short description** (one line):
Ask your agent "does this schedule work?" and get a checked answer: the first
stop that breaks, by exactly how much, and a digest anyone can re-check.

**Description:**

> Agents are good at producing schedules and bad at noticing that stop 7 is
> reached after its window closes. This skill hands the question to a
> deterministic referee instead of letting the model judge it.
>
> Give it routes with time windows (and vehicle capacity, if you have it).
> It re-derives every arrival with exact integer arithmetic and tells you
> which routes hold, the first stop that breaks, the exact deficit, and a
> SHA-256 digest of the inputs and verdict. Identical inputs give the
> identical digest on any machine, so a colleague, customer or auditor can
> confirm the same answer later.
>
> It can also re-order one round (up to 8 interior stops, searched
> exhaustively) so it holds, check a staff rota against rest and break
> thresholds (indicative arithmetic, not legal advice), and order the cuts of
> an SVG or G-code job to cut rapid travel.
>
> **Requires** the free `lattice117-mcp` server from the npm package
> `lattice117-verify` (Node.js 18+). Set-up is one line for Claude Code and a
> copy-paste config for Claude Desktop, Cursor and VS Code with Copilot, all
> included. The server runs on your machine over stdio: no account, no API
> key, no network calls, no telemetry.
>
> **What it does not do:** it checks the travel times, windows and loads you
> give it. It does not know about traffic, unlisted service times or drivers'
> hours law, and apart from re-ordering one round it does not optimise.

**Category:** Operations / Scheduling (or the nearest: Logistics, Data
validation).

**Tags:** scheduling, routing, time windows, feasibility, logistics, delivery,
rota, MCP, verification, deterministic

**Price:** Free.

**Version:** 1.0.0 (skill), for `lattice117-verify` 0.3.0.

**Licence:** AGPL-3.0-or-later; a commercial licence is available for
closed-source use of the package.

**Requirements field:** Node.js 18 or newer; an agent that runs local MCP
servers over stdio.

**Support:** GitHub issues on `KABCTTRHC/lattice117-verify`.

**Screenshots, if the form takes them:** a terminal showing the `verify_fleet`
answer for `examples/route-late.json` ("Route R1 reaches stop B at 55, but its
window closes at 50: 5 late.") and `self_test` with `allMatch: true`.

## Before submitting

- [x] `lattice117-verify@0.3.0` is on npm, and the set-up line works in an
      empty folder (19 Nov).
- [ ] `node tests/skill.test.mjs` passes (CI runs it on every push).
- [ ] The zip's SHA-256 is noted here when it is uploaded:
      `898f116196e19bfaab1504a3569f1db7f2dabd95bdbb3a85c102203856640b35`
      (19 Nov, after adding the native-Windows `cmd /c` line for Claude Code;
      the build gives the same bytes every time).
- [ ] Your affiliate link from Agensi is saved; use it when you share the
      listing.
