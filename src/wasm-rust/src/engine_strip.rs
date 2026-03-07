// engine_strip.rs — Touchstrip input handling
// Treats each strip as a physical element receiving raw 0-1024 positions.
// WASM owns scroll state, inertia physics, and scrub logic.

use crate::engine_core::*;

const STRIP_VERTICAL: u8 = 0;
const STRIP_HORIZONTAL: u8 = 1;

const FRICTION: f32 = 0.97;
const MIN_VELOCITY: f32 = 0.0004;
const RANGE: f32 = 1024.0;
const VISIBLE_BUTTONS: f32 = 8.0; // strip spans 8 grid buttons
const RAW_PER_BUTTON: f32 = RANGE / VISIBLE_BUTTONS; // 128 raw units = 1 grid button
const FRAME_MS: f32 = 16.0; // ~60fps reference for velocity normalization

// ============ Helpers ============

fn get_total_rows(s: &EngineState) -> i32 {
    if s.channel_types[s.current_channel as usize] == ChannelType::Drum as u8 { 128 }
    else { s.scale_count as i32 }
}

fn get_total_cols(s: &EngineState) -> i32 {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    if pat_len > 0 && s.zoom > 0 { (pat_len + s.zoom - 1) / s.zoom } else { 0 }
}

fn get_scrollable_rows(s: &EngineState) -> i32 {
    (get_total_rows(s) - VISIBLE_ROWS as i32).max(0)
}

fn get_scrollable_cols(s: &EngineState) -> i32 {
    (get_total_cols(s) - VISIBLE_COLS as i32).max(0)
}

// ============ Strip API ============

pub fn engine_strip_start(s: &mut EngineState, strip: u8, pos: i32, shift: u8, time_ms: f32) {
    let idx = strip as usize;
    if idx > 1 { return; }

    // Stop any running inertia
    s.strip_velocity[idx] = 0.0;

    s.strip_dragging[idx] = 1;
    s.strip_last_pos[idx] = pos;
    s.strip_last_time[idx] = time_ms;

    // Shift + horizontal → scrub mode
    if strip == STRIP_HORIZONTAL && shift != 0 {
        s.strip_shift_dragging = 1;
        s.scrub_accumulator = 0.0;
    } else {
        s.strip_shift_dragging = 0;
    }
}

pub fn engine_strip_move(s: &mut EngineState, strip: u8, pos: i32, time_ms: f32) {
    let idx = strip as usize;
    if idx > 1 || s.strip_dragging[idx] == 0 { return; }

    let delta = pos - s.strip_last_pos[idx];
    let dt = time_ms - s.strip_last_time[idx];
    s.strip_last_pos[idx] = pos;
    s.strip_last_time[idx] = time_ms;

    if delta == 0 { return; }

    // Scrub mode (horizontal + shift)
    if strip == STRIP_HORIZONTAL && s.strip_shift_dragging != 0 {
        strip_scrub_move(s, delta);
        return;
    }

    // Normal scroll mode
    let scrollable = if strip == STRIP_VERTICAL {
        get_scrollable_rows(s)
    } else {
        get_scrollable_cols(s)
    };

    if scrollable <= 0 { return; }

    // Convert raw delta to value delta
    // 128 raw units = 1 grid button = 1 item scroll
    // Negative reverses direction (touchscreen style: drag down → scroll up)
    let items_delta = -(delta as f32) / RAW_PER_BUTTON;
    let value_delta = items_delta / scrollable as f32;

    // Track velocity for inertia (EWMA smoothed, normalized to per-frame rate)
    if dt > 0.0 && dt < 100.0 {
        let new_v = value_delta / dt * FRAME_MS;
        let old_v = s.strip_velocity[idx];
        s.strip_velocity[idx] = if old_v.abs() < MIN_VELOCITY {
            new_v
        } else {
            old_v * 0.3 + new_v * 0.7
        };
    }

    let offset = if strip == STRIP_VERTICAL {
        s.row_offsets[s.current_channel as usize]
    } else {
        s.col_offset
    };

    let next = (offset + value_delta).max(0.0).min(1.0);

    if strip == STRIP_VERTICAL {
        let ch = s.current_channel as usize;
        s.row_offsets[ch] = next;
        s.target_row_offsets[ch] = next;
    } else {
        // Horizontal scroll during playback → override auto-follow
        if s.is_playing != 0 {
            s.manual_scroll_override = 1;
        }
        s.col_offset = next;
    }
}

