# Tracking: lattice117-verify

Updated 16 November 2026.

## Landed

| Date | What | Record |
|---|---|---|
| 21 Oct | README: the no-network pass of the MCP full cycle is skipped on GitHub's runners | `4db4507` |
| 16 Oct | `lattice117-mcp`, a stdio MCP server with five tools (`verify_fleet`, `verify_rota`, `resequence_round`, `optimize_toolpath`, `self_test`); 79 checks in `tests/mcp.test.mjs` | `4cc3eee`; `sovereign_api` `docs/SELLABLE-CLAIMS.md` 15.1 |
| 16 Oct | The capacity check: the first stop over capacity is named with the excess | `sovereign_api` `docs/SELLABLE-CLAIMS.md` 15.2 |
| 12 Oct | `lattice117-verify@0.2.3` published to npm as `latest`; 0.2.2 deprecated | `sovereign_api` `docs/engineering-record/OPEN-ISSUES.md` U10 |

Tests at 13 November: 87 Rust tests and 585 JavaScript checks
(`sovereign_api` `docs/engineering-record/TEST-CENSUS.md`).

## In progress

| Item | State | Waiting on |
|---|---|---|
| Publish 0.3.0, with the MCP server (decision D1) | `npm/package.json` is at 0.3.0, built and tested; npm's `latest` is 0.2.3 | The owner's yes |

## Next

* The first outside user running a real schedule (the TRL 7 gate).
* After D1: an outside agent using the MCP server.
