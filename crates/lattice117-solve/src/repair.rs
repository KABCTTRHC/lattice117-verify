//! A4 — single-sheet repair on a fixed stop sequence.
//!
//! # What this can and cannot do
//!
//! The route-sheet schema carries a sequence, time windows, and the travel time
//! into each stop from the one before it. On a **fixed** sequence those three
//! facts determine the arrival profile completely, given one more number: when
//! the vehicle leaves the depot.
//!
//! That departure time is the only lever available without new data, and it is
//! a real one — most route sheets in the field carry windows that open later
//! than the start of the day ("deliver 09:00–12:00"), and a round that leaves
//! too late is the single most common repairable failure. Shifting it needs no
//! distance matrix, which is why it belongs to Tier 4 rather than Tier 5.
//!
//! **It is not always enough, and this module says so rather than pretending.**
//! When a round cannot be made feasible at any departure time, the sequence
//! itself is too slow, and no amount of re-timing fixes it. The honest output
//! there is a per-stop counterfactual: exactly how much the window would have
//! to extend, or the leg shorten, for that stop to hold. Re-sequencing is the
//! answer, and re-sequencing needs a matrix — Tier 5.
//!
//! # Determinism
//!
//! Closed form, not search. The latest feasible departure is computed by a
//! single backward pass and the arrival profile by a single forward pass, both
//! integer Q16.16. There is no iteration count to tune, no random seed, and no
//! tie to break, so there is nothing here that can differ between platforms.
//!
//! # The referee is deliberately elsewhere
//!
//! This module never computes a digest and never calls the verifier. It returns
//! a proposed change; the caller runs `lattice117-verify` before and after and
//! emits `digest_before` and `digest_after`. A solver that graded its own work
//! would not be a referee, and the whole commercial claim rests on the grading
//! being independent of the thing being graded.

use crate::Q16;
use alloc::vec::Vec;

/// One stop on a fixed sequence. `travel_q16` is the time into this stop from
/// the previous one; it is ignored for the first stop of a round.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stop {
    pub id: usize,
    pub open_q16: Q16,
    pub close_q16: Q16,
    pub travel_q16: Q16,
}

/// A round, in the order the planner chose. `depart_q16` is when the vehicle
/// leaves; sheets that carry no departure column supply 0.
#[derive(Debug, Clone)]
pub struct Round {
    pub id: usize,
    pub depart_q16: Q16,
    pub stops: Vec<Stop>,
}

/// A stop that cannot be made to hold at any departure time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Residual {
    pub round_id: usize,
    pub stop_id: usize,
    /// Arrival at the best departure this module could find.
    pub arrival_q16: Q16,
    pub close_q16: Q16,
    /// What the window must extend by, or the leg shorten by, to close it.
    /// This is the counterfactual: the smallest correction that works, not an
    /// estimate of one.
    pub deficit_q16: Q16,
}

/// A departure time this module proposes changing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DepartureChange {
    pub round_id: usize,
    pub from_q16: Q16,
    pub to_q16: Q16,
}

/// What a repair pass concluded. Counts are rounds, not stops.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepairOutcome {
    pub rounds_total: usize,
    pub feasible_before: usize,
    pub feasible_after: usize,
    pub changes: Vec<DepartureChange>,
    pub residual: Vec<Residual>,
}

impl RepairOutcome {
    /// True when every round holds after the proposed changes.
    pub fn fully_repaired(&self) -> bool {
        self.feasible_after == self.rounds_total
    }
    /// True when nothing was changed — already feasible, or beyond re-timing.
    pub fn is_no_op(&self) -> bool {
        self.changes.is_empty()
    }
}

/// Arrival time at each stop for a given departure, honouring waits.
///
/// A vehicle that arrives before a window opens waits; it cannot be served
/// early. That wait is what makes the profile non-linear in the departure time
/// and is why the backward pass below is the correct way to find the latest
/// feasible departure rather than simple subtraction.
fn arrivals(round: &Round, depart_q16: Q16) -> Vec<Q16> {
    let mut out = Vec::with_capacity(round.stops.len());
    let mut t = depart_q16;
    for (i, s) in round.stops.iter().enumerate() {
        if i > 0 {
            t = t.saturating_add(s.travel_q16);
        }
        if t < s.open_q16 {
            t = s.open_q16; // wait for the window to open
        }
        out.push(t);
        let _ = i;
    }
    out
}

