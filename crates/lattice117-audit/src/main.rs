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

//! `lattice117_audit` — a standalone, air-gapped feasibility auditor for
//! schedules produced by *other* solvers.
//!
//! ## What this is for
//!
//! This tool does not build routes. It checks one somebody else already
//! built — OR-Tools, jsprit, VROOM, a planner, a spreadsheet — and answers a
//! single question: **is this schedule actually feasible against its own
//! stated time windows?** If it isn't, it names the exact stop that breaks,
//! when the vehicle actually arrives, when the window shut, and by how much
//! it was missed.
//!
//! That framing is deliberate. Route *construction* is the part of this
//! engine with known limits (see `LATTICE117_BSG_SYNOPSIS.md` §4 — the
//! pipeline's own clustering + nearest-neighbour construction vetoes several
//! standard published benchmark instances). Route *verification* has no such
//! dependency: checking a given order is an exact dynamic program, and it is
//! the part of this codebase with the strongest evidence behind it. Running a
//! real published SINTEF Solomon solution through this same checker surfaced
//! a genuine defect in that published data (capability report §3.18).
//!
//! ## Trust model
//!
//! Files in, verdict out. No network, no server, no telemetry, no LLM. The
//! binary never opens a socket. This is the same trust model
//! `lattice117_airgapped` uses, and it is the reason this tool can run inside
//! an export-controlled or otherwise disconnected environment where hosted
//! schedule-analysis products structurally cannot.
//!
//! ## Determinism
//!
//! The verdict digest printed at the end is a SHA-256 over the canonicalised
//! input *and* the verdict. Run the same file twice and it is identical; that
//! is the whole claim this engine makes, and the digest is how you check it
//! rather than take our word for it.
//!
//! ## Exit codes
//!
//! - `0` — every route feasible
//! - `1` — at least one route infeasible (a violation was attributed)
//! - `2` — the input could not be read, parsed, or validated, including a
//!   route that does not start at the depot (see below)
//!
//! Distinct codes so this is usable as a CI gate, which is the point: a
//! planner's output can be checked on every commit rather than in a meeting.
//!
//! ## Route origin
//!
//! Every route is timed from its **first stop at t = 0**. The contract is
//! that the first stop is the depot (`nodes[0]`). A route written as
//! `["A","B","C"]` instead of `["depot","A","B","C","depot"]` silently drops
//! the depot-to-A leg, so every arrival is early by that leg's travel time and
//! a late schedule can PASS. That was a real false PASS, found on
//! 28 Sep 2026: the same stops FAIL by 5.0 once the depot is written in.
//!
//! So a route that does not start at the depot is an **input error (exit 2)**,
//! not a verdict. `--allow-open-route` accepts it for a genuinely open route
//! (a vehicle already in the field); the flag is folded into the digest, so an
//! open-route verdict can never be passed off as a depot-origin one.
//!
//! ## Usage
//!
//! ```sh
//! lattice117_audit --input schedule.json
//! cat schedule.json | lattice117_audit
//! lattice117_audit --input schedule.json --json   # machine-readable
//! lattice117_audit --input schedule.json --allow-open-route
//! ```

use std::io::{IsTerminal, Read};
use std::path::PathBuf;

use clap::Parser;
use lattice117_verify::evaluate_order;
use lattice117_verify::TimeParadoxViolation;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Q16.16 scale factor. Every time value crossing into the engine is
/// multiplied by this; every value coming back is divided by it.
const Q16_ONE: i64 = 65_536;

/// The largest integer part representable in Q16.16 (`i32::MAX / 65536`).
/// Inputs above this silently wrap once scaled, so they are rejected up
/// front with a real message instead.
const Q16_MAX_WHOLE: f64 = 32_767.0;
const Q16_MIN_WHOLE: f64 = -32_768.0;

// ---------------------------------------------------------------------
// Input schema — `lattice117.audit.v1`
// ---------------------------------------------------------------------

/// A schedule to audit.
///
/// Intentionally the smallest shape that OR-Tools, jsprit and VROOM output
/// can all be flattened into without inventing semantics: named stops, a
/// square travel-time matrix, and the routes themselves. Travel times and
/// time windows must share one unit; this tool never assumes what that unit
/// is (the engine's own violation type makes the same refusal — see
/// `TimeParadoxViolation`'s doc comment), it only echoes the `time_unit`
/// label back for readability.
#[derive(Debug, Deserialize)]
struct AuditInput {
    /// Schema marker. Checked so a wrong-format file fails loudly rather
    /// than half-parsing into a misleading verdict.
    schema: String,
    /// Free-text label, echoed in output, never interpreted. e.g. "minutes".
    #[serde(default)]
    time_unit: Option<String>,
    /// Stop definitions. **Index 0 is the depot** — the engine's DP treats
    /// node 0 as the route origin.
    nodes: Vec<NodeSpec>,
    /// Square travel-time matrix, row-major, same unit as the windows.
    distance_matrix: Vec<Vec<f64>>,
    /// The routes to check.
    routes: Vec<RouteSpec>,
}

