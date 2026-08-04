// test_sound.rs — Tests for Sound mode (synth patch editing)

use alloc::boxed::Box;
use crate::engine_core::*;
use crate::engine_input::*;
use crate::engine_sound::*;
use crate::engine_ui::engine_compute_grid;
use arp3_synth::patch;

fn init_state() -> Box<EngineState> {
    let mut s = EngineState::new_boxed();
    engine_core_init(&mut s);
    s
}

/// Drum channel index (engine_core_init sets channels 4/5 to drums).
fn drum_ch(s: &EngineState) -> u8 {
    (0..NUM_CHANNELS).find(|&c| s.is_drum_channel(c)).expect("no drum channel") as u8
}

#[test]
fn ctrl_bottom_row_enters_sound_mode() {
    let mut s = init_state();
    engine_button_press(&mut s, 7, 2, MOD_CTRL);
    assert_eq!(s.ui_mode, UiMode::Sound as u8);
    // Cols 0/1 still switch back to Pattern/Modify
    engine_button_press(&mut s, 7, 0, MOD_CTRL);
    assert_eq!(s.ui_mode, UiMode::Pattern as u8);
}

#[test]
fn sound_mode_blocked_on_drum_channel() {
    let mut s = init_state();
    s.current_channel = drum_ch(&s);
    engine_button_press(&mut s, 7, 2, MOD_CTRL);
    assert_ne!(s.ui_mode, UiMode::Sound as u8);
}

#[test]
fn switching_to_drum_channel_leaves_sound_mode() {
    let mut s = init_state();
    engine_button_press(&mut s, 7, 2, MOD_CTRL);
    assert_eq!(s.ui_mode, UiMode::Sound as u8);
    // Ctrl overlay: select the drum channel's row (its current pattern col)
    let dch = drum_ch(&s);
    let dpat = s.current_patterns[dch as usize];
    engine_button_press(&mut s, dch, dpat + 1, MOD_CTRL);
    assert_eq!(s.current_channel, dch);
    assert_eq!(s.ui_mode, UiMode::Pattern as u8);
}

#[test]
fn left_encoder_cycles_pages_and_wraps() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    assert_eq!(s.sound_page, PAGE_TYPE);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_OSC1);
    engine_arrow_press(&mut s, DIR_DOWN, 0);
    engine_arrow_press(&mut s, DIR_DOWN, 0);
    assert_eq!(s.sound_page, PAGE_FX, "down from page 0 wraps to the last page");
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_TYPE);
}

#[test]
fn fader_press_sets_value_and_focus() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_ENV;
    let ch = s.current_channel as usize;

    // Press top row of the second fader (decay, cols 4-6)
    engine_button_press(&mut s, 0, 5, 0);
    assert_eq!(s.sound_patches[ch][patch::P_DECAY], 100);
    assert_eq!(s.sound_focus[PAGE_ENV as usize], 1);

    // Press bottom row → 0
    engine_button_press(&mut s, 7, 5, 0);
    assert_eq!(s.sound_patches[ch][patch::P_DECAY], 0);

    // Gap column (3) is dead
    let before = s.sound_patches[ch];
    engine_button_press(&mut s, 3, 3, 0);
    assert_eq!(s.sound_patches[ch], before);
}

#[test]
fn right_encoder_edits_focused_param_coarse_and_fine() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_FILT;
    let ch = s.current_channel as usize;
    let start = s.sound_patches[ch][patch::P_CUTOFF];

    engine_arrow_press(&mut s, DIR_RIGHT, 0);
    assert_eq!(s.sound_patches[ch][patch::P_CUTOFF], start + 5, "bare step is coarse");
    engine_arrow_press(&mut s, DIR_LEFT, MOD_SHIFT);
    assert_eq!(s.sound_patches[ch][patch::P_CUTOFF], start + 4, "shift step is fine");
}

#[test]
fn values_clamp_at_range_edges() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_FX;
    let ch = s.current_channel as usize;
    for _ in 0..30 {
        engine_arrow_press(&mut s, DIR_RIGHT, 0);
    }
    assert_eq!(s.sound_patches[ch][patch::P_DRIVE], 100);
    for _ in 0..30 {
        engine_arrow_press(&mut s, DIR_LEFT, 0);
    }
    assert_eq!(s.sound_patches[ch][patch::P_DRIVE], 0);
}

