# Reproduce the digests

**Thirty seconds, one command, no account, no network.**

```
npx lattice117-verify reproduce
```

That is the whole thing. Node 18 or newer, nothing else. It downloads a package
with **zero dependencies**, runs three fixtures through a 21,525-byte
WebAssembly module, prints what came out next to what was expected, and exits
non-zero if they differ.

Then paste the output here:
**[→ file a reproduction report](https://github.com/KABCTTRHC/lattice117-verify/issues/new?template=digest-reproduction.yml)**

---

## Why we are asking

§8 of [the white paper](docs/WHITEPAPER-determinism.md) records an open gap, in
our own words: **every digest in it was produced by us.**

There are nine device captures in there — three phones, three runs each — and
they are still nine captures on hardware we held. The claim this product rests
on is that the same schedule produces the same verdict and the same digest on
any machine, anywhere. That is not a claim we can close by running it again
ourselves, however many times we do it.

One person who is not us, on a machine we have never touched, closes it.

**A non-match is the more useful result.** If your output differs from the
expected values, that is a defect in a claim we are selling, and we would much
rather learn it from you than from a customer. Please report it either way.

## What you are checking

Three strings, from two fixtures:

| # | Fixture | Digest |
|---|---|---|
| 1 | `example-route-sheet.csv` — eight rounds, five feasible | `e249d90e…` |
| 2 | Nottingham round as supplied, alphabetical order, 99.6 min, **infeasible** | `da1650fc…` |
| 3 | The same round re-sequenced, 60.2 min, **feasible** | `2b9d863c…` |

The first is the figure the white paper cites throughout. The second and third
are the Tier 5 benchmark, documented in
[`docs/FIXTURE-NOTTINGHAM.md`](docs/FIXTURE-NOTTINGHAM.md) down to the WGS84
coordinates the distance matrix was derived from.

## What the digest is, and is not

It is a SHA-256 over the canonicalised Q16.16 integers the engine evaluated and
the verdict it reached. Two parties who compute the same digest checked the same
schedule and reached the same conclusion.

**It is not a signature.** It says nothing about who ran the check, and it is not
evidence of authorship, authority or compliance. It is one narrow claim —
reproducibility — and that is all it is offered as.

## What it does on your machine

- Reads three files that ship inside the package.
- Instantiates a WebAssembly module that imports nothing and opens no sockets.
- Prints to stdout.

It makes no network request after the initial `npx` download, writes no file,
reads nothing outside its own package directory, and collects no telemetry. The
environment block it prints — OS, CPU, core count, Node version — is printed for
*you* to paste; it is not sent anywhere. If you would rather not publish your CPU
model, delete that line before posting; the digests are what matter.

You can check all of that before running it. The package is
[`lattice117-verify`](https://www.npmjs.com/package/lattice117-verify) and every
line of it is in this repository.

## If you would rather not use npx

```bash
git clone https://github.com/KABCTTRHC/lattice117-verify
cd lattice117-verify
node npm/bin/lattice117-verify.mjs
```

Same result, no download from the npm registry, and you can read the source
first. There is no build step and no `npm install`, because there are no
dependencies to install.

## Reproducing from source, in Rust

The npm package and the Rust workspace share one evaluation kernel, so the
stronger check is to build it yourself:

```bash
cargo test --workspace          # 65 tests, including the digest fixtures
cargo run -p lattice117-audit -- --input demo/example-fleet.json --json
```

`crates/lattice117-audit` is the air-gapped CLI. Its digest is taken over the
input text and the verdict rather than over the canonical JS form, so it is a
*different* string by design — the two canonicalisations are documented in §5.6
of the paper. Do not expect it to equal `e249d90e…`; expect it to be stable
across your own machines, which is what CI checks on Linux, macOS and Windows
every push.

## Expected output

```
Lattice117 — independent digest re-derivation
==============================================================

Environment
  node                   v22.x
  platform               <your OS>
  cpu                    <your CPU>
  ...

1. Fleet fixture (example-route-sheet.csv)
  rounds checked         8
  feasible               5 of 8

2/3. Nottingham benchmark (Tier 5 re-sequencing)
  before                 99.6 min, INFEASIBLE
  after                  60.2 min, FEASIBLE
  order found            DEPOT -> Beeston -> Chilwell -> Bulwell -> Arnold -> Carlton -> DEPOT

Digests

  MATCH     fleet v1
    expected  e249d90e...
    got       e249d90e...
  ...
```

## What happens to your report

A **matching** report is added to §8 of the white paper as an independent
reproduction, with the machine and OS, and your name if you want it there. The
issue template has a field for that; leave it blank and you stay anonymous, and
we will not name you without it.

A **non-matching** report goes to the front of the queue, and you will be told
what it turned out to be.

---

*Lattice117 is built by [Brierley Sovereign Group Ltd](https://github.com/KABCTTRHC),
Nottingham. AGPL-3.0-or-later, or a commercial licence.*
