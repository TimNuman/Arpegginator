// engine_drumsynth.rs — Sound mode on drum channels: the drum-synth pages.
//
// A KIT page picks the channel's engine — the analog 808 model (Tiptop
// Audio 808 module line: BD808, SD808, the toms/congas, RS808, CP808,
// MA808, CB808, CY808, HH808) or the 2-op FM kit — and then one page per
// instrument follows. Every instrument page keeps the Sound-mode fader-bank
// grammar — 3-column faders for the module's front-panel knobs — plus an
// audition pad in the bottom-right corner that fires the instrument's GM
// note (Shift on the hi-hat page auditions the open hat).
//
// The engine owns the kit params per drum channel (drum_patches: both kit
// banks + the selector, UI units) and every change is emitted through
// platform_drum_param to the synth kit (arp3_synth::drums), where empty
// sampler slots fall back to these voices. Each kit keeps its own bank, so
// switching engines never loses knob settings.

use crate::engine_core::*;
use crate::engine_input::{DIR_LEFT, DIR_RIGHT, MOD_SHIFT};
use crate::engine_sound::{
    PAGE_DBD, PAGE_DCB, PAGE_DCP, PAGE_DCY, PAGE_DHH, PAGE_DKIT, PAGE_DMA, PAGE_DRS, PAGE_DSD,
    PAGE_DTOM, SOUND_ACCENT,
};
use crate::platform::{platform_drum_param, platform_play_preview_note};
pub use arp3_synth::drums::NUM_DRUM_PARAMS;
use arp3_synth::drums::{
    clamp_drum_param, drum_param_max, inst_preview_note, DPF_BD_DECAY, DPF_BD_FM, DPF_BD_LEVEL,
    DPF_BD_TUNE, DPF_CB_DECAY, DPF_CB_FM, DPF_CB_LEVEL, DPF_CB_TUNE, DPF_CP_DECAY, DPF_CP_FM,
    DPF_CP_LEVEL, DPF_CY_DECAY, DPF_CY_FM, DPF_CY_LEVEL, DPF_CY_TUNE, DPF_HH_CH_DEC, DPF_HH_FM,
    DPF_HH_LEVEL, DPF_HH_OH_DEC, DPF_MA_DECAY, DPF_MA_LEVEL, DPF_MA_TONE, DPF_RS_DECAY,
    DPF_RS_FM, DPF_RS_LEVEL, DPF_RS_TUNE, DPF_SD_FM, DPF_SD_LEVEL, DPF_SD_SNAP, DPF_SD_TUNE,
    DPF_TOM_DECAY, DPF_TOM_FM, DPF_TOM_LEVEL, DPF_TOM_TUNE, DP_BD_DECAY, DP_BD_LEVEL,
    DP_BD_TONE, DP_BD_TUNE, DP_CB_DECAY, DP_CB_LEVEL, DP_CB_TUNE, DP_CP_DECAY, DP_CP_LEVEL,
    DP_CP_TONE, DP_CY_DECAY, DP_CY_LEVEL, DP_CY_TONE, DP_CY_TUNE, DP_HH_CH_DEC, DP_HH_LEVEL,
    DP_FOLD, DP_HH_OH_DEC, DP_HH_TUNE, DP_KIT, DP_MA_DECAY, DP_MA_LEVEL, DP_MA_TONE, DP_RS_DECAY,
    DP_RS_LEVEL, DP_RS_TUNE, DP_SD_LEVEL, DP_SD_SNAP, DP_SD_TONE, DP_SD_TUNE, DP_TOM_DECAY,
    DP_TOM_LEVEL, DP_TOM_TUNE, INST_BD, INST_CB, INST_CP, INST_CY, INST_HH, INST_MA, INST_MT,
    INST_RS, INST_SD, KIT_FM, NUM_KITS,
};

pub fn is_drum_page(page: u8) -> bool {
    (PAGE_DBD..=PAGE_DKIT).contains(&page)
}

/// The channel's kit engine (KIT_ANALOG / KIT_FM).
pub fn drum_kit(s: &EngineState, ch: usize) -> i16 {
    s.drum_patches[ch][DP_KIT]
}

pub static KIT_LABELS: [&str; NUM_KITS] = ["ANALOG 808", "FM"];

