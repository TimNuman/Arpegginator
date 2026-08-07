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
fn sound_mode_on_drum_channel_opens_kit_pages() {
    let mut s = init_state();
    s.current_channel = drum_ch(&s);
    engine_button_press(&mut s, 7, 2, MOD_CTRL);
    assert_eq!(s.ui_mode, UiMode::Sound as u8);
    assert_eq!(s.sound_page, PAGE_DKIT, "drum channel snaps to the kit chooser");
}

#[test]
fn switching_to_drum_channel_keeps_sound_mode_and_snaps_page() {
    let mut s = init_state();
    engine_button_press(&mut s, 7, 2, MOD_CTRL);
    assert_eq!(s.ui_mode, UiMode::Sound as u8);
    s.sound_page = PAGE_ENV;
    // Ctrl overlay: select the drum channel's row (its current pattern col)
    let dch = drum_ch(&s);
    let dpat = s.current_patterns[dch as usize];
    engine_button_press(&mut s, dch, dpat + 1, MOD_CTRL);
    assert_eq!(s.current_channel, dch);
    assert_eq!(s.ui_mode, UiMode::Sound as u8);
    assert_eq!(s.sound_page, PAGE_DKIT, "melodic page is foreign to drums; snaps to KIT");
    // And back: a melodic channel snaps off the sampler pages
    let pat0 = s.current_patterns[0];
    engine_button_press(&mut s, 0, pat0 + 1, MOD_CTRL);
    assert_eq!(s.ui_mode, UiMode::Sound as u8);
    assert_eq!(s.sound_page, PAGE_PRESET);
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
    assert_eq!(s.sound_page, PAGE_MOD, "down from page 0 wraps to the last page");
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
fn wheel_page_faders_edit_mod_matrix() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    s.sound_page = PAGE_MOD;
    let ch = s.current_channel as usize;

    // Fader 1 (TGT1) occupies cols 0-2: full-height press = max target
    engine_button_press(&mut s, 0, 0, 0);
    assert_eq!(s.sound_patches[ch][patch::P_MOD1_TARGET], patch::MAX_MOD_TARGET as i16);

    // Encoder clamps depth at both ends of its 0..200 range
    s.sound_focus[PAGE_MOD as usize] = 1; // AMT1
    for _ in 0..50 {
        engine_arrow_press(&mut s, DIR_RIGHT, 0);
    }
    assert_eq!(s.sound_patches[ch][patch::P_MOD1_DEPTH], 200);
    for _ in 0..100 {
        engine_arrow_press(&mut s, DIR_LEFT, 0);
    }
    assert_eq!(s.sound_patches[ch][patch::P_MOD1_DEPTH], 0);
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
fn additive_harm_page_edits_partials() {
    let mut s = init_state();
    s.ui_mode = UiMode::Sound as u8;
    let ch = s.current_channel as usize;
    let add = (0..patch::NUM_PRESETS)
        .find(|&i| patch::PRESETS[i].values[patch::P_ENGINE] == patch::ENGINE_ADDITIVE)
        .expect("no additive preset");
    engine_load_sound_preset(&mut s, ch, add);

    // Page list: PRESET → HARM → ADD → AMP
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_HARM);
    engine_arrow_press(&mut s, DIR_UP, 0);
    assert_eq!(s.sound_page, PAGE_ADD);

    // Every column is a one-wide fader for one partial; press sets + focuses
    s.sound_page = PAGE_HARM;
    engine_button_press(&mut s, 0, 4, 0); // harmonic 5 to max
    assert_eq!(s.sound_patches[ch][patch::P_H1 + 4], 100);
    assert_eq!(s.sound_focus[PAGE_HARM as usize], 4);
    engine_button_press(&mut s, 7, 4, 0); // and back to zero
    assert_eq!(s.sound_patches[ch][patch::P_H1 + 4], 0);

    // Right encoder edits the focused partial (fine step for shift)
    engine_arrow_press(&mut s, DIR_RIGHT, 0);
    assert_eq!(s.sound_patches[ch][patch::P_H1 + 4], 5);
    engine_arrow_press(&mut s, DIR_RIGHT, MOD_SHIFT);
    assert_eq!(s.sound_patches[ch][patch::P_H1 + 4], 6);

    // Grid: all 16 columns render (dim marker at minimum)
    engine_compute_grid(&mut s, 0.0);
    for c in 0..16 {
        assert_ne!(s.button_values[7][c] & 0xF, BTN_OFF, "column {c} should render");
    }
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

// ============ Drum sampler pages ============

mod sampler {
    use super::*;
    use arp3_synth::sampler::*;

    fn drum_state() -> Box<EngineState> {
        let mut s = init_state();
        s.current_channel = drum_ch(&s);
        s.ui_mode = UiMode::Sound as u8;
        crate::engine_sound::ensure_valid_sound_page(&mut s);
        // Sampler tests start on the sampler pages (the 808 pages come first)
        s.sound_page = PAGE_SSLOT;
        s
    }

    #[test]
    fn left_encoder_cycles_sampler_pages_and_wraps_to_kit() {
        let mut s = drum_state();
        assert_eq!(s.sound_page, PAGE_SSLOT);
        for expect in [PAGE_SREC, PAGE_STRIM, PAGE_SPLAY, PAGE_SMOD, PAGE_DKIT] {
            engine_arrow_press(&mut s, DIR_UP, 0);
            assert_eq!(s.sound_page, expect);
        }
        engine_arrow_press(&mut s, DIR_DOWN, 0);
        assert_eq!(s.sound_page, PAGE_SMOD, "down from the first page wraps to the last");
    }

    #[test]
    fn slot_rows_select_and_arrows_step_with_wrap() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        // Rows are slots: bottom row = slot 0, so row 2 = slot 5
        engine_button_press(&mut s, 2, 4, 0);
        assert_eq!(s.sampler_slot[ch], 5);
        engine_arrow_press(&mut s, DIR_RIGHT, 0);
        assert_eq!(s.sampler_slot[ch], 6);
        s.sampler_slot[ch] = 0;
        engine_arrow_press(&mut s, DIR_LEFT, 0);
        assert_eq!(s.sampler_slot[ch], (NUM_SLOTS - 1) as u8, "slot wraps");
        // Slot 15 sits in the upper window: its row is 7 - (15 - 8) = 0,
        // and a bottom-row press now selects the window's first slot (8)
        engine_button_press(&mut s, 7, 0, 0);
        assert_eq!(s.sampler_slot[ch], 8);
    }

    #[test]
    fn trim_press_moves_nearest_handle() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        s.sound_page = PAGE_STRIM;
        // Defaults: start 0, end 1000. Col 3 of 0..15 → 200‰, nearer to start.
        engine_button_press(&mut s, 7, 3, 0);
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_START], 200);
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_END], 1000);
        // Col 14 → 933‰, nearer to end.
        engine_button_press(&mut s, 7, 14, 0);
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_END], 933);
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_START], 200);
    }

    #[test]
    fn trim_handles_cannot_cross() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        s.sound_page = PAGE_STRIM;
        // Walk END far left, then START far right: they pin to a 1% window
        for _ in 0..250 {
            engine_arrow_press(&mut s, DIR_LEFT, MOD_SHIFT); // END -5‰
        }
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_END], 10, "END stops at START + gap");
        for _ in 0..10 {
            engine_arrow_press(&mut s, DIR_RIGHT, 0); // START +5‰
        }
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_START], 0, "START can't pass END - gap");
        assert!(
            s.sampler_params[ch][0][SP_TRIM_START] < s.sampler_params[ch][0][SP_TRIM_END]
        );
        // A press-to-jump on the far right moves END, then START stays below it
        engine_button_press(&mut s, 7, 15, 0);
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_END], 1000);
    }

    #[test]
    fn trim_arrows_nudge_start_bare_end_shifted() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        s.sound_page = PAGE_STRIM;
        engine_arrow_press(&mut s, DIR_RIGHT, 0);
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_START], 5);
        engine_arrow_press(&mut s, DIR_LEFT, MOD_SHIFT);
        assert_eq!(s.sampler_params[ch][0][SP_TRIM_END], 995);
    }

    #[test]
    fn play_page_faders_mode_cells_and_tape_toggle() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        s.sound_page = PAGE_SPLAY;
        // Top of fader 0 (SPEED, cols 0-2) → max
        engine_button_press(&mut s, 0, 0, 0);
        assert_eq!(s.sampler_params[ch][0][SP_SPEED], SLOT_PARAM_MAX[SP_SPEED]);
        assert_eq!(s.sound_focus[PAGE_SPLAY as usize], 0);
        // Mode cells
        engine_button_press(&mut s, 7, 13, 0);
        assert_eq!(s.sampler_params[ch][0][SP_MODE], MODE_LOOP);
        engine_button_press(&mut s, 7, 14, 0);
        assert_eq!(s.sampler_params[ch][0][SP_MODE], MODE_GATE);
        // TAPE toggle
        engine_button_press(&mut s, 7, 15, 0);
        assert_eq!(s.sampler_params[ch][0][SP_TAPE], 1);
        engine_button_press(&mut s, 7, 15, 0);
        assert_eq!(s.sampler_params[ch][0][SP_TAPE], 0);
    }

    #[test]
    fn mod_page_encoder_edits_focused_fader() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        s.sound_page = PAGE_SMOD;
        // Default focus = fader 0 (CUT, default 100 = max): left steps down
        engine_arrow_press(&mut s, DIR_LEFT, 0);
        assert_eq!(s.sampler_params[ch][0][SP_CUT], 95);
        engine_arrow_press(&mut s, DIR_RIGHT, MOD_SHIFT);
        assert_eq!(s.sampler_params[ch][0][SP_CUT], 96, "shift = fine step");
        // Focus follows a fader press (RES = fader 1, cols 4-6)
        engine_button_press(&mut s, 7, 4, 0);
        assert_eq!(s.sampler_params[ch][0][SP_RES], 0);
        engine_arrow_press(&mut s, DIR_RIGHT, 0);
        assert_eq!(s.sampler_params[ch][0][SP_RES], 5);
    }

    #[test]
    fn params_are_per_slot_and_clamped() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        s.sound_page = PAGE_SPLAY;
        s.sampler_slot[ch] = 3;
        engine_arrow_press(&mut s, DIR_RIGHT, 0); // SPEED +5 on slot 3
        assert_eq!(s.sampler_params[ch][3][SP_SPEED], 55);
        assert_eq!(s.sampler_params[ch][0][SP_SPEED], 50, "slot 0 untouched");
        for _ in 0..20 {
            engine_arrow_press(&mut s, DIR_RIGHT, 0);
        }
        assert_eq!(s.sampler_params[ch][3][SP_SPEED], SLOT_PARAM_MAX[SP_SPEED]);
    }

    #[test]
    fn shift_press_tunes_pitch_to_scale_root() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        // Detected key A (9), scale root C (0): nearest path is +3 semitones.
        // Shift+press on slot 0's row (the bottom row) tunes it.
        s.sampler_keys[ch][0] = 9;
        s.sampler_loaded[ch][0] = 1;
        engine_button_press(&mut s, 7, 3, MOD_SHIFT);
        assert_eq!(s.sampler_params[ch][0][SP_PITCH], 24 + 3);
        assert_eq!(s.sampler_slot[ch], 0, "shift-press doesn't change selection");
        // No detected key → TUNE is inert (slot 1 = row 6)
        engine_button_press(&mut s, 6, 3, MOD_SHIFT);
        assert_eq!(s.sampler_params[ch][1][SP_PITCH], 24);
    }

    #[test]
    fn slot_page_rows_show_waveforms_and_selection() {
        let mut s = drum_state();
        let ch = s.current_channel as usize;
        s.sampler_loaded[ch][2] = 1;
        s.sampler_previews[ch][2] = [255; 16];
        s.sampler_slot[ch] = 2;
        engine_compute_grid(&mut s, 0.0);
        // Slot 2's row (7 - 2 = 5) is fully lit and carries the accent
        assert_ne!(s.button_values[5][8] & 0xF, BTN_OFF, "loaded slot row lit");
        assert_eq!(s.color_overrides[5][0], crate::engine_sound::SOUND_ACCENT);
        // An empty, unselected slot's row stays dimmed (slot 6 = row 1)
        assert_eq!(s.button_values[1][8] & 0xF, BTN_OFF, "empty slot row dark");
    }

    #[test]
    fn rec_page_grid_reflects_recording_state() {
        let mut s = drum_state();
        s.sound_page = PAGE_SREC;
        s.rec_state = crate::engine_sampler::REC_RECORDING;
        s.rec_level = 255;
        engine_compute_grid(&mut s, 0.0);
        assert_eq!(
            s.color_overrides[7][0],
            crate::engine_sampler::REC_COLOR,
            "REC cell is red while recording"
        );
    }
}

