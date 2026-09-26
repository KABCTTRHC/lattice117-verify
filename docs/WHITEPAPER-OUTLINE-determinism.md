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

Five separate defects, five different mechanisms, zero of them arithmetic.
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
| Samsung Galaxy Tab A11 | AArch64 | Chrome 153 / V8 | `e249d90e…` | `83c66e6d…` | 36,003 / 0 | **[EVIDENCE]** |
| Google Pixel 8 Pro | AArch64 | Chrome 153 / V8 | `e249d90e…` | `83c66e6d…` | 36,003 / 0 | **[EVIDENCE]** |
| iPhone SE (2020), iOS 26.6.2 | AArch64 | Chrome 154 / **JavaScriptCore** | `e249d90e…` | `83c66e6d…` | 36,003 / 0 | **[EVIDENCE]** |

Note honestly that the native fixture (`611eef21…`) and the browser fixture
(`e249d90e…`) are *different inputs*, not a disagreement. Anyone will ask.
**[ARGUE]**

### 6.1 The device capture, and what it is actually evidence of

Nine captures: three devices, three consecutive runs each, 2026-09-26.
**All nine reproduced both reference digests exactly and all nine reported
0 divergences across 36,003 swept values.** Blocks in Appendix A.
**[EVIDENCE]**

Resist the obvious framing. Three phones is not the interesting number, and a
reviewer will say so. Two things in this dataset are load-bearing:

- **Two independent WebAssembly implementations agree.** The Android captures
  run V8 (Liftoff/TurboFan). The iPhone capture reports `CriOS/154` — Chrome's
  UI over **WKWebView**, because iOS in the UK permits no other engine — so its
  WASM is executed by **JavaScriptCore** (BBQ/OMG) and its `Number`/`Math.round`
  by JSC, not V8. That is a second, separately written engine family reaching
  byte-identical Q16.16 integers and byte-identical digests. It is the strongest
  single fact in the capture set, and it was not something I set out to test.
  **[EVIDENCE]**
- **Each device verified against ground truth, not merely against the others.**
  The sweep compares `toQ()` to exact decimal arithmetic via `BigInt` on the
  device itself (`exactQ` in `demo/determinism.html`). Nine devices agreeing
  with each other could mean nine devices sharing a bug; nine devices agreeing
  with an exact oracle cannot. **[EVIDENCE]**

State plainly what the devices do **not** add: **a new instruction set.** All
three are AArch64, and the macOS CI runner is already AArch64 — that runner is
what surfaced the six `E0133` errors in the `dp.rs` NEON path. Anyone counting
"three new architectures" here is counting wrong, and saying so first costs
nothing and buys the rest of the paper. **[ARGUE]**

### 6.2 Sweep construction

Give the reader the four bands, because "36,003 values" alone is unfalsifiable.
**[EVIDENCE — `floatSweep()` in `demo/determinism.html`]**

| Band | Count | Range |
|---|---|---|
| 1 decimal place | 6,001 | 0.0 … 600.0 |
| 2 decimal places | 6,001 | 0.00 … 60.00 |
| 3 decimal places | 20,001 | 0.000 … 20.000 |
| exact half-ULP offsets, `i + 0.5/65536` to 10 dp | 4,000 | 0 … 3,999 |

The fourth band is the one that matters: those inputs land exactly on
`Math.round`'s tie-break, which is where a rounding-mode disagreement between
engines would show up if one existed. It is 11% of the sweep and 100% of its
teeth. Say that; do not let the reader assume the sweep is 36,003 arbitrary
numbers. **[ARGUE]**

### 6.3 Elapsed time — an operability signal, not a benchmark

| Device | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Galaxy Tab A11 | 525 ms | 173 ms | 158 ms |
| Pixel 8 Pro | 180 ms | 144 ms | 132 ms |
| iPhone SE 2020 | 353 ms | 446 ms | 108 ms |

Report these as *fitness for purpose*, not performance. Two fixtures plus a
36,003-value sweep complete in **well under a second on every device, worst
case 525 ms**, which is what licenses the product claim that verification is
interactive on hardware a depot supervisor already owns. **[EVIDENCE]**

Do not over-read them. The first-run figures carry WASM compilation and module
fetch; the iPhone's run 2 (446 ms) being *slower* than its run 1 (353 ms) is
scheduler and thermal noise, and a paper that presents a three-sample
`performance.now()` spread as a measurement invites exactly the criticism it
deserves. One sentence: the timings bound the cost, they do not characterise
it. **[ARGUE]**

## 7. The central finding — five ways a deterministic system produced verdicts you could not rely on

This is the paper. One subsection per defect: mechanism, how it was found,
what it cost, and the general lesson.

