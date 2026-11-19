# Open issues: lattice117-verify

19 November 2026.

| # | Issue | State |
|---|---|---|
| V1 | 0.3.0, with the MCP server, was built and tested but not published | **Closed 19 Nov.** Published as `latest`; checked from the registry (`docs/RELEASES.md`) |
| V2 | No outside user has run a real schedule through the verifier yet | Open: the TRL 7 gate |
| V3 | The MCP server has been tested on our own machines only. It is published (0.3.0, 19 Nov) but no outside agent is known to have used it. Every mention must say so | Open |
| V4 | The no-network pass of the MCP full-cycle test is skipped on GitHub's runners; it runs locally | Accepted; recorded in the README (`4db4507`) |
| V5 | GitHub Actions jobs here fail before any step runs. On 16 Nov all six CI jobs and the Pages job on `7b43e3d` (documentation only) failed within two seconds (run 43847249670). It is the account-level block recorded in `sovereign_api` as U15; the code is unchanged since `4db4507`, green on 21 Oct, and `cargo test` passes locally. Pages: no deploy since 21 Oct (`4db4507`); runs 59 to 64 (16 to 17 Nov) failed within seconds. The site's files (`demo/`, `excel-addin/`) have not changed since 16 Oct, so the live site is current (checked 18 Nov), but no change can go live until Actions runs | Open: the owner (GitHub billing settings, then GitHub Support) |
| V6 | §8 of the white paper said "every digest in it was produced by us" | **Closed 17 Nov.** The first outside reproduction is on record: Basit Tijani (named with his consent) ran `lattice117-verify reproduce` 0.2.3 on his own Windows x64 PC (Intel Core i7-8665U, Node v24.21.0), all three digests matching bit for bit. His output and screenshot are in `docs/reproductions/`; §8 and `REPRODUCE.md` are updated. V2 stays open: he ran the fixtures, not a schedule of his own |