// ============ 808 drum-synth pages ============

mod drumsynth {
    use super::*;
    use arp3_synth::drums::*;

    fn kit_state() -> Box<EngineState> {
        let mut s = init_state();
        s.current_channel = drum_ch(&s);
        s.ui_mode = UiMode::Sound as u8;
        crate::engine_sound::ensure_valid_sound_page(&mut s);
        // Instrument tests start on the BD page (the KIT chooser comes first)
        s.sound_page = PAGE_DBD;
        s
    }

    #[test]
    fn drum_channel_opens_kit_chooser_then_cycles_instruments() {
        let mut s = kit_state();
        s.sound_page = PAGE_DKIT;
        crate::engine_sound::ensure_valid_sound_page(&mut s);
        assert_eq!(s.sound_page, PAGE_DKIT);
        for expect in [
            PAGE_DFOLD, PAGE_DBD, PAGE_DSD, PAGE_DTOM, PAGE_DRS, PAGE_DCP, PAGE_DMA, PAGE_DCB,
            PAGE_DCY, PAGE_DHH, PAGE_SSLOT,
        ] {
            engine_arrow_press(&mut s, DIR_UP, 0);
            assert_eq!(s.sound_page, expect);
        }
    }

    #[test]
    fn kit_page_selects_engine_and_swaps_fader_banks() {
        let mut s = kit_state();
        let ch = s.current_channel as usize;
        assert_eq!(s.drum_patches[ch][DP_KIT], KIT_ANALOG, "channels boot on the analog kit");
        s.sound_page = PAGE_DKIT;
        // Bottom-row selector cell 1 = FM
        engine_button_press(&mut s, 7, 1, 0);
        assert_eq!(s.drum_patches[ch][DP_KIT], KIT_FM);
        // The BD page now edits the FM bank: second fader is the FM knob
        s.sound_page = PAGE_DBD;
        engine_button_press(&mut s, 0, 4, 0);
        assert_eq!(s.drum_patches[ch][DPF_BD_FM], 100);
        assert_eq!(s.drum_patches[ch][DP_BD_TONE], DRUM_PARAM_DEFAULTS[DP_BD_TONE],
            "analog bank must be untouched by FM edits");
        // Encoder on the KIT page steps back to analog
        s.sound_page = PAGE_DKIT;
        engine_arrow_press(&mut s, DIR_LEFT, 0);
        assert_eq!(s.drum_patches[ch][DP_KIT], KIT_ANALOG);
    }

