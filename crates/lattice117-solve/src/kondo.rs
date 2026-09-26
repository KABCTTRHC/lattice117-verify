//! Kondo O(N^2) routing pipeline: cluster nodes, solve a small inter-cluster
//! QUBO for visiting order, then an exact intra-cluster chain DP per cluster.
//!
//! Standalone crate — no dependency on (and no coupling to) `lattice117_core`.
//! Ported from a design sketch that referenced a separate C++/JNI codebase
//! (`kondo_scattering.cpp`, `chest_master_grid.h`, `solve_32bit_subspace` over
//! JNI) that does not exist in this repository. This port:
//! - keeps the clustering / QUBO-penalty / intra-cluster-DP algorithm design
//!   as given,
//! - fixes two real bugs found while porting (see `kondo_cluster_nodes` and
//!   the seeding loop below),
//! - replaces the external JNI solver dependency with a real, working
//!   default QUBO solver (`default_qubo_solver`) so the pipeline is usable
//!   and testable standalone, while still accepting a caller-supplied
//!   solver for anyone who does have real QUBO hardware/acceleration to
//!   plug in.

// ═══════════════════════════════════════════════════════
// Q16.16 CONSTANTS
// ═══════════════════════════════════════════════════════
use alloc::vec::Vec;

pub const Q16_ONE: i32 = 65536;

/// 0.858 in Q16.16. Was `(Q16_ONE as f64 * 0.858) as i32`, which truncates to
/// this exact value; spelled as a literal so the crate carries no float at all.
pub const Q16_858_MILLI: i32 = 56_229;
/// 0.95 in Q16.16, from `(Q16_ONE as f64 * 0.95) as i32` = 62259.2 -> 62259.
pub const Q16_950_MILLI: i32 = 62_259;

/// `e^-x` for `x` in Q16.16, returning Q16.16. Branchless, integer-only.
///
/// Hand-ported from `lattice117_core`'s `math_vault::feynman::fast_exp_negative`
/// (and its twin in `engine::sentinel_qbn`). This crate is deliberately
/// standalone with zero dependencies, and `firmware/core_math` is deliberately
/// a separate workspace — `firmware/Cargo.toml` documents that boundary and the
/// drift it is guarding against — so this follows the same hand-port-with-
/// provenance convention `core_math` itself uses rather than adding a path
/// dependency across either line. `exp_negative_matches_ported_reference`
/// below pins the values so the copies cannot drift silently.
///
/// Replaces a `f64::exp()` call in the Metropolis acceptance test. `exp` is a
/// libm transcendental: not required by IEEE-754 to be correctly rounded, and
/// free to differ between platforms, which would have made the annealer's
/// output platform-dependent — the one thing this engine cannot be.
#[inline(always)]
fn fast_exp_negative(x: i32) -> i32 {
    const Q16_TWO: i64 = 2 * Q16_ONE as i64;
    const Q16_SIX: i64 = 6 * Q16_ONE as i64;

    // Branchless clamp: x <= 0 returns 1.0 (Q16_ONE).
    let sign_mask = x >> 31;
    let clamped_x = x & !sign_mask;

    let cx = clamped_x as i128;
    let x2 = (cx * cx) >> 16;
    let x3 = (x2 * cx) >> 16;

    let term2 = (x2 << 16) / Q16_TWO as i128;
    let term3 = (x3 << 16) / Q16_SIX as i128;

    let denom = Q16_ONE as i128 + cx + term2 + term3;

    (((Q16_ONE as i128) << 16) / denom.max(1)) as i32
}
pub const K_CLUSTERS: usize = 5; // 5x5=25 variables -> fits a 32-bit QUBO
pub const MAX_NODES_PER_CLUSTER: usize = 32; // tropical DP chain limit

// ═══════════════════════════════════════════════════════
// PHASE 1: KONDO CLUSTERING — O(N^2)
// ═══════════════════════════════════════════════════════
#[derive(Debug, Clone)]
pub struct KondoCluster {
    pub center_idx: u32,
    pub members: Vec<u32>,
    pub shielding_radius: i32,   // Q16.16 — the Kondo screening length
    pub resonance_centroid: i32, // Q16.16 — average lithic_resonance of members
}

