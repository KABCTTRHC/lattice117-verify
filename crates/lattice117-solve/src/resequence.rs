//! Tier 5 — per-vehicle re-sequencing against a supplied distance matrix.
//!
//! # Why per-vehicle first
//!
//! A route sheet that already names `VAN-11` and `VAN-14` carries a decision a
//! planner made — which vehicle serves which stops — and that decision usually
//! encodes things no matrix knows: driver knowledge, vehicle type, customer
//! relationships, depot bay allocation. Re-clustering the whole fleet throws
//! all of it away. So when the assignment exists, it is preserved, and only
//! the order *within* each round is searched. `kondo::solve_logistics_kondo`
//! remains available for an unassigned instance, where there is no partition
//! to respect.
//!
//! # Why exhaustive, and where it stops
//!
//! Real rounds are short. Up to [`EXACT_LIMIT`] interior stops this searches
//! every permutation and returns the optimum — not a heuristic's guess at one.
//! That is 8! = 40,320 orders at the limit, trivial for a browser, and it means
//! the result carries no tuning parameters at all: no iteration budget, no
//! temperature, no seed. Above the limit the round is returned untouched with
//! [`ResequenceOutcome::searched`] false, because reporting "not searched" is
//! honest and returning a heuristic result labelled as optimal is not.
//!
//! # Determinism
//!
//! Candidates are ranked by `(infeasible_count, cost, sequence)`. Feasibility
//! dominates cost — a cheaper route that misses a window is not an improvement
//! — and the sequence itself breaks ties.
//!
//! The sequence is compared as a list of POSITIONS in the supplied round, so
//! **the lowest index wins at the first position where two tied orders differ**:
//! of two equal-cost, equally-feasible orders, the one that visits the
//! earlier-listed stop sooner is returned. That rule is total — no two distinct
//! orders compare equal — so the search has exactly one answer and it does not
//! depend on the order permutations happen to be generated in, on how many
//! threads ran (there is one), or on which candidate was examined first.
//!
//! The consequence worth stating: on a symmetric matrix a round and its exact
//! reverse cost the same, and this rule always returns the forward one.

use crate::repair::{Round, Stop};
use crate::Q16;
use alloc::vec::Vec;

/// Interior stops up to which every permutation is searched.
pub const EXACT_LIMIT: usize = 8;

/// The result of searching one round's orderings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResequenceOutcome {
    pub round_id: usize,
    /// False when the round had more than [`EXACT_LIMIT`] interior stops, in
    /// which case nothing below is a search result.
    pub searched: bool,
    /// POSITIONS in `round.stops`, in the order supplied. Always `0..m`.
    ///
    /// Positions, not stop ids: `apply` needs to index back into the round, and
    /// a round may legitimately visit the same node twice — a depot appears at
    /// both ends — so ids do not identify a slot. Use [`Self::best_ids`] when
    /// what is wanted is the node sequence.
    pub original: Vec<usize>,
    /// Positions in `round.stops` in the best order found. Equal to `original`
    /// when nothing beat it.
    pub best: Vec<usize>,
    pub original_cost_q16: i64,
    pub best_cost_q16: i64,
    pub infeasible_before: usize,
    pub infeasible_after: usize,
}

impl ResequenceOutcome {
    /// True when the order actually moved.
    pub fn changed(&self) -> bool {
        self.searched && self.best != self.original
    }
    /// Time saved, in Q16.16. Never negative: the original is always a candidate.
    pub fn saving_q16(&self) -> i64 {
        self.original_cost_q16 - self.best_cost_q16
    }
    /// The best order as node ids, which is what a matrix and a route sheet
    /// both speak. Needs the round the outcome came from, because the outcome
    /// itself stores positions.
    pub fn best_ids(&self, round: &Round) -> Vec<usize> {
        self.best.iter().map(|&p| round.stops[p].id).collect()
    }
    /// The supplied order as node ids.
    pub fn original_ids(&self, round: &Round) -> Vec<usize> {
        self.original.iter().map(|&p| round.stops[p].id).collect()
    }
}

/// What a whole-fleet re-sequencing pass concluded.
///
/// Aggregates are over rounds, never over stops: "3 of 4 rounds hold" is a
/// sentence a planner can act on, and "17 of 22 stops hold" is not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FleetOutcome {
    pub rounds_total: usize,
    /// Rounds with no window breach as supplied.
    pub feasible_before: usize,
    /// Rounds with no window breach in their best order.
    pub feasible_after: usize,
    /// Rounds too long for exhaustive search, returned untouched.
    pub unsearched: usize,
    pub total_cost_before_q16: i64,
    pub total_cost_after_q16: i64,
    pub outcomes: Vec<ResequenceOutcome>,
}

