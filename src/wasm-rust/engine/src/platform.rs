// platform.rs — Platform callback abstraction
// Each target provides implementations of these functions.
// WASM: calls JS imports via extern "C"
// Teensy (ARM): enqueues MIDI events into a ring buffer for main loop to drain
// Test: no-ops

use crate::engine_core::NUM_CHANNELS;

// ============ WASM Platform ============

#[cfg(all(target_arch = "wasm32", not(test)))]
extern "C" {
    fn js_step_trigger(ch: i32, note: i32, tick: i32, len: i32, vel: i32, timing: i32, flam: i32, ev_idx: i32);
    fn js_note_off(ch: i32, note: i32);
    fn js_set_current_tick(tick: i32);
    fn js_set_current_patterns(ptr: i32);
    fn js_clear_queued_pattern(ch: i32);
    fn js_preview_value(sm: i32, ch: i32, ev_idx: i32, tick: i32, val: i32);
    fn js_play_preview_note(ch: i32, row: i32, length_ticks: i32);
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub fn platform_step_trigger(
    channel: u8, midi_note: u8, tick: i32,
    note_length_ticks: i32, velocity: u8,
    timing_offset_pct: i8, flam_count: u8,
    event_index: u16,
) {
    unsafe {
        js_step_trigger(
            channel as i32, midi_note as i32, tick,
            note_length_ticks, velocity as i32,
            timing_offset_pct as i32, flam_count as i32,
            event_index as i32,
        );
    }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub fn platform_note_off(channel: u8, midi_note: u8) {
    unsafe { js_note_off(channel as i32, midi_note as i32); }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub fn platform_set_current_tick(tick: i32) {
    unsafe { js_set_current_tick(tick); }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub fn platform_set_current_patterns(patterns: &[u8; NUM_CHANNELS]) {
    unsafe { js_set_current_patterns(patterns.as_ptr() as i32); }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub fn platform_clear_queued_pattern(channel: u8) {
    unsafe { js_clear_queued_pattern(channel as i32); }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub fn platform_preview_value(
    sub_mode: u8, channel: u8,
    event_index: u16, tick: i32, value: i16,
) {
    unsafe {
        js_preview_value(
            sub_mode as i32, channel as i32,
            event_index as i32, tick, value as i32,
        );
    }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub fn platform_play_preview_note(channel: u8, row: i16, length_ticks: i32) {
    unsafe { js_play_preview_note(channel as i32, row as i32, length_ticks); }
}

// ============ Teensy / ARM Platform ============

#[cfg(all(target_arch = "arm", not(test)))]
pub mod arm_platform {
    use core::sync::atomic::{AtomicUsize, Ordering};

    const MIDI_QUEUE_SIZE: usize = 128;

    #[derive(Clone, Copy)]
    #[repr(C)]
    pub struct MidiEvent {
        pub kind: u8,       // 0 = note_on, 1 = note_off
        pub channel: u8,
        pub note: u8,
        pub velocity: u8,
    }

    impl MidiEvent {
        const fn zero() -> Self {
            MidiEvent { kind: 0, channel: 0, note: 0, velocity: 0 }
        }
    }

    static mut MIDI_QUEUE: [MidiEvent; MIDI_QUEUE_SIZE] = [MidiEvent::zero(); MIDI_QUEUE_SIZE];
    static MIDI_WRITE: AtomicUsize = AtomicUsize::new(0);
    static MIDI_READ: AtomicUsize = AtomicUsize::new(0);

    pub fn enqueue_midi(ev: MidiEvent) {
        let w = MIDI_WRITE.load(Ordering::Relaxed);
        let next = (w + 1) % MIDI_QUEUE_SIZE;
        if next != MIDI_READ.load(Ordering::Acquire) {
            unsafe { MIDI_QUEUE[w] = ev; }
            MIDI_WRITE.store(next, Ordering::Release);
        }
        // If queue is full, event is silently dropped
    }

    /// Drain one MIDI event from the queue. Called from main loop.
    pub fn dequeue_midi() -> Option<MidiEvent> {
        let r = MIDI_READ.load(Ordering::Relaxed);
        if r == MIDI_WRITE.load(Ordering::Acquire) {
            return None;
        }
        let ev = unsafe { MIDI_QUEUE[r] };
        MIDI_READ.store((r + 1) % MIDI_QUEUE_SIZE, Ordering::Release);
        Some(ev)
    }
}

#[cfg(all(target_arch = "arm", not(test)))]
pub fn platform_step_trigger(
    channel: u8, midi_note: u8, _tick: i32,
    _note_length_ticks: i32, velocity: u8,
    _timing_offset_pct: i8, _flam_count: u8,
    _event_index: u16,
) {
    arm_platform::enqueue_midi(arm_platform::MidiEvent {
        kind: 0, channel, note: midi_note, velocity,
    });
}

#[cfg(all(target_arch = "arm", not(test)))]
pub fn platform_note_off(channel: u8, midi_note: u8) {
    arm_platform::enqueue_midi(arm_platform::MidiEvent {
        kind: 1, channel, note: midi_note, velocity: 0,
    });
}

#[cfg(all(target_arch = "arm", not(test)))]
pub fn platform_set_current_tick(_tick: i32) {}

#[cfg(all(target_arch = "arm", not(test)))]
pub fn platform_set_current_patterns(_patterns: &[u8; NUM_CHANNELS]) {}

#[cfg(all(target_arch = "arm", not(test)))]
pub fn platform_clear_queued_pattern(_channel: u8) {}

#[cfg(all(target_arch = "arm", not(test)))]
pub fn platform_preview_value(
    _sub_mode: u8, _channel: u8,
    _event_index: u16, _tick: i32, _value: i16,
) {}

#[cfg(all(target_arch = "arm", not(test)))]
pub fn platform_play_preview_note(_channel: u8, _row: i16, _length_ticks: i32) {}

// ============ Test / Native Platform (no-ops) ============

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub fn platform_step_trigger(
    _channel: u8, _midi_note: u8, _tick: i32,
    _note_length_ticks: i32, _velocity: u8,
    _timing_offset_pct: i8, _flam_count: u8,
    _event_index: u16,
) {}

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub fn platform_note_off(_channel: u8, _midi_note: u8) {}

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub fn platform_set_current_tick(_tick: i32) {}

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub fn platform_set_current_patterns(_patterns: &[u8; NUM_CHANNELS]) {}

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub fn platform_clear_queued_pattern(_channel: u8) {}

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub fn platform_preview_value(
    _sub_mode: u8, _channel: u8,
    _event_index: u16, _tick: i32, _value: i16,
) {}

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub fn platform_play_preview_note(_channel: u8, _row: i16, _length_ticks: i32) {}
