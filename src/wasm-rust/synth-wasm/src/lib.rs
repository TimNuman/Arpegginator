// synth-wasm/lib.rs — WASM exports for the AudioWorklet synth
//
// Thin shell around arp3-synth, compiled to a separate `synth.wasm` that the
// AudioWorkletProcessor instantiates on the audio thread. Deliberately has
// ZERO imports (no JS callbacks, no allocator use), so the worklet can do
// `new WebAssembly.Instance(module, {})` synchronously in its constructor.
//
// All state is static: the synth struct itself plus one render buffer. The
// worklet calls `synth_render(frames)` once per 128-frame quantum and copies
// the returned f32 block out of WASM memory.

use core::cell::UnsafeCell;

use arp3_synth::{Synth, MAX_BLOCK};

/// Single-threaded interior mutability, same pattern as arp3-engine's
/// `cell::Global`: an AudioWorkletGlobalScope runs exactly one thread and
/// every export below is only ever called from it, so there is never
/// concurrent access.
struct Global<T>(UnsafeCell<T>);
unsafe impl<T> Sync for Global<T> {}
impl<T> Global<T> {
    const fn new(v: T) -> Self {
        Global(UnsafeCell::new(v))
    }
    #[allow(clippy::mut_from_ref)]
    fn get_mut(&self) -> &mut T {
        unsafe { &mut *self.0.get() }
    }
}

static G_SYNTH: Global<Synth> = Global::new(Synth::new());
static G_BUFFER: Global<[f32; MAX_BLOCK]> = Global::new([0.0; MAX_BLOCK]);

#[no_mangle]
pub extern "C" fn synth_init(sample_rate: f32) {
    let synth = G_SYNTH.get_mut();
    *synth = Synth::new();
    synth.set_sample_rate(sample_rate);
}

#[no_mangle]
pub extern "C" fn synth_note_on(channel: u32, note: u32, velocity: u32) {
    G_SYNTH.get_mut().note_on(channel as u8, note as u8, velocity as u8);
}

#[no_mangle]
pub extern "C" fn synth_note_off(channel: u32, note: u32) {
    G_SYNTH.get_mut().note_off(channel as u8, note as u8);
}

#[no_mangle]
pub extern "C" fn synth_all_notes_off() {
    G_SYNTH.get_mut().all_notes_off();
}

/// Set one patch parameter (UI units, see arp3_synth::patch).
#[no_mangle]
pub extern "C" fn synth_set_param(channel: u32, param: u32, value: i32) {
    G_SYNTH.get_mut().set_param(channel as u8, param as u8, value as i16);
}

/// Render `frames` mono samples (clamped to MAX_BLOCK) and return a pointer
/// to the f32 block in WASM memory. Valid until the next call.
#[no_mangle]
pub extern "C" fn synth_render(frames: u32) -> *const f32 {
    let buf = G_BUFFER.get_mut();
    let n = (frames as usize).min(MAX_BLOCK);
    G_SYNTH.get_mut().render(&mut buf[..n]);
    buf.as_ptr()
}
