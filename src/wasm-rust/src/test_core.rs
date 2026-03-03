// test_core.rs — Tests for engine_core functions
// Mirrors src/wasm/tests/test_core.c

use crate::engine_core::*;

fn init_state() -> Box<EngineState> {
    let mut s = Box::new(EngineState::default());
    engine_core_init(&mut s);
    s
}

// ============ engine_core_init ============

#[test]
fn init_defaults() {
    let s = init_state();
    assert_eq!(s.ui_mode, UiMode::Pattern as u8);
    assert_eq!(s.modify_sub_mode, SubModeId::Velocity as u8);
    assert_eq!(s.current_channel, 0);
    assert_eq!(s.zoom, 120); // ZOOM_1_16
    assert_eq!(s.selected_event_idx, -1);
    assert_eq!(s.current_tick, -1);
    assert_eq!(s.is_playing, 0);
    assert_eq!(s.scale_root, 0);
    assert_eq!(s.scale_id_idx, 0);
}

#[test]
fn init_pattern_lengths() {
    let s = init_state();
    for ch in 0..NUM_CHANNELS {
        for pat in 0..NUM_PATTERNS {
            assert_eq!(s.patterns[ch][pat].length_ticks, TICKS_PER_QUARTER * 4 * 4);
            assert_eq!(s.loops[ch][pat].start, 0);
            assert_eq!(s.loops[ch][pat].length, TICKS_PER_QUARTER * 4);
        }
    }
}

#[test]
fn init_queued_patterns_negative() {
    let s = init_state();
    for ch in 0..NUM_CHANNELS {
        assert_eq!(s.queued_patterns[ch], -1);
    }
}

// ============ note_to_midi ============

#[test]
fn note_to_midi_c4() {
    let s = init_state();
    assert_eq!(note_to_midi(0, &s), 60);
}

#[test]
fn note_to_midi_above() {
    let s = init_state();
    assert_eq!(note_to_midi(1, &s), 62);
    assert_eq!(note_to_midi(2, &s), 64);
}

#[test]
fn note_to_midi_below() {
    let s = init_state();
    assert_eq!(note_to_midi(-1, &s), 59);
}

#[test]
fn note_to_midi_out_of_range() {
    let s = init_state();
    assert_eq!(note_to_midi(1000, &s), -1);
    assert_eq!(note_to_midi(-1000, &s), -1);
}

// ============ engine_rebuild_scale ============

#[test]
fn rebuild_scale_c_major() {
    let s = init_state();
    assert_eq!(s.scale_octave_size, 7);
    assert_eq!(s.scale_notes[s.scale_zero_index as usize], 60);
    assert!(s.scale_count > 50);
    assert!(s.scale_count < 128);
}

#[test]
fn rebuild_scale_chromatic() {
    let mut s = init_state();
    s.scale_id_idx = 14;
    s.scale_root = 0;
    engine_rebuild_scale(&mut s);
    assert_eq!(s.scale_octave_size, 12);
    assert_eq!(s.scale_count, 128);
    assert_eq!(note_to_midi(0, &s), 60);
    assert_eq!(note_to_midi(1, &s), 61);
}

#[test]
fn rebuild_scale_d_major() {
    let mut s = init_state();
    s.scale_root = 2;
    s.scale_id_idx = 0;
    engine_rebuild_scale(&mut s);
    assert_eq!(note_to_midi(0, &s), 62);
    assert_eq!(s.scale_octave_size, 7);
}

// ============ engine_cycle_scale ============

#[test]
fn cycle_scale_forward() {
    let mut s = init_state();
    assert_eq!(s.scale_id_idx, 0);
    engine_cycle_scale(&mut s, 1);
    assert_eq!(s.scale_id_idx, 1);
}

#[test]
fn cycle_scale_wrap_forward() {
    let mut s = init_state();
    s.scale_id_idx = NUM_SCALES as u8 - 1;
    engine_cycle_scale(&mut s, 1);
    assert_eq!(s.scale_id_idx, 0);
}

#[test]
fn cycle_scale_wrap_backward() {
    let mut s = init_state();
    engine_cycle_scale(&mut s, -1);
    assert_eq!(s.scale_id_idx, NUM_SCALES as u8 - 1);
}

// ============ engine_cycle_scale_root ============

#[test]
fn cycle_root_forward() {
    let mut s = init_state();
    assert_eq!(s.scale_root, 0);
    engine_cycle_scale_root(&mut s, 1);
    assert_eq!(s.scale_root, 7); // C → G (circle of fifths)
}

// ============ get_arp_chord_index ============

#[test]
fn arp_chord_returns_sentinel() {
    assert_eq!(get_arp_chord_index(ARP_CHORD, 3, 0, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD, 3, 5, 0), 255);
}

#[test]
fn arp_single_note_returns_sentinel() {
    assert_eq!(get_arp_chord_index(ARP_UP, 1, 0, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_DOWN, 1, 0, 0), 255);
}

#[test]
fn arp_up_cycles() {
    assert_eq!(get_arp_chord_index(ARP_UP, 3, 0, 0), 0);
    assert_eq!(get_arp_chord_index(ARP_UP, 3, 1, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_UP, 3, 2, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_UP, 3, 3, 0), 0);
}

#[test]
fn arp_down_cycles() {
    assert_eq!(get_arp_chord_index(ARP_DOWN, 3, 0, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_DOWN, 3, 1, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_DOWN, 3, 2, 0), 0);
    assert_eq!(get_arp_chord_index(ARP_DOWN, 3, 3, 0), 2);
}