    #[test]
    fn every_kit_page_has_faders_with_valid_params() {
        for kit in [KIT_ANALOG, KIT_FM] {
            for page in [
                PAGE_DBD, PAGE_DSD, PAGE_DTOM, PAGE_DRS, PAGE_DCP, PAGE_DMA, PAGE_DCB, PAGE_DCY,
                PAGE_DHH,
            ] {
                let faders = crate::engine_drumsynth::drum_page_faders(page, kit);
                assert!(!faders.is_empty(), "page {} must have faders", page);
                assert!(faders.len() <= 4);
                for &p in faders {
                    assert!(p < NUM_DRUM_PARAMS);
                }
            }
        }
        // Every knob is reachable from exactly one page of its kit; the kit
        // selector itself lives on the KIT chooser page
        let mut seen = [0u8; NUM_DRUM_PARAMS];
        for kit in [KIT_ANALOG, KIT_FM] {
            for page in PAGE_DBD..=PAGE_DHH {
                for &p in crate::engine_drumsynth::drum_page_faders(page, kit) {
                    seen[p] += 1;
                }
            }
        }
        for (p, &n) in seen.iter().enumerate() {
            // The kit selector and the per-instrument folds live on the KIT
            // and FOLD chooser pages
            let expect =
                if p == DP_KIT || (DP_FOLD_BD..=DP_FOLD_HH).contains(&p) { 0 } else { 1 };
            assert_eq!(n, expect, "param {} appears on {} pages", p, n);
        }
    }

