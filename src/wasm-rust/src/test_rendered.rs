// test_rendered.rs — Tests for rendered notes cache and dirty flag system
// Mirrors src/wasm/tests/test_rendered.c

use crate::engine_core::*;
use crate::engine_edit::*;
use crate::engine_ui::*;
use crate::engine_input::engine_find_event_at;

fn init_state() -> Box<EngineState> {
    let mut s = EngineState::new_boxed();
    engine_core_init(&mut s);
    s
}

fn ch(s: &EngineState) -> usize { s.current_channel as usize }
fn pat_idx(s: &EngineState) -> usize { s.current_patterns[ch(s)] as usize }

fn add_event_and_render(s: &mut EngineState, row: i16, tick: i32, length: i32) -> i16 {
    let idx = engine_toggle_event(s, row, tick, length);
    let c = s.current_channel;
    engine_ensure_rendered(s, c);
    idx
}

// ============ Basic cache tests ============

#[test]
fn ensure_rendered_builds_cache() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);

    assert_eq!(s.rendered_dirty[ch(&s)], 1);
    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_dirty[ch(&s)], 0);
    assert_eq!(s.rendered_count, 2);
}

#[test]
fn ensure_rendered_no_rebuild_if_clean() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_count, 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_count, 1);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);
}

// ============ Dirty flag: disable note ============

#[test]
fn disable_note_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert!(idx >= 0);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);
    assert_eq!(s.rendered_count, 1);

    let (c, p) = (ch(&s), pat_idx(&s));
    let h = s.patterns[c][p].event_handles[idx as usize];
    s.event_pool.slots[h as usize].enabled = 0;
    engine_mark_dirty(&mut s, c as u8);
    assert_eq!(s.rendered_dirty[ch(&s)], 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_count, 0);
}

#[test]
fn reenable_note_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert!(idx >= 0);

    let (c, p) = (ch(&s), pat_idx(&s));
    let h = s.patterns[c][p].event_handles[idx as usize];
    s.event_pool.slots[h as usize].enabled = 0;
    engine_mark_dirty(&mut s, c as u8);
    engine_ensure_rendered(&mut s, c as u8);
    assert_eq!(s.rendered_count, 0);

    s.event_pool.slots[h as usize].enabled = 1;
    engine_mark_dirty(&mut s, c as u8);
    assert_eq!(s.rendered_dirty[c], 1);

    engine_ensure_rendered(&mut s, c as u8);
    assert_eq!(s.rendered_count, 1);
}

// ============ Dirty flag: cmd-click disable via button_press ============

#[test]
fn cmd_click_disable_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert!(idx >= 0);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    let found = engine_find_event_at(&s, 10, 0);
    assert_eq!(found, idx);

    let (c, p) = (ch(&s), pat_idx(&s));
    let h = s.patterns[c][p].event_handles[found as usize];
    s.event_pool.slots[h as usize].enabled = 0;
    engine_mark_dirty(&mut s, c as u8);
    assert_eq!(s.rendered_dirty[c], 1);

    engine_ensure_rendered(&mut s, c as u8);
    assert_eq!(s.rendered_count, 0);
}

// ============ Dirty flag: edit operations ============

#[test]
fn toggle_event_marks_dirty() {
    let mut s = init_state();
    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_toggle_event(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_toggle_event(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 1);
}

#[test]
fn move_event_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_move_event(&mut s, idx as u16, 12, 240);
    assert_eq!(s.rendered_dirty[ch(&s)], 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_notes[0].row, 12);
    assert_eq!(s.rendered_notes[0].position, 240);
}

#[test]
fn set_length_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_set_event_length(&mut s, idx as u16, 480);
    assert_eq!(s.rendered_dirty[ch(&s)], 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_notes[0].length, 480);
}

#[test]
fn repeat_amount_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_set_event_repeat_amount(&mut s, idx as u16, 4);
    assert_eq!(s.rendered_dirty[ch(&s)], 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_count, 4);
}

#[test]
fn chord_stack_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_adjust_chord_stack(&mut s, idx as u16, 1); // 1 → 2
    assert_eq!(s.rendered_dirty[ch(&s)], 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_count, 2);
}

#[test]
fn arp_style_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    engine_adjust_chord_stack(&mut s, idx as u16, 1);
    engine_set_event_repeat_amount(&mut s, idx as u16, 4);
    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_cycle_arp_style(&mut s, idx as u16, 1); // CHORD → UP
    assert_eq!(s.rendered_dirty[ch(&s)], 1);
}

// ============ Dirty flag: resize via direct mutation ============

