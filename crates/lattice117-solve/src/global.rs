//! Tier 5, second stage — a whole instance with no vehicle assignment.
//!
//! # When this, and when [`crate::resequence`]
//!
//! [`crate::resequence`] is the first stage and the one that applies to a route
//! sheet: the sheet names the vehicle, so the assignment is data and only the
//! order within each round is open. This module is for the other case — a bare
//! distance matrix with no partition — where there is no planner decision to
//! preserve and the clustering itself has to be chosen.
//!
//! That is a strictly weaker guarantee and the API says so. Re-sequencing
//! returns *the* optimum for rounds up to [`crate::resequence::EXACT_LIMIT`];
//! this returns the best tour the Kondo pipeline found, which is a heuristic
//! result and is labelled [`GlobalOutcome::exact`] `false` always. Nothing here
//! ever claims optimality.
//!
//! # Determinism
//!
//! `kondo`'s annealer is a fixed-seed LCG over integer arithmetic with an
//! integer Metropolis acceptance (`fast_exp_negative`, not `f64::exp`), and the
//! step count is fixed rather than wall-clock bounded. So the tour is a pure
//! function of the matrix. The cost reported below is **recomputed from the
//! matrix** over the returned tour rather than taken from the pipeline's own
//! running total: two numbers that are supposed to agree should be checked
//! against each other, not assumed, and [`GlobalOutcome::cost_agrees`] is that
//! check made visible.

use crate::kondo::{self, LogisticsResult};
use crate::repair::{Round, Stop};
use crate::resequence::{self, EXACT_LIMIT};
use crate::Q16;
use alloc::vec::Vec;

/// A tour over an unassigned instance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalOutcome {
    /// Node ids, depot first, depot repeated last. Every other node appears once.
    pub tour: Vec<usize>,
    /// Travel over `tour`, recomputed from the matrix in Q16.16.
    pub cost_q16: i64,
    /// Cost the Kondo pipeline reported for its own route, for comparison.
    pub pipeline_cost_q16: i64,
    pub clusters: usize,
    /// False when the inter-cluster QUBO solve produced an invalid tour and the
    /// pipeline fell back to visiting clusters in index order.
    pub qubo_valid: bool,
    /// True only when the instance was small enough to be searched
    /// exhaustively, in which case `tour` is *the* optimum and not a guess.
    ///
    /// This was `false` unconditionally until Fixture B measured what the
    /// heuristic actually costs on an instance whose optimum is known — 83.9%
    /// above it on a nine-node circle. An instance that small has no business
    /// going through a heuristic at all, so it no longer does.
    pub exact: bool,
    /// How much the 2-opt pass removed, Q16.16. Zero when it found nothing, or
    /// when the exact path was taken and there was nothing to improve.
    pub uncrossed_q16: i64,
}

impl GlobalOutcome {
    /// True when every node 0..n appears exactly once in the interior.
    pub fn visits_every_node_once(&self, n: usize) -> bool {
        if self.tour.len() != n + 1 || self.tour.first() != Some(&0) || self.tour.last() != Some(&0)
        {
            return false;
        }
        let mut seen = alloc::vec![false; n];
        for &node in &self.tour[..n] {
            if node >= n || seen[node] {
                return false;
            }
            seen[node] = true;
        }
        seen.iter().all(|&s| s)
    }
    /// True when the recomputed cost matches the pipeline's own running total.
    ///
    /// They are computed over the same tour by different code, so a mismatch is
    /// a real defect in one of them and worth surfacing rather than hiding
    /// behind whichever number was picked to display.
    pub fn cost_agrees(&self) -> bool {
        self.cost_q16 == self.pipeline_cost_q16
    }
}

/// Total travel over a tour, read straight from the matrix.
fn tour_cost(tour: &[usize], matrix: &[Q16], n: usize) -> i64 {
    tour.windows(2)
        .map(|w| matrix[w[0] * n + w[1]] as i64)
        .sum()
}