    #[test]
    fn fader_press_sets_kit_param_and_focus() {
        let mut s = kit_state();
        let ch = s.current_channel as usize;
        // BD page, second fader (TONE), top row → 100
        engine_button_press(&mut s, 0, 4, 0);
        assert_eq!(s.drum_patches[ch][DP_BD_TONE], 100);
        assert_eq!(s.sound_focus[PAGE_DBD as usize], 1);
        // Bottom row → 0
        engine_button_press(&mut s, 7, 4, 0);
        assert_eq!(s.drum_patches[ch][DP_BD_TONE], 0);
        // Gap column is inert
        engine_button_press(&mut s, 0, 3, 0);
        assert_eq!(s.sound_focus[PAGE_DBD as usize], 1);
    }

    #[test]
    fn encoder_edits_focused_kit_param_with_shift_fine() {
        let mut s = kit_state();
        let ch = s.current_channel as usize;
        s.sound_page = PAGE_DHH;
        s.sound_focus[PAGE_DHH as usize] = 2; // OH decay
        let before = s.drum_patches[ch][DP_HH_OH_DEC];
        engine_arrow_press(&mut s, DIR_RIGHT, 0);
        assert_eq!(s.drum_patches[ch][DP_HH_OH_DEC], before + 5);
        engine_arrow_press(&mut s, DIR_LEFT, MOD_SHIFT);
        assert_eq!(s.drum_patches[ch][DP_HH_OH_DEC], before + 4);
    }

