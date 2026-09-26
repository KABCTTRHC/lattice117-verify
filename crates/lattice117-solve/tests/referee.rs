//! The referee pipeline, end to end.
//!
//! The solver proposes; `lattice117-verify` decides. This test exists to prove
//! the second half of that sentence is real — that a repaired schedule is
//! graded by the untouched verifier crate and not by the thing that changed it.
//!
//! `lattice117-verify` is a **dev-dependency**, deliberately. It is present for
//! this test and absent from anything that ships, so the solver crate's
//! `[dependencies]` stays empty and the solver has no way to reach into the
//! referee at runtime even if someone later wanted it to.

use lattice117_solve::repair::{band_matrix, repair_fixed_sequence, Round, Stop};
use lattice117_solve::{Q16, Q16_ONE};
use lattice117_verify::evaluate_order;

fn q(mins: i32) -> Q16 {
    mins * Q16_ONE
}
fn stop(id: usize, open: i32, close: i32, travel: i32) -> Stop {
    Stop { id, open_q16: q(open), close_q16: q(close), travel_q16: q(travel) }
}

/// A round whose windows open later in the day and which leaves too late for
/// them — the ordinary field failure that re-timing exists to fix.
fn late_round(depart: i32) -> Round {
    Round {
        id: 1,
        depart_q16: q(depart),
        stops: vec![
            stop(0, 0, 600, 0),
            stop(1, 60, 90, 20),
            stop(2, 80, 100, 15),
        ],
    }
}

/// Grades a round with the untouched verifier at a given departure.
///
/// The verifier starts its clock at zero, so a departure is expressed by adding
/// it to the first leg. Waits at each window are the verifier's own business
/// and are not modelled here — that is the point of asking it.
fn referee_says_feasible(round: &Round, depart_q16: Q16) -> bool {
    let n = round.stops.len();
    let mut m = band_matrix(round);
    m[0 * n + 1] = m[0 * n + 1].saturating_add(depart_q16);
    let order: Vec<usize> = (0..n).collect();
    let windows: Vec<(Q16, Q16)> =
        round.stops.iter().map(|s| (s.open_q16, s.close_q16)).collect();
    evaluate_order(&order, &m, n, &windows).is_ok()
}

#[test]
fn a_repaired_round_is_declared_feasible_by_the_untouched_verifier() {
    let round = late_round(75);

    // digest_before stands in here as the verifier's own before-verdict.
    assert!(
        !referee_says_feasible(&round, round.depart_q16),
        "precondition: the referee must agree this round fails as supplied"
    );

    let out = repair_fixed_sequence(core::slice::from_ref(&round));
    assert!(out.fully_repaired());
    assert_eq!(out.changes.len(), 1);
    let repaired_depart = out.changes[0].to_q16;

    // ...and the after-verdict, from the same untouched verifier.
    assert!(
        referee_says_feasible(&round, repaired_depart),
        "the referee must independently confirm the repair"
    );
}

#[test]
fn the_referee_is_not_fooled_by_a_round_the_solver_declined_to_touch() {
    // Every window opens at zero, so there is no wait to reclaim and the round
    // would have to leave before the start of the day. The solver reports this
    // rather than proposing a change, and the referee must still call it a
    // failure — a declined repair must never read as a pass.
    let round = Round {
        id: 2,
        depart_q16: 0,
        stops: vec![stop(0, 0, 600, 0), stop(1, 0, 42, 7), stop(2, 0, 18, 17)],
    };
    let out = repair_fixed_sequence(core::slice::from_ref(&round));
    assert!(out.is_no_op());
    assert_eq!(out.residual.len(), 1);
    assert_eq!(out.residual[0].deficit_q16, q(6));
    assert!(!referee_says_feasible(&round, round.depart_q16));
}

#[test]
fn repair_then_referee_is_reproducible() {
    let round = late_round(75);
    let first = repair_fixed_sequence(core::slice::from_ref(&round));
    for _ in 0..8 {
        let again = repair_fixed_sequence(core::slice::from_ref(&round));
        assert_eq!(again, first);
        assert!(referee_says_feasible(&round, again.changes[0].to_q16));
    }
}
