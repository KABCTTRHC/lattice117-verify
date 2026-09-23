<!--
PRE-1 OCTOBER CAPTURE — Show HN submission.

Post this BEFORE ER-001. Rationale: a Show HN is a lower-stakes category
with its own audience. It establishes an account with a history, it seeds
the repo with stars, and it means ER-001 arrives from someone who has
already shipped something rather than from a stranger with an essay.

BLOCKER: the repo cannot be published until LICENSE contains the real
AGPL-3.0 text. See LICENSE.

Title (71 chars):
    Show HN: Lattice117 Audit – deterministic schedule feasibility checking

Submit as a link to the GitHub repo.
Post Tue-Thu, 08:00-10:00 UK. Then immediately post the comment below as
the first reply — on Show HN the author's comment is where the real
explanation goes, and posts without one underperform badly.

Expectation setting: most Show HNs get 1-15 points and a handful of
comments. That is not failure. The goal here is a footprint and one or two
conversations, not a front page.
-->

# Show HN: Lattice117 Audit – deterministic schedule feasibility checking

## Author's first comment

I built this because I kept hitting the same problem from the other direction:
it is easy to find out whether a solver *produced* a schedule, and surprisingly
hard to find out whether the schedule it produced is actually feasible.

It does not build routes. It checks one somebody else built — OR-Tools, jsprit,
VROOM, a planner, a spreadsheet — and answers one question: does this hold
against its own time windows? If not, it names the stop, the arrival time, the
window close, and the deficit.

```
  FAIL  0 of 1 routes feasible · 1 violation(s)

  ▸ VAN-01 — stop Bravo-Eng
      arrives           25.0000 minutes   (Q16.16 1638400)
      window shuts      20.0000 minutes   (Q16.16 1310720)
      late by            5.0000 minutes   (Q16.16 327680)
```

Three design decisions that are the whole point:

**No floating point in the evaluation path.** Everything is Q16.16 fixed-point
`i32`. Same input, bit-identical output, any machine, every run. The CLI prints
a SHA-256 digest over the input and the verdict so you can check that rather
than take my word for it — and CI verifies the digest matches across Linux,
macOS and Windows, because a determinism claim that is only tested on one
platform isn't one.

**Out-of-range values are a hard error, not a wrap.** Anything outside Q16.16's
representable range fails loudly, naming the field. A silently wrapped value
produces a confident verdict about a schedule that was never actually checked,
which is the worst failure this kind of tool can have.

**It opens no sockets.** Files in, verdict out. No telemetry, no licence check,
no network of any kind. That was not a privacy feature originally — it was so
it could run somewhere disconnected — but it turns out to be the thing people
ask about first.

Exit codes are 0 / 1 / 2 (feasible / infeasible / bad input) so it works as a
CI gate. Checking your planner's output on every commit is a very different
posture from finding out in a meeting.

On provenance: the verification core is extracted from a larger engine where it
sits under 196 passing tests and is validated against the published SINTEF
Solomon C101 instance and its published Rochat & Taillard solution.

Running that published solution through the checker is what caught the most
useful bug this code has had, and it was *in the checker*. An earlier version
conflated legitimate accumulated waiting time with a due-date violation in the
same cost field, so any route with more than ~152 time-units of honest waiting
came back infeasible. C101's published solution is feasible; a checker that
disagrees is broken. That is when I decided the checker was more interesting
than the solver.

A false "infeasible" is the failure this kind of tool is most likely to have
and least likely to catch, because it doesn't look like a bug — it looks like
being careful. The only thing that finds it is running real published data
against a real published answer.

Honest limitation: it verifies time windows and travel times. It does not yet
check vehicle capacity as a hard constraint, and it has no opinion about
whether your schedule is *good* — only whether it is possible. Route
construction is a much harder problem and I am deliberately not claiming to
have solved it. Verification does not depend on having solved it, which is why
this is the part I am publishing.

Dual-licensed AGPL-3.0 or commercial. Built in Nottingham. Happy to answer
anything.

---

## Notes for the thread

**Expect these questions. Have the answer ready, short.**

*"Why not just use OR-Tools' own validator?"*
→ Because it checks its own output under its own assumptions. This is
independent, takes any planner's output, and gives you a reproducible artifact
you can hand to someone else.

*"Why fixed point?"*
→ Because two runs of a float pipeline on different machines can disagree, and
the entire value here is being able to say the verdict is the same every time.

*"Did you find a bug in the SINTEF benchmark?"*
→ **No, and do not let this drift.** The bug was in my checker; the published
C101 solution is correct and feasible. If anyone reads it the other way in the
thread, correct it immediately and plainly.

*"Is the digest cryptographically meaningful?"*
→ It is a SHA-256 over the canonical input plus the verdict. It proves the same
input produced the same conclusion. It is not a signature and does not claim to
be — do not overstate this if asked.

*"What's the commercial licence for?"*
→ Organisations that cannot release their source. Say it plainly, once, and
move on. Do not pitch in the thread.

**Do not** mention fundraising, the hardware, or AEON-73. If someone asks what
else you build, one sentence, then back to the tool.
