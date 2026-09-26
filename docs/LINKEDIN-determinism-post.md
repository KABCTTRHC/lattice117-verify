# LinkedIn post — BSG Breakthrough: cross-platform determinism

Paste the block below. LinkedIn renders no markdown, so it is written as plain
text with blank lines doing the work. Roughly 1,850 characters — under the 3,000
limit, and above the ~210-character "see more" fold, so the first three lines
have to earn the click.

**Not a financial promotion.** It describes engineering only: no raise, no
round, no returns, no invitation to invest. Keep it that way.

---

```text
BSG Breakthrough — a schedule audit anyone can re-run and get the same answer.

We set out to prove our verification engine was deterministic. It was. That took
a fortnight. Then we spent two months on the part nobody warned us about.

Every number the engine evaluates is a Q16.16 fixed-point integer. No floating
point anywhere in the evaluation path, enforced by CI. That removes a whole class
of cross-platform risk by construction rather than by argument.

But the arithmetic was never where reproducibility broke.

Every defect we found was in canonicalisation — in deciding what to hash. Four of
them, none arithmetic:

• Line endings changed the digest. Same numbers, different hash, because Git
  rewrote LF to CRLF on the Windows checkout.
• 600 and '600' disagreed. A spreadsheet round-trip yields strings.
• Three surfaces canonicalised three different ways for the same schedule.
• A verdict digest that didn't pin its own thresholds could be reproduced under
  different rules and still match.

That last one matters legally, not just technically. UK Working Time Regulations
reg. 23(a) lets a collective agreement modify the 11-hour rest rule outright, so
"compliant" is never a fact about a rota — it's a fact about a rota AND a
ruleset. Pin both, or the verdict means nothing.

The evidence: identical digests across two independently written engine families
— Google's V8 and Apple's JavaScriptCore — plus native Rust on Linux, Windows and
macOS. Each device also checks its own arithmetic against an exact BigInt oracle:
36,003 boundary values, zero divergences, on every device. The rota digest is
identical across nine host timezones, verified in CI.

The result: the same schedule produces the same digest, online or offline, on any
of those platforms.

Not a signature. It proves the same input reached the same conclusion — not who
produced it. That distinction is the whole discipline.

Full write-up and every command to reproduce it:
github.com/KABCTTRHC/lattice117-verify

Lattice117 · Brierley Sovereign Group Ltd, Nottingham

#DeterministicSystems #WebAssembly #Rust #Reproducibility #WorkforceManagement
```

---

## Notes

**The hook.** The first two lines carry the fold. "It was. That took a fortnight.
Then we spent two months on the part nobody warned us about" is the whole post in
miniature and is the reason to click "see more".

**Three claims deliberately not made**, each because the repo does not support
them:

- *"Fixed-point stops the CPU rounding differently."* It does not — the CPU was
  never rounding differently. IEEE-754 binary64 is fully specified on x86-64 and
  AArch64, and our own 36,003-value sweep is a negative result confirming it.
  Claiming otherwise hands a technical reader a reason to distrust everything
  after it.
- *"Cryptographic seal."* It is a digest, not a signature. The post says so
  explicitly, because a product adjacent to employment compliance cannot afford
  the ambiguity.
- *"Standard software fails at these boundaries."* We have n=1. We found four in
  our own system and propose them as a taxonomy; that is the honest and still
  interesting claim.

**If it needs shortening**, cut the reg. 23(a) paragraph first — it is the most
interesting to a specialist and the least to a general feed.

**Best follow-up comment** (post it yourself, an hour in, to lift reach): the
iPhone detail. Chrome on iOS is WKWebView underneath, so that capture ran on
JavaScriptCore, not V8 — a second engine family we did not set out to test.
