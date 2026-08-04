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

// ============ Drum sampler ============
//
// Sample memory lives inside this module so the sampler's raw SampleRef
// pointers stay valid for as long as the slot holds the take. Buffers come
// from a page-grained bump arena (memory.grow — still zero imports); a slot
// re-records into its old buffer when the new take fits, otherwise it gets a
// fresh region and the old one is wasted. Takes are host-capped to a few
// seconds, so waste stays bounded.
//
// Everything below runs on the audio thread (worklet port messages are
// delivered between render quanta), so writes never race the renderer.

use arp3_synth::sampler::{NUM_SLOTS, NUM_SLOT_PARAMS};
use arp3_synth::NUM_SYNTH_CHANNELS;

const WASM_PAGE: usize = 65536;

#[derive(Clone, Copy)]
struct SlotBuf {
    ptr: usize,
    /// Capacity in samples (i16)
    cap: u32,
}

static G_SLOT_BUFS: Global<[[SlotBuf; NUM_SLOTS]; NUM_SYNTH_CHANNELS]> =
    Global::new([[SlotBuf { ptr: 0, cap: 0 }; NUM_SLOTS]; NUM_SYNTH_CHANNELS]);

#[cfg(target_arch = "wasm32")]
fn arena_alloc(bytes: usize) -> usize {
    let pages = bytes.div_ceil(WASM_PAGE);
    let prev = core::arch::wasm32::memory_grow(0, pages);
    if prev == usize::MAX { 0 } else { prev * WASM_PAGE }
}

#[cfg(not(target_arch = "wasm32"))]
fn arena_alloc(_bytes: usize) -> usize {
    0
}

/// Reserve buffer space for a take of `len` samples and return the write
/// pointer, or null if the request is invalid or memory can't grow. The host
/// writes `len` i16 samples there and then calls `synth_sample_commit`.
#[no_mangle]
pub extern "C" fn synth_sample_buffer(channel: u32, slot: u32, len: u32) -> *mut i16 {
    let ch = channel as usize;
    let sl = slot as usize;
    if ch >= NUM_SYNTH_CHANNELS || sl >= NUM_SLOTS || len == 0 || len > 4_000_000 {
        return core::ptr::null_mut();
    }
    let buf = &mut G_SLOT_BUFS.get_mut()[ch][sl];
    if buf.cap < len {
        // Detach the slot from its old memory before it gets replaced
        unsafe { G_SYNTH.get_mut().sampler.set_sample(ch as u8, sl as u8, core::ptr::null(), 0) };
        let ptr = arena_alloc(len as usize * 2);
        if ptr == 0 {
            return core::ptr::null_mut();
        }
        *buf = SlotBuf { ptr, cap: len };
    } else {
        // Reusing the buffer in place: stop voices reading it first
        unsafe { G_SYNTH.get_mut().sampler.set_sample(ch as u8, sl as u8, core::ptr::null(), 0) };
    }
    buf.ptr as *mut i16
}

/// Activate the take previously written via `synth_sample_buffer`.
#[no_mangle]
pub extern "C" fn synth_sample_commit(channel: u32, slot: u32, len: u32) {
    let ch = channel as usize;
    let sl = slot as usize;
    if ch >= NUM_SYNTH_CHANNELS || sl >= NUM_SLOTS {
        return;
    }
    let buf = G_SLOT_BUFS.get_mut()[ch][sl];
    if len == 0 || len > buf.cap {
        return;
    }
    unsafe {
        G_SYNTH.get_mut().sampler.set_sample(ch as u8, sl as u8, buf.ptr as *const i16, len);
    }
}

/// Empty a slot (its arena space is kept for the next take).
#[no_mangle]
pub extern "C" fn synth_sample_clear(channel: u32, slot: u32) {
    if (channel as usize) < NUM_SYNTH_CHANNELS && (slot as usize) < NUM_SLOTS {
        unsafe {
            G_SYNTH.get_mut().sampler.set_sample(channel as u8, slot as u8, core::ptr::null(), 0);
        }
    }
}

/// Trigger a drum hit: GM `note` picks the slot ((note-35) mod 16).
#[no_mangle]
pub extern "C" fn synth_drum_trigger(channel: u32, note: u32, velocity: u32) {
    G_SYNTH.get_mut().drum_trigger(channel as u8, note as u8, velocity as u8);
}

/// Release a held drum note (LOOP/GATE modes).
#[no_mangle]
pub extern "C" fn synth_drum_release(channel: u32, note: u32) {
    G_SYNTH.get_mut().drum_release(channel as u8, note as u8);
}

/// Set one sampler slot param (ids from arp3_synth::sampler).
#[no_mangle]
pub extern "C" fn synth_set_slot_param(channel: u32, slot: u32, param: u32, value: i32) {
    if (param as usize) < NUM_SLOT_PARAMS {
        G_SYNTH.get_mut().set_slot_param(channel as u8, slot as u8, param as u8, value as i16);
    }
}