/// Deterministic 2-opt: repeatedly reverse the segment that saves the most.
///
/// # Why this is here at all
///
/// The Kondo pipeline has no true ordering step. `solve_intra_cluster_chain`
/// sorts a cluster's members by distance to the cluster centre, and its own
/// documentation says as much — "a filtered, pre-sorted order, not an
/// independently re-optimized visiting sequence". On points in convex position
/// every node is the same distance from the centre, so that sort carries no
/// information at all and the tour comes back crossing itself repeatedly.
/// Scaling the cluster count was necessary and is not sufficient: the ordering
/// has to come from somewhere, and this is where it now comes from.
///
/// # Determinism
///
/// Best-improvement, not first-improvement, and ties go to the lowest `(i, j)`
/// — the same rule `resequence` uses. Best-improvement is what makes the result
/// independent of scan order; with first-improvement the answer would depend on
/// where the loop happened to start. Only a strictly positive gain is taken, so
/// the pass cannot oscillate between two tours of equal cost. It is bounded by
/// `max_rounds` rather than by convergence, so a matrix that violates the
/// triangle inequality cannot spin it forever. Every comparison is integer.
///
/// # Both endpoints are pinned, and that is correct HERE
///
/// `depot_first` closes the tour: `tour[0]` and `tour[len - 1]` are both the
/// depot. Reversing any interior segment is then the standard 2-opt move and
/// pinning the ends costs nothing, because they are the same node.
///
/// **`sovereign_api/kondo_router` deliberately differs.** Its
/// `solve_logistics_kondo` returns an OPEN walk from the depot, and there the
/// tail must be free: with it pinned, no sequence of moves can change which
/// node the walk finishes on, so a walk ending in the wrong place is stuck
/// there. That cost a seventeen-node ring 37.6% above its own optimum before it
/// was found. The two copies are not out of sync — they operate on different
/// shapes, and neither form is right for the other's.
fn two_opt(tour: &mut [usize], matrix: &[Q16], n: usize, max_rounds: usize) -> i64 {
    let at = |a: usize, b: usize| matrix[a * n + b] as i64;
    let mut saved: i64 = 0;
    let len = tour.len();
    if len < 5 {
        return 0; // no segment whose reversal changes anything
    }
    for _ in 0..max_rounds {
        let mut best: Option<(i64, usize, usize)> = None;
        for i in 1..len - 2 {
            for j in i + 1..len - 1 {
                // Reversing tour[i..=j] exchanges two edges for two others.
                let before = at(tour[i - 1], tour[i]) + at(tour[j], tour[j + 1]);
                let after = at(tour[i - 1], tour[j]) + at(tour[i], tour[j + 1]);
                let delta = before - after;
                if delta > 0 && best.map_or(true, |(d, _, _)| delta > d) {
                    best = Some((delta, i, j));
                }
            }
        }
        match best {
            Some((delta, i, j)) => {
                tour[i..=j].reverse();
                saved += delta;
            }
            None => break, // locally optimal under 2-opt
        }
    }
    saved
}

/// Solves a small instance exactly, by exhaustive search over the interior.
///
/// Returns `None` when the instance is too large, which hands it back to the
/// heuristic. The bound is `resequence`'s own, so the crate has exactly one
/// definition of "small enough to be certain about".
fn solve_exactly(matrix: &[Q16], n: usize) -> Option<GlobalOutcome> {
    if n < 2 || n - 1 > EXACT_LIMIT {
        return None;
    }
    // No binding windows, so only distance decides — which is what makes this a
    // TSP rather than a VRPTW, and therefore comparable to a published optimum.
    let open = 0;
    let close = Q16::MAX;
    let mut stops: Vec<Stop> = (0..n)
        .map(|id| Stop {
            id,
            open_q16: open,
            close_q16: close,
            travel_q16: 0,
        })
        .collect();
    stops.push(Stop {
        id: 0,
        open_q16: open,
        close_q16: close,
        travel_q16: 0,
    });
    let round = Round {
        id: 0,
        depart_q16: 0,
        stops,
    };

    let out = resequence::resequence_round(&round, matrix, n);
    if !out.searched {
        return None;
    }
    let tour = out.best_ids(&round);
    let cost = tour_cost(&tour, matrix, n);
    Some(GlobalOutcome {
        cost_q16: cost,
        // Nothing else computed a figure to disagree with, so the two match by
        // construction here rather than by luck.
        pipeline_cost_q16: cost,
        clusters: 1,
        qubo_valid: true,
        exact: true,
        uncrossed_q16: 0,
        tour,
    })
}

/// Rotates a tour so the depot (node 0) leads, then closes it back to the depot.
///
/// The pipeline returns a cluster-ordered walk that may start anywhere. A tour
/// is a cycle, so rotating it changes no cost on a symmetric matrix and makes
/// the result comparable between runs and printable next to a route sheet, which
/// always starts at the depot.
fn depot_first(route: &[u32]) -> Vec<usize> {
    let mut nodes: Vec<usize> = route.iter().map(|&v| v as usize).collect();
    if let Some(at) = nodes.iter().position(|&v| v == 0) {
        nodes.rotate_left(at);
    }
    nodes.push(0);
    nodes
}

