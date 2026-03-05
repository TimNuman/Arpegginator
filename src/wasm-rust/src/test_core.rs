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

// ============ Global Automation ============

/// Helper: set up a note at row=0 on channel 0, pattern 0, at tick 0
fn add_note_at_row(s: &mut EngineState, row: i16) -> usize {
    let ch = 0;
    let pat = 0;
    let idx = s.patterns[ch][pat].event_count as usize;
    let h = idx as u16; // Simple handle assignment for test
    s.event_pool.slots[h as usize] = NoteEvent {
        row,
        position: 0,
        length: 120,
        enabled: 1,
        repeat_amount: 1,
        repeat_space: 120,
        ..NoteEvent::default()
    };
    s.patterns[ch][pat].event_handles[idx] = h;
    s.patterns[ch][pat].event_count += 1;
    idx
}

#[test]
fn global_automation_single_key_change_preserves_pitch() {
    let mut s = init_state();
    // Place a note at row=0 (C4 in C Major)
    add_note_at_row(&mut s, 0);
    let original_midi = note_to_midi(s.event_pool.slots[0].row, &s);
    assert_eq!(original_midi, 60); // C4

    // Set up global step 0 = C Major, step 4 = G Major
    s.global_steps[0] = GlobalStep { scale_root: 0, scale_id_idx: 0, active: 1 };
    s.global_steps[4] = GlobalStep { scale_root: 7, scale_id_idx: 0, active: 1 };
    s.global_step_count = 16;

    // Start playback
    s.is_playing = 1;
    engine_core_play_init(&mut s);

    // Advance to step 4 (tick 480 = 4 * 120)
    for _ in 0..480 {
        engine_core_tick(&mut s);
    }

    // After key change to G Major, note should still resolve to same MIDI pitch
    let midi_after = note_to_midi(s.event_pool.slots[0].row, &s);
    assert_eq!(midi_after, original_midi, "Pitch should be preserved after key change to G");
}

#[test]
fn global_automation_circle_of_fifths_round_trip() {
    let mut s = init_state();
    // Place a note at row=0 (C4 in C Major)
    add_note_at_row(&mut s, 0);

    let original_midi = note_to_midi(s.event_pool.slots[0].row, &s);
    assert_eq!(original_midi, 60); // C4

    // Set up 13 global steps with circle of fifths: C, G, D, A, E, B, F#, C#, G#, D#, A#, F, C
    let circle_of_fifths: [u8; 13] = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5, 0];
    for (i, &root) in circle_of_fifths.iter().enumerate() {
        s.global_steps[i] = GlobalStep { scale_root: root, scale_id_idx: 0, active: 1 };
    }
    s.global_step_count = 13;

    // Start playback
    s.is_playing = 1;
    engine_core_play_init(&mut s);

    // Advance past 1 full song loop so the song wraps back to step 0.
    // play_init sets current_tick=-1, so after N iterations current_tick=N-1.
    // We need next_tick = 13*120 = 1560 to hit song_tick=0 (the loop reset).
    // That happens on iteration 1561 (next_tick = current_tick+1 = 1560).
    for _ in 0..1561 {
        engine_core_tick(&mut s);
    }

    // The song looped back to step 0, triggering revert_playback_key_shift.
    // This restores rows and key to the home state exactly.
    let final_midi = note_to_midi(s.event_pool.slots[0].row, &s);
    assert_eq!(final_midi, original_midi, "MIDI pitch should be exact after CoF round trip (song-loop reset)");
}