    #[test]
    fn kit_params_clamp_at_range_edges() {
        let mut s = kit_state();
        let ch = s.current_channel as usize;
        crate::engine_drumsynth::engine_set_drum_param(&mut s, ch, DP_BD_TUNE, 130);
        assert_eq!(s.drum_patches[ch][DP_BD_TUNE], 100);
        crate::engine_drumsynth::engine_set_drum_param(&mut s, ch, DP_BD_TUNE, -7);
        assert_eq!(s.drum_patches[ch][DP_BD_TUNE], 0);
    }

    #[test]
    fn kit_page_grid_shows_faders_and_audition_pad() {
        let mut s = kit_state();
        let ch = s.current_channel as usize;
        s.drum_patches[ch][DP_BD_TUNE] = 100; // first fader full height
        engine_compute_grid(&mut s, 0.0);
        assert_ne!(s.button_values[0][0] & 0xF, BTN_OFF, "full fader reaches the top row");
        assert_eq!(s.button_values[3][3], BTN_OFF, "gap column stays dark");
        // Audition pad in the bottom-right corner
        assert_ne!(s.button_values[7][15] & 0xF, BTN_OFF);
        assert_eq!(s.color_overrides[7][15], crate::engine_sound::SOUND_ACCENT);
    }

    #[test]
    fn melodic_channels_do_not_see_kit_pages() {
        let mut s = init_state();
        s.ui_mode = UiMode::Sound as u8;
        s.sound_page = PAGE_DBD;
        crate::engine_sound::ensure_valid_sound_page(&mut s);
        assert_eq!(s.sound_page, PAGE_PRESET, "kit page is foreign to melodic channels");
    }
}

