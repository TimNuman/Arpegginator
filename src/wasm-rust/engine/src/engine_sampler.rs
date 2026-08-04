// engine_sampler.rs — Sound mode on drum channels: the sampler UI.
//
// Five pages (SLOT / REC / TRIM / PLAY / MOD) following the Sound-mode
// grammar. The engine owns the UI state (selected slot, per-slot params,
// waveform previews) and the host owns the audio: sample memory lives with
// the synth, recording lives with the platform (web mic today, codec line-in
// later). The host pushes 16-bucket waveform previews and recorder state
// into engine buffers; the engine emits slot-param changes and REC presses
// through the platform layer.
//
// Red appears here with exactly one meaning: recording.

use crate::engine_core::*;
use crate::engine_input::{DIR_LEFT, DIR_RIGHT, MOD_SHIFT};
use crate::engine_sound::{PAGE_SMOD, PAGE_SPLAY, PAGE_SREC, PAGE_SSLOT, PAGE_STRIM, SOUND_ACCENT};
use crate::platform::{platform_play_preview_note, platform_rec_control, platform_sample_param};
pub use arp3_synth::sampler::{NUM_SLOTS, NUM_SLOT_PARAMS};
use arp3_synth::sampler::{
    clamp_slot_param, MODE_GATE, MODE_LOOP, MODE_ONE, SP_CUT,
    SP_DECAY, SP_DRIVE, SP_LEVEL, SP_MODE, SP_PITCH, SP_RES, SP_SPEED, SP_TAPE, SP_TRIM_END,
    SP_TRIM_START,
};

/// Red LED color for everything recording-related.
pub const REC_COLOR: u32 = 0xF05A4C;

pub const REC_IDLE: u8 = 0;
pub const REC_ARMED: u8 = 1;
pub const REC_RECORDING: u8 = 2;

/// Waveform previews are 16 amplitude buckets, one per grid column, 0..255.
pub const PREVIEW_BUCKETS: usize = 16;

// ============ Param state ============

/// Set a slot param: clamp, store, emit to the synth.
pub fn engine_set_sampler_param(
    s: &mut EngineState,
    ch: usize,
    slot: usize,
    param: usize,
    value: i16,
) {
    if ch >= NUM_CHANNELS || slot >= NUM_SLOTS || param >= NUM_SLOT_PARAMS {
        return;
    }
    let mut clamped = clamp_slot_param(param, value);
    // Trim handles must not cross — keep at least a 1% window so the cut
    // never inverts (render and DSP both assume start < end)
    const TRIM_GAP: i16 = 10;
    if param == SP_TRIM_START {
        clamped = clamped.min(s.sampler_params[ch][slot][SP_TRIM_END] - TRIM_GAP).max(0);
    } else if param == SP_TRIM_END {
        clamped = clamped.max(s.sampler_params[ch][slot][SP_TRIM_START] + TRIM_GAP).min(1000);
    }
    s.sampler_params[ch][slot][param] = clamped;
    platform_sample_param(ch as u8, slot as u8, param as u8, clamped);
}

/// Emit every slot param of every drum channel (host calls this on synth
/// (re)load, alongside the synth patch sync).
pub fn engine_sync_sampler_params(s: &EngineState) {
    for ch in 0..NUM_CHANNELS {
        if !s.is_drum_channel(ch) {
            continue;
        }
        for slot in 0..NUM_SLOTS {
            for param in 0..NUM_SLOT_PARAMS {
                platform_sample_param(
                    ch as u8,
                    slot as u8,
                    param as u8,
                    s.sampler_params[ch][slot][param],
                );
            }
        }
    }
}

fn selected_slot(s: &EngineState, ch: usize) -> usize {
    (s.sampler_slot[ch] as usize).min(NUM_SLOTS - 1)
}

/// Preview a slot audibly by emitting its GM note as a preview hit.
fn preview_slot(s: &EngineState, ch: usize, slot: usize) {
    let _ = s;
    platform_play_preview_note(ch as u8, 35 + slot as i16, 120);
}

