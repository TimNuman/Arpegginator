use alloc::boxed::Box;
use crate::engine_core::*;
use crate::engine_edit::*;
use crate::engine_ui::engine_compute_grid;

fn init_state() -> Box<EngineState> {
    let mut s = EngineState::new_boxed();
    engine_core_init(&mut s);
    s
}

#[test]
fn fmtbuf_truncates_on_char_boundary() {
    let mut b = FmtBuf::<3>::new();
    b.push_str("aa");
    b.push_str("é");
    assert_eq!(b.as_str(), "aa");
    assert_eq!(b.len(), 2);
}

#[test]
fn fmtbuf_keeps_full_multibyte_when_it_fits() {
    let mut b = FmtBuf::<4>::new();
    b.push_str("é");
    assert_eq!(b.as_str(), "é");
}

#[test]
fn repeat_amount_zero_is_clamped() {
    let mut s = init_state();
    let idx = engine_toggle_event(&mut s, 10, 0, 120);
    assert!(idx >= 0);
    engine_set_event_repeat_amount(&mut s, idx as u16, 0);
    let (c, p) = (s.current_channel as usize, s.current_patterns[s.current_channel as usize] as usize);
    let h = s.patterns[c][p].event_handles[idx as usize];
    assert_eq!(s.event_pool.slots[h as usize].repeat_amount, 1);
}

#[test]
fn tick_with_zero_length_loop_does_not_panic() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    s.loops[ch][pat].length = 0;
    s.is_playing = 1;
    engine_core_play_init(&mut s);
    for _ in 0..16 {
        engine_core_tick(&mut s);
    }
}

#[test]
fn scrub_with_zero_length_loop_does_not_panic() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    s.loops[ch][pat].length = 0;
    engine_core_scrub_to_tick(&mut s, 240);
}

#[test]
fn channel_mode_render_does_not_panic() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    s.ui_mode = UiMode::Channel as u8;
    engine_compute_grid(&mut s, 0.0);
}

#[test]
fn copy_pattern_sets_consistent_count() {
    let mut s = init_state();
    engine_toggle_event(&mut s, 10, 0, 120);
    engine_toggle_event(&mut s, 12, 120, 120);
    let ch = s.current_channel as usize;
    engine_copy_pattern(&mut s, 1);
    assert_eq!(s.patterns[ch][1].event_count, 2);
    for i in 0..s.patterns[ch][1].event_count as usize {
        assert_ne!(s.patterns[ch][1].event_handles[i], POOL_HANDLE_NONE);
    }
}
