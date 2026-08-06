// engine_drumsynth.rs — Sound mode on drum channels: the 808 kit pages.
//
// One page per instrument, mirroring the Tiptop Audio 808 module line
// (BD808, SD808, the toms/congas, RS808, CP808, MA808, CB808, CY808,
// HH808). Every page follows the Sound-mode fader-bank grammar — 3-column
// faders for the module's front-panel knobs — plus an audition pad in the
// bottom-right corner that fires the instrument's GM note (Shift on the
// hi-hat page auditions the open hat).
//
// The engine owns the kit params per drum channel (drum_patches, UI units
// 0..100) and every change is emitted through platform_drum_param to the
// synth's analog-modeled kit (arp3_synth::drums), where empty sampler slots
// fall back to these voices.

use crate::engine_core::*;
use crate::engine_input::{DIR_LEFT, DIR_RIGHT, MOD_SHIFT};
use crate::engine_sound::{
    PAGE_DBD, PAGE_DCB, PAGE_DCP, PAGE_DCY, PAGE_DHH, PAGE_DMA, PAGE_DRS, PAGE_DSD, PAGE_DTOM,
    SOUND_ACCENT,
};
use crate::platform::{platform_drum_param, platform_play_preview_note};
pub use arp3_synth::drums::NUM_DRUM_PARAMS;
use arp3_synth::drums::{
    clamp_drum_param, inst_preview_note, DP_BD_DECAY, DP_BD_LEVEL, DP_BD_TONE, DP_BD_TUNE,
    DP_CB_DECAY, DP_CB_LEVEL, DP_CB_TUNE, DP_CP_DECAY, DP_CP_LEVEL, DP_CP_TONE, DP_CY_DECAY,
    DP_CY_LEVEL, DP_CY_TONE, DP_CY_TUNE, DP_HH_CH_DEC, DP_HH_LEVEL, DP_HH_OH_DEC, DP_HH_TUNE,
    DP_MA_DECAY, DP_MA_LEVEL, DP_MA_TONE, DP_RS_DECAY, DP_RS_LEVEL, DP_RS_TUNE, DP_SD_LEVEL,
    DP_SD_SNAP, DP_SD_TONE, DP_SD_TUNE, DP_TOM_DECAY, DP_TOM_LEVEL, DP_TOM_TUNE, DRUM_PARAM_MAX,
    INST_BD, INST_CB, INST_CP, INST_CY, INST_HH, INST_MA, INST_MT, INST_RS, INST_SD,
};

pub fn is_drum_page(page: u8) -> bool {
    (PAGE_DBD..=PAGE_DHH).contains(&page)
}

/// Drum params behind each page's fader bank, left to right — the module's
/// front-panel knob order.
pub fn drum_page_faders(page: u8) -> &'static [usize] {
    match page {
        PAGE_DBD => &[DP_BD_TUNE, DP_BD_TONE, DP_BD_DECAY, DP_BD_LEVEL],
        PAGE_DSD => &[DP_SD_TUNE, DP_SD_TONE, DP_SD_SNAP, DP_SD_LEVEL],
        PAGE_DTOM => &[DP_TOM_TUNE, DP_TOM_DECAY, DP_TOM_LEVEL],
        PAGE_DRS => &[DP_RS_TUNE, DP_RS_DECAY, DP_RS_LEVEL],
        PAGE_DCP => &[DP_CP_TONE, DP_CP_DECAY, DP_CP_LEVEL],
        PAGE_DMA => &[DP_MA_TONE, DP_MA_DECAY, DP_MA_LEVEL],
        PAGE_DCB => &[DP_CB_TUNE, DP_CB_DECAY, DP_CB_LEVEL],
        PAGE_DCY => &[DP_CY_TUNE, DP_CY_TONE, DP_CY_DECAY, DP_CY_LEVEL],
        PAGE_DHH => &[DP_HH_TUNE, DP_HH_CH_DEC, DP_HH_OH_DEC, DP_HH_LEVEL],
        _ => &[],
    }
}

/// The instrument a page edits — audition pad + OLED header.
pub fn page_inst(page: u8) -> u8 {
    match page {
        PAGE_DSD => INST_SD,
        PAGE_DTOM => INST_MT,
        PAGE_DRS => INST_RS,
        PAGE_DCP => INST_CP,
        PAGE_DMA => INST_MA,
        PAGE_DCB => INST_CB,
        PAGE_DCY => INST_CY,
        PAGE_DHH => INST_HH,
        _ => INST_BD,
    }
}

/// Short OLED label per drum param, module-panel style.
pub fn drum_param_label(param: usize) -> &'static str {
    match param {
        DP_BD_TUNE | DP_SD_TUNE | DP_TOM_TUNE | DP_RS_TUNE | DP_CB_TUNE | DP_CY_TUNE
        | DP_HH_TUNE => "TUNE",
        DP_BD_TONE | DP_SD_TONE | DP_CP_TONE | DP_MA_TONE | DP_CY_TONE => "TONE",
        DP_SD_SNAP => "SNAP",
        DP_HH_CH_DEC => "CH",
        DP_HH_OH_DEC => "OH",
        DP_BD_DECAY | DP_TOM_DECAY | DP_RS_DECAY | DP_CP_DECAY | DP_MA_DECAY | DP_CB_DECAY
        | DP_CY_DECAY => "DECAY",
        _ => "LEVEL",
    }
}

