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
    Stop {
        id,
        open_q16: q(open),
        close_q16: q(close),
        travel_q16: q(travel),
    }
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
    // The leg out of the first stop: row 0, column 1 of a row-major n x n
    // matrix, so index 1. Written as a named constant rather than `0 * n + 1`,
    // which is arithmetic on a zero and reads as a mistake either way.
    const FIRST_LEG: usize = 1;
    m[FIRST_LEG] = m[FIRST_LEG].saturating_add(depart_q16);
    let order: Vec<usize> = (0..n).collect();
    let windows: Vec<(Q16, Q16)> = round
        .stops
        .iter()
        .map(|s| (s.open_q16, s.close_q16))
        .collect();
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
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
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
    assert!(
        frac.len() <= 1,
        "fixture values are specified to one decimal place, got {text:?}"
    );
    let tenths: i64 = whole.parse::<i64>().expect("whole part") * 10
        + if frac.is_empty() {
            0
        } else {
            frac.parse::<i64>().expect("tenth")
        };
    let scaled = tenths * Q16_ONE as i64;
    let rounded = (scaled + 5) / 10; // tenths are always non-negative here
    (sign * rounded) as Q16
}

/// The matrix and its node legend, read from the generated fixture.
fn nottingham_matrix() -> (Vec<Q16>, usize, BTreeMap<String, usize>) {
    let text =
        std::fs::read_to_string(repo_root().join("demo/example-fleet-nottingham-matrix.txt"))
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
                let (idx, name) = entry
                    .trim()
                    .split_once('=')
                    .expect("legend entry is idx=name");
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
    let header: Vec<&str> = lines
        .next()
        .expect("header")
        .split(',')
        .map(str::trim)
        .collect();
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
    Round {
        id: 21,
        depart_q16: depart,
        stops,
    }
}

/// Grades an arbitrary ordering against the untouched verifier.
///
/// The departure is expressed by adding it to the leg out of the depot, exactly
/// as `referee_says_feasible` does above: the verifier starts its clock at zero
/// and this crate does not get to change that.
fn referee_grades(
    order_ids: &[usize],
    matrix: &[Q16],
    n: usize,
    windows: &[(Q16, Q16)],
    depart_q16: Q16,
) -> Result<Q16, lattice117_verify::TimeParadoxViolation> {
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
        vec![
            legend["DEPOT"],
            legend["Arnold"],
            legend["Beeston"],
            legend["Bulwell"],
            legend["Carlton"],
            legend["Chilwell"],
            legend["DEPOT"]
        ],
        "the fixture must still be the alphabetical round the benchmark is about"
    );

    // digest_before stands in here as the referee's own before-verdict: the
    // untouched verifier must agree the supplied sheet fails, and must name the
    // stop and the deficit the documentation quotes.
    let verdict_before = referee_grades(&before_ids, &matrix, n, &windows, round.depart_q16)
        .expect_err("the alphabetical round breaches Chilwell's window");
    assert_eq!(verdict_before.node_id, legend["Chilwell"]);

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
    assert!(
        outcome.searched,
        "five interior stops are well inside EXACT_LIMIT"
    );
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
        vec![
            legend["DEPOT"],
            legend["Beeston"],
            legend["Chilwell"],
            legend["Bulwell"],
            legend["Arnold"],
            legend["Carlton"],
            legend["DEPOT"]
        ],
        "the optimum is Beeston -> Chilwell -> Bulwell -> Arnold -> Carlton"
    );

    // ...and the referee decides. digest_after's verdict half.
    let arrival_after = referee_grades(&after_ids, &matrix, n, &windows, round.depart_q16)
        .expect("the untouched verifier must independently confirm the re-sequenced round");
    assert_eq!(
        arrival_after,
        q_decimal("600.2"),
        "arrival back at the depot"
    );

    // The applied round must cost what was searched, so the sheet a customer
    // exports and the number they were shown are the same thing.
    let fixed = apply(&round, &outcome, &matrix, n);
    let applied: i64 = fixed
        .stops
        .iter()
        .skip(1)
        .map(|s| s.travel_q16 as i64)
        .sum();
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

    let there = matrix[depot * n + arnold] as i64
        + matrix[arnold * n + other] as i64
        + matrix[other * n + depot] as i64;
    let back = matrix[depot * n + other] as i64
        + matrix[other * n + arnold] as i64
        + matrix[arnold * n + depot] as i64;
    assert_eq!(
        there, back,
        "a symmetric matrix makes both two-stop orders identical"
    );

    let windows = vec![(0, q_decimal("1440.0")); n];
    assert!(referee_grades(&[depot, arnold, other, depot], &matrix, n, &windows, 0).is_ok());
    assert!(referee_grades(&[depot, other, arnold, depot], &matrix, n, &windows, 0).is_ok());
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixture B — the convex-position benchmark
//
// Fixture A shows the product claim on realistic geography. This one tests the
// solver against an answer someone other than us settled: for points in convex
// position the optimal tour is the convex-hull order, so on a regular polygon
// the optimum is the perimeter, n * 2R * sin(pi/n).
//
// It is a theorem rather than a downloaded instance because the downloadable
// ones cannot be vendored here — TSPLIB's licence is non-commercial and forbids
// redistribution, Solomon's set carries no licence at all. See
// docs/FIXTURE-B-BENCHMARK.md. tools/benchmark/ runs the real published
// instances against a copy the user supplies themselves.
// ═══════════════════════════════════════════════════════════════════════════

