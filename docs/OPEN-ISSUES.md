# Open issues: lattice117-verify

16 November 2026.

| # | Issue | State |
|---|---|---|
| V1 | 0.3.0, with the MCP server, is built and tested but not published; npm's `latest` is 0.2.3 | Open: the owner's decision D1 |
| V2 | No outside user has run a real schedule through the verifier yet | Open: the TRL 7 gate |
| V3 | The MCP server has been built and tested on our own machines only; it has not been published or used by an outside agent. Every mention must say so | Open, with V1 |
| V4 | The no-network pass of the MCP full-cycle test is skipped on GitHub's runners; it runs locally | Accepted; recorded in the README (`4db4507`) |
| V5 | GitHub Actions jobs here fail before any step runs. On 16 Nov all six CI jobs and the Pages job on `7b43e3d` (documentation only) failed within two seconds (run 43847249670). It is the account-level block recorded in `sovereign_api` as U15; the code is unchanged since `4db4507`, green on 21 Oct, and `cargo test` passes locally | Open: the owner (GitHub billing settings, then GitHub Support) |