/// The latest departure at which every stop still holds, or `None` when no
/// departure works.
///
/// Backward pass: the last stop may be reached no later than its own close;
/// each earlier stop no later than its own close, and no later than what the
/// next stop's deadline allows once travel is subtracted.
fn latest_feasible_departure(round: &Round) -> Option<Q16> {
    let n = round.stops.len();
    if n == 0 {
        return Some(round.depart_q16);
    }
    let mut deadline = round.stops[n - 1].close_q16;
    for i in (1..n).rev() {
        deadline = deadline.min(round.stops[i].close_q16);
        deadline = deadline.saturating_sub(round.stops[i].travel_q16);
    }
    // `deadline` is now the latest arrival permitted at the first stop.
    let first = &round.stops[0];
    let latest = deadline.min(first.close_q16);
    if latest < 0 {
        None
    } else {
        Some(latest)
    }
}

/// Every stop that misses its window at `depart_q16`.
fn violations(round: &Round, depart_q16: Q16) -> Vec<Residual> {
    let arr = arrivals(round, depart_q16);
    let mut out = Vec::new();
    for (i, s) in round.stops.iter().enumerate() {
        if arr[i] > s.close_q16 {
            out.push(Residual {
                round_id: round.id,
                stop_id: s.id,
                arrival_q16: arr[i],
                close_q16: s.close_q16,
                deficit_q16: arr[i].saturating_sub(s.close_q16),
            });
        }
    }
    out
}

/// Repairs what re-timing can repair, and reports precisely what it cannot.
///
/// For each round: if it already holds, nothing changes. If it does not, the
/// latest feasible departure is computed in closed form and proposed — latest,
/// not earliest, because that is the smallest change that works and a planner
/// asked to move a start time wants the smallest one. If no departure works,
/// the round is left untouched and its stops are reported as residual, each
/// with the exact correction that would close it.
pub fn repair_fixed_sequence(rounds: &[Round]) -> RepairOutcome {
    let mut changes = Vec::new();
    let mut residual = Vec::new();
    let mut feasible_before = 0usize;
    let mut feasible_after = 0usize;

    for round in rounds {
        let before = violations(round, round.depart_q16);
        if before.is_empty() {
            feasible_before += 1;
            feasible_after += 1;
            continue;
        }
        match latest_feasible_departure(round) {
            Some(latest) if violations(round, latest).is_empty() => {
                if latest != round.depart_q16 {
                    changes.push(DepartureChange {
                        round_id: round.id,
                        from_q16: round.depart_q16,
                        to_q16: latest,
                    });
                }
                feasible_after += 1;
            }
            // No departure makes this round hold. The sequence is the problem,
            // and re-sequencing it needs a distance matrix this schema has not
            // got. Report the counterfactual at the best departure available
            // and leave the round alone — a partial re-time that still breaches
            // is worse than an untouched round plus an accurate diagnosis.
            _ => {
                let best = latest_feasible_departure(round).unwrap_or(0);
                for r in violations(round, best.max(0)) {
                    residual.push(r);
                }
            }
        }
    }

    RepairOutcome {
        rounds_total: rounds.len(),
        feasible_before,
        feasible_after,
        changes,
        residual,
    }
}