#[test]
fn global_automation_preserves_pitch_at_every_step() {
    let mut s = init_state();
    // Place notes at multiple rows
    add_note_at_row(&mut s, 0);   // C4
    add_note_at_row(&mut s, 2);   // E4
    add_note_at_row(&mut s, 4);   // G4

    let midi_0 = note_to_midi(s.event_pool.slots[0].row, &s);
    let midi_1 = note_to_midi(s.event_pool.slots[1].row, &s);
    let midi_2 = note_to_midi(s.event_pool.slots[2].row, &s);
    assert_eq!(midi_0, 60); // C4
    assert_eq!(midi_1, 64); // E4
    assert_eq!(midi_2, 67); // G4

    // Circle of fifths progression: C -> G -> D -> A -> C
    // Each CoF step may introduce small drift (accepted, same as engine_cycle_scale_root)
    let roots: [u8; 5] = [0, 7, 2, 9, 0];
    for (i, &root) in roots.iter().enumerate() {
        s.global_steps[i] = GlobalStep { scale_root: root, scale_id_idx: 0, active: 1 };
    }
    s.global_step_count = 5;

    s.is_playing = 1;
    engine_core_play_init(&mut s);

    // Check that drift stays bounded through the progression
    for step in 0..5 {
        let target_tick = step * TICKS_PER_SIXTEENTH;
        while s.current_tick < target_tick {
            engine_core_tick(&mut s);
        }

        let m0 = note_to_midi(s.event_pool.slots[0].row, &s);
        let m1 = note_to_midi(s.event_pool.slots[1].row, &s);
        let m2 = note_to_midi(s.event_pool.slots[2].row, &s);
        let drift_0 = (m0 as i32 - midi_0 as i32).abs();
        let drift_1 = (m1 as i32 - midi_1 as i32).abs();
        let drift_2 = (m2 as i32 - midi_2 as i32).abs();
        assert!(drift_0 <= 2, "Note 0 drift {} > 2 at step {}", drift_0, step);
        assert!(drift_1 <= 2, "Note 1 drift {} > 2 at step {}", drift_1, step);
        assert!(drift_2 <= 2, "Note 2 drift {} > 2 at step {}", drift_2, step);
    }
}

#[test]
fn global_automation_many_back_and_forth() {
    let mut s = init_state();
    add_note_at_row(&mut s, 0);

    let original_midi = note_to_midi(s.event_pool.slots[0].row, &s);
    assert_eq!(original_midi, 60);

    // Alternate between C and G major many times
    for i in 0..32 {
        s.global_steps[i] = GlobalStep {
            scale_root: if i % 2 == 0 { 0 } else { 7 },
            scale_id_idx: 0,
            active: 1,
        };
    }
    s.global_step_count = 32;

    s.is_playing = 1;
    engine_core_play_init(&mut s);

    // Run through all 32 steps
    for _ in 0..(32 * TICKS_PER_SIXTEENTH) {
        engine_core_tick(&mut s);
    }

    // Should be back on C Major (step 0 wraps), pitch preserved
    let final_midi = note_to_midi(s.event_pool.slots[0].row, &s);
    assert_eq!(final_midi, original_midi, "Pitch should be stable after many C/G alternations");
}

#[test]
fn global_automation_song_loop_resets_drift() {
    let mut s = init_state();
    // Place a note at row=0 (C4 in C Major)
    add_note_at_row(&mut s, 0);

    let original_row = s.event_pool.slots[0].row;
    let original_midi = note_to_midi(original_row, &s);
    assert_eq!(original_midi, 60); // C4

    // User's scenario: 4 bars (64 sixteenths) with C, G, D, A major
    // Step 0 = C Major, step 16 = G Major, step 32 = D Major, step 48 = A Major
    s.global_steps[0] = GlobalStep { scale_root: 0, scale_id_idx: 0, active: 1 };
    s.global_steps[16] = GlobalStep { scale_root: 7, scale_id_idx: 0, active: 1 };
    s.global_steps[32] = GlobalStep { scale_root: 2, scale_id_idx: 0, active: 1 };
    s.global_steps[48] = GlobalStep { scale_root: 9, scale_id_idx: 0, active: 1 };
    s.global_step_count = 64;

    s.is_playing = 1;
    engine_core_play_init(&mut s);

    // Play past 3 full song loops so we hit step 0 of the 4th loop.
    // Song length = 64 * 120 = 7680 ticks. We need next_tick = 3 * 7680 = 23040
    // to trigger the loop reset. That's iteration 23041.
    for _ in 0..(3 * 64 * TICKS_PER_SIXTEENTH + 1) {
        engine_core_tick(&mut s);
    }

    // After 3 loops, step 0 reset fires, restoring home key and rows.
    assert_eq!(s.scale_root, 0, "Should be back in C Major");
    let final_row = s.event_pool.slots[0].row;
    let final_midi = note_to_midi(final_row, &s);
    assert_eq!(final_row, original_row, "Row should be unchanged after song loops");
    assert_eq!(final_midi, original_midi, "MIDI pitch should be unchanged after song loops");
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