/// TUNE action: snap the slot's PITCH so its detected key lands on the
/// current scale root (nearest direction, within ±6 semitones).
fn tune_slot_to_root(s: &mut EngineState, ch: usize, slot: usize) {
    let key = s.sampler_keys[ch][slot];
    if key < 0 {
        return;
    }
    let key_pc = (key % 12) as i16;
    let root_pc = (s.scale_root % 12) as i16;
    let mut offset = root_pc - key_pc;
    if offset > 6 {
        offset -= 12;
    }
    if offset < -6 {
        offset += 12;
    }
    engine_set_sampler_param(s, ch, slot, SP_PITCH, 24 + offset);
}

// ============ Input ============

pub fn handle_sampler_press(s: &mut EngineState, row: u8, col: u8, mods: u8) {
    let ch = s.current_channel as usize;
    let row = row as usize;
    let col = col as usize;
    let slot = selected_slot(s, ch);

    match s.sound_page {
        PAGE_SSLOT => {
            // Rows are slots (bottom row = first slot of the window, like the
            // drum lanes in pattern mode): press selects + auditions the
            // row's slot; Shift+press TUNEs a pitched slot to the scale root.
            let base = (slot / VISIBLE_ROWS) * VISIBLE_ROWS;
            let sl = base + (VISIBLE_ROWS - 1 - row);
            let _ = col;
            if mods & MOD_SHIFT != 0 {
                tune_slot_to_root(s, ch, sl);
            } else {
                s.sampler_slot[ch] = sl as u8;
                if s.sampler_loaded[ch][sl] != 0 {
                    preview_slot(s, ch, sl);
                }
            }
        }
        PAGE_SREC => {
            if row == VISIBLE_ROWS - 1 && col == 0 {
                platform_rec_control(ch as u8, 1);
            }
        }
        PAGE_STRIM => {
            if row == VISIBLE_ROWS - 1 {
                // Handle track: the nearest handle jumps to the pressed step
                let value = (col as i16 * 1000) / (VISIBLE_COLS as i16 - 1);
                let start = s.sampler_params[ch][slot][SP_TRIM_START];
                let end = s.sampler_params[ch][slot][SP_TRIM_END];
                let param = if (value - start).abs() <= (value - end).abs() {
                    SP_TRIM_START
                } else {
                    SP_TRIM_END
                };
                engine_set_sampler_param(s, ch, slot, param, value);
                preview_slot(s, ch, slot);
            }
        }
        PAGE_SPLAY => {
            // Mode cells: ONE / LOOP / GATE at cols 12-14, TAPE toggle at 15
            if row == VISIBLE_ROWS - 1 && col >= 12 {
                if col <= 14 {
                    engine_set_sampler_param(s, ch, slot, SP_MODE, (col - 12) as i16);
                } else {
                    let tape = s.sampler_params[ch][slot][SP_TAPE];
                    engine_set_sampler_param(s, ch, slot, SP_TAPE, 1 - tape);
                }
                return;
            }
            sampler_fader_press(s, ch, slot, row, col);
        }
        PAGE_SMOD => sampler_fader_press(s, ch, slot, row, col),
        _ => {}
    }
}

/// Slot param currently focused on a fader page (for the OLED highlight).
pub fn sampler_focused_param(s: &EngineState) -> Option<usize> {
    let faders = sampler_page_faders(s.sound_page);
    if faders.is_empty() {
        return None;
    }
    let idx = (s.sound_focus[s.sound_page as usize] as usize).min(faders.len() - 1);
    Some(faders[idx])
}

/// Slot params behind the fader banks, left to right.
pub fn sampler_page_faders(page: u8) -> &'static [usize] {
    match page {
        PAGE_SPLAY => &[SP_SPEED, SP_PITCH, SP_LEVEL, SP_DECAY],
        PAGE_SMOD => &[SP_CUT, SP_RES, SP_DRIVE],
        _ => &[],
    }
}

fn sampler_fader_press(s: &mut EngineState, ch: usize, slot: usize, row: usize, col: usize) {
    let faders = sampler_page_faders(s.sound_page);
    let idx = col / 4;
    if col % 4 == 3 || idx >= faders.len() {
        return;
    }
    s.sound_focus[s.sound_page as usize] = idx as u8;
    let param = faders[idx];
    let max = arp3_synth::sampler::SLOT_PARAM_MAX[param] as i32;
    let value = ((VISIBLE_ROWS - 1 - row) as i32 * max) / (VISIBLE_ROWS as i32 - 1);
    engine_set_sampler_param(s, ch, slot, param, value as i16);
}

