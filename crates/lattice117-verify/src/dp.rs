// Lattice117
// Copyright (C) 2026 Brierley Sovereign Group Ltd <kurtisbrierley@gmail.com>
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by the
// Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
// for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
//
// Alternatively, this file is available under a commercial licence from
// Brierley Sovereign Group Ltd. See LICENSE-COMMERCIAL.md.

#![allow(clippy::missing_safety_doc)]

#[cfg(target_arch = "aarch64")]
use core::arch::aarch64::*;

// ==============================================================================
// STAGE 10.2: BRANCHLESS VECTORIZED DP RELAXATION (THE WAVE COLLAPSE)
// ==============================================================================

#[repr(C, align(64))]
pub struct VectorizedDpTable {
    // Was `Vec<i32>`: every call site (this file's own NEON step below, plus
    // ffi/extraction.rs and ffi/secure_extraction.rs) indexes an element and
    // calls .as_ptr()/.as_mut_ptr() on it to feed a 4-lane vld1q_s32/vst1q_s32 —
    // that requires each element to itself be a [i32; 4], not a bare i32 (which
    // has no .as_ptr()). Unused by the scalar solve_intra_cluster_branchless
    // path below (which only touches cost/arrival_time/best_prev), so this was
    // never exercised by a build that actually type-checked it.
    pub states: Vec<[i32; 4]>,
    pub cost: Vec<[i32; 2]>,
    pub arrival_time: Vec<[i32; 2]>,
    pub best_prev: Vec<[i8; 2]>,
}

#[cfg(target_arch = "aarch64")]
#[inline(always)]
// Unreachable from this crate: `mod dp` is private and lib.rs re-exports only
// the three types, not this. The call sites live in the parent engine
// (ffi/extraction.rs, ffi/secure_extraction.rs), which is not published here,
// so it is extracted-but-unwired rather than abandoned. Kept compiling because
// the CI aarch64 job is what would have caught the E0133 breakage that sat
// here unnoticed until an Apple Silicon runner tried to build it.
#[allow(dead_code)]
pub unsafe fn process_topological_dp_step_neon(
    dp_table: &mut VectorizedDpTable,
    current_state_idx: usize,
    previous_state_idx: usize,
    manifold_gradient_vector: int32x4_t,
) {
    // Every intrinsic below is either an unsafe fn (the loads and the store,
    // which dereference raw pointers) or carries #[target_feature(enable =
    // "neon")] (the arithmetic). Since Rust 1.82 neither is implicitly unsafe
    // just because the enclosing fn is `unsafe fn` — the body needs its own
    // block, so an `unsafe fn` no longer silently blesses whatever it
    // contains. The two obligations the caller must uphold:
    //
    //   * NEON is present. Guaranteed: it is mandatory in the AArch64 base
    //     ABI, and this whole item is cfg'd to target_arch = "aarch64".
    //   * Both indices are in bounds for dp_table.states. Enforced by the
    //     [i32; 4] element type — each element is exactly one 4-lane vector,
    //     so an in-bounds index cannot produce a short read or write.
    unsafe {
        let prev_dp_vector = vld1q_s32(dp_table.states[previous_state_idx].as_ptr());
        let current_dp_vector = vld1q_s32(dp_table.states[current_state_idx].as_ptr());
        let proposed_dp_vector = vaddq_s32(prev_dp_vector, manifold_gradient_vector);
        let improvement_mask = vcltq_s32(proposed_dp_vector, current_dp_vector);
        let optimized_dp_vector = vbslq_s32(
            improvement_mask, // already uint32x4_t: vcltq_s32 returns uint32x4_t directly
            proposed_dp_vector,
            current_dp_vector,
        );
        vst1q_s32(
            dp_table.states[current_state_idx].as_mut_ptr(),
            optimized_dp_vector,
        );
    }
}

// ==============================================================================
// BRANCHLESS TOPOLOGICAL SWEEP
// ==============================================================================

/// Which node tripped the Novikov (time-window) veto, and by how much — the
/// specific attribution the golden test never checked (it only asserts the
/// output string *contains* "UNSTABLE - PARADOX DETECTED"). All fields are
/// Q16.16-scaled, same scale as `time_windows`/`distance_matrix` on the way
/// in, i.e. `deficit_q16 / 65536` is in the input constraints file's own raw
/// time unit — the fixture/constraints format doesn't name a unit, so this
/// deliberately doesn't invent one (e.g. "minutes") either.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeParadoxViolation {
    pub node_id: usize,
    pub arrival_time_q16: i32,
    pub window_close_q16: i32,
    pub deficit_q16: i32,
}

/// A single constructed route's total demand exceeded the configured vehicle
/// capacity (`LATTICE117_VEHICLE_CAPACITY`, unlimited unless set — see
/// `mod.rs::resolve_vehicle_capacity`). Unlike `TimeParadoxViolation`, demand
/// is not Q16.16-scaled — it's a plain integer count straight from the
/// constraints file's demand column, so `total_demand`/`capacity_limit`/
/// `excess_demand` are raw units, not fixed-point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapacityViolation {
    pub route_index: usize,
    pub total_demand: i64,
    pub capacity_limit: i32,
    pub excess_demand: i64,
}