#[test]
fn direct_length_change_needs_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);
    assert_eq!(s.rendered_notes[0].length, 120);

    let (c, p) = (ch(&s), pat_idx(&s));
    let h = s.patterns[c][p].event_handles[idx as usize];
    s.event_pool.slots[h as usize].length = 480;
    engine_mark_dirty(&mut s, c as u8);
    assert_eq!(s.rendered_dirty[c], 1);

    engine_ensure_rendered(&mut s, c as u8);
    assert_eq!(s.rendered_notes[0].length, 480);
}

// ============ Dirty flag: channel/pattern switch ============

#[test]
fn pattern_switch_marks_dirty() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_count, 1);

    let c = ch(&s);
    s.current_patterns[c] = 1;
    engine_mark_dirty(&mut s, c as u8);
    assert_eq!(s.rendered_dirty[c], 1);

    engine_ensure_rendered(&mut s, c as u8);
    assert_eq!(s.rendered_count, 0);

    s.current_patterns[c] = 0;
    engine_mark_dirty(&mut s, c as u8);
    engine_ensure_rendered(&mut s, c as u8);
    assert_eq!(s.rendered_count, 1);
}

// ============ Dirty flag: play/stop resets ============

#[test]
fn play_init_marks_all_dirty() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_ensure_rendered(&mut s, 0);
    assert_eq!(s.rendered_dirty[0], 0);

    engine_core_play_init(&mut s);

    for i in 0..NUM_CHANNELS {
        assert_eq!(s.rendered_dirty[i], 1);
    }
}

#[test]
fn stop_marks_all_dirty() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_ensure_rendered(&mut s, 0);
    assert_eq!(s.rendered_dirty[0], 0);

    engine_core_stop(&mut s);

    for i in 0..NUM_CHANNELS {
        assert_eq!(s.rendered_dirty[i], 1);
    }
}

// ============ Dirty flag: scale change ============

#[test]
fn scale_change_marks_all_dirty() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_ensure_rendered(&mut s, 0);
    assert_eq!(s.rendered_dirty[0], 0);

    engine_cycle_scale(&mut s, 1);

    for i in 0..NUM_CHANNELS {
        assert_eq!(s.rendered_dirty[i], 1);
    }
}

// ============ Rendered notes: chord expansion ============

#[test]
fn rendered_chord_has_chord_index() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_adjust_chord_stack(&mut s, idx as u16, 1); // → 2
    engine_adjust_chord_stack(&mut s, idx as u16, 1); // → 3
    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }

    assert_eq!(s.rendered_count, 3);

    let mut seen = [false; 3];
    for i in 0..s.rendered_count as usize {
        let ci = s.rendered_notes[i].chord_index as usize;
        assert!(ci < 3);
        seen[ci] = true;
    }
    assert!(seen[0]);
    assert!(seen[1]);
    assert!(seen[2]);
}

#[test]
fn rendered_repeat_expansion() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    engine_set_event_repeat_amount(&mut s, idx as u16, 3);
    engine_set_event_repeat_space(&mut s, idx as u16, 120);
    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }

    assert_eq!(s.rendered_count, 3);

    for ri in 0u16..3 {
        let found = (0..s.rendered_count as usize)
            .any(|j| {
                s.rendered_notes[j].repeat_index == ri &&
                s.rendered_notes[j].position == ri as i32 * 120
            });
        assert!(found, "missing rendered note for repeat_index {}", ri);
    }
}

// ============ Rendered notes: disabled events excluded ============

#[test]
fn rendered_excludes_disabled_events() {
    let mut s = init_state();
    let idx0 = engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    let c = ch(&s);
    assert_eq!(s.rendered_count, 2);

    let p = pat_idx(&s);
    let h = s.patterns[c][p].event_handles[idx0 as usize];
    s.event_pool.slots[h as usize].enabled = 0;
    engine_mark_dirty(&mut s, c as u8);
    engine_ensure_rendered(&mut s, c as u8);

    assert_eq!(s.rendered_count, 1);
    assert_eq!(s.rendered_notes[0].row, 12);
}

// ============ Dirty flag: sub-mode modulation ============

#[test]
fn modulation_change_marks_dirty() {
    let mut s = init_state();
    let idx = add_event_and_render(&mut s, 10, 0, 120);
    assert_eq!(s.rendered_dirty[ch(&s)], 0);

    engine_set_sub_mode_value(&mut s, idx as u16, SubModeId::Modulate as u8, 0, 3);
    assert_eq!(s.rendered_dirty[ch(&s)], 1);

    { let cc = s.current_channel; engine_ensure_rendered(&mut s, cc); }
    assert_eq!(s.rendered_notes[0].row, 13); // 10 + 3
}