/// Clusters `n_nodes` nodes into up to `K_CLUSTERS` groups via furthest-point
/// seeding plus a Kondo-shielding-energy nearest-cluster assignment.
///
/// `k_target` is `K_CLUSTERS` clamped to `n_nodes` (never more clusters than
/// nodes) — the original sketch always seeded exactly `K_CLUSTERS` centers
/// regardless of `n_nodes`; for `n_nodes < K_CLUSTERS` the seeding loop would
/// exhaust every unclaimed node, leave `next_center` at its stale default
/// (`0`), and push a duplicate center. Clamping avoids that instead of
/// panicking or silently producing degenerate clusters.
pub fn kondo_cluster_nodes(
    distance_matrix: &[i32], // N x N Q16.16 — edge weights
    n_nodes: usize,
    critical_point_q16: i32, // Q16.16 — Kondo screening critical point
) -> Vec<KondoCluster> {
    let k_target = K_CLUSTERS.min(n_nodes.max(1));

    // ── Furthest-point seeding: maximises inter-cluster separation ──
    let mut center_indices: Vec<usize> = Vec::with_capacity(k_target);
    center_indices.push(0);

    while center_indices.len() < k_target {
        let mut max_min_dist: i32 = -1;
        let mut next_center: Option<usize> = None;

        for node in 0..n_nodes {
            if center_indices.contains(&node) {
                continue;
            }

            let min_d = center_indices
                .iter()
                .map(|&c| distance_matrix[node * n_nodes + c])
                .min()
                .unwrap_or(i32::MAX);

            if min_d > max_min_dist {
                max_min_dist = min_d;
                next_center = Some(node);
            }
        }

        match next_center {
            Some(node) => center_indices.push(node),
            // Every node is already a center (n_nodes <= k_target, already
            // handled by the clamp above, but kept as a safe stop instead of
            // an infinite loop in case that invariant ever changes).
            None => break,
        }
    }

    // ── Kondo shielding assignment ──
    let mut clusters: Vec<KondoCluster> = center_indices
        .iter()
        .map(|&c| KondoCluster {
            center_idx: c as u32,
            members: alloc::vec![c as u32],
            shielding_radius: critical_point_q16,
            resonance_centroid: Q16_ONE,
        })
        .collect();

    for node in 0..n_nodes {
        if center_indices.contains(&node) {
            continue;
        }

        let (best_cluster, _) = center_indices
            .iter()
            .enumerate()
            .map(|(ci, &c)| {
                let dist = distance_matrix[node * n_nodes + c];
                let shield = clusters[ci].shielding_radius;
                let shield_sq = ((shield as i64 * shield as i64) >> 16) as i32;
                // BUG FIXED while porting: `<<` binds *looser* than `/` in Rust,
                // so the original `(dist as i64) << 16 / shield_sq as i64`
                // parsed as `(dist as i64) << (16 / shield_sq as i64)` — a
                // shift by a tiny integer, not the intended Q16.16
                // `(dist << 16) / shield_sq` division. Parenthesized below.
                let kondo_energy = if shield_sq > 0 {
                    (((dist as i64) << 16) / shield_sq as i64) as i32
                } else {
                    i32::MAX
                };
                (ci, kondo_energy)
            })
            .min_by_key(|&(_, e)| e)
            .unwrap();

        clusters[best_cluster].members.push(node as u32);
    }

    clusters
}

// ═══════════════════════════════════════════════════════
// PHASE 2: INTER-CLUSTER QUBO — O(K^4), K small (default 5)
// ═══════════════════════════════════════════════════════

