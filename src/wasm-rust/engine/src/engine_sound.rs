// engine_sound.rs — Sound mode: synth patch editing on the grid.
//
// A third mode next to Pattern and Modify, entered from the Ctrl overlay
// (bottom row, col 2). Reuses the device's existing grammar: the left encoder
// (U/D arrows) cycles pages the way Modify cycles sub-modes, the right
// encoder (L/R) edits the focused value, and the grid is always directly
// pressable — every page is either a chooser or a fader bank.
//
// Patches live in EngineState per channel (in UI units, see
// arp3_synth::patch) and every change is emitted through
// platform_sound_param, which reaches the synth (AudioWorklet on web, direct
// call on Teensy).

use crate::engine_core::*;
use crate::engine_input::{DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP, MOD_SHIFT};
use crate::platform::platform_sound_param;
use arp3_synth::patch::{
    self, clamp_param, ALGO_CARRIERS, ALGO_ROUTES, ENGINE_FM, NUM_ENGINE_TYPES, NUM_PARAMS,
    NUM_PRESETS, NUM_WAVES, PARAM_MAX, PRESETS,
};

// ============ Pages ============

pub const PAGE_PRESET: u8 = 0;
pub const PAGE_OSC1: u8 = 1;
pub const PAGE_OSC2: u8 = 2;
pub const PAGE_AMP: u8 = 3;
pub const PAGE_ENV: u8 = 4;
pub const PAGE_FILT: u8 = 5;
pub const PAGE_FX: u8 = 6;
// FM-engine pages
pub const PAGE_ALGO: u8 = 7;
pub const PAGE_OP: u8 = 8;
pub const PAGE_FM: u8 = 9;
pub const NUM_SOUND_PAGES: usize = 10;

pub static SOUND_PAGE_LABELS: [&str; NUM_SOUND_PAGES] =
    ["PRESET", "OSC 1", "OSC 2", "AMP", "ENV", "FILT", "FX", "ALGO", "OP", "FM"];

/// Page cycle per engine — the left encoder walks this list. The synthesis
/// pages differ; preset/amp/env/filter/fx are shared.
static SUBTR_PAGES: [u8; 7] =
    [PAGE_PRESET, PAGE_OSC1, PAGE_OSC2, PAGE_AMP, PAGE_ENV, PAGE_FILT, PAGE_FX];
static FM_PAGES: [u8; 8] =
    [PAGE_PRESET, PAGE_ALGO, PAGE_OP, PAGE_FM, PAGE_AMP, PAGE_ENV, PAGE_FILT, PAGE_FX];

pub fn engine_pages(engine: i16) -> &'static [u8] {
    if engine == ENGINE_FM { &FM_PAGES } else { &SUBTR_PAGES }
}

fn current_engine(s: &EngineState) -> i16 {
    s.sound_patches[s.current_channel as usize][patch::P_ENGINE]
}

pub static ENGINE_TYPE_LABELS: [&str; NUM_ENGINE_TYPES] = ["SUBTR", "FM", "ADD", "WAVE"];
pub static WAVE_LABELS: [&str; NUM_WAVES] = ["SAW", "SQR", "TRI", "SIN", "PLS", "NSE"];

/// Fader-bank pages: the params behind each fader, left to right. AMP swaps
/// the (subtractive-only) osc mix out when the engine is FM.
pub fn page_faders(engine: i16, page: u8) -> &'static [usize] {
    match page {
        PAGE_AMP if engine == ENGINE_FM => {
            &[patch::P_VOLUME, patch::P_SUB_LEVEL, patch::P_GLIDE]
        }
        PAGE_AMP => &[patch::P_VOLUME, patch::P_OSC_MIX, patch::P_SUB_LEVEL, patch::P_GLIDE],
        PAGE_ENV => &[patch::P_ATTACK, patch::P_DECAY, patch::P_SUSTAIN, patch::P_RELEASE],
        PAGE_FILT => &[patch::P_CUTOFF, patch::P_RESO, patch::P_FENV, patch::P_KEYTRACK],
        PAGE_FX => &[patch::P_DRIVE],
        PAGE_OP => &[patch::P_RATIO1, patch::P_RATIO2, patch::P_RATIO3, patch::P_RATIO4],
        PAGE_FM => &[patch::P_FM_AMT, patch::P_FB, patch::P_MENV, patch::P_DETUNE],
        _ => &[],
    }
}

