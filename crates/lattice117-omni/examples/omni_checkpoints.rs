//! Prints the soak chain at each checkpoint, computed natively.
//!
//!   cargo run --release -p lattice117-omni --example omni_checkpoints -- 10 100 1000
//!
//! Cycles are independent, so their outputs are computed on every core and
//! folded in seed order; the chain is the same as a single-threaded run. This
//! is how the values in demo/omni.html were produced, and a second machine
//! running it is an independent check of them.

use lattice117_omni::{cycle, fold};

fn main() {
    let mut marks: Vec<u32> = std::env::args()
        .skip(1)
        .filter_map(|a| a.parse().ok())
        .collect();
    if marks.is_empty() {
        marks = vec![10, 100, 1_000];
    }
    marks.sort_unstable();
    let last = *marks.last().unwrap();
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1) as u32;
    let mut chain = [0u8; 32];
    let mut next = 0u32;
    const BATCH: u32 = 256;
    while next < last {
        let end = (next + BATCH * threads).min(last);
        let outputs: Vec<Vec<i32>> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..threads)
                .map(|t| {
                    s.spawn(move || {
                        (next..end)
                            .filter(|seed| seed % threads == t)
                            .map(|seed| (seed, cycle(seed)))
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            let mut all: Vec<(u32, Vec<i32>)> = handles
                .into_iter()
                .flat_map(|h| h.join().unwrap())
                .collect();
            all.sort_by_key(|(seed, _)| *seed);
            all.into_iter().map(|(_, o)| o).collect()
        });
        for (i, o) in outputs.iter().enumerate() {
            let seed = next + i as u32;
            chain = fold(&chain, seed, o);
            if marks.contains(&(seed + 1)) {
                let hex: String = chain.iter().map(|b| format!("{b:02x}")).collect();
                println!("{} {hex}", seed + 1);
            }
        }
        next = end;
    }
}