pub fn handle_sampler_arrow(s: &mut EngineState, dir: u8, mods: u8) {
    let ch = s.current_channel as usize;
    let slot = selected_slot(s, ch);
    let shift = (mods & MOD_SHIFT) != 0;
    let delta: i16 = if dir == DIR_RIGHT { 1 } else { -1 };
    if dir != DIR_LEFT && dir != DIR_RIGHT {
        return;
    }

    match s.sound_page {
        PAGE_SSLOT => {
            let next = (slot as i16 + delta).rem_euclid(NUM_SLOTS as i16) as u8;
            s.sampler_slot[ch] = next;
            if s.sampler_loaded[ch][next as usize] != 0 {
                preview_slot(s, ch, next as usize);
            }
        }
        PAGE_STRIM => {
            // Bare = start handle, Shift = end handle; both replay the cut
            let (param, step) = if shift { (SP_TRIM_END, 5) } else { (SP_TRIM_START, 5) };
            let cur = s.sampler_params[ch][slot][param];
            engine_set_sampler_param(s, ch, slot, param, cur + delta * step);
            preview_slot(s, ch, slot);
        }
        PAGE_SPLAY | PAGE_SMOD => {
            let faders = sampler_page_faders(s.sound_page);
            if faders.is_empty() {
                return;
            }
            let idx = (s.sound_focus[s.sound_page as usize] as usize).min(faders.len() - 1);
            let param = faders[idx];
            let step = if shift { 1 } else { 5 };
            let cur = s.sampler_params[ch][slot][param];
            engine_set_sampler_param(s, ch, slot, param, cur + delta * step);
        }
        _ => {}
    }
}

// ============ Rendering ============

/// Mirror a 0..255 amplitude bucket around the center row (3): returns the
/// half-height in rows, 0..3.
fn bucket_half_height(v: u8) -> usize {
    (v as usize * 4 / 256).min(3)
}

fn draw_mirrored_waveform(s: &mut EngineState, buckets: [u8; PREVIEW_BUCKETS], brightness: u16) {
    for (c, &v) in buckets.iter().enumerate() {
        let hh = bucket_half_height(v);
        for r in (3 - hh)..=(3 + hh) {
            s.button_values[r][c] = brightness;
        }
    }
}

/// Bucket amplitude → LED brightness for a loaded slot row. Quiet buckets
/// stay faintly lit so the row still reads as a lane.
fn bucket_brightness(v: u8) -> u16 {
    match v {
        0..=31 => BTN_COLOR_25,
        32..=95 => BTN_COLOR_50,
        96..=175 => BTN_COLOR_75,
        _ => BTN_COLOR_100,
    }
}

/// Rows are slots, mirroring the drum lanes in pattern mode: the bottom row
/// is the window's first slot and each loaded row draws its slot's 16-bucket
/// waveform across the columns. With 16 slots and 8 rows the page shows the
/// window of 8 the selected slot sits in; stepping the encoder past the edge
/// flips the window. The selected slot's row carries the amber accent.
fn render_slot_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let slot = selected_slot(s, ch);
    let base = (slot / VISIBLE_ROWS) * VISIBLE_ROWS;

    for r in 0..VISIBLE_ROWS {
        let sl = base + (VISIBLE_ROWS - 1 - r);
        let selected = sl == slot;
        let loaded = s.sampler_loaded[ch][sl] != 0;
        for c in 0..VISIBLE_COLS {
            s.button_values[r][c] = if loaded {
                bucket_brightness(s.sampler_previews[ch][sl][c])
            } else if selected {
                BTN_COLOR_25
            } else {
                FLAG_DIMMED
            };
            if selected {
                s.color_overrides[r][c] = SOUND_ACCENT;
            }
        }
    }
}

