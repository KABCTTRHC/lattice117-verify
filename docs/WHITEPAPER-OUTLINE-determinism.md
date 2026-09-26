# Outline — *Reproducible Verdicts: Cross-Platform Determinism in Schedule Verification*

**Status: OUTLINE. Kurtis Brierley to complete and publish.**
Everything marked **[EVIDENCE]** is already measured and cited from the
repository. Everything marked **[TO CAPTURE]** is not yet measured — do not
write it as fact until it is. Everything marked **[ARGUE]** is prose you should
write in your own voice.

---

## The thesis, stated up front

Write the paper around one finding, because it is the part nobody else says:

> **Making the computation deterministic was the easy half. Every defect we
> found was in the canonicalisation — in deciding *what to hash* — not in the
> arithmetic. A system can be perfectly deterministic and still produce
> irreproducible verdicts.**

Four separate defects, four different mechanisms, zero of them arithmetic.
That is the contribution. A paper that only says "we used fixed-point and got
the same answer everywhere" is a blog post; a paper that anatomises how
reproducibility fails *anyway* is worth reading.

---

## 1. Abstract

~200 words. Name the problem (verdicts that cannot be independently
re-derived), the approach (Q16.16 integer evaluation with a canonical digest),
the result (bit-identical across N platforms and four independent
implementations), and the finding above. **[ARGUE]**

## 2. Introduction

- The question a verification tool must answer: *would a second party, on
  different hardware, reach the same conclusion from the same input?*
- Why "the code is open" is not sufficient — reproducibility is a property of
  the *pipeline*, not the source. **[ARGUE]**
- Where this matters commercially: a schedule audit is only evidence if it can
  be re-run adversarially. **[ARGUE]**

## 3. Background — where non-determinism actually comes from

Set expectations honestly before the results, or the results look trivial.

- **Floating point is the usual suspect, and is mostly a red herring on modern
  64-bit targets.** IEEE-754 binary64 is fully specified; x86-64 and AArch64
  both implement it. The classic divergence sources are x87 80-bit excess
  precision (32-bit x86) and FMA contraction altering `a*b+c` rounding.
  **[EVIDENCE — analysis in `docs/Q40-24-SOA-EXPERIMENT.md`]**
- **What does vary:** library implementations (`sin`, `exp`), reduction order
  under parallelism, hash iteration order, locale, line endings, and clocks.
- **The under-discussed one:** *serialisation*. Two runs can agree on every
  number and disagree on the bytes that represent them. **[ARGUE]**

## 4. System under test

Keep this short — it is context, not the paper.

- Q16.16 fixed point on `i32`: one integer scaled by 65,536; range
  −32,768…+32,767; resolution 1/65,536. **[EVIDENCE]**
- **Zero `f32`/`f64` in the evaluation path** — `crates/lattice117-verify/src/`
  contains none, verified by `grep` in CI. **[EVIDENCE]**
- Four independent surfaces over one engine: a native Rust CLI, an npm package,
  an Excel task pane, a Google Sheets sidebar, and a browser page.
  **[EVIDENCE]**
- Out-of-range input is refused by name rather than wrapped, because a wrapped
  value yields a *confident* verdict about a schedule that was never checked.
  **[EVIDENCE]**

## 5. Method

- Two reference fixtures, both in the repository: an 8-round fleet and a
  4-person rota. **[EVIDENCE]**
- The verdict digest: SHA-256 over a canonical form of *the Q16.16 integers
  actually evaluated* and the verdict. **[EVIDENCE — `demo/digest.js`]**
- CI pins the digest and fails the build if platforms disagree.
  **[EVIDENCE — `.github/workflows/ci.yml`]**
- Device capture: `demo/determinism.html` runs both fixtures plus a boundary
  sweep and emits a signed-shaped evidence block. **[EVIDENCE]**

## 6. Results — the determinism matrix

Present as one table. Fill each row from a pasted evidence block.

| Platform | ISA | Runtime | Fleet digest | Rota digest | Boundary sweep |
|---|---|---|---|---|---|
| Ubuntu (CI) | x86-64 | native Rust | `611eef21…` (CLI fixture) | — | — | **[EVIDENCE]** |
| Windows (CI) | x86-64 | native Rust | `611eef21…` | — | — | **[EVIDENCE]** |
| macOS (CI) | AArch64 | native Rust | `611eef21…` | — | — | **[EVIDENCE]** |
| Chromium / Linux | x86-64 | V8 + WASM | `e249d90e…` | `83c66e6d…` | 36,003 / 0 | **[EVIDENCE]** |
| npm / Node 22 | x86-64 | V8 + WASM | `e249d90e…` | `83c66e6d…` | — | **[EVIDENCE]** |
| Excel task pane | x86-64 | Edge WebView | `e249d90e…` | `83c66e6d…` | — | **[EVIDENCE]** |
| Google Sheets sidebar | x86-64 | V8 + WASM | `e249d90e…` | `83c66e6d…` | — | **[EVIDENCE]** |
| Samsung Galaxy Tab A11 | AArch64 | Android Chrome | | | | **[TO CAPTURE]** |
| Google Pixel | AArch64 | Android Chrome | | | | **[TO CAPTURE]** |

Note honestly that the native fixture (`611eef21…`) and the browser fixture
(`e249d90e…`) are *different inputs*, not a disagreement. Anyone will ask.
**[ARGUE]**

## 7. The central finding — four ways a deterministic system produced irreproducible verdicts