// ============ Wavefolder + West Coast engine pages ============

mod westcoast {
    use super::*;

    /// Index of the first West Coast factory preset.
    fn west_preset() -> usize {
        (0..patch::NUM_PRESETS)
            .find(|&i| patch::PRESETS[i].values[patch::P_ENGINE] == patch::ENGINE_WEST)
            .expect("no west preset")
    }

    #[test]
    fn loading_a_west_preset_swaps_to_fold_pages() {
        let mut s = init_state();
        s.ui_mode = UiMode::Sound as u8;
        let ch = s.current_channel as usize;
        engine_load_sound_preset(&mut s, ch, west_preset());
        assert_eq!(s.sound_patches[ch][patch::P_ENGINE], patch::ENGINE_WEST);
        let pages = crate::engine_sound::pages_for(&s);
        assert!(pages.contains(&PAGE_WFOLD));
        assert!(pages.contains(&PAGE_WEST));
        // FOLD lives on the WEST page for this engine, not on FX
        assert!(!page_faders(patch::ENGINE_WEST, PAGE_FX).contains(&patch::P_FOLD));
        assert!(page_faders(patch::ENGINE_WEST, PAGE_WEST).contains(&patch::P_FOLD));
    }

    #[test]
    fn fx_page_has_fold_fader_on_other_engines() {
        for engine in [
            patch::ENGINE_SUBTRACTIVE,
            patch::ENGINE_FM,
            patch::ENGINE_WAVETABLE,
            patch::ENGINE_ADDITIVE,
        ] {
            assert!(
                page_faders(engine, PAGE_FX).contains(&patch::P_FOLD),
                "engine {} FX page must expose FOLD",
                engine
            );
        }
    }

    #[test]
    fn fold_track_press_and_encoder_edit_fold() {
        let mut s = init_state();
        s.ui_mode = UiMode::Sound as u8;
        let ch = s.current_channel as usize;
        engine_load_sound_preset(&mut s, ch, west_preset());
        s.sound_page = PAGE_WFOLD;
        // Bottom-row track: col 15 → 100
        engine_button_press(&mut s, 7, 15, 0);
        assert_eq!(s.sound_patches[ch][patch::P_FOLD], 100);
        // Encoder edits the fold too (chooser param), Shift fine
        engine_arrow_press(&mut s, DIR_LEFT, 0);
        assert_eq!(s.sound_patches[ch][patch::P_FOLD], 95);
        engine_arrow_press(&mut s, DIR_LEFT, MOD_SHIFT);
        assert_eq!(s.sound_patches[ch][patch::P_FOLD], 94);
        // Non-bottom rows are inert on the fold page
        let before = s.sound_patches[ch];
        engine_button_press(&mut s, 3, 5, 0);
        assert_eq!(s.sound_patches[ch], before);
    }

    #[test]
    fn west_page_faders_edit_the_folder() {
        let mut s = init_state();
        s.ui_mode = UiMode::Sound as u8;
        let ch = s.current_channel as usize;
        engine_load_sound_preset(&mut s, ch, west_preset());
        s.sound_page = PAGE_WEST;
        // Fader 2 (SHAPE, cols 4-6) to the top
        engine_button_press(&mut s, 0, 5, 0);
        assert_eq!(s.sound_patches[ch][patch::P_WC_SHAPE], 100);
        // Fader 4 (BLOOM, cols 12-14) to the bottom
        engine_button_press(&mut s, 7, 13, 0);
        assert_eq!(s.sound_patches[ch][patch::P_WC_ENV], 0);
    }

    #[test]
    fn mod_matrix_reaches_fold() {
        assert_eq!(patch::PARAM_MAX[patch::P_MOD1_TARGET] as usize, patch::P_FOLD);
        assert_eq!(param_label(patch::P_FOLD), "FOLD");
    }

