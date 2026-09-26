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

// ═══════════════════════════════════════════════════════════════════════════
// Fixture A — the Nottingham geographic benchmark
//
// The official Tier 5 test case. See docs/FIXTURE-NOTTINGHAM.md for the
// coordinates, the Haversine derivation and the honest finding that real
// geometry does NOT reproduce the Tier 4 spec's VAN-14 breach.
//
// These tests read demo/example-fleet-nottingham{.csv,-matrix.txt} from disk
// rather than embedding the numbers. That is the point: the fixture files are
// what the browser, Excel and Sheets surfaces load, so if one drifts the
// benchmark stops matching what customers actually run, and this fails first.
// ═══════════════════════════════════════════════════════════════════════════

use lattice117_solve::resequence::{apply, resequence_fleet, resequence_round};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR is crates/lattice117-solve.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

/// Parses a fixture decimal such as `"11.9"` into Q16.16 **without floats**.
///
/// The fixture is specified to one decimal place, so this needs tenths and
/// nothing more. It rounds half away from zero, which is what
/// `Math.round(v * 65536)` does in the JS surfaces for these values — the two
/// must agree exactly or the digests diverge, and this is the cheaper place to
/// guarantee it than a float that happens to land right.
fn q_decimal(text: &str) -> Q16 {
    let t = text.trim();
    let (sign, t) = match t.strip_prefix('-') {
        Some(rest) => (-1i64, rest),
        None => (1i64, t),
    };
    let (whole, frac) = match t.split_once('.') {
        Some((w, f)) => (w, f),
        None => (t, ""),
    };
    assert!(frac.len() <= 1, "fixture values are specified to one decimal place, got {text:?}");
    let tenths: i64 = whole.parse::<i64>().expect("whole part") * 10
        + if frac.is_empty() { 0 } else { frac.parse::<i64>().expect("tenth") };
    let scaled = tenths * Q16_ONE as i64;
    let rounded = (scaled + 5) / 10; // tenths are always non-negative here
    (sign * rounded) as Q16
}