#[derive(Debug, Deserialize)]
struct NodeSpec {
    /// Human-readable id, used to name the offending stop in the verdict.
    id: String,
    /// Earliest the stop may be serviced.
    ready: f64,
    /// Latest the stop may be serviced. Missing this is the violation.
    due: f64,
}

#[derive(Debug, Deserialize)]
struct RouteSpec {
    /// Label for the vehicle/run, echoed in output.
    #[serde(default)]
    vehicle: Option<String>,
    /// Ordered stop ids, as planned.
    stops: Vec<String>,
}

// ---------------------------------------------------------------------
// Output schema (for --json)
// ---------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct AuditReport {
    schema: &'static str,
    verdict: &'static str,
    /// `"depot"` (the default contract) or `"open"` (`--allow-open-route`).
    route_origin: &'static str,
    time_unit: Option<String>,
    routes_checked: usize,
    routes_feasible: usize,
    violations: Vec<ViolationReport>,
    verdict_digest_sha256: String,
}

#[derive(Debug, Serialize)]
struct ViolationReport {
    vehicle: String,
    /// The stop's own id from the input, not the engine's internal index.
    node_id: String,
    node_index: usize,
    arrival_time: f64,
    window_close: f64,
    deficit: f64,
    arrival_time_q16: i32,
    window_close_q16: i32,
    deficit_q16: i32,
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

#[derive(Parser, Debug)]
#[command(name = "lattice117_audit")]
#[command(
    about = "Air-gapped feasibility auditor: checks whether a schedule another solver produced is actually feasible."
)]
struct Cli {
    /// Schedule JSON to audit. Reads stdin when omitted.
    #[arg(short, long)]
    input: Option<PathBuf>,

    /// Emit the report as JSON instead of a human-readable verdict.
    #[arg(long)]
    json: bool,

    /// Never emit ANSI colour, regardless of terminal detection.
    #[arg(long)]
    no_color: bool,

    /// Accept routes that do not start at the depot (`nodes[0]`); each is then
    /// timed from its own first stop at t = 0. Without this flag such a route
    /// is an input error (exit 2), because leaving the depot out makes every
    /// arrival early and can pass a late schedule.
    #[arg(long)]
    allow_open_route: bool,
}

fn main() {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(code) => std::process::exit(code),
        Err(message) => {
            eprintln!("audit: {message}");
            std::process::exit(2);
        }
    }
}

fn run(cli: &Cli) -> Result<i32, String> {
    let raw = read_input(cli)?;
    let report = audit(&raw, cli.allow_open_route)?;

    if cli.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report)
                .map_err(|e| format!("could not serialise report: {e}"))?
        );
    } else {
        print_human(&report, use_colour(cli));
    }

    Ok(exit_code(&report))
}

fn exit_code(report: &AuditReport) -> i32 {
    if report.violations.is_empty() {
        0
    } else {
        1
    }
}