#[test]
fn arp_up_down_bounces() {
    assert_eq!(get_arp_chord_index(ARP_UP_DOWN, 3, 0, 0), 0);
    assert_eq!(get_arp_chord_index(ARP_UP_DOWN, 3, 1, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_UP_DOWN, 3, 2, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_UP_DOWN, 3, 3, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_UP_DOWN, 3, 4, 0), 0);
}

#[test]
fn arp_down_up_bounces() {
    assert_eq!(get_arp_chord_index(ARP_DOWN_UP, 3, 0, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_DOWN_UP, 3, 1, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_DOWN_UP, 3, 2, 0), 0);
    assert_eq!(get_arp_chord_index(ARP_DOWN_UP, 3, 3, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_DOWN_UP, 3, 4, 0), 2);
}

#[test]
fn arp_offset_shifts() {
    assert_eq!(get_arp_chord_index(ARP_UP, 3, 0, 1), 2);
    assert_eq!(get_arp_chord_index(ARP_UP, 3, 1, 1), 0);
    assert_eq!(get_arp_chord_index(ARP_UP, 3, 2, 1), 1);
}

// ============ is_arp_chord_active ============

#[test]
fn arp_active_chord_always_true() {
    assert!(is_arp_chord_active(ARP_CHORD, 3, 0, 0, 1, 0));
    assert!(is_arp_chord_active(ARP_CHORD, 3, 0, 0, 1, 2));
}

#[test]
fn arp_active_single_voice() {
    assert!(is_arp_chord_active(ARP_UP, 3, 0, 0, 1, 0));
    assert!(!is_arp_chord_active(ARP_UP, 3, 0, 0, 1, 1));
    assert!(!is_arp_chord_active(ARP_UP, 3, 0, 0, 1, 2));
}

#[test]
fn arp_active_multi_voice_window() {
    assert!(is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 0));
    assert!(is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 1));
    assert!(!is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 2));
    assert!(!is_arp_chord_active(ARP_UP, 4, 0, 0, 2, 3));
}

#[test]
fn arp_active_all_voices() {
    assert!(is_arp_chord_active(ARP_UP, 3, 0, 0, 3, 0));
    assert!(is_arp_chord_active(ARP_UP, 3, 0, 0, 3, 1));
    assert!(is_arp_chord_active(ARP_UP, 3, 0, 0, 3, 2));
}

// ============ Chord+Arp styles ============

#[test]
fn arp_chord_up_repeating_cycle() {
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP, 4, 0, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP, 4, 1, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP, 4, 2, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP, 4, 3, 0), 3);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP, 4, 4, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP, 4, 5, 0), 1);
}

#[test]
fn arp_chord_down_repeating_cycle() {
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN, 4, 0, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN, 4, 1, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN, 4, 2, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN, 4, 3, 0), 0);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN, 4, 4, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN, 4, 5, 0), 2);
}

#[test]
fn arp_chord_up_down_repeating_cycle() {
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 0, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 1, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 2, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 3, 0), 3);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 4, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 5, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 6, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 7, 0), 1);
}

#[test]
fn arp_chord_down_up_repeating_cycle() {
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 0, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 1, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 2, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 3, 0), 0);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 4, 0), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 5, 0), 2);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 6, 0), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_DOWN_UP, 4, 7, 0), 2);
}

#[test]
fn arp_chord_up_down_with_offset() {
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 0, -2), 255);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 1, -2), 3);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 2, -2), 2);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 3, -2), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 4, -2), 0);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 5, -2), 1);
    assert_eq!(get_arp_chord_index(ARP_CHORD_UP_DOWN, 4, 6, -2), 255);
}

#[test]
fn arp_chord_active_on_chord_beat() {
    assert!(is_arp_chord_active(ARP_CHORD_UP, 4, 0, 0, 1, 0));
    assert!(is_arp_chord_active(ARP_CHORD_UP, 4, 0, 0, 1, 1));
    assert!(is_arp_chord_active(ARP_CHORD_UP, 4, 0, 0, 1, 3));
    assert!(is_arp_chord_active(ARP_CHORD_UP, 4, 4, 0, 1, 0));
    assert!(is_arp_chord_active(ARP_CHORD_UP, 4, 4, 0, 1, 3));
}

#[test]
fn arp_chord_active_on_single_beat() {
    assert!(!is_arp_chord_active(ARP_CHORD_UP, 4, 1, 0, 1, 0));
    assert!(is_arp_chord_active(ARP_CHORD_UP, 4, 1, 0, 1, 1));
    assert!(!is_arp_chord_active(ARP_CHORD_UP, 4, 1, 0, 1, 2));
    assert!(!is_arp_chord_active(ARP_CHORD_UP, 4, 1, 0, 1, 3));
}

// ============ Voicings ============

#[test]
fn voicing_count_valid() {
    assert!(get_voicing_count(3, 2) > 0);
}

#[test]
fn voicing_offsets_basic() {
    let mut offsets = [0i8; MAX_CHORD_SIZE];
    let count = get_voicing_offsets(3, 2, 0, &mut offsets);
    assert!(count > 0);
    assert_eq!(offsets[0], 0);
}

#[test]
fn voicing_name_not_null() {
    let name = get_voicing_name(3, 2, 0);
    assert!(!name.is_empty());
}

// ============ Misc ============

#[test]
fn scale_name_c_major() {
    let s = init_state();
    assert_eq!(engine_get_scale_name_str(&s), "Major");
}

#[test]
fn alloc_event_id_increments() {
    let mut s = init_state();
    let id1 = engine_alloc_event_id(&mut s);
    let id2 = engine_alloc_event_id(&mut s);
    assert_eq!(id2, id1 + 1);
}
