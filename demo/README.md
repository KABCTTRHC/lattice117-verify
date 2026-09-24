# Browser demo

A single page that runs `lattice117-verify` compiled to WebAssembly. It checks
a delivery round against its own time windows and, when a stop is missed, names
the stop, the arrival, the window close and the deficit — in the schedule's own
units, with the underlying Q16.16 integers shown beside them.

**There is no backend.** The page fetches a 21 KB `.wasm` module and does
everything locally. Disconnect from the network and reload: it still works.
That is the easiest way to demonstrate the air-gap property rather than assert
it, and it is worth doing on camera.

## Running it

WebAssembly cannot be loaded from a `file://` URL, so serve the directory:

```sh
cd demo
python3 -m http.server 8000
# open http://127.0.0.1:8000
```

## Rebuilding the module

```sh
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown -p lattice117-wasm
cp target/wasm32-unknown-unknown/release/lattice117_wasm.wasm demo/
```

The bridge crate (`crates/lattice117-wasm`) adds no evaluation logic. It
exposes the same `evaluate_order` the CLI calls, over a C ABI, so the browser
and the command line run identical code.

## Hosting

The directory is static. GitHub Pages serves it for free: repository
**Settings → Pages → Deploy from a branch → `main` / `/demo`**. Ensure the
`.wasm` is served as `application/wasm` — GitHub Pages does this correctly by
default.
