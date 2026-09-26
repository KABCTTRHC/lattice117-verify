# WTR 1998 regs. 21–24 — when the 11-hour rest rule does not apply

**Status: research note, not legal advice.** Same standing as
`docs/WTR-REG10-CLOCK-CHANGE.md`: written by a non-lawyer to settle product
questions, quotations sourced, reasoning marked as reasoning. Needs a
solicitor's sign-off before it decides anything a worker or employer relies on.

## Why this matters more than the DST question

`docs/WTR-REG10-CLOCK-CHANGE.md` found a **false negative** — one night a year
the check passes a rota it should flag. This note is about the opposite and much
larger exposure: **false positives**. Regs. 21–24 mean a flagged rest breach can
be entirely lawful, all year round, and the engine cannot tell the difference
because the facts that decide it are not in the spreadsheet.

Rough shape of the two exposures:

| | Frequency | Direction | Visible to the engine? |
|---|---|---|---|
| Clock change (reg. 10 reading) | one night a year | unsafe — passes a short rest | no |
| Regs. 21–24 exceptions | potentially every shift change | over-flags lawful rotas | no |

## The provisions

**Reg. 21 — special cases.** Lists categories for which the daily and weekly
rest entitlements and rest breaks do not apply. Among them: workers whose place
of work and residence are distant from one another; security and surveillance
activities requiring a permanent presence to protect property or persons;
activities involving the need for continuity of service or production, *as in
hospitals or similar establishments*; and a **foreseeable surge of activity**,
given as agriculture, tourism and postal services. Guidance on the surge limb
gives harvest and lambing as examples and notes it cannot be used routinely.
Source: [legislation.gov.uk, reg. 21](https://www.legislation.gov.uk/uksi/1998/1833/regulation/21).

**Reg. 22 — shift workers.** The one that bites hardest here:

> regulation 10(1) does not apply in relation to a shift worker when he changes
> shift and cannot take a daily rest period between the end of one shift and the
> start of the next one

Source: [legislation.gov.uk, reg. 22](https://www.legislation.gov.uk/uksi/1998/1833/regulation/22).

**Reg. 23 — collective and workforce agreements.** A collective agreement or a
workforce agreement **may modify or exclude the application of reg. 10(1)**
outright (along with regs. 6(1)–(3) and (7), 11(1)–(2) and 12(1)).
Source: [legislation.gov.uk, reg. 23](https://www.legislation.gov.uk/uksi/1998/1833/regulation/23);
see also the [House of Commons Library research paper 98/82](https://researchbriefings.files.parliament.uk/documents/RP98-82/RP98-82.pdf).

**Reg. 24 — compensatory rest.** Where reg. 21, 22 or 23(a) excludes a
provision and the worker is required to work through what would have been rest:

> (a) his employer shall wherever possible allow him to take an equivalent
> period of compensatory rest, and (b) in exceptional cases in which it is not
> possible, for objective reasons, to grant such a period of rest, his employer
> shall afford him such protection as may be appropriate in order to safeguard
> the worker's health and safety.

Source: [legislation.gov.uk, reg. 24](https://www.legislation.gov.uk/uksi/1998/1833/regulation/24).

Note the asymmetry with reg. 20 (unmeasured working time), which carries **no**
compensatory rest requirement — regs. 21 and 22 do.

## Does the shift-worker exception make the DST question moot?

**No. It narrows it; it does not remove it.** [REASONING]

Reg. 22(a) is conditional on two things at once: the worker **changes shift**,
*and* cannot take a daily rest period between the old shift and the new one. A
spring-forward night in a steady rota — same shift pattern either side, just an
hour of clock removed from the middle — is not a shift change, so reg. 22(a)
does not reach it. The false negative survives.

Reg. 23(a) could remove it, but only where an agreement actually exists and
actually modifies reg. 10(1). That is a fact about the employer, not about the
rota, and the engine has no way to know it.

So the two findings are independent. Neither excuses the other.

## What follows for the product

**1. The scope caveat now names shift changes. [DONE]** The static notice on all
surfaces previously listed opt-outs, young workers, compensatory rest and
collective agreements. Reg. 22(a) is the single most likely reason a flagged
breach is lawful — a rota tool flags shift changeovers constantly — so it is now
named explicitly. Pinned by test across every surface that carries the notice.

**2. Configurable thresholds are the right answer to reg. 23, and already
exist.** `evaluateRota(rows, { rules })` takes the thresholds, and by §7.4 of the
determinism paper those thresholds are **in the canonical form**. An employer
whose workforce agreement sets rest at, say, 9 hours can configure that, and the
digest then pins *which rules were applied* — so a later reader cannot mistake a
9-hour ruleset for the statutory default. The exported report already prints the
rules used.

That is worth saying out loud in the paper: §7.4 was written as a defect
(a digest that did not pin its thresholds could be reproduced under different
rules and still match). Reg. 23 turns the fix into a feature. Derogation is
lawful and common; a verdict is only meaningful alongside the rule it was
measured against, and pinning both is what makes a derogated rota auditable
rather than just differently wrong.

**3. Do not try to model regs. 21, 22 or 24.** [REASONING] Each turns on facts
that are not in a rota: whether this worker is a security guard, whether this is
a foreseeable surge, whether a shift change made rest impossible, whether
compensatory rest was afforded. Inferring any of them from a spreadsheet would
produce a confident verdict about something never checked — the failure mode the
engine already refuses for out-of-range Q16.16 input. The honest product
position is a flag that says *look at this*, not a ruling.

If exceptions are ever represented, the same discipline as the DST fix applies:
they must be **declared as data**, refused by name when absent, and entered into
the canonical form, because they change the verdict.

**4. A commercial note, stated plainly.** These exceptions are a reason the
product's claim must stay "indicative mathematical check", not "compliance
check". That is not a weakness to hide — an auditor knows perfectly well that
regs. 21–24 exist, and a tool claiming to have handled them would be less
credible, not more.

## Limits of this note

- `legislation.gov.uk` is blocked by this container's egress proxy. Every
  quotation here is from search results citing it, not from the page. **Verify
  reg. 22(a) and reg. 24 against the primary source before relying on them.**
  Reg. 21's list is paraphrased, not quoted — read the provision itself.
- Reg. 23 also permits a *relevant agreement* to vary some provisions, and the
  interaction between collective, workforce and relevant agreements is not
  analysed here.
- No case law was searched. The scope of "continuity of service or production"
  in particular has been litigated and that litigation is not reflected here.
- Reg. 21 was amended over the Regulations' life; the version in force should be
  checked rather than assumed.
- Northern Ireland has its own regulations.