pub fn engine_strip_end(s: &mut EngineState, strip: u8) {
    let idx = strip as usize;
    if idx > 1 || s.strip_dragging[idx] == 0 { return; }

    s.strip_dragging[idx] = 0;

    if strip == STRIP_HORIZONTAL && s.strip_shift_dragging != 0 {
        // End scrub
        s.strip_shift_dragging = 0;
        let t = s.current_tick;
        if t >= 0 { s.resume_tick = t; }
        engine_core_scrub_end(s);
        return;
    }

    // Inertia: velocity is already set from strip_move
    // JS will call strip_inertia_tick in rAF loop
}

/// Called from computeGrid each frame. Returns 1 if still animating, 0 if done.
pub fn engine_strip_inertia_tick(s: &mut EngineState, strip: u8) -> u8 {
    let idx = strip as usize;
    if idx > 1 { return 0; }

    // Don't apply inertia while actively dragging
    if s.strip_dragging[idx] != 0 { return 0; }

    let v = s.strip_velocity[idx];
    if v.abs() < MIN_VELOCITY {
        s.strip_velocity[idx] = 0.0;
        return 0;
    }

    s.strip_velocity[idx] *= FRICTION;
    let v = s.strip_velocity[idx];

    if strip == STRIP_VERTICAL {
        let ch = s.current_channel as usize;
        let next = (s.row_offsets[ch] + v).max(0.0).min(1.0);
        s.row_offsets[ch] = next;
        s.target_row_offsets[ch] = next;
    } else {
        let next = (s.col_offset + v).max(0.0).min(1.0);
        s.col_offset = next;
    }

    1
}

// ============ Scrub Helpers ============

fn strip_scrub_move(s: &mut EngineState, delta: i32) {
    // Convert raw delta to ticks: 128 raw = 2 columns (2x scrub speed)
    let cols_delta = delta as f32 / RAW_PER_BUTTON * 2.0;
    s.scrub_accumulator += cols_delta * s.zoom as f32;

    let whole_ticks = s.scrub_accumulator as i32;
    if whole_ticks == 0 { return; }

    s.scrub_accumulator -= whole_ticks as f32;

    let base = if s.current_tick >= 0 { s.current_tick } else {
        let ch = s.current_channel as usize;
        let pat = s.current_patterns[ch] as usize;
        s.loops[ch][pat].start
    };

    engine_core_scrub_to_tick(s, base + whole_ticks);
}

// ============ Playhead Follow ============

pub fn engine_playhead_follow(s: &mut EngineState) {
    // Clear manual override on play/stop transitions handled by caller
    if s.is_playing == 0 || s.current_tick < 0 || s.manual_scroll_override != 0 {
        return;
    }

    // Don't follow in loop mode
    if s.ui_mode == UiMode::Loop as u8 {
        return;
    }

    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let loop_data = &s.loops[ch][pat];
    let loop_start = loop_data.start;
    let loop_len = loop_data.length;
    if loop_len <= 0 { return; }

    let tpc = s.zoom;
    if tpc <= 0 { return; }

    let loop_end_tick = loop_start + loop_len;
    let looped_tick = loop_start + mod_positive(s.current_tick - loop_start, loop_len);

    let loop_start_col = loop_start / tpc;
    let loop_length_cols = (loop_len + tpc - 1) / tpc;
    let loop_end_col = (loop_end_tick + tpc - 1) / tpc;

    if loop_length_cols <= VISIBLE_COLS as i32 { return; }

    let total_cols = get_total_cols(s);
    let max_col_offset = (total_cols - VISIBLE_COLS as i32).max(0);
    if max_col_offset <= 0 { return; }

    const FOLLOW_COL: i32 = 4;
    let looped_col = (looped_tick - loop_start) / tpc + loop_start_col;
    let mut target_start_col = looped_col - FOLLOW_COL;
    target_start_col = target_start_col.max(loop_start_col);
    let max_loop_start_col = loop_end_col - VISIBLE_COLS as i32;
    target_start_col = target_start_col.min(max_loop_start_col);
    target_start_col = target_start_col.max(0).min(max_col_offset);

    let new_col_offset = target_start_col as f32 / max_col_offset as f32;
    let new_col_offset = new_col_offset.max(0.0).min(1.0);

    if (new_col_offset - s.col_offset).abs() > 0.001 {
        s.col_offset = new_col_offset;
    }
}
