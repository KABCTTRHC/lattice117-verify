/**
 * UK rota rest & break checking — a second evaluation mode, not a route preset.
 *
 * A rota is not a route. A route is a sequence of arrivals along one path; a
 * rota is a set of shifts per person, where what matters is the GAP BETWEEN
 * consecutive shifts and the length of each one. The two share the engine's
 * discipline (exact integers, no floating point, named violations) and nothing
 * else, so this is its own path rather than the routing check wearing a hat.
 *
 * ---------------------------------------------------------------------------
 * INDICATIVE MATHEMATICAL CHECK ONLY — NOT LEGAL ADVICE.
 *
 * This compares times against the rest and break thresholds configured below.
 * It is arithmetic, not a determination of compliance with the Working Time
 * Regulations 1998 or any other law. It does not know about opt-outs, young
 * workers, shift-work exceptions, compensatory rest, unmeasured working time,
 * or any collective agreement. A clean result here is not a defence, and a
 * flagged result is not an offence.
 * ---------------------------------------------------------------------------
 *
 * ## Why the arithmetic is in whole minutes
 *
 * Absolute times are held as exact integer minutes since the civil epoch, and
 * only the DIFFERENCES are expressed in Q16.16.
 *
 * That split is deliberate. Q16.16 spans +/-32,768, so absolute minutes over a
 * monthly rota would overflow it, while Q16.16 *hours* cannot represent most
 * clock times exactly - 06:20 is 6.333... hours, which lands between two
 * Q16.16 steps. A rest gap computed that way could come out as 10.99999 hours
 * against an 11.00000 threshold and report a breach that does not exist. For a
 * tool people may show to an employment lawyer, a false positive at exactly
 * the threshold is the worst available bug.
 *
 * Gaps and durations are small (a rest gap is hours, not weeks), so they fit
 * Q16.16 comfortably and every whole minute is exactly representable:
 * 660 minutes is exactly 11 hours, and the comparison is integer-exact.
 */

/** Q16.16 scale factor, shared with the routing path. */
const Q = 65536;

/** Minutes in a day, used when a shift crosses midnight. */
const DAY = 1440;

/**
 * The configured thresholds, in whole minutes.
 *
 * Named after what they are rather than the regulation they echo, because the
 * check is against these numbers and nothing more.
 */
export const RULES = Object.freeze({
  /** Minimum rest between the end of one shift and the start of the next. */
  restMinutes: 660,          // 11.0 hours
  /** A shift longer than this is expected to carry a break. */
  longShiftMinutes: 360,     // 6.0 hours
  /** The break a long shift is expected to carry. */
  breakMinutes: 20,
});

export const DISCLAIMER =
  'Indicative mathematical check against configured rest and break rules ' +
  '(11h inter-shift rest, 20m break over 6h) — not legal advice.';

/* ---- time parsing, without Date ------------------------------------------

   `new Date('2026-09-28 06:00')` is interpreted against the viewer's time
   zone and differs between engines. Every value here is parsed to an integer
   by hand so two people in two countries hash the same rota identically.
-------------------------------------------------------------------------- */

/** Days from 1970-01-01 for a civil y/m/d. Integer arithmetic throughout. */
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;                                   // [0, 399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** "HH:MM" or "HH:MM:SS" -> minutes past midnight. Seconds are truncated. */
function timeOfDay(str) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(String(str));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** "YYYY-MM-DD" or "DD/MM/YYYY" -> day number. UK order for slashes. */
function dayNumber(str) {
  const s = String(str).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return daysFromCivil(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return daysFromCivil(+m[3], +m[2], +m[1]);
  return null;
}

/**
 * Resolves one cell into absolute minutes.
 *
 * Accepts a full datetime, or a bare time-of-day when a separate date column
 * supplies the day. Returns null rather than guessing.
 */
export function toMinutes(value, dateCell) {
  const s = String(value ?? '').trim();
  if (!s) return null;

  const dt = /^(.+?)[T\s]+(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(s);
  if (dt) {
    const day = dayNumber(dt[1]), tod = timeOfDay(dt[2]);
    if (day === null || tod === null) return null;
    return day * DAY + tod;
  }

  const tod = timeOfDay(s);
  if (tod === null) return null;
  const day = dateCell == null ? 0 : dayNumber(dateCell);
  return (day === null ? 0 : day) * DAY + tod;
}

/** Break cells: "30", "0:30", "30m", "1h 15m". Returns whole minutes. */
export function breakToMinutes(value) {
  const s = String(value ?? '').trim();
  if (!s) return 0;
  const hm = timeOfDay(s);
  if (hm !== null && s.includes(':')) return hm;
  const n = Number(s);
  if (Number.isFinite(n)) return Math.round(n);
  let total = 0, seen = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([hm])/gi)) {
    total += Math.round(Number(m[1]) * (m[2].toLowerCase() === 'h' ? 60 : 1));
    seen = true;
  }
  return seen ? total : 0;
}

