# The skills pipeline, version 2: the upgrade

**Written:** 17 November 2026. **Starts when:** version 1 is live, meaning
`lattice117-verify@0.3.0` is on npm and the free Schedule Feasibility Check is
listed on Agensi (`docs/AGENSI-LISTING.md`).

## Where version 1 leaves us

| Piece | State |
|---|---|
| `lattice117-mcp`, five read-only tools | Built, tested in CI (in-process, packed tarball, official SDK client); ships in 0.3.0 |
| The skill `skills/schedule-feasibility-check` | `SKILL.md`, set-up for five clients, five worked examples |
| Drift test `tests/skill.test.mjs` | Tool names, version pins, example outputs and quoted digests checked on every push |
| Zip builder `tools/build_skill_zip.py` | Reproducible: same files, same bytes, same SHA-256 |
| Distribution | One free listing on Agensi |

Version 1 is a hand-built, hand-listed free skill. Version 2 makes the
pipeline repeatable, adds paid skills that use only what the engine already
does, and measures what happens.

## The upgrade, in five parts

### 1. One command from tag to release

- A tag `skill-<name>-v<version>` makes CI run `tests/skill.test.mjs`, build
  the zip with `tools/build_skill_zip.py`, and attach the zip and its SHA-256
  to a GitHub release.
- The listing is then updated by hand on Agensi with that exact zip; the
  release notes carry the hash, so anyone can check that the listed zip is the
  released one.
- A version table in `skills/README.md` records which skill version needs
  which package version. The drift test already fails if a skill pins a
  package version other than the one in `npm/package.json`.

### 2. Paid skills, built only on existing tools

Each one is a new `SKILL.md` and examples over the same five tools: no new
engine code, and so no new claims to evidence.

| Skill | What the agent does | Built on | Suggested price, to test |
|---|---|---|---|
| **Fleet Audit Report** | Checks a whole fleet from a CSV, writes a dated audit report with every verdict, each first failure and the digests, ready to file | `verify_fleet`, `self_test` | £19 one-off |
| **Round Repair** | Refused rounds are re-ordered one by one (up to 8 interior stops each), every repair re-verified, with a before-and-after table | `resequence_round`, `verify_fleet` | £15 one-off |
| **Rota Check Pack** | Rest and break checks with saved threshold presets and a breach report, always labelled indicative, not legal advice | `verify_rota` | £9 one-off |
| **Cut Order** | Orders SVG or G-code cuts for less rapid travel, reports the lower-bound saving | `optimize_toolpath` | Free, for makers |

The prices are guesses to test, not market data: Agensi shares no category
figures. Start at the low end, then let the dashboard decide.

### 3. More places to be found

- The MCP Registry, for the server itself (decision D2 in
  `sovereign_api/docs/PACKAGES-AND-HARDWARE-PLAN-2026-11.md`), once 0.3.0 is
  out.
- Other skill marketplaces only where the listing is non-exclusive, as
  Agensi's is.
- The repository README and the npm page link to the listings, using the
  Agensi affiliate link (90% on a new buyer's first purchase of our skill,
  20% of what they buy in their first six months).

### 4. Measure without telemetry

The server collects nothing and will keep it that way. The numbers come from
outside it:

- Agensi's dashboard: views, installs, sales and revenue per listing.
- npm's weekly downloads for `lattice117-verify`.
- GitHub: stars, issues, and reproduction reports from the verifier.

Review them monthly in `docs/TRACKING.md`: which skill earns its place, and
which listing text converts.

### 5. From a skill to a contract

A skill is the cheapest way for an operations team to see the referee work
on their own data. Each listing and each skill's "About" section points to
the two paid routes that already exist:

- the commercial licence for closed-source use (`LICENSE-COMMERCIAL.md`);
- a scoped pilot or an annual licence for an operations team, with terms on
  request.

## Gates every version 2 skill must pass

1. Every tool it names exists, and every example in `examples/` gives the
   output it promises: the drift test, extended to each skill folder.
2. Every sentence about what the tool does is true of the engine today. No
   claim beyond what `tests/` exercises.
3. The rota skill says "indicative, not legal advice" in its description and
   whenever it reports.
4. The zip is reproducible, and its SHA-256 is in the release notes.
5. No install scripts, no network access, no telemetry: the server stays as
   it is.

## Order of work

| Step | What | Depends on |
|---|---|---|
| 2.0 | Tag-to-release in CI; `skills/README.md` with the version table; the drift test over every skill folder | Version 1 live |
| 2.1 | Fleet Audit Report and Round Repair, listed as paid | 2.0 |
| 2.2 | MCP Registry listing; README and npm links with the affiliate link | 0.3.0 published |
| 2.3 | Rota Check Pack and Cut Order | 2.1's first month of numbers |
| 2.4 | Monthly review in `docs/TRACKING.md` | 2.1 |

## Risks

- **One marketplace.** Listings are non-exclusive, so 2.2 spreads the risk.
- **AGPL deters some buyers.** The commercial licence answers that, and the
  listing says so.
- **The MCP specification moves.** The server negotiates protocol versions,
  and the official-SDK test in CI catches a mismatch on every push.
- **An unpublished package.** Every set-up line pins a version that must
  exist on npm. Never list a skill before its package version is published.