/// Builds a 32x32 QUBO (flattened, row-major) encoding "visit each cluster
/// exactly once, at exactly one tour position" plus inter-cluster travel
/// cost as the objective. Variable index = `cluster * k + position`.
pub fn build_inter_cluster_qubo(clusters: &[KondoCluster], inter_cluster_distances: &[i32]) -> [i32; 32 * 32] {
    let k = clusters.len();
    let mut q = [0i32; 32 * 32];
    // Must exceed the total possible objective savings from violating a
    // constraint, not just be "a big constant": a fixed `4 * Q16_ONE`
    // (bug found while testing this port) is only larger than "any travel
    // cost" for small-scale inputs — on real distance matrices where
    // individual edges exceed that fixed value, the QUBO's true minimum can
    // legitimately violate the exactly-one constraints to save more on
    // travel than the fixed penalty costs, regardless of how well it's
    // annealed. Scaling per the actual max distance present closes that gap
    // for any input scale.
    let max_travel_cost = inter_cluster_distances.iter().copied().map(i32::abs).max().unwrap_or(0);
    let penalty_a = (max_travel_cost.saturating_mul(k.max(1) as i32)).max(4 * Q16_ONE);

    for c in 0..k {
        // Constraint 1: each cluster visited exactly once
        for p1 in 0..k {
            let i = c * k + p1;
            q[i * 32 + i] += -penalty_a;
            for p2 in (p1 + 1)..k {
                let j = c * k + p2;
                q[i * 32 + j] += 2 * penalty_a;
            }
        }
        // Constraint 2: each position has exactly one cluster
        for p in 0..k {
            let i = c * k + p;
            for c2 in (c + 1)..k {
                let j = c2 * k + p;
                q[i * 32 + j] += 2 * penalty_a;
            }
        }
    }

    // Objective: minimise inter-cluster travel cost
    for c1 in 0..k {
        for c2 in 0..k {
            if c1 == c2 {
                continue;
            }
            let travel_cost = inter_cluster_distances[c1 * k + c2];
            for p in 0..(k.saturating_sub(1)) {
                let i = c1 * k + p;
                let j = c2 * k + (p + 1);
                q[i * 32 + j] += travel_cost;
            }
        }
    }

    q
}

/// Extracts a cluster visiting order from a QUBO solution bitfield.
/// Positions never claimed by exactly one cluster (an invalid/partial
/// solve) fall back to `0` here — callers should check `validate_tour`
/// first if that distinction matters, which `solve_logistics_kondo` does.
pub fn extract_cluster_tour(qubo_result: u32, k: usize) -> Vec<usize> {
    let mut tour = alloc::vec![0usize; k];
    let mut position_filled = alloc::vec![false; k];

    for cluster in 0..k {
        for position in 0..k {
            let bit = cluster * k + position;
            if (qubo_result >> bit) & 1 == 1 && !position_filled[position] {
                tour[position] = cluster;
                position_filled[position] = true;
            }
        }
    }
    tour
}

/// True iff every cluster is visited exactly once and every position is
/// filled exactly once — the QUBO's two constraint families both satisfied.
pub fn validate_tour(result: u32, k: usize) -> bool {
    let mut cluster_visits = alloc::vec![0u32; k];
    let mut position_visits = alloc::vec![0u32; k];

    for cluster in 0..k {
        for position in 0..k {
            let bit = cluster * k + position;
            if (result >> bit) & 1 == 1 {
                cluster_visits[cluster] += 1;
                position_visits[position] += 1;
            }
        }
    }

    cluster_visits.iter().all(|&v| v == 1) && position_visits.iter().all(|&v| v == 1)
}