fn render_rec_page(s: &mut EngineState) {
    // Live input waveform, dimmer than sample views (it's a monitor)
    draw_mirrored_waveform(s, s.rec_waveform, BTN_COLOR_50);

    // REC cell: dim red idle, pulsing red armed, solid red recording
    let (val, pulsing) = match s.rec_state {
        REC_RECORDING => (BTN_COLOR_100, false),
        REC_ARMED => (BTN_COLOR_100, true),
        _ => (BTN_COLOR_25, false),
    };
    let cell = &mut s.button_values[VISIBLE_ROWS - 1][0];
    *cell = val;
    if pulsing {
        *cell |= FLAG_LOOP_BOUNDARY_PULSING;
        s.pulse_active = 1;
    }
    s.color_overrides[VISIBLE_ROWS - 1][0] = REC_COLOR;

    // Input meter on the right of the bottom row: teal → amber → red
    let lit = (s.rec_level as usize * 6) / 256;
    for i in 0..5 {
        let c = VISIBLE_COLS - 5 + i;
        if i < lit {
            s.button_values[VISIBLE_ROWS - 1][c] = BTN_COLOR_100;
            if i >= 4 {
                s.color_overrides[VISIBLE_ROWS - 1][c] = REC_COLOR; // clipping
            } else if i >= 3 {
                s.color_overrides[VISIBLE_ROWS - 1][c] = SOUND_ACCENT;
            }
        } else {
            s.button_values[VISIBLE_ROWS - 1][c] = FLAG_DIMMED;
        }
    }
}

fn render_trim_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let slot = selected_slot(s, ch);
    let start = s.sampler_params[ch][slot][SP_TRIM_START] as usize;
    let end = s.sampler_params[ch][slot][SP_TRIM_END] as usize;
    let scol = (start * (VISIBLE_COLS - 1) + 500) / 1000;
    let ecol = (end * (VISIBLE_COLS - 1) + 500) / 1000;

    // Waveform: bright inside the cut, dim outside; amber handle columns
    let buckets = s.sampler_previews[ch][slot];
    for (c, &v) in buckets.iter().enumerate() {
        let hh = bucket_half_height(v);
        let inside = c >= scol && c <= ecol;
        for r in (3 - hh)..=(3 + hh) {
            s.button_values[r][c] = if inside { BTN_COLOR_100 } else { BTN_COLOR_25 };
        }
    }
    for r in 0..(VISIBLE_ROWS - 1) {
        for handle in [scol, ecol] {
            s.button_values[r][handle] = BTN_COLOR_100;
            s.color_overrides[r][handle] = SOUND_ACCENT;
        }
    }

    // Handle track
    for c in 0..VISIBLE_COLS {
        let v = &mut s.button_values[VISIBLE_ROWS - 1][c];
        if c == scol || c == ecol {
            *v = BTN_COLOR_100;
            s.color_overrides[VISIBLE_ROWS - 1][c] = SOUND_ACCENT;
        } else if c > scol && c < ecol {
            *v = BTN_WHITE_25;
        } else {
            *v = FLAG_DIMMED;
        }
    }
}

fn render_sampler_fader_page(s: &mut EngineState) {
    let ch = s.current_channel as usize;
    let slot = selected_slot(s, ch);
    let page = s.sound_page;
    let faders = sampler_page_faders(page);
    let focus = (s.sound_focus[page as usize] as usize).min(faders.len().saturating_sub(1));

    for (i, &param) in faders.iter().enumerate() {
        let value = s.sampler_params[ch][slot][param] as i32;
        let max = arp3_synth::sampler::SLOT_PARAM_MAX[param] as i32;
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

    // PLAY page extras: mode cells + TAPE toggle
    if page == PAGE_SPLAY {
        let mode = s.sampler_params[ch][slot][SP_MODE];
        for (i, m) in [MODE_ONE, MODE_LOOP, MODE_GATE].iter().enumerate() {
            s.button_values[VISIBLE_ROWS - 1][12 + i] =
                if mode == *m { BTN_COLOR_100 } else { BTN_WHITE_25 };
        }
        let tape = s.sampler_params[ch][slot][SP_TAPE] != 0;
        s.button_values[VISIBLE_ROWS - 1][15] = if tape { BTN_COLOR_100 } else { BTN_WHITE_25 };
        if tape {
            s.color_overrides[VISIBLE_ROWS - 1][15] = SOUND_ACCENT;
        }
    }
}

pub fn render_sampler_page(s: &mut EngineState) {
    match s.sound_page {
        PAGE_SSLOT => render_slot_page(s),
        PAGE_SREC => render_rec_page(s),
        PAGE_STRIM => render_trim_page(s),
        _ => render_sampler_fader_page(s),
    }
}
