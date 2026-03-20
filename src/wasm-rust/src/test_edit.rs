// test_edit.rs — Tests for engine_edit functions
// Mirrors src/wasm/tests/test_edit.c

use crate::engine_core::*;
use crate::engine_edit::*;

fn init_state() -> Box<EngineState> {
    let mut s = EngineState::new_boxed();
    engine_core_init(&mut s);
    s
}

fn ch(s: &EngineState) -> usize { s.current_channel as usize }
fn pat(s: &EngineState) -> usize { s.current_patterns[ch(s)] as usize }

fn ev<'a>(s: &'a EngineState, idx: usize) -> &'a NoteEvent {
    let (c, p) = (ch(s), pat(s));
    let h = s.patterns[c][p].event_handles[idx];
    &s.event_pool.slots[h as usize]
}

fn ev_ch_pat<'a>(s: &'a EngineState, c: usize, p: usize, idx: usize) -> &'a NoteEvent {
    let h = s.patterns[c][p].event_handles[idx];
    &s.event_pool.slots[h as usize]
}

// ============ engine_toggle_event ============

#[test]
fn toggle_add_event() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    assert!(idx >= 0);
    let (c, p) = (ch(&s), pat(&s));
    assert_eq!(s.patterns[c][p].event_count, 1);
    assert_eq!(ev(&s, idx as usize).row, 10);
    assert_eq!(ev(&s, idx as usize).position, 0);
    assert_eq!(ev(&s, idx as usize).length, 120);
    assert_eq!(ev(&s, idx as usize).enabled, 1);
}

#[test]
fn toggle_remove_event() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    assert_eq!(idx, -1);
    let (c, p) = (ch(&s), pat(&s));
    assert_eq!(s.patterns[c][p].event_count, 0);
}

#[test]
fn toggle_multiple_events() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);
    engine_toggle_event(&mut s, 14, 240, 120);
    let (c, p) = (ch(&s), pat(&s));
    assert_eq!(s.patterns[c][p].event_count, 3);
}

#[test]
fn toggle_fill_128_events() {
    let mut s = init_state();
    // Fill 8 rows × 16 columns = 128 events, each at a unique (row, tick)
    for row in 0..8i16 {
        for col in 0..16i32 {
            let idx = engine_toggle_event(&mut s, row, col * 120, 120);
            assert!(idx >= 0, "failed to add event at row={}, col={}", row, col);
        }
    }
    let (c, p) = (ch(&s), pat(&s));
    assert_eq!(s.patterns[c][p].event_count, 128);
    assert!(s.event_pool.free_count > 0, "pool should have free slots remaining");
}

#[test]
fn toggle_event_default_values() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 5, 0, 120);
    let e = ev(&s, idx as usize);
    assert_eq!(e.repeat_amount, 1);
    assert_eq!(e.chord_amount, 1);
    assert_eq!(e.chord_space, 2);
    assert_eq!(e.arp_style, ARP_CHORD);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Velocity as usize).values[0], 100);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Velocity as usize).length, 1);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Hit as usize).values[0], 100);
}

// ============ engine_remove_event ============

#[test]
fn remove_event_fixes_selection() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);
    s.selected_event_idx = 1;
    engine_remove_event(&mut s, 0);
    assert_eq!(s.selected_event_idx, 0);
}

#[test]
fn remove_event_clears_selection() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    s.selected_event_idx = 0;
    engine_remove_event(&mut s, 0);
    assert_eq!(s.selected_event_idx, -1);
}

// ============ engine_move_event ============

#[test]
fn move_event_basic() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_move_event(&mut s, idx as u16, 20, 240);
    assert_eq!(ev(&s, idx as usize).row, 20);
    assert_eq!(ev(&s, idx as usize).position, 240);
}

#[test]
fn move_event_out_of_range_ignored() {
    let mut s = init_state();
    engine_move_event(&mut s, 99, 20, 240); // should not crash
}

// ============ engine_set_event_length ============

#[test]
fn set_length_basic() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_event_length(&mut s, idx as u16, 240);
    assert_eq!(ev(&s, idx as usize).length, 240);
}

#[test]
fn set_length_min_clamp() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_event_length(&mut s, idx as u16, 0);
    assert_eq!(ev(&s, idx as usize).length, 1);
}