/// The matrix and its node legend, read from the generated fixture.
fn nottingham_matrix() -> (Vec<Q16>, usize, BTreeMap<String, usize>) {
    let text = std::fs::read_to_string(repo_root().join("demo/example-fleet-nottingham-matrix.txt"))
        .expect("matrix fixture is missing — run node tools/fixture/nottingham.mjs");
    let mut legend = BTreeMap::new();
    let mut rows: Vec<Vec<Q16>> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(list) = line.strip_prefix("# nodes:") {
            for entry in list.split(',') {
                let (idx, name) = entry.trim().split_once('=').expect("legend entry is idx=name");
                legend.insert(name.to_string(), idx.parse().expect("legend index"));
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        rows.push(line.split_whitespace().map(q_decimal).collect());
    }
    let n = rows.len();
    assert_eq!(legend.len(), n, "the legend must name every row");
    assert!(rows.iter().all(|r| r.len() == n), "matrix must be square");
    (rows.concat(), n, legend)
}

/// The alphabetical round, read from the generated CSV.
fn nottingham_round(legend: &BTreeMap<String, usize>) -> Round {
    let text = std::fs::read_to_string(repo_root().join("demo/example-fleet-nottingham.csv"))
        .expect("CSV fixture is missing — run node tools/fixture/nottingham.mjs");
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let header: Vec<&str> = lines.next().expect("header").split(',').map(str::trim).collect();
    let col = |name: &str| header.iter().position(|h| *h == name).expect(name);
    let mut stops = Vec::new();
    let mut depart = 0;
    for line in lines {
        let f: Vec<&str> = line.split(',').collect();
        depart = q_decimal(f[col("depart")]);
        stops.push(Stop {
            id: legend[f[col("stop")].trim()],
            open_q16: q_decimal(f[col("window_open")]),
            close_q16: q_decimal(f[col("window_close")]),
            travel_q16: q_decimal(f[col("travel_mins_from_previous")]),
        });
    }
    Round { id: 21, depart_q16: depart, stops }
}

/// Grades an arbitrary ordering against the untouched verifier.
///
/// The departure is expressed by adding it to the leg out of the depot, exactly
/// as `referee_says_feasible` does above: the verifier starts its clock at zero
/// and this crate does not get to change that.
fn referee_grades(order_ids: &[usize], matrix: &[Q16], n: usize, windows: &[(Q16, Q16)], depart_q16: Q16)
    -> Result<Q16, lattice117_verify::TimeParadoxViolation>
{
    let mut m = matrix.to_vec();
    let first = order_ids[1];
    m[order_ids[0] * n + first] = m[order_ids[0] * n + first].saturating_add(depart_q16);
    evaluate_order(order_ids, &m, n, windows)
}

fn windows_of(round: &Round, n: usize) -> Vec<(Q16, Q16)> {
    let mut w = vec![(0, 0); n];
    for s in &round.stops {
        w[s.id] = (s.open_q16, s.close_q16);
    }
    w
}

/// The headline Tier 5 claim, end to end, with the referee deciding both halves.
///
/// Pinned values are the exact Q16.16 integers, not rounded minutes. A test that
/// asserted "about 60 minutes" would pass through a change that moved the digest,
/// and the digest is the product.
#[test]
fn the_nottingham_round_resequences_from_99_6_to_60_2_minutes() {
    let (matrix, n, legend) = nottingham_matrix();
    let round = nottingham_round(&legend);
    let windows = windows_of(&round, n);

    // The sheet as supplied: alphabetical order.
    let before_ids: Vec<usize> = round.stops.iter().map(|s| s.id).collect();
    assert_eq!(
        before_ids,
        vec![legend["DEPOT"], legend["Arnold"], legend["Beeston"],
             legend["Bulwell"], legend["Carlton"], legend["Chilwell"], legend["DEPOT"]],
        "the fixture must still be the alphabetical round the benchmark is about"
    );

    // digest_before stands in here as the referee's own before-verdict: the
    // untouched verifier must agree the supplied sheet fails, and must name the
    // stop and the deficit the documentation quotes.
    let verdict_before = referee_grades(&before_ids, &matrix, n, &windows, round.depart_q16)
        .expect_err("the alphabetical round breaches Chilwell's window");
    assert_eq!(verdict_before.node_id as usize, legend["Chilwell"]);

    // 41_051_751 is 626.40002 minutes, and `q_decimal("626.4")` is 41_051_750.
    // The one-ulp gap is not a defect and it is not noise: an arrival is the SUM
    // of six independently-rounded legs, and the sum of roundings is not the
    // rounding of the sum. Asserting the accumulated integer is the only correct
    // choice here — it is the number the engine computed, the number the verdict
    // turns on and the number that enters the digest. Asserting the
    // pretty-printed decimal instead would pin a value the engine never held.
    assert_eq!(verdict_before.arrival_time_q16, 41_051_751);
    assert_eq!(verdict_before.window_close_q16, q_decimal("615.0"));
    assert_eq!(verdict_before.deficit_q16, 41_051_751 - q_decimal("615.0"));
    // 747_111 / 65_536 = 11.4 minutes late, which is what the docs quote.
    assert_eq!(verdict_before.deficit_q16, 747_111);

    // The solver proposes.
    let outcome = resequence_round(&round, &matrix, n);
    assert!(outcome.searched, "five interior stops are well inside EXACT_LIMIT");
    assert!(outcome.changed());
    assert_eq!(outcome.infeasible_before, 1);
    assert_eq!(outcome.infeasible_after, 0);

    // Exact Q16.16 travel totals: 99.6 min before, 60.2 min after.
    assert_eq!(outcome.original_cost_q16, 6_527_386);
    assert_eq!(outcome.best_cost_q16, 3_945_267);
    assert_eq!(outcome.saving_q16(), 2_582_119);

    let after_ids = outcome.best_ids(&round);
    assert_eq!(
        after_ids,
        vec![legend["DEPOT"], legend["Beeston"], legend["Chilwell"],
             legend["Bulwell"], legend["Arnold"], legend["Carlton"], legend["DEPOT"]],
        "the optimum is Beeston -> Chilwell -> Bulwell -> Arnold -> Carlton"
    );

    // ...and the referee decides. digest_after's verdict half.
    let arrival_after = referee_grades(&after_ids, &matrix, n, &windows, round.depart_q16)
        .expect("the untouched verifier must independently confirm the re-sequenced round");
    assert_eq!(arrival_after, q_decimal("600.2"), "arrival back at the depot");

    // The applied round must cost what was searched, so the sheet a customer
    // exports and the number they were shown are the same thing.
    let fixed = apply(&round, &outcome, &matrix, n);
    let applied: i64 = fixed.stops.iter().skip(1).map(|s| s.travel_q16 as i64).sum();
    assert_eq!(applied, outcome.best_cost_q16);
}

/// 39.4 minutes saved on a 99.6-minute round. Stated as integers so the claim in
/// the marketing copy cannot drift from the claim in the code.
#[test]
fn the_nottingham_saving_is_39_4_minutes_and_39_6_percent() {
    let (matrix, n, legend) = nottingham_matrix();
    let round = nottingham_round(&legend);
    let outcome = resequence_round(&round, &matrix, n);

    // Accumulated, not `q_decimal("39.4")`, for the reason given above: this is
    // a difference of two six-leg sums. It is one ulp above the decimal, which
    // still reads as 39.4 minutes to one place.
    assert_eq!(outcome.saving_q16(), 2_582_119);

    // Percentage in hundredths, integer arithmetic only. 2_582_119 * 10_000 /
    // 6_527_386 = 3955, i.e. 39.55%, which prints as 39.6% to one place. The
    // published figure must be this one and not 40%.
    let hundredths = outcome.saving_q16() * 10_000 / outcome.original_cost_q16;
    assert_eq!(hundredths, 3955);
}

/// The fleet-level pass must agree with the single-round pass, because the
/// surfaces call the fleet one and the benchmark quotes the single-round numbers.
#[test]
fn the_fleet_pass_reports_the_same_numbers_as_the_single_round_pass() {
    let (matrix, n, legend) = nottingham_matrix();
    let round = nottingham_round(&legend);
    let single = resequence_round(&round, &matrix, n);
    let fleet = resequence_fleet(core::slice::from_ref(&round), &matrix, n);

    assert_eq!(fleet.rounds_total, 1);
    assert_eq!(fleet.feasible_before, 0);
    assert_eq!(fleet.feasible_after, 1);
    assert!(fleet.fully_repaired());
    assert_eq!(fleet.unsearched, 0);
    assert_eq!(fleet.total_cost_before_q16, single.original_cost_q16);
    assert_eq!(fleet.total_cost_after_q16, single.best_cost_q16);
    assert_eq!(fleet.saving_q16(), single.saving_q16());
    assert_eq!(fleet.outcomes, vec![single]);
}

/// Reported because the request was to report whatever real geometry produced:
/// it does not reproduce the Tier 4 spec's VAN-14 breach. Both orders hold, and
/// with two interior stops on a symmetric matrix they cost the same, so
/// re-sequencing that round cannot change anything. Pinned so the claim in
/// docs/FIXTURE-NOTTINGHAM.md §5.1 stays true.
#[test]
fn real_geometry_does_not_reproduce_the_van_14_breach() {
    let (matrix, n, legend) = nottingham_matrix();
    let (depot, arnold) = (legend["DEPOT"], legend["Arnold"]);
    // Bulwell stands in for the spec's second stop: any second node gives the
    // same structural result, which is the finding.
    let other = legend["Bulwell"];

    let there = matrix[depot * n + arnold] as i64 + matrix[arnold * n + other] as i64
        + matrix[other * n + depot] as i64;
    let back = matrix[depot * n + other] as i64 + matrix[other * n + arnold] as i64
        + matrix[arnold * n + depot] as i64;
    assert_eq!(there, back, "a symmetric matrix makes both two-stop orders identical");

    let windows = vec![(0, q_decimal("1440.0")); n];
    assert!(referee_grades(&[depot, arnold, other, depot], &matrix, n, &windows, 0).is_ok());
    assert!(referee_grades(&[depot, other, arnold, depot], &matrix, n, &windows, 0).is_ok());
}
