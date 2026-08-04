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
    assert_eq!(s.sound_page, PAGE_PRESET);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_OSC1);
    engine_arrow_press(&mut s, DIR_DOWN, 0);
    engine_arrow_press(&mut s, DIR_DOWN, 0);
    assert_eq!(s.sound_page, PAGE_FX, "down from page 0 wraps to the last page");
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_PRESET);
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
fn amp_page_sub_fader() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_AMP;
    let ch = s.current_channel as usize;
    assert_eq!(s.sound_patches[ch][patch::P_SUB_LEVEL], 0, "sub defaults to off");
    // Third fader (cols 8-10) is the sub level
    engine_button_press(&mut s, 0, 9, 0);
    assert_eq!(s.sound_patches[ch][patch::P_SUB_LEVEL], 100);
    assert_eq!(s.sound_focus[PAGE_AMP as usize], 2);
    engine_button_press(&mut s, 7, 9, 0);
    assert_eq!(s.sound_patches[ch][patch::P_SUB_LEVEL], 0);
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

/// First FM preset slot (TINE MACHINE).
fn first_fm_preset() -> usize {
    (0..patch::NUM_PRESETS)
        .find(|&i| patch::PRESETS[i].values[patch::P_ENGINE] == patch::ENGINE_FM)
        .expect("no FM preset")
}

#[test]
fn fm_preset_switches_page_list() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    let fm = first_fm_preset();
    engine_load_sound_preset(&mut s, ch, fm);
    assert_eq!(s.sound_patches[ch][patch::P_ENGINE], patch::ENGINE_FM);

    // Left encoder walks the FM page list: PRESET → ALGO → OP → FM → AMP...
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_ALGO);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_OP);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_FM);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_AMP);

    // Loading a subtractive preset from an FM-only page snaps back to PRESET
    s.sound_page = PAGE_ALGO;
    engine_load_sound_preset(&mut s, ch, 0);
    assert_eq!(s.sound_page, PAGE_PRESET);
}

#[test]
fn algo_page_selector_and_encoder() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    engine_load_sound_preset(&mut s, ch, first_fm_preset());
    s.sound_page = PAGE_ALGO;

    engine_button_press(&mut s, 7, 5, 0); // select algorithm 6
    assert_eq!(s.sound_patches[ch][patch::P_ALGO], 5);
    // Selector strip has exactly 8 cells — col 8 is dead
    engine_button_press(&mut s, 7, 8, 0);
    assert_eq!(s.sound_patches[ch][patch::P_ALGO], 5);
    // Right encoder steps the algorithm
    engine_arrow_press(&mut s, DIR_RIGHT, 0);
    assert_eq!(s.sound_patches[ch][patch::P_ALGO], 6);

    // Grid renders the selector with the current algo lit
    engine_compute_grid(&mut s, 0.0);
    assert_eq!(s.button_values[7][6], BTN_COLOR_100);
    assert_eq!(s.button_values[7][0], BTN_WHITE_25);
}

#[test]
fn fm_op_page_faders_edit_ratios() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    engine_load_sound_preset(&mut s, ch, first_fm_preset());
    s.sound_page = PAGE_OP;

    engine_button_press(&mut s, 0, 5, 0); // second fader top = R2 max
    assert_eq!(s.sound_patches[ch][patch::P_RATIO2], 15);
    assert_eq!(s.sound_edited[ch], 1, "ratio edit flags the patch");
}

#[test]
fn wavetable_preset_pages_and_position_track() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    let wt = (0..patch::NUM_PRESETS)
        .find(|&i| patch::PRESETS[i].values[patch::P_ENGINE] == patch::ENGINE_WAVETABLE)
        .expect("no wavetable preset");
    engine_load_sound_preset(&mut s, ch, wt);

    // Page list: PRESET → WAVE → DIGI → AMP
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_WT);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_DIGI);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_AMP);

    // WAVE page bottom row jumps the morph position
    s.sound_page = PAGE_WT;
    engine_button_press(&mut s, 7, 15, 0);
    assert_eq!(s.sound_patches[ch][patch::P_WT_POS], 100);
    engine_button_press(&mut s, 7, 0, 0);
    assert_eq!(s.sound_patches[ch][patch::P_WT_POS], 0);

    // Grid draws a waveform trace and the position track
    engine_compute_grid(&mut s, 0.0);
    let lit: usize = (0..7)
        .map(|r| (0..16).filter(|&c| s.button_values[r][c] == BTN_COLOR_100).count())
        .sum();
    assert!(lit >= 16, "waveform trace should light one cell per column, got {lit}");
    assert_eq!(s.button_values[7][0], BTN_COLOR_100, "position cell at 0");
}