/// Drum params behind each page's fader bank, left to right — the module's
/// front-panel knob order. The FM kit has its own bank.
pub fn drum_page_faders(page: u8, kit: i16) -> &'static [usize] {
    if kit == KIT_FM {
        return match page {
            PAGE_DBD => &[DPF_BD_TUNE, DPF_BD_FM, DPF_BD_DECAY, DPF_BD_LEVEL],
            PAGE_DSD => &[DPF_SD_TUNE, DPF_SD_FM, DPF_SD_SNAP, DPF_SD_LEVEL],
            PAGE_DTOM => &[DPF_TOM_TUNE, DPF_TOM_FM, DPF_TOM_DECAY, DPF_TOM_LEVEL],
            PAGE_DRS => &[DPF_RS_TUNE, DPF_RS_FM, DPF_RS_DECAY, DPF_RS_LEVEL],
            PAGE_DCP => &[DPF_CP_FM, DPF_CP_DECAY, DPF_CP_LEVEL],
            PAGE_DMA => &[DPF_MA_TONE, DPF_MA_DECAY, DPF_MA_LEVEL],
            PAGE_DCB => &[DPF_CB_TUNE, DPF_CB_FM, DPF_CB_DECAY, DPF_CB_LEVEL],
            PAGE_DCY => &[DPF_CY_TUNE, DPF_CY_FM, DPF_CY_DECAY, DPF_CY_LEVEL],
            PAGE_DHH => &[DPF_HH_FM, DPF_HH_CH_DEC, DPF_HH_OH_DEC, DPF_HH_LEVEL],
            _ => &[],
        };
    }
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

/// OLED page name, per kit (the static SOUND_PAGE_LABELS entry is the
/// analog spelling).
pub fn drum_page_label(page: u8, kit: i16) -> &'static str {
    if kit == KIT_FM {
        return match page {
            PAGE_DKIT => "KIT",
            PAGE_DBD => "FM BD",
            PAGE_DSD => "FM SD",
            PAGE_DTOM => "FM TOMS",
            PAGE_DRS => "FM RIM/CLV",
            PAGE_DCP => "FM CLAP",
            PAGE_DMA => "FM MARACAS",
            PAGE_DCB => "FM COWBELL",
            PAGE_DCY => "FM CYMBAL",
            _ => "FM HI-HAT",
        };
    }
    match page {
        PAGE_DKIT => "KIT",
        PAGE_DBD => "BD 808",
        PAGE_DSD => "SD 808",
        PAGE_DTOM => "TOMS",
        PAGE_DRS => "RIM/CLAVE",
        PAGE_DCP => "CLAP",
        PAGE_DMA => "MARACAS",
        PAGE_DCB => "COWBELL",
        PAGE_DCY => "CYMBAL",
        _ => "HI-HAT",
    }
}

/// Short OLED label per drum param, module-panel style.
pub fn drum_param_label(param: usize) -> &'static str {
    match param {
        DP_KIT => "KIT",
        DP_FOLD => "FOLD",
        DP_BD_TUNE | DP_SD_TUNE | DP_TOM_TUNE | DP_RS_TUNE | DP_CB_TUNE | DP_CY_TUNE
        | DP_HH_TUNE | DPF_BD_TUNE | DPF_SD_TUNE | DPF_TOM_TUNE | DPF_RS_TUNE | DPF_CB_TUNE
        | DPF_CY_TUNE => "TUNE",
        DP_BD_TONE | DP_SD_TONE | DP_CP_TONE | DP_MA_TONE | DP_CY_TONE | DPF_MA_TONE => "TONE",
        DPF_BD_FM | DPF_SD_FM | DPF_TOM_FM | DPF_RS_FM | DPF_CP_FM | DPF_CB_FM | DPF_CY_FM
        | DPF_HH_FM => "FM",
        DP_SD_SNAP | DPF_SD_SNAP => "SNAP",
        DP_HH_CH_DEC | DPF_HH_CH_DEC => "CH",
        DP_HH_OH_DEC | DPF_HH_OH_DEC => "OH",
        DP_BD_DECAY | DP_TOM_DECAY | DP_RS_DECAY | DP_CP_DECAY | DP_MA_DECAY | DP_CB_DECAY
        | DP_CY_DECAY | DPF_BD_DECAY | DPF_TOM_DECAY | DPF_RS_DECAY | DPF_CP_DECAY
        | DPF_MA_DECAY | DPF_CB_DECAY | DPF_CY_DECAY => "DECAY",
        _ => "LEVEL",
    }
}

// ============ Param state ============