// ============ Param state ============

/// Set a kit param: clamp, store, emit to the synth.
pub fn engine_set_drum_param(s: &mut EngineState, ch: usize, param: usize, value: i16) {
    if ch >= NUM_CHANNELS || param >= NUM_DRUM_PARAMS {
        return;
    }
    let clamped = clamp_drum_param(value);
    s.drum_patches[ch][param] = clamped;
    platform_drum_param(ch as u8, param as u8, clamped);
}

/// Emit every kit param of every drum channel (host calls this on synth
/// (re)load, alongside the synth patch and sampler syncs).
pub fn engine_sync_drum_params(s: &EngineState) {
    for ch in 0..NUM_CHANNELS {
        if !s.is_drum_channel(ch) {
            continue;
        }
        for param in 0..NUM_DRUM_PARAMS {
            platform_drum_param(ch as u8, param as u8, s.drum_patches[ch][param]);
        }
    }
}

/// Drum param currently focused on the page (for the OLED highlight and the
/// right encoder).
pub fn drum_focused_param(s: &EngineState) -> Option<usize> {
    let faders = drum_page_faders(s.sound_page);
    if faders.is_empty() {
        return None;
    }
    let idx = (s.sound_focus[s.sound_page as usize] as usize).min(faders.len() - 1);
    Some(faders[idx])
}

// ============ Input ============

/// Audition the page's instrument. Shift on the hi-hat page fires the open
/// hat so both decays are reachable from the pad.
fn audition(s: &EngineState, ch: usize, mods: u8) {
    let note = if s.sound_page == PAGE_DHH && mods & MOD_SHIFT != 0 {
        46
    } else {
        inst_preview_note(page_inst(s.sound_page)) as i16
    };
    platform_play_preview_note(ch as u8, note, 120);
}

pub fn handle_drum_press(s: &mut EngineState, row: u8, col: u8, mods: u8) {
    let ch = s.current_channel as usize;
    let row = row as usize;
    let col = col as usize;

    // Audition pad: bottom-right corner (free on every page — 4 faders end
    // at column 14)
    if row == VISIBLE_ROWS - 1 && col == VISIBLE_COLS - 1 {
        audition(s, ch, mods);
        return;
    }

    // Fader banks: 3 columns per fader + 1 gap column
    let faders = drum_page_faders(s.sound_page);
    let idx = col / 4;
    if col % 4 == 3 || idx >= faders.len() {
        return;
    }
    s.sound_focus[s.sound_page as usize] = idx as u8;
    let value = ((VISIBLE_ROWS - 1 - row) as i32 * DRUM_PARAM_MAX as i32)
        / (VISIBLE_ROWS as i32 - 1);
    engine_set_drum_param(s, ch, faders[idx], value as i16);
}

pub fn handle_drum_arrow(s: &mut EngineState, dir: u8, mods: u8) {
    if dir != DIR_LEFT && dir != DIR_RIGHT {
        return;
    }
    let ch = s.current_channel as usize;
    let Some(param) = drum_focused_param(s) else {
        return;
    };
    let step = if mods & MOD_SHIFT != 0 { 1 } else { 5 };
    let delta = if dir == DIR_RIGHT { step } else { -step };
    let cur = s.drum_patches[ch][param];
    engine_set_drum_param(s, ch, param, cur + delta);
}

// ============ Rendering ============

pub fn render_drum_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let page = s.sound_page;
    let faders = drum_page_faders(page);
    let focus = (s.sound_focus[page as usize] as usize).min(faders.len().saturating_sub(1));

    for (i, &param) in faders.iter().enumerate() {
        let value = s.drum_patches[ch][param] as i32;
        let lit = ((value * VISIBLE_ROWS as i32 + DRUM_PARAM_MAX as i32 / 2)
            / DRUM_PARAM_MAX as i32) as usize;
        let focused = i == focus;
        let col0 = i * 4;
        for step in 0..lit.max(1) {
            let vr = VISIBLE_ROWS - 1 - step;
            let is_cap = step + 1 == lit.max(1);
            let val = if lit == 0 {
                BTN_COLOR_25
            } else if is_cap {
                BTN_COLOR_100
            } else if focused {
                BTN_COLOR_75
            } else {
                BTN_COLOR_50
            };
            for c in col0..(col0 + 3).min(VISIBLE_COLS) {
                s.button_values[vr][c] = val;
                if focused && is_cap && lit > 0 {
                    s.color_overrides[vr][c] = SOUND_ACCENT;
                }
            }
        }
    }

    // Audition pad
    s.button_values[VISIBLE_ROWS - 1][VISIBLE_COLS - 1] = BTN_COLOR_75;
    s.color_overrides[VISIBLE_ROWS - 1][VISIBLE_COLS - 1] = SOUND_ACCENT;
}
