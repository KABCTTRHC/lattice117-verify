# Open issues: lattice117-verify

17 November 2026.

| # | Issue | State |
|---|---|---|
| V1 | 0.3.0, with the MCP server, is built and tested but not published; npm's `latest` is 0.2.3 | Open: the owner's decision D1 |
| V2 | No outside user has run a real schedule through the verifier yet | Open: the TRL 7 gate |
| V3 | The MCP server has been built and tested on our own machines only; it has not been published or used by an outside agent. Every mention must say so | Open, with V1 |
| V4 | The no-network pass of the MCP full-cycle test is skipped on GitHub's runners; it runs locally | Accepted; recorded in the README (`4db4507`) |
| V5 | GitHub Actions jobs here fail before any step runs. On 16 Nov all six CI jobs and the Pages job on `7b43e3d` (documentation only) failed within two seconds (run 43847249670). It is the account-level block recorded in `sovereign_api` as U15; the code is unchanged since `4db4507`, green on 21 Oct, and `cargo test` passes locally | Open: the owner (GitHub billing settings, then GitHub Support) |
| V6 | §8 of the white paper says "every digest in it was produced by us". The first outside reproduction is reported, not yet on record. Passed on by the owner on 17 Nov: an independent engineer, in a private message, reports running `lattice117-verify reproduce` on his own Windows x86-64 machine. All three digests matched bit for bit: the example route sheet, and the Nottingham Tier 5 schedule before and after re-sequencing (99.6 to 60.2 min), with the ~21.5 KB module. We hold his message, not his output | Reported. Closes when his output is on record: a reproduction report (`REPRODUCE.md`), or his output filed with his consent. Until then §8 and `REPRODUCE.md` stay as written. V2 stays open: he ran the fixtures, not a schedule of his own |
