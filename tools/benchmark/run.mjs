#!/usr/bin/env node
/**
 * Runs Lattice117's Tier 5 solver against a benchmark instance YOU supply.
 *
 *   node tools/benchmark/run.mjs --tsplib  /path/to/burma14.tsp
 *   node tools/benchmark/run.mjs --solomon /path/to/C101.txt
 *   node tools/benchmark/run.mjs --tsplib  /path/to/x.tsp --optimum 1234
 *
 * No instance data ships with this repository. docs/FIXTURE-B-BENCHMARK.md
 * records the licence position that forced that: TSPLIB's own terms permit
 * non-commercial use only and forbid redistribution without written
 * permission, and Solomon's instances carry no licence statement at all.
 *
 * What this prints is a measurement, not a score. Where the engine cannot be
 * compared to a published figure it says so instead of printing a ratio that
 * looks like one.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { parseTsplib, parseSolomon, euc2d, solomonDistance, matrixOf } from './parse.mjs';
import { resequenceRound, EXACT_LIMIT, fromQ } from '../../demo/resequence.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KNOWN = JSON.parse(readFileSync(join(HERE, 'best-known.json'), 'utf8'));

function usage(msg) {
  if (msg) console.error(`\n${msg}`);
  console.error(`
Usage:
  node tools/benchmark/run.mjs --tsplib  <file.tsp>  [--optimum N]
  node tools/benchmark/run.mjs --solomon <file.txt>

Instance files are not included. Obtain them yourself, under whatever terms
apply to you; see docs/FIXTURE-B-BENCHMARK.md.
`);
  process.exit(msg ? 2 : 0);
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? usage(`${name} needs a value`);
};
if (!argv.length || argv.includes('-h') || argv.includes('--help')) usage();

const tsplib = flag('--tsplib');
const solomon = flag('--solomon');
if (!tsplib && !solomon) usage('give either --tsplib or --solomon');
if (tsplib && solomon) usage('give one of --tsplib or --solomon, not both');

/** Exhaustive interior search over a closed tour 0..n-1..0. */
function resequenceTour(matrix, n) {
  const stops = [...Array(n)].map((_, i) =>
    ({ id: `N${i}`, node: i, openQ: 0, closeQ: 2 ** 30, travelQ: 0 }));
  stops.push({ id: 'N0', node: 0, openQ: 0, closeQ: 2 ** 30, travelQ: 0 });
  return resequenceRound({ id: 'tour', departQ: 0, stops }, matrix, n);
}

if (tsplib) {
  const inst = parseTsplib(readFileSync(tsplib, 'utf8'));
  const { matrix, n } = matrixOf(inst.coords, euc2d);
  const stated = flag('--optimum');
  const key = basename(tsplib).replace(/\.tsp$/i, '').toLowerCase();
  const record = KNOWN.tsplib[key];
  const optimum = stated !== null ? Number(stated) : record?.optimum ?? null;

  console.log(`\nTSPLIB instance ${inst.name} — ${n} nodes, EDGE_WEIGHT_TYPE EUC_2D`);
  console.log(`Distances are nint(sqrt(dx^2+dy^2)), as TSPLIB defines them, so a`);
  console.log(`tour length here is directly comparable to a published one.\n`);

  const out = resequenceTour(matrix, n);
  if (!out.searched) {
    console.log(`Exhaustive re-sequencing: NOT RUN.`);
    console.log(`  ${n - 1} interior nodes is past EXACT_LIMIT (${EXACT_LIMIT}), so this`);
    console.log(`  instance is outside what the exact path will claim an answer for.`);
    console.log(`  It reports that rather than returning a guess labelled optimal.`);
    console.log(`  The global heuristic path is Rust-only; see`);
    console.log(`  crates/lattice117-solve/tests/referee.rs for its measured gap.`);
  } else {
    const len = out.bestCostQ / 65536;
    console.log(`Exhaustive re-sequencing: ${len.toFixed(0)} over ${n} nodes`);
    console.log(`  order ${out.bestIds.join(' -> ')}`);
    if (optimum !== null) {
      const gap = ((len - optimum) / optimum) * 100;
      console.log(`  published ${record ? record.status : 'supplied'}: ${optimum}` +
                  (record ? `  (${record.source})` : ''));
      console.log(`  gap: ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%`);
      if (gap < 0) {
        console.log(`  A NEGATIVE GAP IS A BUG, not a record: the published value is`);
        console.log(`  proven optimal, so beating it means the distances were read`);
        console.log(`  differently. Check EDGE_WEIGHT_TYPE and the rounding rule.`);
        process.exit(1);
      }
    } else {
      console.log(`  no published value on file for "${key}" — pass --optimum N to compare.`);
    }
  }
  console.log('');
}

if (solomon) {
  const inst = parseSolomon(readFileSync(solomon, 'utf8'));
  const nodes = inst.customers;
  const { matrix, n } = matrixOf(nodes, solomonDistance);
  const key = inst.name.trim().toUpperCase();
  const record = KNOWN.solomon[key];

  console.log(`\nSolomon instance ${inst.name} — ${n} nodes, ` +
              `${inst.vehicles ?? '?'} vehicles of capacity ${inst.capacity ?? '?'}\n`);

  /* The mismatch, stated before any number is printed. Solomon's best-known
     figures are the distance of a multi-vehicle, capacity-feasible solution
     that minimises vehicle count first. This engine models neither capacity nor
     fleet size. Printing our single-tour length beside their fleet distance
     would produce a ratio that reads as a score and means nothing. */
  console.log(`NOT COMPARABLE, and this is why rather than a caveat in small print:`);
  console.log(`  Solomon's objective minimises VEHICLES first, then distance, under a`);
  console.log(`  hard CAPACITY constraint. Lattice117 models neither. Its best-known`);
  console.log(`  distance` + (record ? ` for ${key} is ${record.distance} over ` +
              `${record.vehicles} vehicles` : ' is not on file') + `, which is not a`);
  console.log(`  number a single uncapacitated tour can be scored against.`);
  if (record) console.log(`  source: ${record.source}`);

  /* What IS answerable: can one tour satisfy every window at all? Usually no,
     which is a real result about the instance rather than a score. */
  const out = resequenceTour(matrix, n);
  console.log(`\nWhat this engine can say about ${key}:`);
  if (!out.searched) {
    console.log(`  Exhaustive re-sequencing not run — ${n - 1} interior stops is past`);
    console.log(`  EXACT_LIMIT (${EXACT_LIMIT}). Tier 5 re-sequences ROUNDS, and a round is`);
    console.log(`  short; a 100-customer instance with no assignment is the global`);
    console.log(`  path's problem, and the global path does not claim optimality.`);
  } else {
    console.log(`  single-tour length ${fromQ(out.bestCostQ).toFixed(1)} ` +
                `(uncapacitated, windows ignored)`);
  }
  const windows = nodes.filter((c) => c.due < Infinity).length;
  console.log(`  ${windows} of ${n} nodes carry a time window.`);
  console.log(`\n  To exercise the path Tier 5 is actually sold on, split this`);
  console.log(`  instance into rounds and re-sequence each one — that is what a`);
  console.log(`  route sheet is, and it is what demo/example-fleet-nottingham.csv`);
  console.log(`  demonstrates end to end.\n`);
}