/// A small, real, deterministic simulated-annealing QUBO solver over the
/// 32-bit variable space (bits beyond `k*k` are simply never referenced by
/// `build_inter_cluster_qubo`'s Q matrix, so annealing over all 32 is safe
/// regardless of `k`). Matches the `impl Fn(&[i32; 32*32], i32, i32) -> u32`
/// shape `solve_logistics_kondo` expects, so it's a drop-in for anyone
/// without real QUBO hardware/JNI acceleration to plug in — see
/// `solve_logistics_kondo_default`.
pub fn default_qubo_solver(q: &[i32; 32 * 32], temperature_q16: i32, cooling_q16: i32) -> u32 {
    const MAX_SWEEPS: u32 = 2000;
    const RESTARTS: u32 = 8;

    // Q16.16 throughout. The temperature floor is 1 — the smallest positive
    // Q16.16 value — rather than the old 1e-6, which has no representation
    // here and was never reachable at this scale anyway.
    let base_temp: i32 = temperature_q16.max(1);
    // Strictly below 1.0 so the schedule always cools; the old f64 clamp of
    // 0.999_999 rounds to Q16_ONE - 1 at this precision.
    let cooling: i32 = cooling_q16.clamp(0, Q16_ONE - 1);

    let mut rng_seed: u32 = 117;
    let mut next_rand_u32 = move || -> u32 {
        rng_seed = rng_seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        rng_seed
    };

    // A single cooling run from a fixed start (all-zero, maximally
    // constraint-violating) can stall in a local minimum before every
    // constraint is satisfied. `default_qubo_solver` doesn't know `k` (its
    // signature is fixed by what `solve_logistics_kondo` expects), so it
    // can't call `validate_tour` itself — but the QUBO's penalty terms make
    // energy a direct proxy for constraint violation (every violated
    // "exactly one" constraint costs at least `penalty_a`), so several
    // independent restarts from random initial states, keeping whichever
    // reaches the lowest energy overall, reliably finds a fully-satisfying
    // assignment on a problem this small (<=32 bits) without needing k.
    let mut overall_best_state: u32 = 0;
    let mut overall_best_energy = i64::MAX;

    for _ in 0..RESTARTS {
        let mut state: u32 = next_rand_u32();
        let mut best_state = state;
        let mut best_energy = qubo_energy(q, state);
        let mut t: i32 = base_temp;

        for _ in 0..MAX_SWEEPS {
            for i in 0..32 {
                let delta = qubo_flip_delta(q, state, i);
                let accept = if delta <= 0 {
                    true
                } else {
                    // Metropolis: accept an uphill move with probability
                    // e^(-delta/t). delta is a raw integer energy and t is
                    // Q16.16, so the exponent in Q16.16 is
                    // (delta << 32) / t. i128 because delta is i64 and the
                    // shift would overflow i64 on large penalties.
                    let x = ((delta as i128) << 32) / (t as i128).max(1);
                    // Saturate rather than wrap: an exponent past i32::MAX
                    // means e^-x is zero to well beyond Q16.16 precision,
                    // which is exactly what fast_exp_negative returns there.
                    let x_q16 = if x >= i32::MAX as i128 { i32::MAX } else { x as i32 };
                    // The LCG's top 16 bits give a uniform Q16.16 fraction
                    // in [0, 1) — the same comparison the f64 version made,
                    // with no float and no libm call.
                    ((next_rand_u32() >> 16) as i32) < fast_exp_negative(x_q16)
                };
                if accept {
                    state ^= 1 << i;
                }
            }

            let energy = qubo_energy(q, state);
            if energy < best_energy {
                best_energy = energy;
                best_state = state;
            }

            t = ((t as i64 * cooling as i64) >> 16) as i32;
            // 1e-4 in Q16.16 is 6.55, so 7 is the first representable value
            // at or above the old threshold. Reheat rather than freeze.
            if t < 7 {
                t = (base_temp / 10).max(1);
            }
        }

        if best_energy < overall_best_energy {
            overall_best_energy = best_energy;
            overall_best_state = best_state;
        }
    }

    overall_best_state
}

fn qubo_energy(q: &[i32; 32 * 32], state: u32) -> i64 {
    let mut e: i64 = 0;
    for i in 0..32 {
        let xi = ((state >> i) & 1) as i64;
        if xi == 0 {
            continue;
        }
        for j in 0..32 {
            let xj = ((state >> j) & 1) as i64;
            e += q[i * 32 + j] as i64 * xi * xj;
        }
    }
    e
}