    #[test]
    fn fold_page_grid_draws_trace_and_track() {
        let mut s = init_state();
        s.ui_mode = UiMode::Sound as u8;
        let ch = s.current_channel as usize;
        engine_load_sound_preset(&mut s, ch, west_preset());
        s.sound_page = PAGE_WFOLD;
        s.sound_patches[ch][patch::P_FOLD] = 100;
        engine_compute_grid(&mut s, 0.0);
        // Some cell in rows 0-6 is lit (the trace) ...
        let lit = (0..7).any(|r| (0..16).any(|c| s.button_values[r][c] != BTN_OFF));
        assert!(lit, "fold trace must draw");
        // ... and the track's fold marker sits at the right edge
        assert_eq!(s.button_values[7][15], BTN_COLOR_100);
        assert_eq!(s.color_overrides[7][15], crate::engine_sound::SOUND_ACCENT);
    }
}

// ============ Per-instrument drum FOLD page ============

mod drum_fold {
    use super::*;
    use arp3_synth::drums::*;

    fn fold_page_state() -> Box<EngineState> {
        let mut s = init_state();
        s.current_channel = drum_ch(&s);
        s.ui_mode = UiMode::Sound as u8;
        crate::engine_sound::ensure_valid_sound_page(&mut s);
        assert_eq!(s.sound_page, PAGE_DKIT, "KIT chooser first");
        engine_arrow_press(&mut s, DIR_UP, 0);
        assert_eq!(s.sound_page, PAGE_DFOLD, "FOLD page follows the kit chooser");
        s
    }

    #[test]
    fn fold_columns_set_focus_and_edit_per_instrument() {
        let mut s = fold_page_state();
        let ch = s.current_channel as usize;
        // Column 8 (HH), top row -> 100; only the hats' fold moves
        engine_button_press(&mut s, 0, 8, 0);
        assert_eq!(s.drum_patches[ch][DP_FOLD_HH], 100);
        assert_eq!(s.drum_patches[ch][DP_FOLD_BD], 0);
        assert_eq!(s.sound_focus[PAGE_DFOLD as usize], 8);
        // Encoder edits the focused column, Shift fine
        engine_arrow_press(&mut s, DIR_LEFT, 0);
        assert_eq!(s.drum_patches[ch][DP_FOLD_HH], 95);
        engine_arrow_press(&mut s, DIR_LEFT, MOD_SHIFT);
        assert_eq!(s.drum_patches[ch][DP_FOLD_HH], 94);
        // Columns beyond the nine folds are inert
        let before = s.drum_patches[ch];
        engine_button_press(&mut s, 0, 9, 0);
        assert_eq!(s.drum_patches[ch], before);
    }

    #[test]
    fn fold_page_grid_shows_column_faders() {
        let mut s = fold_page_state();
        let ch = s.current_channel as usize;
        s.drum_patches[ch][DP_FOLD_BD] = 100; // column 0 full
        s.sound_focus[PAGE_DFOLD as usize] = 0;
        engine_compute_grid(&mut s, 0.0);
        assert_ne!(s.button_values[0][0] & 0xF, BTN_OFF, "full fold column reaches the top");
        assert_eq!(s.color_overrides[0][0], crate::engine_sound::SOUND_ACCENT);
        // A clean instrument keeps its dim base marker
        assert_eq!(s.button_values[7][4], BTN_COLOR_25);
        // Audition pad still present
        assert_ne!(s.button_values[7][15] & 0xF, BTN_OFF);
    }

    #[test]
    fn kit_page_no_longer_carries_a_fader() {
        let mut s = fold_page_state();
        s.sound_page = PAGE_DKIT;
        let ch = s.current_channel as usize;
        let before = s.drum_patches[ch];
        engine_button_press(&mut s, 0, 13, 0);
        assert_eq!(s.drum_patches[ch], before, "KIT page right bank is inert again");
    }
}
