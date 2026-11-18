# Tracking: lattice117-verify

Updated 18 November 2026.

## Landed

| Date | What | Record |
|---|---|---|
| 18 Nov | The 18 Nov test gauntlet: 87 Rust tests (1 ignored) and 590 JavaScript checks pass; the skill zip builds byte-identical twice; the MCP full cycle 24 of 24; `npx -y lattice117-verify reproduce` (0.2.3) gives 3 of 3 digests; the six demo pages pass in Chromium (no errors; the round's fix and the Nottingham story give the CLI's results). The Pages deploys have failed since 16 Nov (V5), but the site's files are unchanged since 16 Oct, so the live site is current | `sovereign_api` `docs/ALIGNMENT-2026-11-18.md` §5–6 |
| 17 Nov | Agent skill `schedule-feasibility-check` for Agensi and other skill hubs, with `tests/skill.test.mjs` (5 checks) and a reproducible zip | `a31e32f`; `docs/AGENSI-LISTING.md` |
| 17 Nov | The first outside reproduction on record: 3 of 3 digests on Windows x64; white paper section 8 updated | `3a71a57`, `759cf1a`; `docs/reproductions/` |
| 21 Oct | README: the no-network pass of the MCP full cycle is skipped on GitHub's runners | `4db4507` |
| 16 Oct | `lattice117-mcp`, a stdio MCP server with five tools (`verify_fleet`, `verify_rota`, `resequence_round`, `optimize_toolpath`, `self_test`); 79 checks in `tests/mcp.test.mjs` | `4cc3eee`; `sovereign_api` `docs/SELLABLE-CLAIMS.md` 15.1 |
| 16 Oct | The capacity check: the first stop over capacity is named with the excess | `sovereign_api` `docs/SELLABLE-CLAIMS.md` 15.2 |
| 12 Oct | `lattice117-verify@0.2.3` published to npm as `latest`; 0.2.2 deprecated | `sovereign_api` `docs/engineering-record/OPEN-ISSUES.md` U10 |

Tests at 18 November: 87 Rust tests and 590 JavaScript checks (the
13 November census had 585; the skill's test added 5). History:
`sovereign_api` `docs/engineering-record/TEST-CENSUS.md`.

## In progress

| Item | State | Waiting on |
|---|---|---|
| Publish 0.3.0, with the MCP server (decision D1) | `npm/package.json` is at 0.3.0, built and tested; npm's `latest` is 0.2.3 | The owner's yes |
| Pages deploys (V5) | None since 21 Oct: every run since 16 Nov fails before any step. The live site is current, since its files have not changed | The owner: the account's Actions settings (`sovereign_api` U15) |

## Next

* The first outside user running a real schedule (the TRL 7 gate).
* After D1: an outside agent using the MCP server.
