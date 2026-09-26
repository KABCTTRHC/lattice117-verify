# What it would have cost a firm to reach this point

**Brierley Sovereign Group Ltd · 26 September 2026**

A replacement-cost estimate for Lattice117 as it stands today, built from what
is actually in the two repositories rather than from recollection.

---

## 0. Read this before quoting any number below

Three caveats, stated first because an estimate quoted without them is worse
than no estimate.

**Lines of code are a poor proxy for effort and an actively misleading one for
value.** They are used below only to establish that the artefact is large and
real, never to derive a price. A competent team asked to build this product
from a clean sheet would write *less* code than is here, not more.

**Not all of it is on the critical path.** Both repositories contain
exploratory work, benchmark harnesses, archived scripts and domain experiments
that a commercial team would never have been funded to write. The costing below
is scoped to the **eleven workstreams that a firm would actually have had to
staff** to produce the shipping product, its evidence and its compliance
position.

**This is a replacement cost, not a valuation.** It answers "what would it cost
to buy this outcome from a services firm?" It does not answer what the business
is worth, and the two are not related.

---

## 1. What exists, measured

| | `sovereign_api` | `lattice117-verify` |
|---|---|---|
| Rust | 132 files, 39,623 lines | 8 files, 2,528 lines |
| Python | 87 files, 25,581 lines | — |
| C / C++ / headers | 116 files, 17,790 lines | — |
| JavaScript / TypeScript | 14 files, 391 lines | 23 files, 3,696 lines |
| HTML | — | 11 files, 5,674 lines |
| Solidity | 4 files, 377 lines | — |
| Markdown documentation | 84 files | 6 files, 2,474 lines |
| Commits | 104 | 47 |

**Shipping surfaces:** native Rust CLI, published npm package, browser page,
Microsoft Excel task pane, Google Sheets add-on (deployed).
**Test suites:** 131 JavaScript assertions across five files, 28 Rust tests in
the extracted solver crate, plus the workspace suites and a CI matrix spanning
Ubuntu, Windows, macOS, `wasm32-unknown-unknown` and `aarch64`.
**Evidence:** nine device captures across three devices and two independently
written WebAssembly engine families, a 19-page technical white paper, and two
sourced legal research notes.

---

## 2. The team a firm would have had to hire

Rates are UK contract day rates for 2026, outside London. An agency in London
would be 30–60% higher; an employed team is cheaper per day but carries
recruitment, management and idle time that a project of this shape would pay
for anyway.

| Role | Why this project needs it | Day rate |
|---|---|---|
| Principal engineer — numerics & determinism | Q16.16 design, the canonicalisation taxonomy, the boundary-sweep methodology. This is the rarest skill on the list. | £700–900 |
| Senior Rust systems engineer ×2 | VRPTW engine, branchless DP, clustering, QUBO, recombination, WASM target | £550–750 |
| Embedded / FPGA engineer | `lithos_q`/`lithos_u` bare metal: MMU, DMA, AMP mailbox, watchdog, telemetry ring | £550–750 |
| Senior frontend engineer | Four surfaces, offline-first, licensing UI, glassmorphic redesign | £450–600 |
| Office / Workspace add-in specialist | Excel task pane and Sheets add-on are their own discipline — manifests, sideloading, OAuth scoping, store review | £500–650 |
| DevOps / release engineer | CI matrix across five targets, Pages, npm, marketplace pipelines | £500–650 |
| QA / test engineer | 159 assertions, boundary tables, negative controls, device capture protocol | £400–550 |
| Technical writer | White paper, spec, research notes, store listings | £350–500 |
| Product manager | Tier design, pricing, scope gates | £500–700 |
| UI designer | Brand, pricing cards, store assets | £400–600 |
| Employment solicitor | WTR reg. 10, 21–24 analysis | £250–450/hr |

---

## 3. Workstream estimate

Estimated in person-days by workstream, which is defensible, rather than by
line count, which is not.