/// Parses, validates and checks one schedule. `Err` is an input error (exit 2).
fn audit(raw: &str, allow_open_route: bool) -> Result<AuditReport, String> {
    let input: AuditInput =
        serde_json::from_str(raw).map_err(|e| format!("could not parse schedule JSON: {e}"))?;

    validate(&input)?;

    let index_of = |id: &str| input.nodes.iter().position(|n| n.id == id);

    // Scale into the engine's Q16.16 domain. Every conversion is checked:
    // a value that would overflow the fixed-point range is a hard input
    // error, never a silently wrapped number that produces a confident,
    // wrong verdict.
    let nodes_count = input.nodes.len();
    let mut distances_q16: Vec<i32> = Vec::with_capacity(nodes_count * nodes_count);
    for (r, row) in input.distance_matrix.iter().enumerate() {
        for (c, value) in row.iter().enumerate() {
            distances_q16.push(
                to_q16(*value).map_err(|e| format!("distance_matrix[{r}][{c}] = {value}: {e}"))?,
            );
        }
    }

    let mut time_windows: Vec<(i32, i32)> = Vec::with_capacity(nodes_count);
    for node in &input.nodes {
        let ready = to_q16(node.ready)
            .map_err(|e| format!("node \"{}\" ready = {}: {e}", node.id, node.ready))?;
        let due = to_q16(node.due)
            .map_err(|e| format!("node \"{}\" due = {}: {e}", node.id, node.due))?;
        if due < ready {
            return Err(format!(
                "node \"{}\" has due ({}) before ready ({}) — the window is empty, so no schedule can satisfy it",
                node.id, node.due, node.ready
            ));
        }
        time_windows.push((ready, due));
    }

    // Check each route independently against the same evaluator the engine
    // itself uses. Every route is checked even after the first failure —
    // reporting one violation and stopping would send someone round the loop
    // once per broken stop.
    let mut violations: Vec<ViolationReport> = Vec::new();
    let mut feasible = 0usize;

    for (route_idx, route) in input.routes.iter().enumerate() {
        let label = route
            .vehicle
            .clone()
            .unwrap_or_else(|| format!("route-{route_idx}"));

        let mut ordered: Vec<usize> = Vec::with_capacity(route.stops.len());
        for stop in &route.stops {
            let idx = index_of(stop)
                .ok_or_else(|| format!("route \"{label}\" references unknown stop \"{stop}\""))?;
            ordered.push(idx);
        }

        // The route-origin contract (module note). Checked before evaluation
        // so an open route is never given a verdict it did not earn.
        if !allow_open_route && ordered.first() != Some(&0) {
            let depot = &input.nodes[0].id;
            let first = route.stops.first().map_or("<none>", String::as_str);
            return Err(format!(
                "route \"{label}\" starts at \"{first}\", not at the depot \"{depot}\" (nodes[0]). \
                 Every route is timed from its first stop at t = 0, so leaving the depot out \
                 makes each arrival early by the depot leg and can pass a late schedule. \
                 Write the route as [\"{depot}\", ..., \"{depot}\"], or pass --allow-open-route \
                 if this vehicle genuinely starts at \"{first}\""
            ));
        }

        match evaluate_order(&ordered, &distances_q16, nodes_count, &time_windows) {
            Ok(_final_arrival_q16) => feasible += 1,
            Err(v) => violations.push(to_report(&label, v, &input)),
        }
    }

    let verdict = if violations.is_empty() {
        "FEASIBLE"
    } else {
        "INFEASIBLE"
    };

    // Digest covers the input *and* the verdict: it pins what was checked
    // and what was concluded, so two runs can be compared without trusting
    // either run's narrator.
    //
    // Line endings are normalised first, and that is not cosmetic. The digest
    // is taken over the input text, so hashing raw bytes made the same
    // schedule hash differently on Windows: git rewrites LF to CRLF on
    // checkout, as does every Windows editor, and CI caught exactly this —
    // Linux and macOS agreed on 611eef21…, Windows returned 5467faa0… while
    // reporting byte-identical Q16.16 integers. A digest whose whole purpose
    // is letting two parties confirm they reached the same verdict on the
    // same schedule cannot report a difference that does not exist.
    //
    // Normalising CRLF to LF is a no-op on an already-LF file, so every
    // digest published before this change still holds.
    let canonical = raw.replace("\r\n", "\n");
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    // Only the non-default mode is hashed, so every depot-origin digest
    // published before the flag existed is unchanged.
    if allow_open_route {
        hasher.update(b"\x00route-origin:open");
    }
    hasher.update(b"\x00verdict:");
    hasher.update(verdict.as_bytes());
    for v in &violations {
        hasher.update(format!(
            "\x00{}:{}:{}:{}",
            v.node_index, v.arrival_time_q16, v.window_close_q16, v.deficit_q16
        ));
    }
    let digest = format!("{:x}", hasher.finalize());

    Ok(AuditReport {
        schema: "lattice117.audit.report.v1",
        verdict,
        route_origin: if allow_open_route { "open" } else { "depot" },
        time_unit: input.time_unit.clone(),
        routes_checked: input.routes.len(),
        routes_feasible: feasible,
        violations,
        verdict_digest_sha256: digest,
    })
}

fn read_input(cli: &Cli) -> Result<String, String> {
    match &cli.input {
        Some(path) => std::fs::read_to_string(path)
            .map_err(|e| format!("could not read {}: {e}", path.display())),
        None => {
            if std::io::stdin().is_terminal() {
                return Err(
                    "no input. Pass --input <file> or pipe a schedule on stdin.".to_string()
                );
            }
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| format!("could not read stdin: {e}"))?;
            Ok(buf)
        }
    }
}

