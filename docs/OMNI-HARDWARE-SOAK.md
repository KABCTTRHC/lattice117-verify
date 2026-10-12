# Omni-hardware soak

**Page:** https://kabcttrhc.github.io/lattice117-verify/omni.html

`determinism.html` proves a device reproduces two reference digests in under a
second. The soak asks the harder question: does it **keep** reproducing exact
results for half an hour, under sustained load, as it heats and throttles?

## What one cycle is

`crates/lattice117-omni` (a separate WASM module beside, never instead of, the
21,525-byte published referee) generates a planning problem of 6 to 40 nodes
from the cycle number and runs it through:

1. the global solver: exact search up to nine nodes, Kondo QUBO annealing and
   2-opt above that;
2. the referee (`evaluate_order`), against generated time windows. Half the
   cycles have windows that should bite, so both the accept and the violation
   paths run;
3. exact resequencing of the first stops;
4. closed-form repair (re-timing).

Every output integer is folded into a SHA-256 chain. At fixed checkpoints
(10, 100, 1,000, 5,000, 10,000, 25,000, 50,000 and 100,000 cycles) the chain
must equal the value pinned from the native x86-64 build. A browser engine, an
instruction set or a thermal state that changed any result in any cycle would
show as a mismatch at the next checkpoint.

## What the page records

- Pre-flight: the same reference fixtures and 36,003-value boundary sweep as
  `determinism.html`.
- Per cycle: time taken, from outside the kernel (which has no clock).
- Every 500th cycle: the cycle is run again and both outputs are compared.
- Every minute:
  - the reference fixtures are re-checked under load;
  - the median, 95th percentile and maximum time per cycle;
  - battery level and charging (where the browser exposes them);
  - the CPU pressure state (Chrome's Compute Pressure API, the closest thing
    to a thermal signal a web page can see);
  - JavaScript heap;
  - seconds the tab was hidden.
- Temperature: **no browser exposes a temperature sensor.** The page takes
  start and end readings entered by the operator and marks them as such.
  Measured temperature every cycle comes from the native soak
  (`sovereign_api`'s `omni_soak`), on Linux, Android (Termux), Pine64 or a
  Chromebook's Linux container.
- The record ends with a SHA-256 over every line above it. A full JSON log
  (every cycle's time) and a minute-by-minute CSV can be downloaded.

## Running it

1. Plug the device in and set the screen not to sleep (the page also asks the
   browser to keep it awake where supported).
2. Open the page, enter a device name, choose **30 minutes**, press start.
3. Keep the tab in front. A background tab is slowed by the browser; the
   record states how long it was hidden.
4. When it finishes, download the JSON and copy the record.

A pass is `OVERALL DETERMINISTIC`, with every reached checkpoint `MATCH`.
Throughput, slow-down and telemetry differ by device by design: they describe
the device, not the result.

## Reference timings

Headless Chromium on a 4-core x86-64 server: about 28 cycles per second, 34 ms
median per cycle.

## Found by the soak before release

The first run of the kernel found two defects in `lattice117-solve` that no
existing test reached:

- **Overflow.** The Kondo chain DP and the inter-cluster QUBO kept 32-bit
  running sums, and overflowed once distances reached a few thousand units. A
  debug build panicked; a release build wrapped silently.
- **Dropped stops.** A cluster of more than 32 members was truncated, and the
  extra stops vanished from the route with no error.

Both are fixed, each with a regression test that fails without the fix. Inputs
that did not trigger either defect give the same results as before.