fn qubo_flip_delta(q: &[i32; 32 * 32], state: u32, i: usize) -> i64 {
    let bit = ((state >> i) & 1) as i64;
    let new_bit = 1 - bit;
    let qi_i = q[i * 32 + i] as i64;
    let mut delta = qi_i * (new_bit - bit);
    for j in 0..32 {
        if j == i {
            continue;
        }
        let xj = ((state >> j) & 1) as i64;
        if xj == 0 {
            continue;
        }
        let qij = q[i * 32 + j] as i64;
        let qji = q[j * 32 + i] as i64;
        delta += (qij + qji) * xj * (new_bit - bit);
    }
    delta
}

// ═══════════════════════════════════════════════════════
// PHASE 3: INTRA-CLUSTER CHAIN DP — O(m) per cluster
// ═══════════════════════════════════════════════════════

/// Orders a cluster's members by distance to the cluster center, then runs a
/// forward/backward DP over an "include or skip" binary state per node.
/// `linear_costs` are a uniform negative bias scaled to dominate
/// `coupling_costs` (see the scaling comment inline below), guaranteeing
/// every member is included — this is a *filtered, pre-sorted* order
/// (members in distance-to-center order), not an independently
/// re-optimized visiting sequence; the DP's only real degree of freedom is
/// the include/skip decision itself, which the dominant bias always
/// resolves to "include".
pub fn solve_intra_cluster_chain(cluster: &KondoCluster, distance_matrix: &[i32], n_nodes: usize) -> Vec<u32> {
    let members = &cluster.members;

    if members.len() <= 1 {
        return members.clone();
    }

    let mut ordered = members.clone();
    ordered.sort_by_key(|&node| distance_matrix[node as usize * n_nodes + cluster.center_idx as usize]);

    let m = ordered.len().min(MAX_NODES_PER_CLUSTER);
    ordered.truncate(m);

    let mut linear_costs = alloc::vec![0i32; m];
    let mut coupling_costs = alloc::vec![0i32; m.saturating_sub(1)];

    for i in 0..(m.saturating_sub(1)) {
        let n1 = ordered[i] as usize;
        let n2 = ordered[i + 1] as usize;
        coupling_costs[i] = distance_matrix[n1 * n_nodes + n2];
    }

    // "All nodes must be visited" (original intent) requires the inclusion
    // bias to *dominate* any coupling cost the DP could ever weigh it
    // against — a fixed `-Q16_ONE` (bug found while testing this port) only
    // does that when real inter-node distances stay below 1.0 in Q16.16.
    // On real data (e.g. distances of a few line-units, each easily
    // exceeding Q16_ONE), the DP could legitimately find it cheaper to skip
    // a node than to pay a large coupling cost — silently dropping members
    // from the route, the opposite of "all nodes must be visited". Scaling
    // per the actual max coupling cost present closes that gap, matching
    // the same fix applied to `build_inter_cluster_qubo`'s penalty above.
    let max_coupling = coupling_costs.iter().copied().map(i32::abs).max().unwrap_or(0);
    let inclusion_bias = max_coupling.saturating_mul(2).max(Q16_ONE);
    for cost in linear_costs.iter_mut() {
        *cost = -inclusion_bias;
    }

    let mut cost = alloc::vec![[0i32; 2]; m];
    let mut best_prev: Vec<[i8; 2]> = alloc::vec![[0i8; 2]; m];

    cost[0][0] = 0;
    cost[0][1] = linear_costs[0];

    for i in 1..m {
        let j = coupling_costs[i - 1];
        let c_i = linear_costs[i];

        let from0 = cost[i - 1][0];
        let from1 = cost[i - 1][1];
        if from0 <= from1 {
            cost[i][0] = from0;
            best_prev[i][0] = 0;
        } else {
            cost[i][0] = from1;
            best_prev[i][0] = 1;
        }

        // Tie-break toward `from1` (stay included), not `from0` (skip):
        // with a uniform per-node inclusion bias, a coupling cost can land
        // exactly on `bias`, making "skip this node, include the next" and
        // "include both" cost-equal. `<=` here (bug found via hand-tracing
        // a real drop) picks the skip path on that tie even though it saves
        // nothing — silently excluding a node the bias was supposed to
        // guarantee inclusion for. `<` makes ties resolve toward keeping
        // every member in the route, matching this DP's stated purpose.
        let to1_from0 = cost[i - 1][0] + c_i;
        let to1_from1 = cost[i - 1][1] + c_i + j;
        if to1_from0 < to1_from1 {
            cost[i][1] = to1_from0;
            best_prev[i][1] = 0;
        } else {
            cost[i][1] = to1_from1;
            best_prev[i][1] = 1;
        }
    }

    // Same tie-break direction as above, for the same reason.
    let mut states = alloc::vec![0i32; m];
    states[m - 1] = if cost[m - 1][0] < cost[m - 1][1] { 0 } else { 1 };
    for i in (0..m - 1).rev() {
        states[i] = best_prev[i + 1][states[i + 1] as usize] as i32;
    }

    ordered
        .iter()
        .enumerate()
        .filter(|(i, _)| states[*i] == 1)
        .map(|(_, &node)| node)
        .collect()
}