/// Iterations the 2-opt pass is allowed. Each removes at least one crossing and
/// a tour has finitely many, so this is a safety stop rather than a budget —
/// reaching it means the matrix is pathological, not that the answer was cut
/// short.
pub const MAX_TWO_OPT_ROUNDS: usize = 256;

/// Optimises an unassigned instance with a caller-supplied QUBO solver.
pub fn solve_unassigned(
    matrix: &[Q16],
    n: usize,
    qubo_solver_fn: impl Fn(&[i32; 32 * 32], i32, i32) -> u32,
) -> GlobalOutcome {
    // Small instances are solved, not approximated. Clustering exists to make a
    // large instance tractable; on a small one it destroys the global structure
    // and buys nothing, which Fixture B measured at 83.9% above the optimum.
    if let Some(exact) = solve_exactly(matrix, n) {
        return exact;
    }

    let LogisticsResult {
        route,
        total_distance_q16,
        cluster_count,
        qubo_solution_valid,
        ..
    } = kondo::solve_logistics_kondo(matrix, n, qubo_solver_fn);
    let mut tour = depot_first(&route);
    let uncrossed_q16 = two_opt(&mut tour, matrix, n, MAX_TWO_OPT_ROUNDS);
    GlobalOutcome {
        cost_q16: tour_cost(&tour, matrix, n),
        // The pipeline's own figure is for its own route, BEFORE 2-opt. Left as
        // it was rather than overwritten: `cost_agrees` exists to surface a
        // disagreement between two numbers that ought to match, and quietly
        // restating the improved one here would make it always agree and so
        // say nothing.
        pipeline_cost_q16: total_distance_q16 as i64,
        clusters: cluster_count,
        qubo_valid: qubo_solution_valid,
        exact: false,
        uncrossed_q16,
        tour,
    }
}