fn validate(input: &AuditInput) -> Result<(), String> {
    if input.schema != "lattice117.audit.v1" {
        return Err(format!(
            "unsupported schema \"{}\" (expected \"lattice117.audit.v1\")",
            input.schema
        ));
    }
    if input.nodes.is_empty() {
        return Err("nodes is empty — nothing to audit".to_string());
    }
    if input.routes.is_empty() {
        return Err("routes is empty — nothing to audit".to_string());
    }
    let n = input.nodes.len();
    if input.distance_matrix.len() != n {
        return Err(format!(
            "distance_matrix has {} rows but there are {} nodes — it must be square and node-aligned",
            input.distance_matrix.len(),
            n
        ));
    }
    for (i, row) in input.distance_matrix.iter().enumerate() {
        if row.len() != n {
            return Err(format!(
                "distance_matrix row {} has {} columns, expected {}",
                i,
                row.len(),
                n
            ));
        }
    }
    let mut seen: Vec<&str> = Vec::with_capacity(n);
    for node in &input.nodes {
        if seen.contains(&node.id.as_str()) {
            return Err(format!(
                "duplicate node id \"{}\" — stop ids must be unique to attribute a violation to one of them",
                node.id
            ));
        }
        seen.push(&node.id);
    }
    Ok(())
}

/// Scales a caller-supplied value into Q16.16, refusing anything the format
/// cannot hold. Rejecting loudly matters more than convenience here: a
/// wrapped value produces a confident verdict about a schedule that was
/// never actually checked.
fn to_q16(value: f64) -> Result<i32, String> {
    if !value.is_finite() {
        return Err("value is not finite".to_string());
    }
    if value > Q16_MAX_WHOLE || value < Q16_MIN_WHOLE {
        return Err(format!(
            "outside the Q16.16 representable range ({Q16_MIN_WHOLE} to {Q16_MAX_WHOLE}). Rescale the schedule's time unit (e.g. minutes instead of seconds) and retry"
        ));
    }
    Ok((value * Q16_ONE as f64).round() as i32)
}

fn from_q16(value: i32) -> f64 {
    value as f64 / Q16_ONE as f64
}

fn to_report(vehicle: &str, v: TimeParadoxViolation, input: &AuditInput) -> ViolationReport {
    let node_id = input
        .nodes
        .get(v.node_id)
        .map(|n| n.id.clone())
        // The engine reports an index; if it is somehow out of range, say so
        // rather than silently print a plausible-looking wrong name.
        .unwrap_or_else(|| format!("<unmapped index {}>", v.node_id));

    ViolationReport {
        vehicle: vehicle.to_string(),
        node_id,
        node_index: v.node_id,
        arrival_time: from_q16(v.arrival_time_q16),
        window_close: from_q16(v.window_close_q16),
        deficit: from_q16(v.deficit_q16),
        arrival_time_q16: v.arrival_time_q16,
        window_close_q16: v.window_close_q16,
        deficit_q16: v.deficit_q16,
    }
}

// ---------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------

fn use_colour(cli: &Cli) -> bool {
    if cli.no_color || std::env::var_os("NO_COLOR").is_some() {
        return false;
    }
    std::io::stdout().is_terminal()
}