// ============ Sub-mode operations ============

#[test]
fn sub_mode_value_basic() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_sub_mode_value(&mut s, idx as u16, SubModeId::Velocity as u8, 0, 80);
    let e = ev(&s, idx as usize);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Velocity as usize).values[0], 80);
}

#[test]
fn sub_mode_value_materializes_array() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_sub_mode_value(&mut s, idx as u16, SubModeId::Velocity as u8, 2, 50);
    let e = ev(&s, idx as usize);
    let arr = get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Velocity as usize);
    assert_eq!(arr.length, 3);
    assert_eq!(arr.values[2], 50);
    assert_eq!(arr.values[1], 100); // looped from index 0
}

#[test]
fn sub_mode_length_expand() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_sub_mode_length(&mut s, idx as u16, SubModeId::Velocity as u8, 4);
    let e = ev(&s, idx as usize);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Velocity as usize).length, 4);
}

#[test]
fn sub_mode_length_shrink() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_sub_mode_length(&mut s, idx as u16, SubModeId::Velocity as u8, 4);
    engine_set_sub_mode_length(&mut s, idx as u16, SubModeId::Velocity as u8, 2);
    let e = ev(&s, idx as usize);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Velocity as usize).length, 2);
}

#[test]
fn sub_mode_length_clamp_min() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_sub_mode_length(&mut s, idx as u16, SubModeId::Velocity as u8, 0);
    let e = ev(&s, idx as usize);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &e.sub_mode_handles, SubModeId::Velocity as usize).length, 1);
}

#[test]
fn toggle_loop_mode_cycles() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);

    assert_eq!(get_sub_mode(&s.sub_mode_pool, &ev(&s, idx as usize).sub_mode_handles, SubModeId::Velocity as usize).loop_mode, LoopMode::Continue as u8);
    engine_cycle_sub_mode_loop_mode(&mut s, idx as u16, SubModeId::Velocity as u8, true);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &ev(&s, idx as usize).sub_mode_handles, SubModeId::Velocity as usize).loop_mode, LoopMode::Reset as u8);
    engine_cycle_sub_mode_loop_mode(&mut s, idx as u16, SubModeId::Velocity as u8, true);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &ev(&s, idx as usize).sub_mode_handles, SubModeId::Velocity as usize).loop_mode, LoopMode::Fill as u8);
    engine_cycle_sub_mode_loop_mode(&mut s, idx as u16, SubModeId::Velocity as u8, true);
    assert_eq!(get_sub_mode(&s.sub_mode_pool, &ev(&s, idx as usize).sub_mode_handles, SubModeId::Velocity as usize).loop_mode, LoopMode::Continue as u8);
}

// ============ Chord operations ============

#[test]
fn chord_stack_increase() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);

    assert_eq!(ev(&s, idx as usize).chord_amount, 1);
    engine_adjust_chord_stack(&mut s, idx as u16, 1);
    assert_eq!(ev(&s, idx as usize).chord_amount, 2);
    engine_adjust_chord_stack(&mut s, idx as u16, 1);
    assert_eq!(ev(&s, idx as usize).chord_amount, 3);
}

#[test]
fn chord_stack_decrease_clamp() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);

    engine_adjust_chord_stack(&mut s, idx as u16, -1);
    assert_eq!(ev(&s, idx as usize).chord_amount, 1);
}

#[test]
fn chord_stack_max_clamp() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);

    for _ in 0..20 {
        engine_adjust_chord_stack(&mut s, idx as u16, 1);
    }
    assert!(ev(&s, idx as usize).chord_amount as usize <= MAX_CHORD_SIZE);
}

// ============ Pattern operations ============

#[test]
fn copy_pattern() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);
    engine_copy_pattern(&mut s, 1);
    let c = ch(&s);
    assert_eq!(s.patterns[c][1].event_count, 2);
    assert_eq!(ev_ch_pat(&s, c, 1, 0).row, 10);
    assert_eq!(ev_ch_pat(&s, c, 1, 1).row, 12);
}

#[test]
fn clear_pattern() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);
    let (c, p) = (ch(&s), pat(&s));
    assert_eq!(s.patterns[c][p].event_count, 2);
    engine_clear_pattern(&mut s);
    assert_eq!(s.patterns[c][p].event_count, 0);
}