const q = (minutes) => minutes * Q;

/**
 * Evaluates one rota.
 *
 * @param {{staff:string, start:*, end:*, break?:*, date?:*, row?:number}[]} rows
 * @param {{maxPeople?:number, rules?:object}} [opts]
 */
export function evaluateRota(rows, opts = {}) {
  const rules = { ...RULES, ...(opts.rules || {}) };
  const cap = opts.maxPeople ?? Infinity;

  const byStaff = new Map();
  const rejected = [];

  rows.forEach((r, i) => {
    const staff = String(r.staff ?? '').trim();
    if (!staff) return;
    const start = toMinutes(r.start, r.date);
    let end = toMinutes(r.end, r.date);
    if (start === null || end === null) {
      rejected.push({ row: r.row ?? i + 2, staff,
        why: `could not read "${r.start}" / "${r.end}" as a time` });
      return;
    }
    // A shift ending at or before it starts has crossed midnight. This is the
    // normal night-shift case and mishandling it invents an 18-hour rest gap
    // where there is none.
    let crossedMidnight = false;
    if (end <= start) { end += DAY; crossedMidnight = true; }

    if (!byStaff.has(staff)) byStaff.set(staff, []);
    byStaff.get(staff).push({
      start, end, crossedMidnight,
      breakMins: breakToMinutes(r.break),
      label: String(r.date ?? '').trim() || null,
      row: r.row ?? i + 2,
    });
  });

  const people = [], verdict = [], breaches = [];
  let checked = 0, capped = 0;

  for (const [staff, shifts] of byStaff) {
    // The cap is applied where shifts are evaluated, not by hiding rows after.
    if (checked >= cap) { capped++; continue; }
    checked++;
    shifts.sort((a, b) => a.start - b.start || a.end - b.end);

    const mine = [];

    for (let i = 0; i < shifts.length; i++) {
      const s = shifts[i];
      const duration = s.end - s.start;

      if (duration > rules.longShiftMinutes && s.breakMins < rules.breakMinutes) {
        mine.push({
          kind: 'break', staff, row: s.row, label: s.label,
          shiftMinutes: duration, actual: s.breakMins,
          expected: rules.breakMinutes,
          shortfall: rules.breakMinutes - s.breakMins,
          q: { actual: q(s.breakMins), expected: q(rules.breakMinutes),
               shortfall: q(rules.breakMinutes - s.breakMins) },
        });
      }

      if (i + 1 < shifts.length) {
        const n = shifts[i + 1];
        const gap = n.start - s.end;
        if (gap < 0) {
          mine.push({
            kind: 'overlap', staff, row: n.row, label: n.label,
            actual: gap, expected: rules.restMinutes, shortfall: -gap,
            q: { actual: q(gap), expected: q(rules.restMinutes),
                 shortfall: q(-gap) },
          });
        } else if (gap < rules.restMinutes) {
          mine.push({
            kind: 'rest', staff, row: n.row, label: n.label,
            actual: gap, expected: rules.restMinutes,
            shortfall: rules.restMinutes - gap,
            q: { actual: q(gap), expected: q(rules.restMinutes),
                 shortfall: q(rules.restMinutes - gap) },
          });
        }
      }
    }

    people.push({ id: staff, shifts });
    verdict.push({ id: staff, ok: mine.length === 0, breaches: mine });
    breaches.push(...mine);
  }

  return {
    checked, capped, totalPeople: byStaff.size,
    clear: verdict.filter((v) => v.ok).length,
    people, verdict, breaches, rejected, rules,
  };
}

/** "9h 20m" from 560. Display only — never fed to the digest. */
export function humanMinutes(m) {
  const neg = m < 0; const a = Math.abs(m);
  const h = Math.floor(a / 60), mm = a % 60;
  return (neg ? '-' : '') + (h ? `${h}h ${mm}m` : `${mm}m`);
}