/// Set a kit param: clamp, store, emit to the synth.
pub fn engine_set_drum_param(s: &mut EngineState, ch: usize, param: usize, value: i16) {
    if ch >= NUM_CHANNELS || param >= NUM_DRUM_PARAMS {
        return;
    }
    let clamped = clamp_drum_param(param, value);
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
    let ch = s.current_channel as usize;
    if s.sound_page == PAGE_DKIT {
        // Focus 0 = the kit selector, 1 = the kit-wide FOLD fader
        return Some(if s.sound_focus[PAGE_DKIT as usize] == 1 { DP_FOLD } else { DP_KIT });
    }
    let faders = drum_page_faders(s.sound_page, drum_kit(s, ch));
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

    // KIT page: bottom row holds one selector cell per engine; the right
    // bank (cols 12-14) is the kit-wide FOLD fader
    if s.sound_page == PAGE_DKIT {
        if (12..15).contains(&col) {
            s.sound_focus[PAGE_DKIT as usize] = 1;
            let value = ((VISIBLE_ROWS - 1 - row) as i32 * 100) / (VISIBLE_ROWS as i32 - 1);
            engine_set_drum_param(s, ch, DP_FOLD, value as i16);
            audition(s, ch, 0);
        } else if row == VISIBLE_ROWS - 1 && col < NUM_KITS {
            s.sound_focus[PAGE_DKIT as usize] = 0;
            engine_set_drum_param(s, ch, DP_KIT, col as i16);
            audition(s, ch, 0);
        }
        return;
    }

    // Fader banks: 3 columns per fader + 1 gap column
    let faders = drum_page_faders(s.sound_page, drum_kit(s, ch));
    let idx = col / 4;
    if col % 4 == 3 || idx >= faders.len() {
        return;
    }
    s.sound_focus[s.sound_page as usize] = idx as u8;
    let param = faders[idx];
    let max = drum_param_max(param) as i32;
    let value = ((VISIBLE_ROWS - 1 - row) as i32 * max) / (VISIBLE_ROWS as i32 - 1);
    engine_set_drum_param(s, ch, param, value as i16);
}

pub fn handle_drum_arrow(s: &mut EngineState, dir: u8, mods: u8) {
    if dir != DIR_LEFT && dir != DIR_RIGHT {
        return;
    }
    let ch = s.current_channel as usize;
    let Some(param) = drum_focused_param(s) else {
        return;
    };
    // Enumerated selector (the kit) steps one option; knobs step 5 (Shift 1)
    let step = if param == DP_KIT || mods & MOD_SHIFT != 0 { 1 } else { 5 };
    let delta = if dir == DIR_RIGHT { step } else { -step };
    let cur = s.drum_patches[ch][param];
    engine_set_drum_param(s, ch, param, cur + delta);
    if param == DP_KIT {
        audition(s, ch, 0);
    }
}

// ============ Rendering ============

/// KIT page trace rows over an 8-column cycle: a clean sine for the analog
/// kit, a modulated (FM-wobbled) cycle for the FM kit.
static KIT_WAVE_ROWS: [[u8; 8]; NUM_KITS] = [
    [3, 1, 0, 1, 3, 5, 6, 5], // sine
    [3, 0, 2, 1, 4, 6, 4, 6], // phase-modulated sine
];

fn render_kit_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let kit = (drum_kit(s, ch) as usize).min(NUM_KITS - 1);
    let rows = &KIT_WAVE_ROWS[kit];
    const TRACE_COLS: usize = 12; // the FOLD fader takes the right bank

    // Waveform trace with dim vertical connectors on jumps (same drawing
    // grammar as the osc pages)
    for c in 0..TRACE_COLS {
        let r = rows[c % 8] as usize;
        s.button_values[r][c] = BTN_COLOR_100;
        if c + 1 < TRACE_COLS {
            let r2 = rows[(c + 1) % 8] as usize;
            let (lo, hi) = if r < r2 { (r, r2) } else { (r2, r) };
            for rr in (lo + 1)..hi {
                if s.button_values[rr][c + 1] == BTN_OFF {
                    s.button_values[rr][c + 1] = BTN_COLOR_25;
                }
            }
        }
    }

    // Bottom row: kit selector strip
    for c in 0..NUM_KITS {
        s.button_values[VISIBLE_ROWS - 1][c] =
            if c == kit { BTN_COLOR_100 } else { BTN_WHITE_25 };
        if c == kit {
            s.color_overrides[VISIBLE_ROWS - 1][c] = SOUND_ACCENT;
        }
    }

    // Kit-wide FOLD fader (cols 12-14), standard fader grammar
    let value = s.drum_patches[ch][DP_FOLD] as i32;
    let lit = ((value * VISIBLE_ROWS as i32 + 50) / 100) as usize;
    let focused = s.sound_focus[PAGE_DKIT as usize] == 1;
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
        for c in 12..15 {
            s.button_values[vr][c] = val;
            if focused && is_cap && lit > 0 {
                s.color_overrides[vr][c] = SOUND_ACCENT;
            }
        }
    }
}

pub fn render_drum_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let page = s.sound_page;
    if page == PAGE_DKIT {
        render_kit_page(s);
    } else {
        let faders = drum_page_faders(page, drum_kit(s, ch));
        let focus = (s.sound_focus[page as usize] as usize).min(faders.len().saturating_sub(1));

        for (i, &param) in faders.iter().enumerate() {
            let value = s.drum_patches[ch][param] as i32;
            let max = drum_param_max(param) as i32;
            let lit = ((value * VISIBLE_ROWS as i32 + max / 2) / max.max(1)) as usize;
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
    }

    // Audition pad
    s.button_values[VISIBLE_ROWS - 1][VISIBLE_COLS - 1] = BTN_COLOR_75;
    s.color_overrides[VISIBLE_ROWS - 1][VISIBLE_COLS - 1] = SOUND_ACCENT;
}
