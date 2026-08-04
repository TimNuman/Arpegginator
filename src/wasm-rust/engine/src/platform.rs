// platform.rs — Platform callback abstraction
//
// One implementation module per target; exactly one is compiled in and
// re-exported as the crate-visible `platform_*` API:
//   WASM:         calls JS imports via extern "C"
//   Teensy (ARM): enqueues MIDI events into a ring buffer for main loop to drain
//   Test/native:  no-ops

#[allow(unused_imports)]
use crate::engine_core::NUM_CHANNELS;

// ============ WASM Platform ============

#[cfg(all(target_arch = "wasm32", not(test)))]
mod wasm {
    use super::NUM_CHANNELS;

    extern "C" {
        fn js_note_on(ch: i32, note: i32, vel: i32);
        fn js_note_off(ch: i32, note: i32);
        fn js_set_current_tick(tick: i32);
        fn js_set_current_patterns(ptr: i32);
        fn js_clear_queued_pattern(ch: i32);
        fn js_preview_value(sm: i32, ch: i32, ev_idx: i32, tick: i32, val: i32);
        fn js_play_preview_note(ch: i32, row: i32, length_ticks: i32);
        fn js_sound_param(ch: i32, param: i32, value: i32);
    }

    pub fn platform_note_on(channel: u8, midi_note: u8, velocity: u8) {
        unsafe { js_note_on(channel as i32, midi_note as i32, velocity as i32); }
    }

    pub fn platform_note_off(channel: u8, midi_note: u8) {
        unsafe { js_note_off(channel as i32, midi_note as i32); }
    }

    pub fn platform_set_current_tick(tick: i32) {
        unsafe { js_set_current_tick(tick); }
    }

    pub fn platform_set_current_patterns(patterns: &[u8; NUM_CHANNELS]) {
        unsafe { js_set_current_patterns(patterns.as_ptr() as i32); }
    }

    pub fn platform_clear_queued_pattern(channel: u8) {
        unsafe { js_clear_queued_pattern(channel as i32); }
    }

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

    pub fn platform_play_preview_note(channel: u8, row: i16, length_ticks: i32) {
        unsafe { js_play_preview_note(channel as i32, row as i32, length_ticks); }
    }

    pub fn platform_sound_param(channel: u8, param: u8, value: i16) {
        unsafe { js_sound_param(channel as i32, param as i32, value as i32); }
    }
}

#[cfg(all(target_arch = "wasm32", not(test)))]
pub use wasm::*;

// ============ Teensy / ARM Platform ============

#[cfg(all(target_arch = "arm", not(test)))]
pub mod arm_platform {
    use core::sync::atomic::{AtomicUsize, Ordering};
    use crate::cell::Global;

    const MIDI_QUEUE_SIZE: usize = 128;

    #[derive(Clone, Copy)]
    #[repr(C)]
    pub struct MidiEvent {
        pub kind: u8,       // one of the KIND_* constants
        pub channel: u8,
        pub note: i16,      // MIDI note (on/off) or scale row (preview, can be negative)
        pub velocity: u8,
        pub length_ticks: i32, // only used for KIND_PREVIEW
    }

    impl MidiEvent {
        pub const KIND_NOTE_ON: u8 = 0;
        pub const KIND_NOTE_OFF: u8 = 1;
        pub const KIND_PREVIEW: u8 = 2;
        /// Sound param change: `note` = param id, `length_ticks` = value.
        pub const KIND_SOUND_PARAM: u8 = 3;

        const fn zero() -> Self {
            MidiEvent { kind: 0, channel: 0, note: 0, velocity: 0, length_ticks: 0 }
        }
    }

    static MIDI_QUEUE: Global<[MidiEvent; MIDI_QUEUE_SIZE]> =
        Global::new([MidiEvent::zero(); MIDI_QUEUE_SIZE]);
    static MIDI_WRITE: AtomicUsize = AtomicUsize::new(0);
    static MIDI_READ: AtomicUsize = AtomicUsize::new(0);

    pub fn enqueue_midi(ev: MidiEvent) {
        let w = MIDI_WRITE.load(Ordering::Relaxed);
        let next = (w + 1) % MIDI_QUEUE_SIZE;
        if next != MIDI_READ.load(Ordering::Acquire) {
            MIDI_QUEUE.get_mut()[w] = ev;
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
        let ev = MIDI_QUEUE.get()[r];
        MIDI_READ.store((r + 1) % MIDI_QUEUE_SIZE, Ordering::Release);
        Some(ev)
    }
}

#[cfg(all(target_arch = "arm", not(test)))]
mod arm {
    use super::NUM_CHANNELS;
    use super::arm_platform::{enqueue_midi, MidiEvent};

    pub fn platform_note_on(channel: u8, midi_note: u8, velocity: u8) {
        enqueue_midi(MidiEvent {
            kind: MidiEvent::KIND_NOTE_ON, channel, note: midi_note as i16, velocity, length_ticks: 0,
        });
    }

    pub fn platform_note_off(channel: u8, midi_note: u8) {
        enqueue_midi(MidiEvent {
            kind: MidiEvent::KIND_NOTE_OFF, channel, note: midi_note as i16, velocity: 0, length_ticks: 0,
        });
    }

    pub fn platform_set_current_tick(_tick: i32) {}

    pub fn platform_set_current_patterns(_patterns: &[u8; NUM_CHANNELS]) {}

    pub fn platform_clear_queued_pattern(_channel: u8) {}

    pub fn platform_preview_value(
        _sub_mode: u8, _channel: u8,
        _event_index: u16, _tick: i32, _value: i16,
    ) {}

    pub fn platform_play_preview_note(channel: u8, row: i16, length_ticks: i32) {
        enqueue_midi(MidiEvent {
            kind: MidiEvent::KIND_PREVIEW, channel, note: row, velocity: 100, length_ticks,
        });
    }

    pub fn platform_sound_param(channel: u8, param: u8, value: i16) {
        enqueue_midi(MidiEvent {
            kind: MidiEvent::KIND_SOUND_PARAM, channel, note: param as i16, velocity: 0,
            length_ticks: value as i32,
        });
    }
}

#[cfg(all(target_arch = "arm", not(test)))]
pub use arm::*;

// ============ Test / Native Platform (no-ops) ============

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
mod noop {
    use super::NUM_CHANNELS;

    pub fn platform_note_on(_channel: u8, _midi_note: u8, _velocity: u8) {}

    pub fn platform_note_off(_channel: u8, _midi_note: u8) {}

    pub fn platform_set_current_tick(_tick: i32) {}

    pub fn platform_set_current_patterns(_patterns: &[u8; NUM_CHANNELS]) {}

    pub fn platform_clear_queued_pattern(_channel: u8) {}

    pub fn platform_preview_value(
        _sub_mode: u8, _channel: u8,
        _event_index: u16, _tick: i32, _value: i16,
    ) {}

    pub fn platform_play_preview_note(_channel: u8, _row: i16, _length_ticks: i32) {}

    pub fn platform_sound_param(_channel: u8, _param: u8, _value: i16) {}
}

#[cfg(any(test, not(any(target_arch = "wasm32", target_arch = "arm"))))]
pub use noop::*;