| # | Workstream | Person-days | At blended £600/day |
|---|---|---|---|
| 1 | Deterministic VRPTW core — Q16.16, branchless DP, capacity, time windows | 90–130 | £54k–78k |
| 2 | Clustering, QUBO annealer, recombination and cross-exchange | 45–65 | £27k–39k |
| 3 | Fixed-point library and generic `Q<INT,FRAC>` type | 15–25 | £9k–15k |
| 4 | Bare-metal firmware (`lithos_q`, `lithos_u`) | 60–90 | £36k–54k |
| 5 | FFI and integration layer (C-ABI, Arrow, k8s, ROADEF) | 40–60 | £24k–36k |
| 6 | Benchmarks, datasets and validation harness | 35–50 | £21k–30k |
| 7 | Four delivery surfaces + offline licensing (ECDSA P-256, free tier) | 55–80 | £33k–48k |
| 8 | Cross-platform determinism programme — CI matrix, capture harness, nine-device evidence | 25–40 | £15k–24k |
| 9 | White paper and technical documentation | 20–30 | £12k–18k |
| 10 | Marketplace submissions, store assets, listings | 12–20 | £7k–12k |
| 11 | Legal research and compliance position (WTR) | 6–10 + counsel | £4k–6k + £3k–8k counsel |
| | **Total** | **403–600 person-days** | **£242k–360k** |

**Add what a firm cannot avoid:** project management at 12–15% (£29k–54k),
recruitment for two scarce roles (£15k–30k), and a contingency no fixed-price
bid would omit at 15% (£36k–54k).

### Replacement cost

| Scenario | Cost |
|---|---|
| UK contract team, Nottingham/remote rates | **£320k–500k** |
| London agency or consultancy | **£550k–850k** |
| Employed team, fully loaded, 12 months | **£420k–620k** |

### Calendar time

A team of six to eight, working in parallel with the usual coordination
overhead, would reach this state in **9–14 months**. The dependency chain —
engine before surfaces, surfaces before evidence, evidence before the paper —
means it does not compress much below nine months regardless of headcount.

---

## 4. What today actually saved

This is the part to be most careful with, because it is the easiest to
overstate.

**I can measure today. I cannot measure the years before it.** What follows is
scoped strictly to the work in this session's commits.

Delivered today across both repositories:

- The determinism white paper: ~9,000 words, 19 pages, rendered to PDF from
  source, with nine device evidence blocks and both fixtures reproduced in full
- Five research and specification documents: WTR reg. 10, WTR regs. 21–24,
  Tier 4/5 spec, replacement cost (this), LinkedIn engineering post
- A timezone invariance suite — nine host zones, static source guards — and the
  DST semantic defect it exposed, measured and pinned
- The tier entitlement model, with a revenue bug found and fixed: `issue.mjs`
  would sign any tier string while `licence.js` degrades unknown tiers to
  Standard, so one typo would have granted Standard to a £499 customer
- Removal of the last libm transcendental from the route path, with an integer
  Q16.16 replacement and a parity test across three copies
- `crates/lattice117-solve` extracted, 1,383 lines, building for `wasm32` and
  `aarch64`, 28 tests
- Eight store assets generated from the live product, and a CI guard hardened
  twice

A senior engineer plus a technical writer, working to this standard — sourced
claims, negative controls, render verification — would take **18–28 person-days**
for that output. At blended rate, **£11k–17k**.

**The part that matters more than the hours.** Four things were found today
that a normal build would have shipped:

1. `f64::exp()` in the annealer's acceptance test — the one libm call left in
   the route path, and invisible to a guard that checks for `f32`/`f64`
   declarations
2. The rest-period clock-change defect — a false negative in the unsafe
   direction, once a year
3. The licence tier typo path — signed keys silently under-delivering to the
   highest-paying customers
4. The free-tier screenshot that read "100% achievable" having checked 1 of 8
   rounds, which was about to go to Microsoft as a store listing

None of those is a line of code. Each is the kind of defect that surfaces in
front of a customer, an auditor or an acquirer rather than in a test run.

---

## 5. The honest comparison

Do not claim this was built for nothing. It was built with an enormous amount
of one person's time, and that time has a real cost that this document does not
attempt to price.

What can be said plainly, and defended:

**A firm would have needed 403–600 person-days and 9–14 months to reach this
state, at a replacement cost of £320k–500k at UK contract rates.**

**The output has properties most funded teams do not deliver:** identical
verdict digests across two independently written WebAssembly engines, a CI
matrix that fails the build when platforms disagree, zero server infrastructure,
zero data egress, and a published white paper that documents its own defects
rather than hiding them.

**And it has properties a funded team would have had by now and this does not:**
no external party has independently re-derived a digest, the test set is two
fixtures rather than a corpus, and the Enterprise tiers are specified and
partially extracted rather than shipping. Those gaps are named in the white
paper's §8 and in the Tier 4/5 spec, and naming them is the reason the rest of
the document can be trusted.
