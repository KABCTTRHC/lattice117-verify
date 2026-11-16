# Overview: lattice117-verify

16 November 2026.

## What it is

The public verifier for Lattice117 schedules. It checks whether a schedule is
feasible against its time windows, and against vehicle capacity when one is
given; when it is not, it names the first stop that fails and by how much. It
prints a digest anyone can recompute, it runs offline, and the same input gives
the same digest on any machine.

## What is in the repository

| Path | What it holds |
|---|---|
| `crates/` | Rust crates: `lattice117-verify`, `lattice117-audit`, `lattice117-solve`, `lattice117-wasm` (the WebAssembly build) and `lattice117-omni` |
| `npm/` | The npm package `lattice117-verify`: the library (`index.js`), the WASM build, the CLI (`bin/`) and `mcp.js`, the MCP server `lattice117-mcp` |
| `excel-addin/`, `sheets-addon/` | An Excel add-in (Schedule Check) and a Google Sheets add-on |
| `demo/`, `examples/` | Worked examples, among them the Nottingham round |
| `docs/` | The determinism white paper, the fixture write-ups, the omni-hardware soak and the regulation notes |
| `REPRODUCE.md` | How to reproduce the published digests |

## Where it sits

The engine (`sovereign_api`) produces and certifies plans. This repository is
the small, public check that anyone can run on them without trusting the
engine.

## The six repositories

| Repository | What it is |
|---|---|
| `sovereign_api` | The Lattice117 engine, its referees, firmware, benchmarks and engineering record. The canonical engine |
| `lattice117-verify` | The public verifier: npm `lattice117-verify`, Rust crates, the WASM build and the MCP server |
| `orrery-bsg` | The owner's private command terminal for seeing and testing the engines |
| `tate_engine` | An earlier sibling of the engine, with modules `sovereign_api` does not carry |
| `aeon73-workbench` | The AEON-73 workbench app: a model of a concept part that does not exist |
| `axiomq` | AxiomQ, a Next.js and Genkit chatbot prototype |