/// Short OLED label per param.
pub fn param_label(param: usize) -> &'static str {
    match param {
        patch::P_ENGINE => "TYPE",
        patch::P_WAVE1 | patch::P_WAVE2 => "WAVE",
        patch::P_SUB_LEVEL => "SUB",
        patch::P_VOLUME => "VOL",
        patch::P_OSC_MIX => "MIX",
        patch::P_DETUNE => "DET",
        patch::P_GLIDE => "GLIDE",
        patch::P_ATTACK => "A",
        patch::P_DECAY => "D",
        patch::P_SUSTAIN => "S",
        patch::P_RELEASE => "R",
        patch::P_CUTOFF => "CUT",
        patch::P_RESO => "RES",
        patch::P_FENV => "ENV",
        patch::P_KEYTRACK => "KEY",
        patch::P_DRIVE => "DRIVE",
        patch::P_ALGO => "ALGO",
        patch::P_RATIO1 => "R1",
        patch::P_RATIO2 => "R2",
        patch::P_RATIO3 => "R3",
        patch::P_RATIO4 => "R4",
        patch::P_FM_AMT => "FM",
        patch::P_FB => "FB",
        patch::P_MENV => "MENV",
        _ => "?",
    }
}

/// Format a param value for the OLED, using the same mappings the synth
/// applies, so the screen shows what the DSP does.
pub fn format_param_value(param: usize, value: i16) -> FmtBuf<12> {
    use core::fmt::Write;
    let mut buf = FmtBuf::<12>::new();
    let seconds = match param {
        patch::P_ATTACK => Some(patch::attack_s(value)),
        patch::P_DECAY | patch::P_RELEASE => Some(patch::decay_s(value)),
        patch::P_GLIDE => Some(patch::glide_s(value)),
        _ => None,
    };
    match param {
        patch::P_ENGINE => buf.push_str(ENGINE_TYPE_LABELS[(value as usize).min(NUM_ENGINE_TYPES - 1)]),
        patch::P_WAVE1 | patch::P_WAVE2 => buf.push_str(WAVE_LABELS[(value as usize).min(NUM_WAVES - 1)]),
        patch::P_DETUNE => { let _ = write!(buf, "{}CT", value); }
        patch::P_ALGO => { let _ = write!(buf, "{}", value + 1); }
        patch::P_RATIO1 | patch::P_RATIO2 | patch::P_RATIO3 | patch::P_RATIO4 => {
            if value <= 0 { buf.push_str("X.5") } else { let _ = write!(buf, "X{}", value); }
        }
        patch::P_CUTOFF => {
            let hz = patch::cutoff_hz(value);
            if hz >= 1000.0 {
                let _ = write!(buf, "{}.{}K", (hz / 1000.0) as i32, ((hz / 100.0) as i32) % 10);
            } else {
                let _ = write!(buf, "{}HZ", hz as i32);
            }
        }
        _ if seconds.is_some() => {
            let s = seconds.unwrap();
            if s >= 1.0 {
                let _ = write!(buf, "{}.{}S", s as i32, ((s * 10.0) as i32) % 10);
            } else {
                let _ = write!(buf, "{}MS", (s * 1000.0) as i32);
            }
        }
        _ => { let _ = write!(buf, "{}%", value); }
    }
    buf
}

// ============ Param state ============

/// Set one patch param on a channel: clamp, store, emit to the synth, and
/// flag the channel's patch as deviating from its preset.
pub fn engine_set_sound_param(s: &mut EngineState, ch: usize, param: usize, value: i16) {
    if ch >= NUM_CHANNELS || param >= NUM_PARAMS {
        return;
    }
    let clamped = clamp_param(param, value);
    if s.sound_patches[ch][param] != clamped {
        s.sound_edited[ch] = 1;
    }
    s.sound_patches[ch][param] = clamped;
    platform_sound_param(ch as u8, param as u8, clamped);
}

/// Load a factory preset into a channel: copy values, emit them all to the
/// synth, and clear the edited flag. Also used by the reset cell to restore
/// the current preset over local edits.
pub fn engine_load_sound_preset(s: &mut EngineState, ch: usize, preset: usize) {
    if ch >= NUM_CHANNELS || preset >= NUM_PRESETS {
        return;
    }
    s.sound_patches[ch] = PRESETS[preset].values;
    s.sound_presets[ch] = preset as u8;
    s.sound_edited[ch] = 0;
    for param in 0..NUM_PARAMS {
        platform_sound_param(ch as u8, param as u8, s.sound_patches[ch][param]);
    }
    // The preset may switch engines; if the current page doesn't exist for
    // the new engine, fall back to the preset page
    let engine = s.sound_patches[ch][patch::P_ENGINE];
    if !engine_pages(engine).contains(&s.sound_page) {
        s.sound_page = PAGE_PRESET;
    }
}

