# Contributing

Bug reports and failing test cases are welcome without ceremony — open an issue
with a schedule that produces the wrong verdict and it will be looked at.

## Before you open a pull request — please read this

This project is **dual-licensed**: AGPL-3.0-or-later, and a commercial licence
for organisations that cannot comply with the AGPL. Offering a commercial
licence requires that the licensor holds the rights to all the code being
licensed.

That means **contributed code cannot simply be merged.** If a contribution is
merged under the AGPL alone, the project can no longer commercially license the
file it touched, and the dual-licence model breaks — permanently, and usually
without anybody noticing until a customer's lawyer asks.

So, for any non-trivial contribution, we ask for a copyright assignment or a
licence grant covering commercial relicensing, agreed **before** merge. It is a
short document and it is not negotiable, because the alternative is that this
project stops being able to fund itself.

If that is not acceptable to you — which is a perfectly reasonable position —
please open an issue describing the change instead. A well-specified issue is
genuinely valuable and carries none of this friction.

## Standards

Three things are expected of any change to evaluation logic:

1. **No floating point in the evaluation path.** Determinism is the product. A
   `f32` or `f64` anywhere in `evaluate_order`'s call graph is a defect
   regardless of how well it behaves in testing.
2. **Negative-control your tests.** Before trusting a test that guards
   something, break the thing deliberately and confirm the test fails, with the
   expected values, at the expected line. A test never observed to fail is not
   evidence.
3. **Overflow is a defect, not an edge case.** Widen and saturate rather than
   wrap. A wrapped intermediate produces a confident, wrong answer, which is
   the worst failure mode this crate can have.

## Running the tests

```sh
cargo test --all
```