Orient the reader: **§7.1–7.4 are reproducibility failures** — the same input
yielded different digests. **§7.5 is a different species** — the digest was
stable everywhere and the *verdict* was wrong anyway, and it was found by
applying §7.6's taxonomy forward rather than by a test failing. Say which is
which; conflating them would undercut §7.6. **[ARGUE]**

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

### 7.5 The one the taxonomy predicted: DST makes "eleven hours" ambiguous

Found while writing §10's timezone caveat, which is the honest provenance and
worth stating — the taxonomy earned its keep by pointing at where to look.

`rota.js` measures rest in **civil** minutes, computed by integer date
arithmetic that never consults the host zone. That is what buys the
timezone invariance in §10. It also means that on the night the clocks go
forward, civil time and elapsed time disagree:

| Night (Europe/London) | Civil | Elapsed | Engine verdict |
|---|---|---|---|
| Sat 28 Mar 2026 22:00 → Sun 29 Mar 09:00 | 11h 00m | **10h 00m** | **clear** |
| Sat 24 Oct 2026 22:00 → Sun 25 Oct 09:00 | 11h 00m | 12h 00m | clear |

**[EVIDENCE — measured, pinned in `tests/timezone.test.mjs`]**

The autumn row is conservative and harmless. The spring row is a **false
negative in the direction that matters**: the worker received ten hours' rest,
WTR 1998 reg. 10 speaks of "a rest period of not less than eleven consecutive
hours", and the engine passed it.

Be precise about what kind of defect this is, because it is the paper's point:

- It is **not** a determinism defect. Every platform and every zone returns the
  same verdict and the same digest for that night — including hosts where no
  such transition occurs. Determinism is intact and is exactly what makes the
  error *consistent* rather than intermittent.
- It is a **semantic** defect, §7.4's category: the canonical form covers
  everything that could change the verdict, but the *definition* of the quantity
  being compared against the threshold was never written down. "Eleven hours" was
  assumed to be unambiguous. Twice a year, in one jurisdiction-dependent
  direction, it is not.

*Lesson, and the strongest one in the paper:* eliminating a dependency does not
eliminate the decision it was making. Refusing to consult the host timezone
silently chose civil time over elapsed time. A removed dependency is a policy
choice that no longer has anywhere to be documented — which is why it went
unnoticed through four surfaces, three test suites and nine device captures.
**[ARGUE]**

Deliberately left unfixed at the time of writing. It changes published verdict
digests, and the right answer is a legal question about reg. 10 rather than an
engineering one. Recommend stating the convention in `DISCLAIMER` and offering
elapsed-time rest as an explicit, digest-affecting rule flag — which, by §7.4,
would have to enter the canonical form. **[ARGUE]**

### 7.6 Synthesis — a taxonomy

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
- Rest is measured in civil time, not elapsed time, so the engine over-reports
  compliance by one hour on the spring-forward night — once a year, in the
  unsafe direction. See §7.5. **[EVIDENCE]**

## 10. What this does not prove

A short, unhedged section. It buys more credibility than anything else in the
paper. **[ARGUE]**

- Determinism is not correctness. A consistently wrong verdict is still wrong.
- The digest is **not a signature**. It proves the same input produced the same
  conclusion; it proves nothing about who produced it or when.
- The test set is two fixtures, not a corpus.
- No external party has yet re-derived a digest independently. Say so.
- **Every one of the nine device captures ran in `Europe/London`**, so the
  capture set does not test timezone independence at all. That gap is now closed
  from the other direction instead, by `tests/timezone.test.mjs`: the rota
  fixture digest is re-derived in nine host zones — including the 45-minute
  offset `Asia/Kathmandu`, the +13:45 `Pacific/Chatham`, and `Pacific/Kiritimati`
  on the far side of the date line — and is identical in all nine. The same suite
  asserts statically that `rota.js` and `digest.js` construct no `Date` and read
  no locale or zone. **[EVIDENCE]** A device capture from a non-London zone would
  still be worth having, but it would now confirm a measured property rather than
  establish one. **[TO CAPTURE — nice to have, no longer load-bearing]**
- **The user agent cannot identify the devices.** Chrome's UA reduction freezes
  Android at `10` and the model at `K`, so the two Android blocks in Appendix A
  are textually identical but for `Mobile`. The devices are distinguished by
  their GPU, core count and memory fields. Anyone re-deriving this must not read
  "Android 10" as the OS version. **[EVIDENCE]**