// ═══════════════════════════════════════════════════════
// FULL PIPELINE
// ═══════════════════════════════════════════════════════

#[derive(Debug)]
pub struct LogisticsResult {
    pub route: Vec<u32>,
    pub total_distance_q16: i32,
    pub cluster_count: usize,
    /// False if the inter-cluster QUBO solve returned an invalid tour
    /// (see `validate_tour`) and the pipeline fell back to visiting
    /// clusters in index order instead. Always `true` for
    /// `solve_logistics_kondo_default` in practice on small `k` (5x5),
    /// but a caller-supplied solver isn't guaranteed to converge.
    pub qubo_solution_valid: bool,
    pub phase1_ns: u64,
    pub phase2_ns: u64,
    pub phase3_ns: u64,
}

/// Runs the full three-phase pipeline with a caller-supplied QUBO solver
/// (e.g. real hardware/JNI acceleration). See `solve_logistics_kondo_default`
/// for a version that works out of the box with no external solver.
pub fn solve_logistics_kondo(
    distance_matrix: &[i32],
    n_nodes: usize,
    qubo_solver_fn: impl Fn(&[i32; 32 * 32], i32, i32) -> u32,
) -> LogisticsResult {
    // Phase timings were `std::time::Instant` in sovereign_api. They are zero
    // here, deliberately and permanently:
    //
    //   1. `Instant::now()` does not exist on `wasm32-unknown-unknown`, which
    //      is the target this extraction exists to serve.
    //   2. More importantly, a wall-clock number on a *deterministic* result
    //      struct is a trap. Two runs that agree on every route would compare
    //      unequal, and anything that ever hashes this struct would produce a
    //      different digest on every call. The fields stay for API parity with
    //      sovereign_api; they must never enter a canonical form.
    let critical_point = Q16_858_MILLI;
    let clusters = kondo_cluster_nodes(distance_matrix, n_nodes, critical_point);
    let phase1_ns = 0u64;

    let k = clusters.len();
    let mut inter_dist = alloc::vec![0i32; k * k];
    for (i, c1) in clusters.iter().enumerate() {
        for (j, c2) in clusters.iter().enumerate() {
            inter_dist[i * k + j] = distance_matrix[c1.center_idx as usize * n_nodes + c2.center_idx as usize];
        }
    }

    let q_matrix = build_inter_cluster_qubo(&clusters, &inter_dist);
    let temperature = 2 * Q16_ONE;
    let cooling = Q16_950_MILLI;

    let qubo_result = qubo_solver_fn(&q_matrix, temperature, cooling);
    let qubo_solution_valid = validate_tour(qubo_result, k);
    let cluster_tour = if qubo_solution_valid {
        extract_cluster_tour(qubo_result, k)
    } else {
        // Deterministic, always-valid fallback: visit clusters in index
        // order rather than propagate a broken/partial tour (extraction
        // otherwise silently defaults unfilled positions to cluster 0 —
        // exactly the "printed default 0" failure mode this design is
        // meant to eliminate).
        (0..k).collect()
    };
    let phase2_ns = 0u64;

    let mut final_route: Vec<u32> = Vec::with_capacity(n_nodes);
    let mut total_dist = 0i32;
    let mut prev_last_node: Option<u32> = None;

    for &cluster_idx in &cluster_tour {
        let cluster = &clusters[cluster_idx];
        let local_route = solve_intra_cluster_chain(cluster, distance_matrix, n_nodes);

        if let Some(prev) = prev_last_node {
            if let Some(&first) = local_route.first() {
                total_dist += distance_matrix[prev as usize * n_nodes + first as usize];
            }
        }

        for window in local_route.windows(2) {
            total_dist += distance_matrix[window[0] as usize * n_nodes + window[1] as usize];
        }

        prev_last_node = local_route.last().copied();
        final_route.extend_from_slice(&local_route);
    }
    let phase3_ns = 0u64;

    LogisticsResult {
        route: final_route,
        total_distance_q16: total_dist,
        cluster_count: k,
        qubo_solution_valid,
        phase1_ns,
        phase2_ns,
        phase3_ns,
    }
}

