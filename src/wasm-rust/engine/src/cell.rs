// cell.rs — the single audited unsafe boundary for global mutable state.
//
// The engine only ever runs single-threaded:
//   * wasm32-unknown-unknown has no threads at all.
//   * The Teensy firmware touches engine globals exclusively from the main
//     loop (MIDI hand-off uses a separate lock-free atomic ring buffer).
//
// `Global<T>` gives `static` globals interior mutability without `static mut`,
// which lets the rest of the codebase compile as ordinary safe Rust (no
// `#![allow(static_mut_refs)]`, no scattered `unsafe` blocks). Every unsafe
// operation needed for global mutable state is concentrated here and justified
// by the single-threaded execution model above — this is the only place in the
// engine that asserts that invariant.
//
// `Global` is zero-cost: `get`/`get_mut` compile down to a plain pointer
// dereference, identical to the old `static mut` accesses, which matters for
// the per-pixel OLED framebuffer on the 600MHz Cortex-M7.

use core::cell::UnsafeCell;

/// Interior-mutable wrapper for single-threaded `static` globals.
pub struct Global<T> {
    inner: UnsafeCell<T>,
}

// SAFETY: the engine is only accessed from a single thread (see module note),
// so there is never concurrent access to the wrapped value. Sharing the cell
// across the (sole) thread is therefore sound.
unsafe impl<T> Sync for Global<T> {}

impl<T> Global<T> {
    /// Create a new global. `const` so it can initialize a `static`.
    pub const fn new(value: T) -> Self {
        Self { inner: UnsafeCell::new(value) }
    }

    /// Borrow the contained value immutably.
    pub fn get(&self) -> &T {
        // SAFETY: single-threaded; no concurrent access exists (module note).
        // The caller is responsible for not holding an overlapping `&mut`,
        // exactly as the previous `static mut` reads required.
        unsafe { &*self.inner.get() }
    }

    /// Borrow the contained value mutably.
    #[allow(clippy::mut_from_ref)]
    pub fn get_mut(&self) -> &mut T {
        // SAFETY: single-threaded; no concurrent access exists (module note).
        // The caller must not create overlapping `&mut`, exactly as the
        // previous `static mut` writes required.
        unsafe { &mut *self.inner.get() }
    }

    /// Raw pointer to the contained value, for FFI buffers handed to JS.
    pub fn as_ptr(&self) -> *mut T {
        self.inner.get()
    }
}