/// Emit every param of every melodic channel — called by the host once the
/// synth is ready so it starts from the engine's state.
pub fn engine_sync_sound_params(s: &EngineState) {
    for ch in 0..NUM_CHANNELS {
        if s.is_drum_channel(ch) {
            continue;
        }
        for param in 0..NUM_PARAMS {
            platform_sound_param(ch as u8, param as u8, s.sound_patches[ch][param]);
        }
    }
}

/// Which param a page's chooser edits (None for the preset and fader pages).
fn chooser_param(page: u8) -> Option<usize> {
    match page {
        PAGE_OSC1 => Some(patch::P_WAVE1),
        PAGE_OSC2 => Some(patch::P_WAVE2),
        PAGE_ALGO => Some(patch::P_ALGO),
        _ => None,
    }
}

/// The param the right encoder edits on the current page.
pub fn focused_param(s: &EngineState) -> Option<usize> {
    if let Some(p) = chooser_param(s.sound_page) {
        return Some(p);
    }
    let faders = page_faders(current_engine(s), s.sound_page);
    if faders.is_empty() {
        return None;
    }
    let idx = (s.sound_focus[s.sound_page as usize] as usize).min(faders.len() - 1);
    Some(faders[idx])
}

// ============ Input ============

fn step_param(s: &mut EngineState, param: usize, delta: i16) {
    let ch = s.current_channel as usize;
    let cur = s.sound_patches[ch][param];
    engine_set_sound_param(s, ch, param, cur + delta);
}

/// Encoder step size: enumerated/small-range params (waves, algos, ratios)
/// move one option, percent params move in coarse steps (Shift = fine).
fn encoder_step(param: usize, fine: bool) -> i16 {
    if PARAM_MAX[param] <= 15 || fine { 1 } else { 5 }
}

pub fn handle_arrow_sound(s: &mut EngineState, dir: u8, mods: u8) {
    let shift = (mods & MOD_SHIFT) != 0;

    match dir {
        // Left encoder: cycle the current engine's page list
        DIR_UP | DIR_DOWN => {
            let pages = engine_pages(current_engine(s));
            let idx = pages.iter().position(|&pg| pg == s.sound_page).unwrap_or(0);
            let n = pages.len();
            let next = if dir == DIR_UP { (idx + 1) % n } else { (idx + n - 1) % n };
            s.sound_page = pages[next];
        }
        // Right encoder: edit the focused value
        DIR_LEFT | DIR_RIGHT => {
            // Preset page: step through presets, loading as you go
            if s.sound_page == PAGE_PRESET {
                let ch = s.current_channel as usize;
                if !s.is_drum_channel(ch) {
                    let cur = s.sound_presets[ch] as usize;
                    let n = NUM_PRESETS;
                    let next = if dir == DIR_RIGHT { (cur + 1) % n } else { (cur + n - 1) % n };
                    engine_load_sound_preset(s, ch, next);
                }
                return;
            }
            // On the Osc 2 page, Shift+L/R nudges detune instead (fine)
            let param = if s.sound_page == PAGE_OSC2 && shift {
                Some(patch::P_DETUNE)
            } else {
                focused_param(s)
            };
            if let Some(param) = param {
                let step = encoder_step(param, shift);
                let delta = if dir == DIR_RIGHT { step } else { -step };
                step_param(s, param, delta);
            }
        }
        _ => {}
    }
}

