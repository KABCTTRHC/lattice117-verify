//! WebAssembly bridge for `lattice117-verify`.
//!
//! This crate adds no evaluation logic of its own. It exposes the *same*
//! `evaluate_order` the CLI calls, over a C ABI, so a browser can run it
//! directly — no server, no API call, no telemetry. The page that loads this
//! module works with the network disconnected, which is the easiest way to
//! demonstrate the air-gap property rather than assert it.
//!
//! ## Memory protocol
//!
//! Callers allocate with [`lattice_alloc`], write `i32` values into the
//! module's linear memory, call [`lattice_verify`], then read the result
//! block back. Everything crossing the boundary is `i32` in Q16.16 — no
//! strings, no JSON, no floating point.
//!
//! The result block is six `i32`s:
//!
//! | Index | Meaning |
//! |---|---|
//! | 0 | `0` = feasible, `1` = time-window violation, `-1` = bad input |
//! | 1 | violating stop index into the supplied route (`-1` if none) |
//! | 2 | arrival time, Q16.16 |
//! | 3 | window close, Q16.16 |
//! | 4 | deficit, Q16.16 (how late, in the caller's own unit) |
//! | 5 | total route cost when feasible, Q16.16 |

use lattice117_verify::evaluate_order;

/// Allocates `size` bytes in the module's linear memory and returns a pointer.
///
/// The caller owns the block and must return it with [`lattice_free`].
#[no_mangle]
pub extern "C" fn lattice_alloc(size: usize) -> *mut u8 {
    let mut buf: Vec<u8> = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    core::mem::forget(buf);
    ptr
}

/// Returns a block previously handed out by [`lattice_alloc`].
///
/// # Safety
///
/// `ptr` must have come from [`lattice_alloc`] with the same `size`, and must
/// not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn lattice_free(ptr: *mut u8, size: usize) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, 0, size) });
    }
}

/// Verifies one route against its own time windows.
///
/// `route_ptr` is `route_len` node indices. `dist_ptr` is an `n * n` row-major
/// Q16.16 distance matrix. `win_ptr` is `n` `(ready, due)` Q16.16 pairs, so
/// `2 * n` values. `out_ptr` is a six-`i32` result block (see module docs).
///
/// # Safety
///
/// Every pointer must be a live allocation of at least the length implied by
/// the accompanying count, and `out_ptr` must have room for six `i32`s.
#[no_mangle]
pub unsafe extern "C" fn lattice_verify(
    route_ptr: *const u32,
    route_len: usize,
    dist_ptr: *const i32,
    n: usize,
    win_ptr: *const i32,
    out_ptr: *mut i32,
) {
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, 6) };
    out.fill(0);
    out[1] = -1;

    // Reject shapes the evaluator would index out of, rather than trusting the
    // caller. A browser page is an untrusted caller by definition.
    if route_ptr.is_null() || dist_ptr.is_null() || win_ptr.is_null() || n == 0 || route_len == 0 {
        out[0] = -1;
        return;
    }
    let route_raw = unsafe { core::slice::from_raw_parts(route_ptr, route_len) };
    if route_raw.iter().any(|&idx| idx as usize >= n) {
        out[0] = -1;
        return;
    }

    let route: Vec<usize> = route_raw.iter().map(|&i| i as usize).collect();
    let distances = unsafe { core::slice::from_raw_parts(dist_ptr, n * n) };
    let windows_flat = unsafe { core::slice::from_raw_parts(win_ptr, n * 2) };
    let windows: Vec<(i32, i32)> = windows_flat.chunks_exact(2).map(|w| (w[0], w[1])).collect();

    match evaluate_order(&route, distances, n, &windows) {
        Ok(cost) => {
            out[0] = 0;
            out[5] = cost;
        }
        Err(v) => {
            out[0] = 1;
            out[1] = v.node_id as i32;
            out[2] = v.arrival_time_q16;
            out[3] = v.window_close_q16;
            out[4] = v.deficit_q16;
        }
    }
}