impl FleetOutcome {
    /// True when every round holds after re-sequencing.
    pub fn fully_repaired(&self) -> bool {
        self.feasible_after == self.rounds_total
    }
    /// True when no round's order moved.
    pub fn is_no_op(&self) -> bool {
        self.outcomes.iter().all(|o| !o.changed())
    }
    /// Travel time saved across the fleet, Q16.16. Never negative.
    pub fn saving_q16(&self) -> i64 {
        self.total_cost_before_q16 - self.total_cost_after_q16
    }
}

/// Re-sequences every round against one shared matrix.
///
/// Rounds are processed in the order given and never interact: the vehicle
/// assignment is an input, not something this searches. That is what makes the
/// pass order-independent — swapping two rounds in the input swaps two entries
/// in `outcomes` and changes nothing else.
pub fn resequence_fleet(rounds: &[Round], matrix: &[Q16], n: usize) -> FleetOutcome {
    let mut out = FleetOutcome {
        rounds_total: rounds.len(),
        feasible_before: 0,
        feasible_after: 0,
        unsearched: 0,
        total_cost_before_q16: 0,
        total_cost_after_q16: 0,
        outcomes: Vec::with_capacity(rounds.len()),
    };
    for round in rounds {
        let o = resequence_round(round, matrix, n);
        if o.infeasible_before == 0 {
            out.feasible_before += 1;
        }
        if o.infeasible_after == 0 {
            out.feasible_after += 1;
        }
        if !o.searched {
            out.unsearched += 1;
        }
        out.total_cost_before_q16 += o.original_cost_q16;
        out.total_cost_after_q16 += o.best_cost_q16;
        out.outcomes.push(o);
    }
    out
}

/// Total travel for one ordering, plus how many stops miss their window.
///
/// `order` holds POSITIONS in `stops`; the matrix is indexed by `Stop::id`,
/// which is the stop's row in the caller's node table. Those two index spaces
/// are distinct, and conflating them was a real bug here — it only showed up
/// once `apply` reordered a round and the positions stopped matching the ids.
///
/// The first and last entries of a round are its depot legs and stay pinned —
/// a vehicle that starts somewhere other than the depot is a different problem.
fn evaluate(order: &[usize], stops: &[Stop], matrix: &[Q16], n: usize, depart: Q16) -> (i64, usize) {
    let mut cost: i64 = 0;
    let mut t: i64 = depart as i64;
    let mut infeasible = 0usize;
    for w in order.windows(2) {
        let leg = matrix[stops[w[0]].id * n + stops[w[1]].id] as i64;
        cost += leg;
        t += leg;
        let s = &stops[w[1]];
        if t < s.open_q16 as i64 {
            t = s.open_q16 as i64; // wait for the window to open
        }
        if t > s.close_q16 as i64 {
            infeasible += 1;
        }
    }
    (cost, infeasible)
}

/// Every permutation of `items`, in lexicographic order of the input.
///
/// Heap's algorithm would be faster and would not emit in a defined order.
/// This one does, which is what makes the tie-break below reproducible.
fn permutations(items: &[usize]) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    let mut current = Vec::with_capacity(items.len());
    let mut used = alloc::vec![false; items.len()];
    fn walk(
        items: &[usize], used: &mut Vec<bool>, current: &mut Vec<usize>, out: &mut Vec<Vec<usize>>,
    ) {
        if current.len() == items.len() {
            out.push(current.clone());
            return;
        }
        for i in 0..items.len() {
            if used[i] {
                continue;
            }
            used[i] = true;
            current.push(items[i]);
            walk(items, used, current, out);
            current.pop();
            used[i] = false;
        }
    }
    walk(items, &mut used, &mut current, &mut out);
    out
}

/// Searches one round's interior orderings against a supplied matrix.
///
/// `matrix` is row-major `n × n` in the same Q16.16 unit as the windows, and
/// indices are positions in `round.stops`.
pub fn resequence_round(round: &Round, matrix: &[Q16], n: usize) -> ResequenceOutcome {
    let m = round.stops.len();
    let original: Vec<usize> = (0..m).collect();
    let (orig_cost, orig_bad) = evaluate(&original, &round.stops, matrix, n, round.depart_q16);

    let mut out = ResequenceOutcome {
        round_id: round.id,
        searched: false,
        original: original.clone(),
        best: original.clone(),
        original_cost_q16: orig_cost,
        best_cost_q16: orig_cost,
        infeasible_before: orig_bad,
        infeasible_after: orig_bad,
    };

    // First and last stay pinned, so the interior is what gets permuted.
    if m < 3 {
        out.searched = true;
        return out;
    }
    let interior: Vec<usize> = (1..m - 1).collect();
    if interior.len() > EXACT_LIMIT {
        return out; // searched stays false — nothing here is a search result
    }
    out.searched = true;

    // Rank by (infeasible, cost, sequence). Feasibility dominates: a cheaper
    // route that misses a window is not an improvement. The sequence breaks
    // remaining ties so the lexicographically smallest always wins.
    let mut best_key = (orig_bad, orig_cost, original.clone());
    for perm in permutations(&interior) {
        let mut order = Vec::with_capacity(m);
        order.push(0);
        order.extend_from_slice(&perm);
        order.push(m - 1);
        let (cost, bad) = evaluate(&order, &round.stops, matrix, n, round.depart_q16);
        let key = (bad, cost, order);
        if key < best_key {
            best_key = key;
        }
    }
    out.infeasible_after = best_key.0;
    out.best_cost_q16 = best_key.1;
    out.best = best_key.2;
    out
}