- Device provenance is self-reported by the author, not attested. Nothing binds
  a pasted evidence block to the hardware that produced it — which is the same
  limitation as the digest itself (§10, second bullet), one level up.

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
node tests/timezone.test.mjs    # 9 host timezones, one digest
npm install lattice117-verify
```

And on any device, open:
`https://kabcttrhc.github.io/lattice117-verify/determinism.html`

---

## Appendix A — evidence blocks

Verbatim as emitted by `demo/determinism.html`. Nothing here is retyped or
summarised; a block a reader can diff is worth more than a table transcribed
from it. Captured 2026-09-26 by Kurtis Brierley.

Reference values, for diffing:

- fleet `e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d`
- rota `83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf`

### A.1 — Samsung Galaxy Tab A11 (Chrome 153, V8)

<!-- CAPTURE BLOCKS: verbatim device output. Do not reformat or edit. -->

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T10:55:56.755Z

DEVICE
  user agent   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36
  platform     Linux armv81
  cores        8   memory 4 GB
  screen       1007x601 @ dpr 1.3312500715255737
  gpu          ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 525 ms
OVERALL DETERMINISTIC
```

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T10:57:13.368Z

DEVICE
  user agent   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36
  platform     Linux armv81
  cores        8   memory 4 GB
  screen       1007x601 @ dpr 1.3312500715255737
  gpu          ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 173 ms
OVERALL DETERMINISTIC
```

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T10:57:42.090Z

DEVICE
  user agent   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36
  platform     Linux armv81
  cores        8   memory 4 GB
  screen       1007x601 @ dpr 1.3312500715255737
  gpu          ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 158 ms
OVERALL DETERMINISTIC
```

### A.2 — Google Pixel 8 Pro (Chrome 153, V8)

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T11:00:44.273Z

DEVICE
  user agent   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36
  platform     Linux armv81
  cores        9   memory 8 GB
  screen       448x998 @ dpr 2.25
  gpu          ANGLE (ARM, Mali-G715, OpenGL ES 3.2)
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 180 ms
OVERALL DETERMINISTIC
```

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T11:01:08.110Z

DEVICE
  user agent   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36
  platform     Linux armv81
  cores        9   memory 8 GB
  screen       448x998 @ dpr 2.25
  gpu          ANGLE (ARM, Mali-G715, OpenGL ES 3.2)
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 144 ms
OVERALL DETERMINISTIC
```

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T11:01:28.196Z

DEVICE
  user agent   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36
  platform     Linux armv81
  cores        9   memory 8 GB
  screen       448x998 @ dpr 2.25
  gpu          ANGLE (ARM, Mali-G715, OpenGL ES 3.2)
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 132 ms
OVERALL DETERMINISTIC
```

### A.3 — iPhone SE 2020, iOS 26.6.2 (Chrome 154 / CriOS — JavaScriptCore)

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T11:03:02.379Z

DEVICE
  user agent   Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.8037.55 Mobile/15E148 Safari/604.1
  platform     iPhone
  cores        4   memory ? GB
  screen       375x667 @ dpr 2
  gpu          Apple GPU
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 353 ms
OVERALL DETERMINISTIC
```

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T11:03:16.458Z

DEVICE
  user agent   Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.8037.55 Mobile/15E148 Safari/604.1
  platform     iPhone
  cores        4   memory ? GB
  screen       375x667 @ dpr 2
  gpu          Apple GPU
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 446 ms
OVERALL DETERMINISTIC
```

```
LATTICE117 DETERMINISM EVIDENCE
captured 2026-09-26T11:03:26.270Z

DEVICE
  user agent   Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.8037.55 Mobile/15E148 Safari/604.1
  platform     iPhone
  cores        4   memory ? GB
  screen       375x667 @ dpr 2
  gpu          Apple GPU
  wasm         Memory=yes Global=yes Table=yes instantiateStreaming=yes
  timezone     Europe/London

FLEET FIXTURE  example-route-sheet.csv
  rounds       8 checked, 5 achievable
  engine       21525 bytes
  digest       e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  expected     e249d90ef7b895243e48c9f8315e3fe3a3ab02732604a898c2c6922fda24888d
  result       MATCH

ROTA FIXTURE  example-rota.csv
  staff        4 checked, 2 clear, 2 flagged
  digest       83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  expected     83c66e6dfdd2f1b304364f65a102397b85bf1c225396c2dbd36df9272c92f3cf
  result       MATCH

Q16.16 BOUNDARY SWEEP  toQ() against exact BigInt decimal
  values       36003
  divergences  0
  result       MATCH

ELAPSED 108 ms
OVERALL DETERMINISTIC
```

## Appendix B — the fixtures

`demo/example-route-sheet.csv` and `demo/example-rota.csv`, reproduced in full.
They are small enough to print, which is the point.
