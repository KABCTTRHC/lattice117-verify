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

## Results, 4 October 2026

Nine consumer devices ran the page for 30 minutes each on 4 October 2026,
between 08:57 and 11:23 UTC. Every device reached `OVERALL DETERMINISTIC`, and
every checkpoint each one reached equals the pinned value above. The pass/fail
result is the checkpoint values. The cycle counts and latencies describe the
device, not the result.

| Device | CPU / ISA the WASM ran on | OS, browser engine | Cycles | Checkpoints to | Median ms |
|---|---|---|---:|---:|---:|
| Google Pixel 8 Pro | Tensor G3, AArch64 | Android, Chrome 153 (V8) | 59,967 | 50,000 | 28.9 |
| Samsung Galaxy A36 | Snapdragon (Adreno 710), ARMv8 † | Android, Chrome 154 (V8) | 55,111 | 50,000 | 33.3 |
| Apple iPhone SE (2020) | A13, AArch64 | iOS 26.6.2, Chrome for iOS (JavaScriptCore) | 52,758 | 50,000 | 28.0 |
| HP 450 G5 | Core i5-8250U, x86-64 | Windows, Chrome 154 (V8) | 41,096 | 25,000 | 43.0 |
| Dell OptiPlex SFF | Pentium G3240, x86-64 | Windows, Chrome 154 (V8) | 39,043 | 25,000 | 46.9 |
| Samsung Galaxy Tab A11 | Mali-G57 SoC, ARMv8 † | Android, Chrome 154 (V8) | 27,543 | 25,000 | 67.8 |
| Fusion5 FM4 | Celeron N4120, x86-64 | Windows, Edge 154 (V8) | 21,641 | 10,000 | 86.9 |
| ASUS Chromebook C523N | Apollo Lake Celeron, x86-64 | ChromeOS, Chrome 126 (V8) | 16,140 | 10,000 | 115.2 |
| TCL 50V6BK television | **32-bit ARM (`armv7l`)** | Android 11 TV, WebView 153 (V8) | 2,712 | 1,000 | 709.1 |

† Chrome on Android reports a fixed platform string, so whether its build
was 32- or 64-bit on these two devices is not recorded. The Pixel 8 Pro and
the iPhone run 64-bit code only. The television's WebView reports its real
platform, `armv7l`, which is 32-bit ARM.

- 316,011 generated planning problems were solved and refereed, 313,299 of
  them on the eight devices with a saved JSON. No checkpoint, repeat re-run or
  reference-fixture re-check differed on any device.
- Three instruction sets were covered: x86-64, AArch64 and 32-bit ARM. Each
  is compiled by a different backend of the browser's WebAssembly compiler.
  Two independently written engines took part: V8, in Chrome versions 126 to
  154, and Apple's JavaScriptCore.
- The results held under load:
  - The Chromebook spent 4 minutes and the OptiPlex 1 minute at the browser's
    `critical` CPU-pressure level.
  - The iPhone's median cycle time rose from 25 ms to about 50 ms during the
    run.
  - Every checkpoint still matched.
- The records were re-checked off-device: every record seal recomputes, and
  every chain value equals the pin. The television's JSON was not saved; its
  record was checked from a transcription, whose seal also recomputes.
- **Page fix found by this run.** The downloaded JSON's `hiddenMs` kept
  counting after the soak ended,
  while the sealed record correctly said 0 s. The page now stops counting at
  the end, and the record and the JSON carry the same end time. No result,
  checkpoint or seal was affected.