/// Applies an outcome's ordering to a round, leaving windows and ids intact.
pub fn apply(round: &Round, outcome: &ResequenceOutcome, matrix: &[Q16], n: usize) -> Round {
    let stops: Vec<Stop> = outcome
        .best
        .iter()
        .enumerate()
        .map(|(pos, &idx)| {
            let mut s = round.stops[idx];
            // Travel into this stop is now the leg from whatever precedes it.
            s.travel_q16 = if pos == 0 {
                0
            } else {
                matrix[round.stops[outcome.best[pos - 1]].id * n + round.stops[idx].id]
            };
            s
        })
        .collect();
    Round { id: round.id, depart_q16: round.depart_q16, stops }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Q16_ONE;

    fn q(v: i32) -> Q16 { v * Q16_ONE }
    fn stop(id: usize, open: i32, close: i32) -> Stop {
        Stop { id, open_q16: q(open), close_q16: q(close), travel_q16: 0 }
    }

    /// Depot, three stops, depot. The given order is the expensive one.
    fn line_round() -> (Round, Vec<Q16>, usize) {
        // The matrix is indexed by Stop::id, so these are the line coordinates
        // of nodes 0..4: depot 0, A 1, B 2, C 3, and node 4 is the depot again.
        let pos = [0i32, 1, 2, 3, 0];
        let n = 5;
        let mut m = alloc::vec![0; n * n];
        for i in 0..n {
            for j in 0..n {
                m[i * n + j] = q((pos[i] - pos[j]).abs());
            }
        }
        // Given order visits C, A, B — a zig-zag.
        let round = Round {
            id: 1,
            depart_q16: 0,
            stops: alloc::vec![
                stop(0, 0, 1000),
                stop(3, 0, 1000),   // C
                stop(1, 0, 1000),   // A
                stop(2, 0, 1000),   // B
                stop(4, 0, 1000),
            ],
        };
        (round, m, n)
    }

    #[test]
    fn an_inefficient_order_is_improved_and_the_saving_is_real() {
        let (round, m, n) = line_round();
        let out = resequence_round(&round, &m, n);
        assert!(out.searched);
        assert!(out.changed(), "a zig-zag must be beaten by a monotone walk");
        assert!(out.saving_q16() > 0);
        assert!(out.best_cost_q16 < out.original_cost_q16);
    }

    #[test]
    fn the_original_is_always_a_candidate_so_saving_is_never_negative() {
        let (round, m, n) = line_round();
        let out = resequence_round(&round, &m, n);
        assert!(out.saving_q16() >= 0);
    }

    #[test]
    fn feasibility_beats_cost() {
        let (mut round, m, n) = line_round();
        // Make the cheap order miss a window, so the search must reject it.
        round.stops[1].close_q16 = q(1); // C must be reached almost immediately
        let out = resequence_round(&round, &m, n);
        assert!(out.infeasible_after <= out.infeasible_before,
                "re-sequencing must never increase the number of missed windows");
    }

    #[test]
    fn a_round_too_long_to_search_is_reported_not_guessed() {
        let n = EXACT_LIMIT + 3;
        let m = alloc::vec![q(1); n * n];
        // 30_000 rather than 100_000: Q16.16 caps at 32,767, and q(100_000)
        // overflows i32 — the engine's own range limit, hit by the test first.
        let stops: Vec<Stop> = (0..n).map(|i| stop(i, 0, 30_000)).collect();
        let round = Round { id: 9, depart_q16: 0, stops };
        let out = resequence_round(&round, &m, n);
        assert!(!out.searched, "must not claim a result it did not search for");
        assert!(!out.changed());
    }

    #[test]
    fn resequencing_is_deterministic_across_repeated_calls() {
        let (round, m, n) = line_round();
        let first = resequence_round(&round, &m, n);
        for _ in 0..8 {
            assert_eq!(resequence_round(&round, &m, n), first);
        }
    }

    #[test]
    fn apply_rewrites_travel_from_the_matrix() {
        let (round, m, n) = line_round();
        let out = resequence_round(&round, &m, n);
        let fixed = apply(&round, &out, &m, n);
        assert_eq!(fixed.stops[0].travel_q16, 0, "nothing precedes the first stop");
        let (cost, _) = evaluate(&(0..fixed.stops.len()).collect::<Vec<_>>(),
                                &fixed.stops, &m, n, 0);
        assert_eq!(cost, out.best_cost_q16, "applied round must cost what was searched");
    }
}
