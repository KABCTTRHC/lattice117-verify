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
    /// Always false. This is a heuristic; see the module docs.
    pub exact: bool,
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
    tour.windows(2).map(|w| matrix[w[0] * n + w[1]] as i64).sum()
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

/// Optimises an unassigned instance with a caller-supplied QUBO solver.
pub fn solve_unassigned(
    matrix: &[Q16],
    n: usize,
    qubo_solver_fn: impl Fn(&[i32; 32 * 32], i32, i32) -> u32,
) -> GlobalOutcome {
    let LogisticsResult { route, total_distance_q16, cluster_count, qubo_solution_valid, .. } =
        kondo::solve_logistics_kondo(matrix, n, qubo_solver_fn);
    let tour = depot_first(&route);
    GlobalOutcome {
        cost_q16: tour_cost(&tour, matrix, n),
        pipeline_cost_q16: total_distance_q16 as i64,
        clusters: cluster_count,
        qubo_valid: qubo_solution_valid,
        exact: false,
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

    #[test]
    fn a_tour_starts_and_ends_at_the_depot_and_visits_everything_once() {
        let n = 9;
        let out = solve_unassigned_default(&line(n), n);
        assert!(out.visits_every_node_once(n), "tour was {:?}", out.tour);
    }

    #[test]
    fn the_recomputed_cost_is_positive_and_the_result_never_claims_optimality() {
        let n = 9;
        let out = solve_unassigned_default(&line(n), n);
        assert!(out.cost_q16 > 0);
        assert!(!out.exact, "the global path is a heuristic and must say so");
    }

    #[test]
    fn the_global_path_is_deterministic_across_repeated_calls() {
        let n = 9;
        let m = line(n);
        let first = solve_unassigned_default(&m, n);
        for _ in 0..8 {
            assert_eq!(solve_unassigned_default(&m, n), first);
        }
    }

    /// The cost the pipeline accumulates is over its own open walk; the cost
    /// here is over the closed depot-first tour. They differ by the closing leg,
    /// which is exactly what `cost_agrees` is for: it must not silently be true.
    #[test]
    fn the_two_cost_figures_are_compared_rather_than_assumed_equal() {
        let n = 9;
        let m = line(n);
        let out = solve_unassigned_default(&m, n);
        let closing = out.tour[out.tour.len() - 2];
        let expected_gap = m[closing * n] as i64;
        assert_eq!(
            out.cost_q16 - out.pipeline_cost_q16,
            expected_gap,
            "the only permitted difference is the leg back to the depot"
        );
        assert_eq!(out.cost_agrees(), expected_gap == 0);
    }
}
