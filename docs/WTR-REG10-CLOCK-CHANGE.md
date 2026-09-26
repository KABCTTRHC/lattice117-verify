# WTR 1998 reg. 10 and the clock change — is "eleven consecutive hours" civil or elapsed?

**Status: research note, not legal advice.** Written to settle a product
decision, by a non-lawyer. Everything below is either a quotation with a
source, or reasoning explicitly marked as reasoning. Before this changes a
verdict a worker or an employer relies on, it needs an employment solicitor's
sign-off. The point of writing it down is so that sign-off takes an hour
instead of a day.

## The question

`demo/rota.js` measures inter-shift rest in **civil (clock) minutes**. On the
night the clocks go forward, civil and elapsed time disagree:

| Night (Europe/London) | Civil | Elapsed | Engine verdict |
|---|---|---|---|
| Sat 28 Mar 2026 22:00 → Sun 29 Mar 09:00 | 11h 00m | **10h 00m** | clear |
| Sat 24 Oct 2026 22:00 → Sun 25 Oct 09:00 | 11h 00m | 12h 00m | clear |

Measured and pinned in `tests/timezone.test.mjs`. The autumn row is
conservative. The spring row passes a worker who received ten hours' rest.

So: does reg. 10 want eleven hours of clock face, or eleven hours of rest?

## What the provision says

Regulation 10(1) of the Working Time Regulations 1998:

> An adult worker is entitled to a rest period of not less than eleven
> consecutive hours in each 24-hour period during which he works for his
> employer.

Source: [legislation.gov.uk, WTR 1998 reg. 10](https://www.legislation.gov.uk/uksi/1998/1833/regulation/10).
Reg. 10(2) sets twelve consecutive hours for a young worker; reg. 10(3) allows
that period to be interrupted for work split up over the day or of short
duration.

Acas states the entitlement as at least 11 hours' **uninterrupted** rest
between finishing work and starting the next day.
Source: [Acas — the right to rest](https://www.acas.org.uk/rest-breaks).

The Regulations implement Article 3 of the Working Time Directive
(2003/88/EC), which is drafted in the same terms — a minimum daily rest period
of 11 consecutive hours per 24-hour period.
Source: [Working Time Directive](https://en.wikipedia.org/wiki/Working_Time_Directive_2003)
(secondary; the Directive text itself was not reachable from this container —
see *Limits of this note*).

## Three arguments, all pointing the same way

**1. The units are durations, not clock positions. [REASONING]**

An hour is a quantity of time. "Not less than eleven consecutive hours" is
drafted the way a minimum quantity is drafted — compare "not less than 20
minutes" in reg. 12, which nobody reads as a clock-face span. Nothing in reg.
10 refers to times of day, to a calendar day, or to local time. The reference
period is likewise "each 24-hour period", another duration; on the
spring-forward day the *civil* day is 23 hours long, so a civil reading has to
explain what a "24-hour period" means on a day that has 23 of them. An elapsed
reading needs no such explanation.

**2. The purpose is physiological. [REASONING]**

The Regulations are health-and-safety legislation, enforced in part by the HSE.
The protected interest is actual recovery. A worker who slept ten hours did not
recover for eleven, and the fact that a clock moved is not a fact about that
worker. A purposive construction — the orthodox approach to WTR, which is
derived from a Directive — favours elapsed time. Reg. 10's own carve-out in
10(3) is about *interruption*, which only makes sense if the protected thing is
a continuous stretch of real rest.

**3. The regulated analogue already measures elapsed time, and says so.**

This is the strongest point available, because it is settled practice rather
than construction.

Drivers' hours under Regulation (EC) 561/2006 are recorded by digital
tachograph. **Tachographs record in UTC.** They may *display* local time, and
the driver may set that display, but the stored record and every printout are
UTC — a reference with no daylight saving in it at all. Consequently a clock
change cannot lengthen or shorten a recorded rest period, and the guidance is
explicit that a full off-duty period is compliant "regardless of whether the
clocks go back or forward."

Sources: [VDO Fleet — changing the time of a digital tachograph](https://www.fleet.vdo.co.uk/vdo-blog/how-to-change-the-time-of-the-digital-tachograph/);
[trans.info — clocks change, what to do with your tachograph](https://trans.info/en/clocks-change-tachograph-october-2022-113949);
[Aquarius IT — changing the local time of a digital tachograph](https://www.aquariusit.com/news/changing-the-local-time-of-a-digital-tachograph/).

The sector with the most safety-critical rest rules, the most enforcement, and
the most litigation solved this problem by removing local time from the
measurement entirely. That is not authority on reg. 10, but it is a very strong
indication of what a tribunal would think eleven hours' rest means, and it is
the sector this product is aimed at.

## Conclusion

**Elapsed time.** On the balance of the text, the purpose, and the practice of
the closest regulated regime, "eleven consecutive hours" means eleven hours of
real rest, and the current civil-time measurement is **optimistic on one night
a year, in the unsafe direction.**

Confidence: high on the direction, lower on whether any tribunal has ever been
asked. No authority squarely on DST and reg. 10 was found — see below.

## What this means for the product

Three things, in order of cost.

**1. Say so. [DONE]** `DISCLAIMER` in `demo/rota.js` now states the clock-time
convention and names the spring-forward night explicitly, so the one case where
the check is optimistic is disclosed at the point of use rather than discovered
afterwards. It is not in the canonical form, so no published digest moved.

**2. Do not fix this by reaching for `Date`.** The obvious repair — compute
elapsed time from the host timezone — would reintroduce exactly the defect the
integer parser exists to prevent: a laptop's zone setting changing a compliance
verdict, and `tests/timezone.test.mjs` failing. The tachograph answer is the
right one: measure in a reference that has no DST.

**3. The real fix is a schema change, not a line.** To measure elapsed time
deterministically, each shift's civil time needs a **declared UTC offset**
supplied as data — a column, or a zone named in the ruleset and resolved
against a pinned IANA database version. Whichever way, by §7.4 of the
determinism paper that offset **changes the verdict and must therefore enter
the canonical form**, which moves every rota digest. That makes it a versioned
change (`lattice117.rota.v2`), not a patch.

Recommended shape, for when it is worth doing:

- `RULES` gains `restBasis: 'civil' | 'elapsed'`, defaulting to `'civil'` so
  existing digests are stable and the choice is explicit rather than implied.
- `'elapsed'` requires a per-shift `utcOffsetMinutes`, refused by name if
  absent — the same discipline as out-of-range Q16.16 input, for the same
  reason: a confident verdict about a schedule that was never properly checked
  is worse than a refusal.
- Both `restBasis` and the offsets join `canonicaliseRota`'s rules tuple.
- Bump the canonical form's `mode` string, and keep a v1 fixture so the old
  digests remain reproducible.

## Limits of this note

- `legislation.gov.uk`, `eur-lex.europa.eu` and `en.wikipedia.org` are all
  blocked by this container's network egress proxy. Reg. 10(1) is quoted from
  search results that cite legislation.gov.uk rather than from the page itself.
  **Verify the quotation against the primary source before relying on it.**
- No case law search was performed and none of these sources is a judgment. If
  a tribunal has considered a clock change and reg. 10, this note does not know
  about it.
- Reg. 10 has exceptions that are not analysed here at all: reg. 21 (special
  cases), reg. 22 (shift workers), reg. 23 (collective agreements), and the
  compensatory rest in reg. 24. A shift-worker exception could make the whole
  question moot for some employers.
- Northern Ireland has its own regulations.