pub fn handle_sound_press(s: &mut EngineState, row: u8, col: u8, _mods: u8) {
    let ch = s.current_channel as usize;
    if s.is_drum_channel(ch) {
        return;
    }
    let page = s.sound_page;
    let row = row as usize;
    let col = col as usize;

    // Preset page: cells select presets; the bottom-right cell resets local
    // edits back to the selected preset
    if page == PAGE_PRESET {
        if row == VISIBLE_ROWS - 1 && col == VISIBLE_COLS - 1 {
            if s.sound_edited[ch] != 0 {
                engine_load_sound_preset(s, ch, s.sound_presets[ch] as usize);
            }
            return;
        }
        let idx = row * VISIBLE_COLS + col;
        if idx < NUM_PRESETS {
            engine_load_sound_preset(s, ch, idx);
        }
        return;
    }
    if let Some(chooser) = chooser_param(page) {
        // Bottom row is the option selector strip (waves or algorithms)
        let options = (PARAM_MAX[chooser] as usize + 1).min(VISIBLE_COLS);
        if row == VISIBLE_ROWS - 1 && col < options {
            engine_set_sound_param(s, ch, chooser, col as i16);
        }
        return;
    }

    // Fader banks: 3 columns per fader + 1 gap column
    let faders = page_faders(current_engine(s), page);
    let fader_idx = col / 4;
    if col % 4 == 3 || fader_idx >= faders.len() {
        return;
    }
    // Pressing a fader sets its height AND focuses it for the encoder
    s.sound_focus[page as usize] = fader_idx as u8;
    let value = ((VISIBLE_ROWS - 1 - row) as i16) * 100 / (VISIBLE_ROWS as i16 - 1);
    engine_set_sound_param(s, ch, faders[fader_idx], value);
}

// ============ Grid rendering ============

/// Amber accent for Sound mode (focus caps, the SND mode button).
pub const SOUND_ACCENT: u32 = 0xF0A63C;

/// Per-shape waveform drawings for the osc pages: LED row (0 = top .. 6)
/// per column over an 8-column cycle, drawn twice across the grid.
static WAVE_ROWS: [[u8; 8]; NUM_WAVES] = [
    [6, 5, 4, 3, 2, 1, 0, 6], // saw: ramp up, drop
    [1, 1, 1, 1, 5, 5, 5, 5], // square
    [6, 4, 2, 0, 2, 4, 6, 6], // triangle
    [3, 1, 0, 1, 3, 5, 6, 5], // sine
    [1, 1, 5, 5, 5, 5, 5, 5], // pulse (25% duty)
    [3, 0, 5, 2, 6, 1, 4, 3], // noise: jitter
];

fn render_preset_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let selected = s.sound_presets[ch] as usize;
    let edited = s.sound_edited[ch] != 0;

    for idx in 0..NUM_PRESETS {
        let (r, c) = (idx / VISIBLE_COLS, idx % VISIBLE_COLS);
        if r >= VISIBLE_ROWS - 1 {
            break; // last row is reserved for the reset cell
        }
        if idx == selected {
            s.button_values[r][c] = BTN_COLOR_100;
            if edited {
                // Amber selected cell: this preset has local edits
                s.color_overrides[r][c] = SOUND_ACCENT;
            }
        } else {
            s.button_values[r][c] = BTN_WHITE_25;
        }
    }

    // Reset cell (bottom-right): appears only when there's something to reset
    if edited {
        s.button_values[VISIBLE_ROWS - 1][VISIBLE_COLS - 1] = BTN_COLOR_100;
        s.color_overrides[VISIBLE_ROWS - 1][VISIBLE_COLS - 1] = SOUND_ACCENT;
    }
}

fn render_osc_page(s: &mut EngineState, wave_param: usize) {
    let ch = s.current_channel as usize;
    let wave = s.sound_patches[ch][wave_param] as usize % NUM_WAVES;
    let rows = &WAVE_ROWS[wave];

    // Waveform trace with dim vertical connectors on jumps
    for c in 0..VISIBLE_COLS {
        let r = rows[c % 8] as usize;
        s.button_values[r][c] = BTN_COLOR_100;
        if c + 1 < VISIBLE_COLS {
            let r2 = rows[(c + 1) % 8] as usize;
            let (lo, hi) = if r < r2 { (r, r2) } else { (r2, r) };
            for rr in (lo + 1)..hi {
                if s.button_values[rr][c + 1] == BTN_OFF {
                    s.button_values[rr][c + 1] = BTN_COLOR_25;
                }
            }
        }
    }

    // Bottom row: shape selector strip
    for c in 0..NUM_WAVES {
        s.button_values[VISIBLE_ROWS - 1][c] =
            if c == wave { BTN_COLOR_100 } else { BTN_WHITE_25 };
    }
}