This is the paper. One subsection per defect: mechanism, how it was found,
what it cost, and the general lesson.

### 7.1 Platform: line endings changed the hash

The digest was taken over the input *text*. With no `.gitattributes`, Git
rewrote LF to CRLF on the Windows checkout. Linux and macOS returned
`611eef21…`; Windows returned `5467faa0…` — **with byte-identical Q16.16
integers in the violation.** Reproduced locally by feeding a CRLF copy to the
Linux binary. **[EVIDENCE]**

*Lesson:* hashing a representation rather than a value imports every property
of that representation, including ones the operating system controls.

### 7.2 Type: `600` and `'600'` disagreed

The npm package hashed values as supplied. A CSV or spreadsheet round-trip
yields strings, so the same schedule with the same verdict produced two
digests. Fixed by hashing the Q16.16 integers the engine evaluated.
**[EVIDENCE — npm 0.1.0 → 0.2.0]**

*Lesson:* canonicalise **after** normalisation, not before. The boundary where
types are coerced is the boundary where the canonical form should be taken.

### 7.3 Structural: three surfaces, three canonical forms

The browser hashed raw inputs; the Excel pane hashed a summary that **excluded
the inputs entirely** (so two unrelated schedules failing alike collided); the
package hashed Q16.16 integers. One schedule, three digests — measured at
`e249d90e…` vs `8bad5881…` before the fix. **[EVIDENCE]**

*Lesson:* a digest whose canonicalisation is reimplemented per surface is not a
digest. Ours is now one shared file, byte-compared across surfaces in CI.

### 7.4 Semantic: a verdict is meaningless without its thresholds

The rota check compares against configurable limits (11h rest, 20m break). A
digest over shifts and outcomes alone could be reproduced under *different
rules* and still match. The thresholds are therefore part of the canonical
form. **[EVIDENCE — `canonicaliseRota`]**

*Lesson:* the canonical form must cover everything that could change the
verdict, including configuration. This is the failure mode that survives all
three above.

### 7.5 Synthesis — a taxonomy

Propose it plainly: **representational, type-level, structural, semantic.**
Argue that the four are exhaustive for digest-based verification and that each
needs a different control. This is the part a reviewer will cite. **[ARGUE]**

## 8. What is *not* a source of divergence

Useful because it is counter-intuitive and you measured it.

- **The JavaScript float boundary.** `Math.round(Number(v) * 65536)` is the only
  arithmetic outside WASM. Across **36,003 realistic values** — 0–600 at one,
  two and three decimal places plus exact half-unit boundaries — it produced
  **bit-identical** results to exact decimal arithmetic via `BigInt`. **Zero
  divergences.** **[EVIDENCE]**
- **Architecture, for a parse-then-scale.** See §3. **[EVIDENCE]**
- State plainly that rewriting the parser would have added risk and changed
  nothing — a negative result worth publishing. **[ARGUE]**

## 9. Limits

Do not let a reviewer find these first.

- Q16.16 caps a schedule at ~22 days in minutes, ~9 hours in seconds.
  **[EVIDENCE]**
- A wider type is not free: Q40.24 on `i64` **doubles** the memory of a dense
  matrix — 13,509 nodes goes from 0.73 GB to 1.46 GB. **[EVIDENCE]**
- Above **2²⁹ ≈ 537 million**, staging a Q40.24 value through `f64` silently
  drops low fractional bits, because f64 has a 53-bit significand and Q40.24
  keeps 24 fractional. Q16.16 never reaches that magnitude, which is exactly
  why §8's sweep found nothing. **[EVIDENCE — analysis only, not yet measured]**
- Vehicle capacity is not yet a hard constraint. **[EVIDENCE]**

## 10. What this does not prove

A short, unhedged section. It buys more credibility than anything else in the
paper. **[ARGUE]**

- Determinism is not correctness. A consistently wrong verdict is still wrong.
- The digest is **not a signature**. It proves the same input produced the same
  conclusion; it proves nothing about who produced it or when.
- The test set is two fixtures, not a corpus.
- No external party has yet re-derived a digest independently. Say so.

## 11. Related work

**[TO CAPTURE]** — you will need real citations. Suggested reading, all of
which you should read rather than cite from this list:
reproducible-builds.org; Goldberg, *What Every Computer Scientist Should Know
About Floating-Point Arithmetic* (1991); the SINTEF Solomon VRPTW benchmark
set and the Rochat & Taillard solutions; Certificate Transparency (RFC 6962)
and Sigstore, for the distinction between a digest and an attestation.

## 12. Reproduction

Every command a reader needs, with expected output. This section is what makes
it a paper rather than a claim. **[EVIDENCE — all of these run today]**

```sh
git clone https://github.com/KABCTTRHC/lattice117-verify && cd lattice117-verify
cargo test --all
./target/release/lattice117-audit --input examples/infeasible.json --json
node tests/rota.test.mjs        # 28 boundary and negative-control tests
node tests/sheets.test.mjs      # bundle parity and scope assertions
npm install lattice117-verify
```

And on any device, open:
`https://kabcttrhc.github.io/lattice117-verify/determinism.html`

---

## Appendix A — evidence blocks

Paste each device's block verbatim. Do not retype them; do not summarise them.
A pasted block a reader can diff is worth more than a table you transcribed.

## Appendix B — the fixtures

`demo/example-route-sheet.csv` and `demo/example-rota.csv`, reproduced in full.
They are small enough to print, which is the point.
