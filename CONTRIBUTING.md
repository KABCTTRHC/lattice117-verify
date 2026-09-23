# Contributing to Lattice117

Thank you for your interest. Please read this document in full before opening a
pull request — it contains legal terms that apply to any contribution you
submit.

> **Not legal advice.** This document was drafted to be clear and
> self-consistent, but it has not been reviewed by a solicitor. Brierley
> Sovereign Group Ltd should obtain legal review before relying on it in a
> commercial dispute. See *"On enforceability"* at the end.

---

## 1. Dual-licensing disclosure

**Lattice117 is dual-licensed.**

| Licence | Terms | Who it is for |
|---|---|---|
| **GNU AGPL v3.0 or later** | [`LICENSE`](LICENSE) | Anyone. Free to use, modify and distribute, subject to the AGPL's source-disclosure obligations — including for software made available over a network (AGPL §13). |
| **Commercial licence** | [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md) | Industrial, defence and enterprise operators who cannot or will not release their source. |

The commercial licensing rights are **held exclusively by Brierley Sovereign
Group Ltd** (registered in England and Wales, No. 16833179).

This model is what funds the project's continued development. It only works if
the company holds sufficient rights in **all** of the code it distributes. Code
contributed under the AGPL alone cannot be included in a commercial licence —
which is why §2 exists.

---

## 2. Inbound Contributor Licence Agreement (CLA)

**By submitting a contribution to this project, you agree to the following
terms.**

### 2.1 Definitions

**"Contribution"** means any work of authorship — including source code,
documentation, configuration, tests, and any modification or addition to
existing work — that you intentionally submit to this project for inclusion, by
any means including pull request, patch, issue attachment or electronic
communication.

**"You"** means the individual, or the legal entity on whose behalf you act,
submitting the Contribution.

**"The Company"** means Brierley Sovereign Group Ltd, registered in England and
Wales under number 16833179.

### 2.2 Grant of copyright licence

You hereby grant to the Company a **perpetual, worldwide, non-exclusive,
royalty-free, irrevocable** licence to reproduce, prepare derivative works of,
publicly display, publicly perform, sublicense, and distribute your
Contribution and such derivative works, **under both**:

**(a)** the GNU Affero General Public License v3.0 or any later version; **and**

**(b)** any commercial, proprietary, or closed-source licence terms the Company
may select, now or in the future, including terms that do not require
disclosure of source code.

This grant expressly includes the right to relicense and sublicense your
Contribution under terms of the Company's choosing, without further notice to
you, without attribution beyond that required by the AGPL, and without any
obligation of payment or accounting to you.

### 2.3 Grant of patent licence

You grant the Company and all recipients of software distributed by the Company
a **perpetual, worldwide, non-exclusive, royalty-free, irrevocable** patent
licence to make, have made, use, offer to sell, sell, import and otherwise
transfer your Contribution, where such licence applies only to those patent
claims licensable by you that are necessarily infringed by your Contribution
alone or by combination of your Contribution with the project.

If any entity institutes patent litigation alleging that the project or a
Contribution within it constitutes patent infringement, any patent licences
granted under this section to that entity terminate as of the date such
litigation is filed.

### 2.4 Your representations

You represent that:

1. **You are legally entitled to grant the above licences.** The Contribution
   is your original creation, or you have obtained sufficient rights from the
   actual author to submit it under these terms.
2. **Your employer, if any, has waived any rights** in the Contribution, or you
   have received permission to submit it on their behalf. If any part of your
   Contribution was created in the course of employment, you have confirmed
   with your employer that this submission is permitted.
3. **The Contribution does not knowingly infringe** any third party's copyright,
   patent, trade secret, or other intellectual property right.
4. **You will notify the Company promptly** if you become aware that any of
   these representations is or becomes inaccurate.

### 2.5 No warranty and no obligation

You provide your Contribution "AS IS", without warranty of any kind, express or
implied. You retain all right, title and interest in your Contribution not
expressly granted here — **this is a licence, not an assignment.** You may
continue to use your own Contribution for any purpose.

The Company is under no obligation to accept, merge, retain or distribute any
Contribution.

---

## 3. Developer Certificate of Origin

**Every commit must be signed off.** Use:

```sh
git commit -s -m "Your message"
```

This appends a `Signed-off-by:` trailer using your real name and email, and
certifies the Developer Certificate of Origin 1.1, reproduced below.

Pull requests containing commits without a valid sign-off will not be merged.
To fix an existing branch:

```sh
git rebase --signoff main
```

### Developer Certificate of Origin 1.1

```
By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right
    to submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my
    knowledge, is covered under an appropriate open source license and I have
    the right under that license to submit that work with modifications,
    whether created in whole or in part by me, under the same open source
    license (unless I am permitted to submit under a different license), as
    indicated in the file; or

(c) The contribution was provided directly to me by some other person who
    certified (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public
    and that a record of the contribution (including all personal information I
    submit with it, including my sign-off) is maintained indefinitely and may
    be redistributed consistent with this project or the open source license(s)
    involved.
```

*The DCO certifies origin. It does **not** by itself grant the relicensing
rights the commercial model requires — that is what §2 is for. Both apply.*

---

## 4. Dependency policy

**No dependency may be introduced whose licence conflicts with dual-licensing
and commercial distribution.**

### Permitted

Permissive licences that allow proprietary redistribution: **MIT**,
**Apache-2.0**, **BSD-2-Clause**, **BSD-3-Clause**, **ISC**, **Zlib**,
**Unlicense**, **CC0-1.0**, and dual `MIT OR Apache-2.0` (the Rust ecosystem
norm).

### Prohibited

Any dependency under a copyleft or source-disclosure licence, including but not
limited to **GPL** (any version), **AGPL** (any version), **LGPL** (any version,
including dynamic linking), **MPL-2.0**, **EPL**, **CDDL**, **SSPL**, **BUSL**,
and any "source-available" or non-commercial licence.

Also prohibited: any dependency with **no licence**, an **unclear or missing
licence file**, or a **custom licence** that has not been reviewed.

**Why LGPL is on the prohibited list**, since this surprises people: LGPL's
relinking requirement is incompatible with distributing a statically linked
proprietary binary, which is precisely what a commercial licensee will want.

### Before adding any dependency

1. Check the licence of the crate **and its full transitive tree**.
2. Prefer no dependency at all. This project's verification core has zero
   runtime dependencies and that is a feature worth defending.
3. State the licence in your pull request description.

```sh
cargo install cargo-deny
cargo deny check licenses
```

A dependency that violates this policy will be rejected regardless of technical
merit. Removing a contaminated dependency after it has shipped in a commercial
release is expensive and sometimes impossible.

---

## 5. Engineering standards

Three expectations for any change to evaluation logic:

1. **No floating point in the evaluation path.** Determinism is the product. An
   `f32` or `f64` anywhere in `evaluate_order`'s call graph is a defect
   regardless of how well it behaves in testing.
2. **Negative-control your tests.** Before trusting a test that guards
   something, break the thing deliberately and confirm the test fails, with the
   expected values, at the expected line. A test never observed to fail is not
   evidence.
3. **Overflow is a defect, not an edge case.** Widen and saturate rather than
   wrap. A wrapped intermediate produces a confident, wrong answer — the worst
   failure mode this project can have.

```sh
cargo fmt --all
cargo clippy --all-targets -- -D warnings
cargo test --all
```

---

## 6. If you would rather not agree to §2

That is a completely reasonable position, and a number of good engineers hold
it.

**Please open an issue instead.** A well-specified bug report — ideally with a
schedule that produces the wrong verdict — is genuinely valuable, carries none
of this friction, and requires no agreement from you.

---

## On enforceability

Stated plainly rather than buried: an inbound CLA accepted by implication —
"by submitting, you agree" — is **weaker than a signed agreement**, and its
enforceability varies by jurisdiction.

For casual contributions this is normally accepted practice. For any
substantial contribution, or any contribution from a corporate contributor, the
Company should require explicit acceptance before merge, via a CLA assistant
bot or a signed document.

This section exists so that nobody — contributor or company — mistakes
convenience for certainty.

---

*Lattice117 · Copyright (C) 2026 Brierley Sovereign Group Ltd
<kurtisbrierley@gmail.com> · Registered in England and Wales, No. 16833179*
