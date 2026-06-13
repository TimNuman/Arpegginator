// test_critical.rs — Regression tests for host-input crash/corruption fixes.
// Each test drives a path that previously panicked (panic = "abort" → full trap)
// or corrupted the event pool when fed out-of-range values reachable from the
// JS frontend or SysEx host.

use alloc::boxed::Box;
use crate::engine_core::*;
use crate::engine_edit::{engine_toggle_event, engine_copy_pattern, engine_set_event_repeat_amount};
use crate::engine_input::{engine_button_press, engine_key_action, ACTION_DISABLE_NOTE};
use crate::engine_ui::engine_compute_grid;

fn init_state() -> Box<EngineState> {
    let mut s = EngineState::new_boxed();
    engine_core_init(&mut s);
    s
}

// ============ #1 — 8 grid rows vs 6 channels in Channel mode ============

#[test]
fn channel_mode_render_does_not_overrun_channel_arrays() {
    let mut s = init_state();
    s.ui_mode = UiMode::Channel as u8;
    // Rows 6 and 7 have no backing channel; rendering must not index out of bounds.
    engine_compute_grid(&mut s, 0.0);
    // Rows beyond NUM_CHANNELS are dimmed rather than read from channel arrays.
    for vr in NUM_CHANNELS..VISIBLE_ROWS {
        assert_ne!(s.button_values[vr][0] & FLAG_DIMMED, 0);
    }
}

#[test]
fn channel_mode_press_beyond_channels_is_ignored() {
    let mut s = init_state();
    s.ui_mode = UiMode::Channel as u8;
    // Row 7 ≥ NUM_CHANNELS — must be a no-op, not an out-of-bounds write.
    engine_button_press(&mut s, 7, 0, 0);
    engine_button_press(&mut s, 6, 1, 0);
}

// ============ #2 — copy_pattern handle integrity ============

#[test]
fn copy_pattern_leaves_no_stale_handles() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);
    engine_toggle_event(&mut s, 14, 240, 120);

    let ch = s.current_channel as usize;
    let src = s.current_patterns[ch] as usize;
    let src_ec = s.patterns[ch][src].event_count;
    let tgt = if src == 0 { 1 } else { 0 };

    engine_copy_pattern(&mut s, tgt as u8);

    let tgt_ec = s.patterns[ch][tgt].event_count;
    assert_eq!(tgt_ec, src_ec);
    // Every counted handle is live, and every slot past the count is cleared —
    // no freed/stale handle remains referenced.
    for i in 0..MAX_EVENTS {
        let h = s.patterns[ch][tgt].event_handles[i];
        if i < tgt_ec as usize {
            assert_ne!(h, POOL_HANDLE_NONE);
        } else {
            assert_eq!(h, POOL_HANDLE_NONE);
        }
    }
}

// ============ #5 — division by zero on host-controlled values ============

#[test]
fn tick_survives_zero_length_loop() {
    let mut s = init_state();
    engine_core_play_init(&mut s);
    // A host writing the loops buffer could set length 0 → mod_positive(_, 0).
    for pat in 0..NUM_PATTERNS {
        s.loops[0][pat].length = 0;
    }
    for _ in 0..16 {
        engine_core_tick(&mut s);
    }
}

#[test]
fn scrub_survives_zero_length_loop() {
    let mut s = init_state();
    for ch in 0..NUM_CHANNELS {
        for pat in 0..NUM_PATTERNS {
            s.loops[ch][pat].length = 0;
        }
    }
    engine_core_scrub_to_tick(&mut s, 500);
    engine_core_scrub_to_tick(&mut s, 0);
}

#[test]
fn tick_survives_out_of_range_current_pattern() {
    let mut s = init_state();
    engine_core_play_init(&mut s);
    // current_patterns is a raw JS-writable buffer; an index ≥ NUM_PATTERNS
    // must not index the loops/patterns arrays out of bounds.
    s.current_patterns[0] = 99;
    for _ in 0..4 {
        engine_core_tick(&mut s);
    }
}

#[test]
fn repeat_amount_is_clamped_to_one() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    assert!(idx >= 0);
    engine_set_event_repeat_amount(&mut s, idx as u16, 0);

    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let h = s.patterns[ch][pat].event_handles[idx as usize];
    assert_eq!(s.event_pool.slots[h as usize].repeat_amount, 1);
}

// ============ #8 — pool free rejects bad handles ============
//
// The out-of-range / free-list-overflow rejections are release-only defense
// (in debug builds the paired debug_assert fires first, by design), so they
// can't be exercised here. The POOL_HANDLE_NONE no-op is the testable case.

#[test]
fn event_free_none_handle_is_noop() {
    let mut s = init_state();
    let before = s.event_pool.free_count;
    event_free(&mut s.event_pool, POOL_HANDLE_NONE);
    assert_eq!(s.event_pool.free_count, before);
}

// ============ #9 — stale selected_event_idx from the host ============

#[test]
fn out_of_range_selection_does_not_crash_disable_note() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    // engine_set_selected_event accepts any i16; a stale/huge index must not
    // index event_handles (len MAX_EVENTS) out of bounds.
    s.selected_event_idx = 9000;
    engine_key_action(&mut s, ACTION_DISABLE_NOTE);
    // The selection was out of range, so the note must remain enabled.
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let h = s.patterns[ch][pat].event_handles[0];
    assert_eq!(s.event_pool.slots[h as usize].enabled, 1);
}