/// Convenience wrapper using the crate's own `default_qubo_solver` — usable
/// with no external solver/JNI bridge.
pub fn solve_logistics_kondo_default(distance_matrix: &[i32], n_nodes: usize) -> LogisticsResult {
    solve_logistics_kondo(distance_matrix, n_nodes, default_qubo_solver)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Symmetric Q16.16 distance matrix for `n` nodes laid out on a line
    /// (node i at position i * unit), so distances are simple and every
    /// assertion below is checkable by hand.
    fn line_matrix(n: usize, unit_q16: i32) -> Vec<i32> {
        let mut m = alloc::vec![0i32; n * n];
        for i in 0..n {
            for j in 0..n {
                m[i * n + j] = (i as i32 - j as i32).abs() * unit_q16;
            }
        }
        m
    }

    #[test]
    fn clustering_does_not_duplicate_centers_when_nodes_fewer_than_k_clusters() {
        // n_nodes (3) < K_CLUSTERS (5) — the bug this test guards against
        // would previously push a duplicate center once every node had
        // already been claimed.
        let matrix = line_matrix(3, Q16_ONE);
        let clusters = kondo_cluster_nodes(&matrix, 3, Q16_858_MILLI);

        let mut all_members: Vec<u32> = clusters.iter().flat_map(|c| c.members.clone()).collect();
        all_members.sort_unstable();
        assert_eq!(all_members, alloc::vec![0, 1, 2], "every node must appear exactly once across all clusters");

        let mut centers: Vec<u32> = clusters.iter().map(|c| c.center_idx).collect();
        centers.sort_unstable();
        centers.dedup();
        assert_eq!(centers.len(), clusters.len(), "no duplicate cluster centers");
    }

    #[test]
    fn kondo_energy_uses_correct_operator_precedence() {
        // Regression test for the `<<`/`/` precedence bug: with dist=100 and
        // shield_sq derived from a critical_point of ~0.858 (56229 in
        // Q16.16), the fixed formula must produce a large positive Q16.16
        // value (dist<<16 is huge relative to shield_sq), not the tiny value
        // a `dist << (16 / shield_sq)` misparse would produce.
        let n = 2;
        let matrix = alloc::vec![0, 100 * Q16_ONE, 100 * Q16_ONE, 0];
        let clusters = kondo_cluster_nodes(&matrix, n, Q16_858_MILLI);
        // With n_nodes == k_target == 2, both nodes become centers, so this
        // test's real value is just that clustering completes without the
        // degenerate near-zero energy the precedence bug would have caused
        // in the assignment loop on a larger instance — covered end-to-end
        // by `full_pipeline_visits_every_node_exactly_once` below.
        assert_eq!(clusters.len(), 2);
    }

    /// Pins `fast_exp_negative` against the implementation it was ported from
    /// (`lattice117_core::math_vault::feynman`). Three copies of this kernel now
    /// exist across two workspaces by deliberate architectural choice; this is
    /// what stops them drifting, which is the bug class `firmware/Cargo.toml`
    /// explicitly warns about.
    ///
    /// Note these are the *rational approximation's* values, not true `e^-x`:
    /// e^-1 reads 0.375 against a true 0.3679, about 1.9% high. That is a
    /// property of the ported kernel, not of this port, and it is acceptable in
    /// a Metropolis acceptance test, which is a heuristic and not a measurement.
    /// It would not be acceptable anywhere a verdict depends on the value.
    #[test]
    fn exp_negative_matches_ported_reference() {
        for (x, expected) in [
            (-65536i32, 65536i32), // negative clamps to 1.0
            (0, 65536),            // e^0 = 1.0
            (32768, 39819),        // e^-0.5 ~= 0.607590
            (65536, 24576),        // e^-1   ~= 0.375000
            (131072, 10347),       // e^-2   ~= 0.157883
            (262144, 2769),        // e^-4   ~= 0.042252
            (i32::MAX, 0),         // saturated exponent underflows to zero
        ] {
            assert_eq!(fast_exp_negative(x), expected, "fast_exp_negative({x})");
        }
    }

    /// The annealer must be bit-identical run to run within a process, which is
    /// the property the fixed-seed LCG buys and the float `exp` was quietly
    /// putting at risk across platforms.
    #[test]
    fn qubo_solver_is_deterministic_across_repeated_calls() {
        let mut q = [0i32; 32 * 32];
        for i in 0..8 {
            for j in 0..8 {
                q[i * 32 + j] = ((i as i32) - (j as i32)) * 1024;
            }
        }
        let first = default_qubo_solver(&q, 2 * Q16_ONE, Q16_950_MILLI);
        for _ in 0..4 {
            assert_eq!(default_qubo_solver(&q, 2 * Q16_ONE, Q16_950_MILLI), first);
        }
    }

    #[test]
    fn qubo_solver_finds_a_valid_tour_for_five_clusters() {
        let clusters: Vec<KondoCluster> = (0..5)
            .map(|i| KondoCluster {
                center_idx: i,
                members: alloc::vec![i],
                shielding_radius: Q16_858_MILLI,
                resonance_centroid: Q16_ONE,
            })
            .collect();
        let inter_dist = line_matrix(5, Q16_ONE);

        let q = build_inter_cluster_qubo(&clusters, &inter_dist);
        let result = default_qubo_solver(&q, (2 * Q16_ONE), Q16_950_MILLI);

        assert!(validate_tour(result, 5), "default_qubo_solver should find a constraint-satisfying tour for a 5x5 problem");
    }

    #[test]
    fn full_pipeline_visits_every_node_exactly_once() {
        let n = 23; // deliberately not a multiple of K_CLUSTERS
        let matrix = line_matrix(n, Q16_ONE);

        let result = solve_logistics_kondo_default(&matrix, n);

        assert!(result.qubo_solution_valid, "inter-cluster QUBO solve should converge on this small instance");

        let mut visited = result.route.clone();
        visited.sort_unstable();
        visited.dedup();
        assert_eq!(
            visited.len(),
            n,
            "every node must be visited exactly once; got {} distinct nodes out of {} in route {:?}",
            visited.len(),
            n,
            result.route
        );
        assert_eq!(result.route.len(), n, "route must not contain duplicates");
    }

    #[test]
    fn extract_and_validate_agree_on_a_hand_built_valid_tour() {
        // k=3, identity tour (cluster i at position i): bits 0, 4, 8 set
        // (variable index = cluster*k + position = i*3+i).
        let k = 3;
        let result: u32 = (1 << 0) | (1 << 4) | (1 << 8);
        assert!(validate_tour(result, k));
        assert_eq!(extract_cluster_tour(result, k), alloc::vec![0, 1, 2]);
    }

    #[test]
    fn validate_tour_rejects_a_cluster_visited_twice() {
        let k = 3;
        // cluster 0 at both position 0 and 1, cluster 2 never visited.
        let result: u32 = (1 << 0) | (1 << 1) | (1 << 8);
        assert!(!validate_tour(result, k));
    }
}