#[test]
fn preset_cells_are_colored_by_engine() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    engine_compute_grid(&mut s, 0.0);

    let fm = first_fm_preset();
    let wt = (0..patch::NUM_PRESETS)
        .find(|&i| patch::PRESETS[i].values[patch::P_ENGINE] == patch::ENGINE_WAVETABLE)
        .unwrap();
    let cell = |idx: usize| (idx / VISIBLE_COLS, idx % VISIBLE_COLS);

    // Unselected cells: dim, tinted by their engine
    let (r, c) = cell(1); // FAT STACK (subtractive)
    assert_eq!(s.button_values[r][c], BTN_COLOR_25);
    assert_eq!(s.color_overrides[r][c], ENGINE_COLORS[0]);
    let (r, c) = cell(fm);
    assert_eq!(s.color_overrides[r][c], ENGINE_COLORS[1]);
    let (r, c) = cell(wt);
    assert_eq!(s.color_overrides[r][c], ENGINE_COLORS[2]);

    // Selected clean cell: bright in its engine color (preset 0, subtractive)
    assert_eq!(s.button_values[0][0], BTN_COLOR_100);
    assert_eq!(s.color_overrides[0][0], ENGINE_COLORS[0]);
}

#[test]
fn preset_page_selects_and_loads() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    assert_eq!(s.sound_presets[ch], 0, "boots on preset 0");

    // Press preset cell 2 (ACID LINE) — full patch loads, clean state
    engine_button_press(&mut s, 0, 2, 0);
    assert_eq!(s.sound_presets[ch], 2);
    assert_eq!(s.sound_patches[ch], patch::PRESETS[2].values);
    assert_eq!(s.sound_edited[ch], 0);

    // Out-of-range cells are ignored
    let before = s.sound_presets[ch];
    engine_button_press(&mut s, 6, 15, 0);
    assert_eq!(s.sound_presets[ch], before);
}

#[test]
fn preset_encoder_steps_and_wraps() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    engine_arrow_press(&mut s, DIR_LEFT, 0);
    assert_eq!(
        s.sound_presets[ch] as usize,
        patch::NUM_PRESETS - 1,
        "left from preset 0 wraps to the last"
    );
    engine_arrow_press(&mut s, DIR_RIGHT, 0);
    assert_eq!(s.sound_presets[ch], 0);
    assert_eq!(s.sound_patches[ch], patch::PRESETS[0].values, "stepping loads the preset");
}

#[test]
fn editing_flags_edited_and_reset_restores() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    engine_button_press(&mut s, 0, 1, 0); // load FAT STACK
    assert_eq!(s.sound_edited[ch], 0);

    // Edit a fader on the ENV page → edited
    s.sound_page = PAGE_ENV;
    engine_button_press(&mut s, 0, 0, 0);
    assert_eq!(s.sound_edited[ch], 1);
    assert_ne!(s.sound_patches[ch], patch::PRESETS[1].values);

    // Grid shows the reset cell + amber selected preset
    s.sound_page = PAGE_PRESET;
    engine_compute_grid(&mut s, 0.0);
    assert_eq!(s.button_values[7][15], BTN_COLOR_100, "reset cell lit when edited");
    assert_eq!(s.color_overrides[0][1], crate::engine_sound::SOUND_ACCENT);

    // Reset cell restores the preset and clears the flag
    engine_button_press(&mut s, 7, 15, 0);
    assert_eq!(s.sound_edited[ch], 0);
    assert_eq!(s.sound_patches[ch], patch::PRESETS[1].values);
    engine_compute_grid(&mut s, 0.0);
    assert_eq!(s.button_values[7][15] & 0xF, BTN_OFF, "reset cell hidden when clean");
}

#[test]
fn presets_are_per_channel() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    engine_button_press(&mut s, 0, 3, 0); // ch 0 → RUBBER BASS
    assert_eq!(s.sound_presets[0], 3);
    assert_eq!(s.sound_presets[1], 0, "other channels keep their preset");
    assert_eq!(s.sound_patches[1], patch::PRESETS[0].values);
}

#[test]
fn param_value_formatting() {
    assert_eq!(format_param_value(patch::P_SUSTAIN, 55).as_str(), "55%");
    assert_eq!(format_param_value(patch::P_WAVE1, patch::WAVE_SAW).as_str(), "SAW");
    assert_eq!(format_param_value(patch::P_SUB_LEVEL, 30).as_str(), "30%");
    assert_eq!(format_param_value(patch::P_DETUNE, 7).as_str(), "7CT");
    // Times come from the shared synth mappings
    let atk = format_param_value(patch::P_ATTACK, patch::DEFAULTS[patch::P_ATTACK]);
    assert!(atk.as_str().ends_with("MS"), "attack shows ms, got {}", atk.as_str());
}
