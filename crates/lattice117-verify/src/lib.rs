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

//! Deterministic time-window feasibility verification.
//!
//! This crate answers one question: **is a given schedule actually feasible
//! against its own time windows?** If it is not, it names the stop that breaks,
//! when the vehicle arrives, when the window shut, and by how much it was
//! missed.
//!
//! It does not build schedules. Verifying an order someone else produced is an
//! exact dynamic program with no dependence on construction quality, which is
//! why this crate can be published with confidence while route construction
//! remains a harder, separate problem.
//!
//! # Determinism
//!
//! Every value crossing this API is Q16.16 fixed-point (`i32`). There is no
//! floating point anywhere in the evaluation path, so the same inputs produce
//! bit-identical outputs on any machine, on every run. That is the property the
//! whole crate exists to provide.
//!
//! # Example
//!
//! ```
//! use lattice117_verify::{evaluate_order, Q16_ONE};
//!
//! // Three stops: depot, A, B. Travel times in Q16.16.
//! let d = |v: i32| v * Q16_ONE;
//! let distances = vec![
//!     d(0),  d(10), d(20),
//!     d(10), d(0),  d(15),
//!     d(20), d(15), d(0),
//! ];
//! let windows = vec![(d(0), d(480)), (d(0), d(100)), (d(0), d(100))];
//!
//! assert!(evaluate_order(&[0, 1, 2, 0], &distances, 3, &windows).is_ok());
//! ```

#![forbid(unsafe_op_in_unsafe_fn)]

mod dp;

pub use dp::{CapacityViolation, TimeParadoxViolation, VectorizedDpTable};

/// Q16.16 fixed-point scalar. The integer part occupies the high 16 bits.
pub type Q16 = i32;

/// 1.0 in Q16.16.
pub const Q16_ONE: Q16 = 65_536;

/// Verifies that `ordered_route` is feasible against `time_windows`.
///
/// Returns the final arrival time in Q16.16 on success, or the specific
/// violation — node, arrival, window close and deficit — on failure.
///
/// `distances_q16` is a row-major `nodes_count × nodes_count` matrix. Node 0 is
/// treated as the route origin.
///
/// All time values share one unit, and this crate never assumes what that unit
/// is. A deficit of `65_536` means one whole unit of whatever the caller
/// supplied.
pub fn evaluate_order(
    ordered_route: &[usize],
    distances_q16: &[Q16],
    nodes_count: usize,
    time_windows: &[(Q16, Q16)],
) -> Result<Q16, TimeParadoxViolation> {
    let ordered_u32: Vec<u32> = ordered_route.iter().map(|&n| n as u32).collect();
    let m = ordered_u32.len();
    let mut table = VectorizedDpTable {
        states: Vec::new(),
        cost: vec![[0i32; 2]; m],
        arrival_time: vec![[0i32; 2]; m],
        best_prev: vec![[0i8; 2]; m],
    };
    dp::solve_intra_cluster_branchless(
        &ordered_u32,
        distances_q16,
        nodes_count,
        time_windows,
        0,
        &mut table,
    )
    .map(|(arrival_q16, _idle_and_penalty)| arrival_q16)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Vec<Q16>, Vec<(Q16, Q16)>) {
        let d = |v: i32| v * Q16_ONE;
        (
            vec![d(0), d(10), d(20), d(10), d(0), d(15), d(20), d(15), d(0)],
            vec![(d(0), d(480)), (d(0), d(100)), (d(0), d(100))],
        )
    }

    #[test]
    fn a_feasible_route_is_accepted() {
        let (distances, windows) = fixture();
        assert!(evaluate_order(&[0, 1, 2, 0], &distances, 3, &windows).is_ok());
    }

    /// Hand-computed: arrival at node 2 is 10 + 15 = 25, against a window
    /// closing at 20, so the deficit is 5.0 — 327_680 in Q16.16.
    #[test]
    fn an_infeasible_route_names_the_stop_and_the_deficit() {
        let (distances, mut windows) = fixture();
        windows[2].1 = 20 * Q16_ONE;

        let violation = evaluate_order(&[0, 1, 2, 0], &distances, 3, &windows)
            .expect_err("arriving at 25 against a window closing at 20 must fail");

        assert_eq!(violation.node_id, 2);
        assert_eq!(violation.arrival_time_q16, 25 * Q16_ONE);
        assert_eq!(violation.window_close_q16, 20 * Q16_ONE);
        assert_eq!(violation.deficit_q16, 5 * Q16_ONE);
    }

    /// The claim this crate makes: same input, same output, every time.
    #[test]
    fn repeated_evaluation_is_bit_identical() {
        let (distances, windows) = fixture();
        let first = evaluate_order(&[0, 1, 2, 0], &distances, 3, &windows);
        for _ in 0..64 {
            assert_eq!(evaluate_order(&[0, 1, 2, 0], &distances, 3, &windows), first);
        }
    }
}