/// Optimises an unassigned instance with the crate's own integer annealer.
pub fn solve_unassigned_default(matrix: &[Q16], n: usize) -> GlobalOutcome {
    solve_unassigned(matrix, n, kondo::default_qubo_solver)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Q16_ONE;

    /// Nodes on a line, node i at position i. Distances are `|i - j|`, so every
    /// assertion below can be checked by hand.
    fn line(n: usize) -> Vec<Q16> {
        let mut m = alloc::vec![0; n * n];
        for i in 0..n {
            for j in 0..n {
                m[i * n + j] = (i as i32 - j as i32).abs() * Q16_ONE;
            }
        }
        m
    }

    /// A regular n-gon's distance matrix, built from a chord table.
    ///
    /// On a regular polygon the distance between two vertices depends only on
    /// how many vertices apart they are, so the matrix needs no coordinates and
    /// no trigonometry at test time. Each entry is `2R sin(pi k / n)` km at
    /// 30 km/h in minutes, scaled to Q16.16, for R = 10 km:
    ///
    /// ```text
    /// [round(2*10*math.sin(math.pi*k/n)/30*60*65536) for k in range(n//2+1)]
    /// ```
    ///
    /// The table has to be a REAL chord function or the tests mean nothing: the
    /// theorem they rest on is that the optimal tour of points in convex
    /// position is the hull order, and an invented monotone table is not points
    /// in convex position. The first draft here was hand-written and a few
    /// hundred ulps off the true chords — close enough to pass, which is worse
    /// than failing.
    fn circle(n: usize) -> Vec<Q16> {
        let chords: &[i64] = match n {
            9 => &[0, 896_585, 1_685_029, 2_270_234, 2_581_614],
            _ => panic!("no chord table for n = {n}"),
        };
        let mut m = alloc::vec![0; n * n];
        for i in 0..n {
            for j in 0..n {
                let d = (i as i64 - j as i64).unsigned_abs() as usize;
                m[i * n + j] = chords[d.min(n - d)] as Q16;
            }
        }
        m
    }

    #[test]
    fn a_small_instance_is_solved_exactly_rather_than_approximated() {
        // Nine nodes: eight interior, which is exactly EXACT_LIMIT.
        let n = EXACT_LIMIT + 1;
        let m = line(n);
        let out = solve_unassigned_default(&m, n);
        assert!(
            out.exact,
            "an instance this small must not go through a heuristic"
        );
        assert!(out.visits_every_node_once(n), "tour was {:?}", out.tour);
        // On a line the optimum is out and back: 2 * (n - 1) units.
        assert_eq!(out.cost_q16, 2 * (n as i64 - 1) * Q16_ONE as i64);
        assert!(
            out.cost_agrees(),
            "nothing else computed a figure to disagree with"
        );
        assert_eq!(out.uncrossed_q16, 0, "there was nothing left to uncross");
    }

    #[test]
    fn one_node_past_the_limit_falls_back_to_the_heuristic_and_says_so() {
        let n = EXACT_LIMIT + 2;
        let m = line(n);
        let out = solve_unassigned_default(&m, n);
        assert!(
            !out.exact,
            "past EXACT_LIMIT the answer is a heuristic and must say so"
        );
        assert!(out.visits_every_node_once(n), "tour was {:?}", out.tour);
    }

    #[test]
    fn the_heuristic_path_still_visits_every_node_once_on_a_large_instance() {
        let n = 40;
        let out = solve_unassigned_default(&line(n), n);
        assert!(!out.exact);
        assert!(out.visits_every_node_once(n), "tour was {:?}", out.tour);
        assert!(out.cost_q16 > 0);
    }

    #[test]
    fn both_paths_are_deterministic_across_repeated_calls() {
        for n in [EXACT_LIMIT + 1, 40] {
            let m = line(n);
            let first = solve_unassigned_default(&m, n);
            for _ in 0..8 {
                assert_eq!(solve_unassigned_default(&m, n), first, "n = {n}");
            }
        }
    }

    /// 2-opt on a tour built to cross itself: the fix must be found, and the
    /// saving reported must be exactly the saving made.
    #[test]
    fn two_opt_uncrosses_and_reports_what_it_saved() {
        let n = 6;
        let m = line(n);
        // 0 -> 3 -> 2 -> 1 -> 4 -> 5 -> 0 doubles back twice.
        let mut tour = alloc::vec![0, 3, 2, 1, 4, 5, 0];
        let before = tour_cost(&tour, &m, n);
        let saved = two_opt(&mut tour, &m, n, MAX_TWO_OPT_ROUNDS);
        let after = tour_cost(&tour, &m, n);
        assert!(saved > 0, "a doubled-back tour has crossings to remove");
        assert_eq!(
            before - after,
            saved,
            "the reported saving must be the real one"
        );
        // On a line the optimum is out and back, 2 * (n - 1).
        assert_eq!(after, 2 * (n as i64 - 1) * Q16_ONE as i64);
    }

    #[test]
    fn two_opt_is_a_no_op_on_a_tour_that_is_already_optimal() {
        let n = 6;
        let m = line(n);
        let mut tour: Vec<usize> = (0..n).chain(core::iter::once(0)).collect();
        let before = tour.clone();
        assert_eq!(two_opt(&mut tour, &m, n, MAX_TWO_OPT_ROUNDS), 0);
        assert_eq!(tour, before, "an optimal tour must come back untouched");
    }

    /// Only a strictly positive gain is taken, so a matrix full of equal
    /// distances cannot make the pass flip between equal-cost tours forever.
    #[test]
    fn two_opt_does_not_oscillate_on_equal_cost_moves() {
        let n = 7;
        let m = alloc::vec![Q16_ONE; n * n];
        let mut tour: Vec<usize> = (0..n).chain(core::iter::once(0)).collect();
        let before = tour.clone();
        assert_eq!(two_opt(&mut tour, &m, n, MAX_TWO_OPT_ROUNDS), 0);
        assert_eq!(tour, before);
    }

    /// The regression Fixture B found, at unit-test range: the convex instance
    /// that used to come back 83.9% above the proven optimum.
    #[test]
    fn the_convex_instance_that_was_83_9_percent_off_is_now_exact() {
        let n = 9;
        let m = circle(n);
        let optimum: i64 = (0..n).map(|i| m[i * n + (i + 1) % n] as i64).sum();
        let out = solve_unassigned_default(&m, n);
        assert!(out.exact);
        assert_eq!(out.cost_q16, optimum, "the perimeter is the optimum here");
    }

    /// The one figure `cost_agrees` exists to expose. On the heuristic path the
    /// pipeline's running total is over its own OPEN walk and the cost here is
    /// over the CLOSED, 2-opted tour, so they are not expected to match — and
    /// the flag must report that rather than being quietly made true.
    #[test]
    fn the_two_cost_figures_are_compared_rather_than_assumed_equal() {
        let n = 40;
        let m = line(n);
        let out = solve_unassigned_default(&m, n);
        assert_eq!(
            out.cost_agrees(),
            out.cost_q16 == out.pipeline_cost_q16,
            "the flag must describe the two numbers, not assert them equal"
        );
        assert!(
            out.uncrossed_q16 >= 0,
            "2-opt can only remove cost, never add it"
        );
    }
}