/// Fixed 2026-08-20: this function used to sum legitimate accumulated
/// waiting time and the due-date-violation penalty into the same
/// `dp_table.cost` field, then gate Ok/Err on `cost >= 10_000_000`. Any
/// route with enough genuine, harmless waiting (over ~152.6 real
/// time-units — `10_000_000 / 65536`) crossed that threshold with zero
/// actual violations. Confirmed against ground truth, not assumed: all 10
/// routes of C101's real published Rochat & Taillard solution (SINTEF,
/// cost 828.94) came back "infeasible" under the old logic despite being
/// genuinely feasible — the reported "deficit" on one route (694.00)
/// matched that route's hand-computed legitimate waiting time (693.18)
/// to within 0.12%, not any real due-date miss.
///
/// `cost` is now pure accumulated idle/waiting time — the schedule clock's
/// own bookkeeping for the branchless dual-lane min-selection (prefer
/// whichever lane accumulates less waiting), nothing else. Violation
/// detection is a separate, explicit, per-node check —
/// `service_start_time > due_time`, using the same branchless sign-mask
/// idiom as everywhere else in this crate — latched into `first_violation`
/// (set once true, never summed with `cost`, never overwritten) which is
/// now the *sole* source of truth for the final Ok/Err decision.
///
/// Note: `service_time` (the constraints file's 7th column) is not
/// included in `service_start_time`/arrival-time computation here, and
/// isn't threaded into `time_windows` at all upstream (`engine/mod.rs`
/// never reads it) — a real, separate gap from the one fixed here, not
/// addressed by this change.
#[inline(always)]
pub fn solve_intra_cluster_branchless(
    ordered_nodes: &[u32],
    distance_matrix: &[i32],
    n_nodes: usize,
    time_windows: &[(i32, i32)],
    start_time: i32,
    dp_table: &mut VectorizedDpTable,
) -> Result<(i32, i32), TimeParadoxViolation> {
    let m = ordered_nodes.len();
    if m == 0 {
        return Ok((start_time, 0));
    }

    let start_node = ordered_nodes[0] as usize;
    let (ready_0, due_0) = time_windows[start_node];

    let idle_0 = (ready_0 - start_time).max(0);
    let t_current = start_time + idle_0;

    dp_table.cost[0][0] = idle_0;
    dp_table.cost[0][1] = idle_0;
    dp_table.arrival_time[0][0] = t_current;
    dp_table.arrival_time[0][1] = t_current;

    // Latched — set once true, never summed, never overwritten — and the
    // sole source of truth for Ok/Err below. `t_current` here already *is*
    // service_start_time (arrival plus any waiting up to ready_0).
    let mut first_violation: Option<TimeParadoxViolation> = None;
    let start_veto_mask = (((due_0 as i64) - (t_current as i64)) >> 63) as i32;
    if start_veto_mask != 0 {
        first_violation = Some(TimeParadoxViolation {
            node_id: start_node,
            arrival_time_q16: t_current,
            window_close_q16: due_0,
            deficit_q16: t_current.saturating_sub(due_0),
        });
    }

    for i in 1..m {
        let n1 = ordered_nodes[i - 1] as usize;
        let n2 = ordered_nodes[i] as usize;

        let travel_cost = distance_matrix[n1 * n_nodes + n2];
        let (ready, due) = time_windows[n2];

        let t_from0 = dp_table.arrival_time[i - 1][0].saturating_add(travel_cost);
        let t_from1 = dp_table.arrival_time[i - 1][1].saturating_add(travel_cost);

        let cost_from0 = dp_table.cost[i - 1][0];
        let cost_from1 = dp_table.cost[i - 1][1];

        let idle_0 = (ready.saturating_sub(t_from0)).max(0);
        let idle_1 = (ready.saturating_sub(t_from1)).max(0);

        // Pure idle-time accumulation — no penalty mixed in. Used only to
        // pick the lower-waiting lane for the branchless min-selection
        // below; feasibility is decided entirely by the explicit check
        // after it, not by this value crossing any threshold.
        let total_idle0 = cost_from0.saturating_add(idle_0);
        let total_idle1 = cost_from1.saturating_add(idle_1);

        let diff = total_idle0.saturating_sub(total_idle1);
        let sign_mask = ((total_idle0 as i64 - total_idle1 as i64) >> 63) as i32;

        dp_table.cost[i][0] = total_idle1.saturating_add(diff & sign_mask);
        dp_table.best_prev[i][0] = (1 ^ (sign_mask & 1)) as i8;

        let t_diff = (t_from0 + idle_0).saturating_sub(t_from1 + idle_1);
        dp_table.arrival_time[i][0] = (t_from1 + idle_1) + (t_diff & sign_mask);

        dp_table.cost[i][1] = dp_table.cost[i][0].saturating_add(travel_cost);
        dp_table.best_prev[i][1] = dp_table.best_prev[i][0];
        dp_table.arrival_time[i][1] = dp_table.arrival_time[i][0].saturating_add(travel_cost);

        // Explicit, dedicated violation check — service_start_time (the
        // officially winning lane's actual, already-computed arrival, post
        // any waiting) > due_time — branchless, same sign-mask idiom as
        // above, latched once, never summed with idle time.
        if first_violation.is_none() {
            let winning_service_start = dp_table.arrival_time[i][0];
            let winning_veto_mask = (((due as i64) - (winning_service_start as i64)) >> 63) as i32;
            if winning_veto_mask != 0 {
                first_violation = Some(TimeParadoxViolation {
                    node_id: n2,
                    arrival_time_q16: winning_service_start,
                    window_close_q16: due,
                    deficit_q16: winning_service_start.saturating_sub(due),
                });
            }
        }
    }

    let final_state = if dp_table.cost[m - 1][0] <= dp_table.cost[m - 1][1] {
        0
    } else {
        1
    };

    if let Some(violation) = first_violation {
        return Err(violation);
    }

    Ok((
        dp_table.arrival_time[m - 1][final_state],
        dp_table.cost[m - 1][final_state],
    ))
}