use lattice117_solve::global;
use lattice117_solve::resequence::EXACT_LIMIT;

/// The convex fixture: 9 nodes on a circle, read from the generated file.
fn convex_matrix() -> (Vec<Q16>, usize) {
    let text = std::fs::read_to_string(repo_root().join("tests/fixtures/convex-9.txt"))
        .expect("convex fixture is missing — run node tools/fixture/convex.mjs");
    let rows: Vec<Vec<Q16>> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| l.split_whitespace().map(q_decimal).collect())
        .collect();
    let n = rows.len();
    assert!(rows.iter().all(|r| r.len() == n), "matrix must be square");
    (rows.concat(), n)
}

/// The tour `0 -> 1 -> ... -> n-1 -> 0`, which is the perimeter.
fn perimeter(n: usize) -> Vec<usize> {
    (0..n).chain(core::iter::once(0)).collect()
}

/// True when `ids` walks the circle, in either direction.
///
/// Direction is deliberately not pinned. A symmetric matrix cannot tell a tour
/// from its reverse — they cost the same to the last bit — so the theorem names
/// the hull ORDER, not a heading. Which of the two comes back depends on the
/// order the stops were listed in, because the tie-break compares positions in
/// the supplied round; pinning one would be pinning an artefact of the input.
fn is_hull_order(ids: &[usize], n: usize) -> bool {
    let forward = perimeter(n);
    let mut backward: Vec<usize> = (1..n).rev().collect();
    backward.insert(0, 0);
    backward.push(0);
    ids == forward.as_slice() || ids == backward.as_slice()
}

fn tour_cost(tour: &[usize], matrix: &[Q16], n: usize) -> i64 {
    tour.windows(2)
        .map(|w| matrix[w[0] * n + w[1]] as i64)
        .sum()
}

/// Standard lexicographic next permutation. Returns false on the last one.
fn next_permutation(a: &mut [usize]) -> bool {
    if a.len() < 2 {
        return false;
    }
    let mut i = a.len() - 1;
    while i > 0 && a[i - 1] >= a[i] {
        i -= 1;
    }
    if i == 0 {
        return false;
    }
    let mut j = a.len() - 1;
    while a[j] <= a[i - 1] {
        j -= 1;
    }
    a.swap(i - 1, j);
    a[i..].reverse();
    true
}

/// A round with no binding windows, so only distance decides — which is what
/// makes this a TSP and therefore comparable to the theorem.
fn convex_round(n: usize) -> Round {
    let open = 0;
    let close = q_decimal("1440.0");
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
    Round {
        id: 1,
        depart_q16: 0,
        stops,
    }
}

/// The headline: at exactly `EXACT_LIMIT` interior stops, the exhaustive path
/// returns the tour the theorem names, from whatever order it is handed.
#[test]
fn the_exact_path_finds_the_convex_hull_order_at_the_search_limit() {
    let (matrix, n) = convex_matrix();
    assert_eq!(
        n - 1,
        EXACT_LIMIT,
        "the fixture must sit exactly on the search bound"
    );

    // Handed the worst order this instance has, not a nearly-sorted one.
    let mut stops: Vec<Stop> = convex_round(n).stops;
    let scrambled: Vec<usize> = vec![0, 4, 8, 3, 7, 2, 6, 1, 5, 0];
    for (slot, &id) in stops.iter_mut().zip(scrambled.iter()) {
        slot.id = id;
    }
    let round = Round {
        id: 1,
        depart_q16: 0,
        stops,
    };

    let out = resequence_round(&round, &matrix, n);
    assert!(
        out.searched,
        "8 interior stops is exactly EXACT_LIMIT, so it must be searched"
    );
    let found = out.best_ids(&round);
    assert!(
        is_hull_order(&found, n),
        "the optimum for points in convex position is the hull order; got {found:?}"
    );

    // n * 2R * sin(pi/n) is 123.127 min exactly; 123.3 once each leg is rounded
    // to 1 dp, which is the number this matrix actually holds.
    assert_eq!(out.best_cost_q16, 8_080_587);
    assert_eq!(out.best_cost_q16, tour_cost(&perimeter(n), &matrix, n));

    // ...and the referee agrees the result is feasible.
    let windows = windows_of(&round, n);
    assert!(referee_grades(&out.best_ids(&round), &matrix, n, &windows, 0).is_ok());
}