fn print_human(report: &AuditReport, colour: bool) {
    let (green, red, dim, bold, reset) = if colour {
        ("\x1b[32m", "\x1b[31m", "\x1b[2m", "\x1b[1m", "\x1b[0m")
    } else {
        ("", "", "", "", "")
    };

    let unit = report.time_unit.as_deref().unwrap_or("time units");

    println!();
    println!("{bold}LATTICE117 SCHEDULE AUDIT{reset}");
    println!("{dim}air-gapped · deterministic · no data left this machine{reset}");
    if report.route_origin == "open" {
        println!(
            "{dim}--allow-open-route: each route is timed from its own first stop, not the depot{reset}"
        );
    }
    println!();

    if report.violations.is_empty() {
        println!(
            "  {green}{bold}PASS{reset}  {} of {} routes feasible",
            report.routes_feasible, report.routes_checked
        );
        println!("  {dim}every stop is reachable within its own time window{reset}");
    } else {
        println!(
            "  {red}{bold}FAIL{reset}  {} of {} routes feasible · {} violation(s)",
            report.routes_feasible,
            report.routes_checked,
            report.violations.len()
        );
        println!();
        for v in &report.violations {
            println!(
                "  {red}▸{reset} {bold}{}{reset} — stop {bold}{}{reset}",
                v.vehicle, v.node_id
            );
            println!(
                "      arrives      {:>12.4} {unit}   {dim}(Q16.16 {}){reset}",
                v.arrival_time, v.arrival_time_q16
            );
            println!(
                "      window shuts {:>12.4} {unit}   {dim}(Q16.16 {}){reset}",
                v.window_close, v.window_close_q16
            );
            println!(
                "      {red}late by{reset}      {red}{:>12.4}{reset} {unit}   {dim}(Q16.16 {}){reset}",
                v.deficit, v.deficit_q16
            );
            println!();
        }
    }

    println!(
        "  {dim}verdict digest  {}{reset}",
        report.verdict_digest_sha256
    );
    println!(
        "  {dim}re-run this file and the digest is identical, or determinism is broken{reset}"
    );
    println!();
    println!(
        "{dim}To generate a cryptographically sealed compliance artifact for this audit, upgrade to a commercial license.{reset}"
    );
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// depot open 0..600; A due 30, B due 50, C due 40. depot->A->B->C is
    /// 20 + 15 + 10 = 45 at C, so C is late by 5. Leave the depot out and C is
    /// reached at 15 + 10 = 25: a false PASS.
    fn schedule(stops: &[&str], c_due: f64) -> String {
        let stops: Vec<String> = stops.iter().map(|s| format!("\"{s}\"")).collect();
        format!(
            r#"{{"schema":"lattice117.audit.v1","time_unit":"minutes",
            "nodes":[{{"id":"depot","ready":0,"due":600}},{{"id":"A","ready":0,"due":30}},
                     {{"id":"B","ready":0,"due":50}},{{"id":"C","ready":0,"due":{c_due}}}],
            "distance_matrix":[[0,20,25,30],[20,0,15,25],[25,15,0,10],[30,25,10,0]],
            "routes":[{{"vehicle":"van-1","stops":[{}]}}]}}"#,
            stops.join(",")
        )
    }

    #[test]
    fn a_depot_origin_route_inside_every_window_passes() {
        let r = audit(&schedule(&["depot", "A", "B", "C", "depot"], 60.0), false).unwrap();
        assert_eq!(r.verdict, "FEASIBLE");
        assert_eq!(r.route_origin, "depot");
        assert_eq!(exit_code(&r), 0);
    }

    #[test]
    fn a_late_route_fails_and_names_the_stop_and_the_deficit() {
        let r = audit(&schedule(&["depot", "A", "B", "C", "depot"], 40.0), false).unwrap();
        assert_eq!(r.verdict, "INFEASIBLE");
        assert_eq!(exit_code(&r), 1);
        assert_eq!(r.violations.len(), 1);
        let v = &r.violations[0];
        assert_eq!(v.node_id, "C");
        assert_eq!(v.arrival_time_q16, 45 * 65_536);
        assert_eq!(v.window_close_q16, 40 * 65_536);
        assert_eq!(v.deficit_q16, 5 * 65_536);
    }

    #[test]
    fn the_missing_depot_trap_is_an_input_error_not_a_pass() {
        let err = audit(&schedule(&["A", "B", "C"], 40.0), false).unwrap_err();
        assert!(err.contains("not at the depot \"depot\""), "{err}");
        assert!(err.contains("--allow-open-route"), "{err}");
        let r = audit(&schedule(&["depot", "A", "B", "C", "depot"], 40.0), false).unwrap();
        assert_eq!(exit_code(&r), 1);
    }

    #[test]
    fn an_empty_route_is_an_input_error() {
        assert!(audit(&schedule(&[], 40.0), false).is_err());
    }

    #[test]
    fn allow_open_route_times_from_the_first_stop_and_says_so_in_the_digest() {
        let open = audit(&schedule(&["A", "B", "C"], 40.0), true).unwrap();
        assert_eq!(open.verdict, "FEASIBLE");
        assert_eq!(open.route_origin, "open");
        let raw = schedule(&["depot", "A", "B", "C", "depot"], 60.0);
        let strict = audit(&raw, false).unwrap();
        let loose = audit(&raw, true).unwrap();
        assert_eq!(strict.verdict, loose.verdict);
        assert_ne!(strict.verdict_digest_sha256, loose.verdict_digest_sha256);
    }

    #[test]
    fn the_published_example_digest_is_unchanged() {
        // The digest CI pins for examples/infeasible.json. The route-origin
        // contract must not move a single published depot-origin digest.
        let raw = include_str!("../../../examples/infeasible.json");
        let r = audit(raw, false).unwrap();
        assert_eq!(
            r.verdict_digest_sha256,
            "611eef21de58485fe4727b74f54f4f6a06e1e1bf9567384c989a1e75b5cac085"
        );
    }
}