/// Builds the band distance matrix a fixed sequence implies, so the untouched
/// verifier can grade the result.
///
/// `evaluate_order` walks the sequence and reads only consecutive pairs, so a
/// matrix carrying just those entries is sufficient and exact. Every other cell
/// is `i32::MAX / 2` — large enough that any path not on the given sequence is
/// rejected, small enough not to overflow when a leg is added to it.
pub fn band_matrix(round: &Round) -> Vec<Q16> {
    let n = round.stops.len();
    let mut m = alloc::vec![i32::MAX / 2; n * n];
    for i in 1..n {
        m[(i - 1) * n + i] = round.stops[i].travel_q16;
    }
    for (i, cell) in m.iter_mut().enumerate().take(n * n) {
        if i / n == i % n {
            *cell = 0;
        }
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Q16_ONE;

    fn q(mins: i32) -> Q16 {
        mins * Q16_ONE
    }
    fn stop(id: usize, open: i32, close: i32, travel: i32) -> Stop {
        Stop { id, open_q16: q(open), close_q16: q(close), travel_q16: q(travel) }
    }

    /// A round whose windows open later in the day, which is the ordinary case
    /// in the field and the one re-timing exists for. Leaving at 0 means
    /// arriving long before the windows open and waiting; leaving at the right
    /// time makes it hold.
    fn late_window_round(depart: i32) -> Round {
        Round {
            id: 1,
            depart_q16: q(depart),
            stops: alloc::vec![
                stop(0, 0, 600, 0),
                stop(1, 60, 90, 20),   // opens 60, closes 90
                stop(2, 80, 100, 15),  // opens 80, closes 100
            ],
        }
    }

    #[test]
    fn a_round_that_leaves_too_late_is_retimed_to_the_latest_that_works() {
        // Leaving at 75: stop 1 at 95 > 90. Breached.
        let out = repair_fixed_sequence(&[late_window_round(75)]);
        assert_eq!(out.feasible_before, 0);
        assert_eq!(out.feasible_after, 1);
        assert!(out.fully_repaired());
        assert_eq!(out.changes.len(), 1);
        // Latest that works: stop 2 must be reached by 100, so stop 1 by 85;
        // stop 1 also closes at 90, so 85 binds; departure therefore 65.
        assert_eq!(out.changes[0].to_q16, q(65));
        assert!(out.residual.is_empty());
    }

    #[test]
    fn a_round_that_already_holds_is_left_completely_alone() {
        let out = repair_fixed_sequence(&[late_window_round(60)]);
        assert_eq!(out.feasible_before, 1);
        assert!(out.fully_repaired());
        assert!(out.is_no_op(), "a passing round must not be touched");
    }

    /// The bundled fleet fixture's failing rounds are this shape: every window
    /// opens at zero, so there is no wait to reclaim and the round would have
    /// to leave before the start of the day. Re-timing cannot help, and the
    /// module must say so rather than proposing a change that still breaches.
    #[test]
    fn a_structurally_infeasible_round_is_not_touched_and_is_reported_exactly() {
        let round = Round {
            id: 2,
            depart_q16: 0,
            stops: alloc::vec![
                stop(0, 0, 600, 0),
                stop(1, 0, 42, 7),
                stop(2, 0, 18, 17),  // arrives 24, closes 18 — 6 late
            ],
        };
        let out = repair_fixed_sequence(&[round]);
        assert_eq!(out.feasible_after, 0);
        assert!(!out.fully_repaired());
        assert!(out.is_no_op(), "must not propose a change that still breaches");
        assert_eq!(out.residual.len(), 1);
        assert_eq!(out.residual[0].stop_id, 2);
        assert_eq!(out.residual[0].deficit_q16, q(6));
    }

    #[test]
    fn waiting_for_a_window_to_open_is_modelled_not_ignored() {
        let r = late_window_round(0);
        let arr = arrivals(&r, 0);
        assert_eq!(arr[1], q(60), "arrives at 20, waits until the window opens");
        assert_eq!(arr[2], q(80), "arrives at 75, waits until 80");
    }

    #[test]
    fn repair_is_deterministic_across_repeated_calls() {
        let rounds = [late_window_round(75), late_window_round(60)];
        let first = repair_fixed_sequence(&rounds);
        for _ in 0..8 {
            assert_eq!(repair_fixed_sequence(&rounds), first);
        }
    }

    #[test]
    fn band_matrix_carries_the_sequence_legs_and_nothing_else() {
        let r = late_window_round(0);
        let n = r.stops.len();
        let m = band_matrix(&r);
        assert_eq!(m[0 * n + 1], q(20));
        assert_eq!(m[1 * n + 2], q(15));
        assert_eq!(m[0 * n + 0], 0);
        assert_eq!(m[2 * n + 0], i32::MAX / 2, "off-sequence legs stay unreachable");
    }
}