/// Rounding could in principle break the theorem: a matrix rounded to 1 dp is
/// not exactly Euclidean, so "an optimal tour has no crossings" no longer
/// follows for free. Rather than assume it survives, this checks it — the
/// perimeter must beat every one of the 40,320 orders, and by a real margin
/// rather than a last-bit one.
#[test]
fn rounding_does_not_break_the_theorem_on_this_instance() {
    let (matrix, n) = convex_matrix();
    let round = convex_round(n);
    let out = resequence_round(&round, &matrix, n);

    let best = out.best_cost_q16;
    let mut second = i64::MAX;
    let mut ties = 0usize;

    // Every interior ordering, scored directly rather than through the solver,
    // so this is an independent check and not the search grading itself. Walked
    // in lexicographic order by next_permutation rather than collected, so the
    // 40,320 orders cost one Vec rather than forty thousand.
    let mut perm: Vec<usize> = (1..n).collect();
    let mut counted = 0usize;
    loop {
        let mut tour: Vec<usize> = Vec::with_capacity(n + 1);
        tour.push(0);
        tour.extend_from_slice(&perm);
        tour.push(0);
        let cost = tour_cost(&tour, &matrix, n);
        assert!(
            cost >= best,
            "found an order cheaper than the hull order: {tour:?}"
        );
        if cost == best {
            ties += 1;
        } else if cost < second {
            second = cost;
        }
        counted += 1;
        if !next_permutation(&mut perm) {
            break;
        }
    }
    assert_eq!(counted, 40_320, "8! orderings, all of them");

    // Exactly two: the perimeter and its reverse. A symmetric matrix cannot
    // distinguish them, and the tie-break returns the forward one.
    assert_eq!(ties, 2);
    // 24.0 minutes clear of second place — not a rounding-width margin.
    assert_eq!(second - best, q_decimal("24.0") as i64);
}

/// The heuristic path, measured rather than advertised.
///
/// `global` is the unassigned-instance path and never claims optimality. On an
/// instance whose optimum is known exactly, the useful thing is to report the
/// gap — which is what a customer weighing £499 actually wants to know, and
/// what a benchmark is for. Pinned so a regression in either direction shows up.
#[test]
fn the_heuristic_path_reports_its_true_gap_to_the_known_optimum() {
    let (matrix, n) = convex_matrix();
    let optimum = tour_cost(&perimeter(n), &matrix, n);

    let out = global::solve_unassigned_default(&matrix, n);
    assert!(out.visits_every_node_once(n), "tour was {:?}", out.tour);
    assert!(
        !out.exact,
        "the global path is a heuristic and must not claim otherwise"
    );
    assert!(
        out.cost_q16 >= optimum,
        "a heuristic cannot beat the proven optimum; got {} against {optimum}",
        out.cost_q16
    );

    // The gap, in tenths of a percent, integer arithmetic only. Pinned because
    // it is a published number about the product and must not drift silently in
    // either direction.
    //
    // It is 83.9%, and that is the finding rather than an embarrassment to be
    // hidden. On a nine-node circle — about the easiest non-trivial instance
    // there is — the Kondo pipeline returns 0 -> 8 -> 1 -> 6 -> 7 -> 4 -> 3 ->
    // 5 -> 2 -> 0, which crosses the circle repeatedly, against a perimeter that
    // crosses it never. The cause is structural: K_CLUSTERS is 5, so nine nodes
    // land in clusters of about two, and on points in convex position the
    // clustering carries almost no signal for the inter-cluster QUBO to use.
    //
    // What this licenses, and what it does not: `resequence` is exactly optimal
    // here and is what Tier 5 is sold on. `global` is the unassigned-instance
    // path, it reports `exact: false`, and a number like this is why that flag
    // is not decoration. It must not be marketed as an optimiser on this
    // evidence. docs/FIXTURE-B-BENCHMARK.md says so in those words.
    let gap_tenths = (out.cost_q16 - optimum) * 1000 / optimum;
    assert_eq!(
        gap_tenths, 839,
        "global path cost {} against optimum {optimum}",
        out.cost_q16
    );
    assert_eq!(out.tour, vec![0, 8, 1, 6, 7, 4, 3, 5, 2, 0]);
    assert_eq!(out.clusters, 5);
}