fn render_fader_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let page = s.sound_page;
    let faders = page_faders(current_engine(s), page);
    let focus = (s.sound_focus[page as usize] as usize).min(faders.len().saturating_sub(1));

    for (i, &param) in faders.iter().enumerate() {
        let value = s.sound_patches[ch][param] as i32;
        let max = PARAM_MAX[param] as i32;
        let lit = ((value * VISIBLE_ROWS as i32 + max / 2) / max.max(1)) as usize;
        let focused = i == focus;
        let col0 = i * 4;

        for k in 0..lit.max(1) {
            let vr = VISIBLE_ROWS - 1 - k;
            let is_cap = k + 1 == lit.max(1);
            let val = if lit == 0 {
                BTN_COLOR_25 // empty fader: dim base cell as position marker
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

/// FM algorithm diagram: draw the 4 operators as blocks positioned by their
/// depth in the modulation graph (carriers on the bottom row, modulators
/// stacked above what they feed), with dim connector cells between. Bottom
/// row is the 8-algorithm selector strip.
fn render_algo_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let algo = (s.sound_patches[ch][patch::P_ALGO] as usize).min(7);
    let routes = &ALGO_ROUTES[algo];
    let carriers = ALGO_CARRIERS[algo];

    // Depth of each op above the carrier row: carriers sit at 0, an op sits
    // one level above the deepest op it modulates. Routing is strictly
    // ascending (op i only feeds higher ops), so iterate targets descending.
    let mut level = [0usize; 4];
    for op in (0..4).rev() {
        let mut max_target = None;
        for target in (op + 1)..4 {
            if routes[target] & (1 << op) != 0 {
                max_target = Some(level[target].max(max_target.unwrap_or(0)));
            }
        }
        if let Some(t) = max_target {
            level[op] = t + 1;
        }
    }

    // Column assignment: spread the ops on each level across the grid
    let mut col_of = [0usize; 4];
    for lv in 0..4 {
        let ops: [bool; 4] = core::array::from_fn(|op| level[op] == lv);
        let n = ops.iter().filter(|&&b| b).count();
        if n == 0 {
            continue;
        }
        let mut placed = 0;
        for op in 0..4 {
            if ops[op] {
                col_of[op] = (VISIBLE_COLS * (placed + 1)) / (n + 1);
                placed += 1;
            }
        }
    }

    for op in 0..4 {
        let vr = 5 - (level[op] * 2).min(5);
        let c = col_of[op].clamp(1, VISIBLE_COLS - 1);
        let is_carrier = carriers & (1 << op) != 0;
        let val = if is_carrier { BTN_COLOR_100 } else { BTN_COLOR_50 };
        s.button_values[vr][c - 1] = val;
        s.button_values[vr][c] = val;
        // Feedback op (op 1) gets the amber accent when feedback is active
        if op == 0 && s.sound_patches[ch][patch::P_FB] > 0 {
            s.color_overrides[vr][c - 1] = SOUND_ACCENT;
            s.color_overrides[vr][c] = SOUND_ACCENT;
        }
        // Connector down to each op this one modulates
        for target in (op + 1)..4 {
            if routes[target] & (1 << op) != 0 {
                let tr = 5 - (level[target] * 2).min(5);
                let tc = col_of[target].clamp(1, VISIBLE_COLS - 1);
                let (lo, hi) = if vr < tr { (vr, tr) } else { (tr, vr) };
                for rr in (lo + 1)..hi {
                    let cc = if rr == lo + 1 { c } else { tc };
                    if s.button_values[rr][cc - 1] == BTN_OFF {
                        s.button_values[rr][cc - 1] = BTN_COLOR_25;
                    }
                }
            }
        }
    }

    // Bottom row: algorithm selector strip
    for c in 0..8 {
        s.button_values[VISIBLE_ROWS - 1][c] =
            if c == algo { BTN_COLOR_100 } else { BTN_WHITE_25 };
    }
}

/// Render the Sound-mode grid. Returns false when the current channel is a
/// drum channel — the caller falls back to pattern mode (drum synthesis
/// isn't a thing yet).
pub fn render_sound_mode(s: &mut EngineState) -> bool {
    let ch = s.current_channel as usize;
    if s.is_drum_channel(ch) {
        return false;
    }

    match s.sound_page {
        PAGE_PRESET => render_preset_page(s),
        PAGE_OSC1 => render_osc_page(s, patch::P_WAVE1),
        PAGE_OSC2 => render_osc_page(s, patch::P_WAVE2),
        PAGE_ALGO => render_algo_page(s),
        _ => render_fader_page(s),
    }
    true
}