#[test]
fn osc_page_selector_row_picks_wave() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_OSC1;
    let ch = s.current_channel as usize;

    engine_button_press(&mut s, 7, 3, 0); // SINE
    assert_eq!(s.sound_patches[ch][patch::P_WAVE1], patch::WAVE_SINE);
    // Beyond the selector strip: ignored
    engine_button_press(&mut s, 7, 9, 0);
    assert_eq!(s.sound_patches[ch][patch::P_WAVE1], patch::WAVE_SINE);
    // Right encoder steps shapes too
    engine_arrow_press(&mut s, DIR_RIGHT, 0);
    assert_eq!(s.sound_patches[ch][patch::P_WAVE1], patch::WAVE_PULSE);
}

#[test]
fn osc2_shift_encoder_nudges_detune() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_OSC2;
    let ch = s.current_channel as usize;
    let start = s.sound_patches[ch][patch::P_DETUNE];
    engine_arrow_press(&mut s, DIR_RIGHT, MOD_SHIFT);
    assert_eq!(s.sound_patches[ch][patch::P_DETUNE], start + 1);
}

#[test]
fn sub_page_toggle_cell() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_SUB;
    let ch = s.current_channel as usize;
    assert_eq!(s.sound_patches[ch][patch::P_SUB_ON], 0);
    engine_button_press(&mut s, 0, 15, 0);
    assert_eq!(s.sound_patches[ch][patch::P_SUB_ON], 1);
    engine_button_press(&mut s, 0, 15, 0);
    assert_eq!(s.sound_patches[ch][patch::P_SUB_ON], 0);
}

#[test]
fn patches_are_per_channel() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_ENV;
    engine_button_press(&mut s, 0, 0, 0); // ch 0 attack = 100
    let other = 1;
    assert_eq!(s.sound_patches[other][patch::P_ATTACK], patch::DEFAULTS[patch::P_ATTACK]);
    assert_eq!(s.sound_patches[0][patch::P_ATTACK], 100);
}

#[test]
fn fader_grid_renders_expected_columns() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_ENV;
    let ch = s.current_channel as usize;
    s.sound_patches[ch][patch::P_ATTACK] = 100; // full fader

    engine_compute_grid(&mut s, 0.0);

    // Attack fader (cols 0-2) fully lit, gap column dark, cap at top
    assert_ne!(s.button_values[0][0] & 0xF, BTN_OFF);
    assert_ne!(s.button_values[7][2] & 0xF, BTN_OFF);
    assert_eq!(s.button_values[4][3] & 0xF, BTN_OFF, "gap column stays dark");
}

#[test]
fn type_page_renders_and_selects() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_TYPE;
    engine_compute_grid(&mut s, 0.0);
    assert_eq!(s.button_values[0][0], BTN_COLOR_100, "subtractive row selected");
    assert_eq!(s.button_values[1][0], BTN_WHITE_25, "unavailable engines dimmed");

    // Selecting an unavailable engine is rejected
    engine_button_press(&mut s, 2, 0, 0);
    let ch = s.current_channel as usize;
    assert_eq!(s.sound_patches[ch][patch::P_ENGINE], patch::ENGINE_SUBTRACTIVE);
}

#[test]
fn param_value_formatting() {
    assert_eq!(format_param_value(patch::P_SUSTAIN, 55).as_str(), "55%");
    assert_eq!(format_param_value(patch::P_WAVE1, patch::WAVE_SAW).as_str(), "SAW");
    assert_eq!(format_param_value(patch::P_SUB_ON, 1).as_str(), "ON");
    assert_eq!(format_param_value(patch::P_DETUNE, 7).as_str(), "7CT");
    // Times come from the shared synth mappings
    let atk = format_param_value(patch::P_ATTACK, patch::DEFAULTS[patch::P_ATTACK]);
    assert!(atk.as_str().ends_with("MS"), "attack shows ms, got {}", atk.as_str());
}
