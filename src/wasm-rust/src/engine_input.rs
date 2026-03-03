// engine_input.rs — Button press, arrow press, key actions, camera follow

use crate::engine_core::*;
use crate::engine_edit::*;
use crate::engine_ui::*;

// ============ Arrow Directions ============

pub const DIR_UP: u8 = 0;
pub const DIR_DOWN: u8 = 1;
pub const DIR_LEFT: u8 = 2;
pub const DIR_RIGHT: u8 = 3;

// ============ Key Action IDs ============

pub const ACTION_TOGGLE_PLAY: u8 = 0;
pub const ACTION_DESELECT: u8 = 1;
pub const ACTION_ZOOM_IN: u8 = 2;
pub const ACTION_ZOOM_OUT: u8 = 3;
pub const ACTION_DELETE_NOTE: u8 = 4;
pub const ACTION_CLEAR_PATTERN: u8 = 5;

// ============ Modifier Flags ============

pub const MOD_CTRL: u8 = 1;
pub const MOD_SHIFT: u8 = 2;
pub const MOD_META: u8 = 4;
pub const MOD_ALT: u8 = 8;

// ============ Zoom Levels ============

static ZOOM_LEVELS: [i32; 5] = [480, 240, 120, 60, 30];

fn zoom_cycle(current: i32, direction: i8) -> i32 {
    ZOOM_LEVELS.iter()
        .position(|&z| z == current)
        .map(|i| {
            let new_i = (i as i32 + direction as i32).clamp(0, ZOOM_LEVELS.len() as i32 - 1) as usize;
            ZOOM_LEVELS[new_i]
        })
        .unwrap_or(current)
}

// ============ Step Tables ============

static SUB_ZOOM: [i32; 4] = [60, 90, 120, 180];
static TRIPLETS: [i32; 5] = [40, 80, 160, 320, 640];
const MAX_STEPS: usize = 128;

fn build_step_table(zoom: i32, max_tick: i32) -> Vec<i32> {
    let mut steps: Vec<i32> = SUB_ZOOM.iter()
        .filter(|&&v| v < zoom && v <= max_tick)
        .copied()
        .chain((1..).map(|i| zoom * i).take_while(|&v| v <= max_tick))
        .take(MAX_STEPS)
        .collect();
    steps.sort_unstable();
    steps.dedup();
    steps
}

fn build_step_table_with_triplets(zoom: i32, max_tick: i32) -> Vec<i32> {
    let mut steps = build_step_table(zoom, max_tick);
    let extras: Vec<i32> = TRIPLETS.iter()
        .filter(|&&t| t >= zoom && t <= max_tick && !steps.contains(&t))
        .copied()
        .collect();
    steps.extend(extras);
    steps.sort_unstable();
    steps.dedup();
    steps
}

fn find_step_index(steps: &[i32], current: i32) -> usize {
    steps.iter()
        .position(|&s| s >= current)
        .unwrap_or(steps.len().saturating_sub(1))
}

fn step_to(steps: &[i32], current: i32, increase: bool) -> i32 {
    if steps.is_empty() { return current; }
    let idx = find_step_index(steps, current);
    let idx = if steps[idx] == current {
        if increase { (idx + 1).min(steps.len() - 1) } else { idx.saturating_sub(1) }
    } else { idx };
    steps[idx]
}

// ============ Coordinate Conversion ============

fn get_total_rows(s: &EngineState) -> i16 {
    if s.channel_types[s.current_channel as usize] == ChannelType::Drum as u8 { 128 }
    else { s.scale_count as i16 }
}

fn get_min_row(s: &EngineState) -> i16 {
    if s.channel_types[s.current_channel as usize] == ChannelType::Drum as u8 { 0 }
    else { -(s.scale_zero_index as i16) }
}

fn get_start_array_index(s: &EngineState) -> i16 {
    let total = get_total_rows(s);
    let max_offset = total - VISIBLE_ROWS as i16;
    if max_offset <= 0 { return 0; }
    ((1.0 - s.row_offsets[s.current_channel as usize] as f64) * max_offset as f64 + 0.5) as i16
}

pub fn engine_visible_to_actual_row(s: &EngineState, visible_row: u8) -> i16 {
    let start_idx = get_start_array_index(s);
    let min_row = get_min_row(s);
    let flipped = VISIBLE_ROWS as i16 - 1 - visible_row as i16;
    start_idx + min_row + flipped
}

pub fn engine_visible_to_tick(s: &EngineState, visible_col: u8) -> i32 {
    let tpc = s.zoom;
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    let total_cols = if pat_len > 0 && tpc > 0 { (pat_len + tpc - 1) / tpc } else { 0 };
    let max_col_offset = (total_cols - VISIBLE_COLS as i32).max(0);
    let start_col = if max_col_offset > 0 {
        (s.col_offset * max_col_offset as f32 + 0.5) as i32
    } else { 0 };
    (start_col + visible_col as i32) * tpc
}

pub fn engine_find_event_at(s: &EngineState, row: i16, tick: i32) -> i16 {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pd = &s.patterns[ch][pat];
    (0..pd.event_count as usize)
        .find(|&i| pd.events[i].row == row && pd.events[i].position == tick)
        .map(|i| i as i16)
        .unwrap_or(-1)
}

fn find_event_overlapping(s: &EngineState, row: i16, tick: i32) -> i16 {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pd = &s.patterns[ch][pat];

    (0..pd.event_count as usize)
        .filter(|&i| pd.events[i].enabled != 0 && pd.events[i].row == row)
        .find(|&i| {
            let ev = &pd.events[i];
            (0..ev.repeat_amount).any(|r| {
                let pos = ev.position + r as i32 * ev.repeat_space;
                tick >= pos && tick < pos + ev.length
            })
        })
        .map(|i| i as i16)
        .unwrap_or(-1)
}

fn find_event_by_chord(s: &EngineState, row: i16, tick: i32) -> i16 {
    let ch = s.current_channel as usize;
    let notes = &s.rendered_notes[ch];
    let count = s.rendered_count[ch] as usize;

    (0..count)
        .find(|&i| notes[i].row == row && tick >= notes[i].position && tick < notes[i].position + notes[i].length)
        .map(|i| notes[i].source_idx as i16)
        .unwrap_or(-1)
}

fn play_event_preview(s: &EngineState, ev: &NoteEvent, length_ticks: i32) {
    if s.is_playing != 0 { return; }
    let ch = s.current_channel;
    if ev.chord_amount <= 1 {
        crate::platform_play_preview_note(ch, ev.row, length_ticks);
        return;
    }
    let mut offsets = [0i8; MAX_CHORD_SIZE];
    let count = get_chord_offsets(s, ev, &mut offsets, 0);
    (0..count).for_each(|c| {
        crate::platform_play_preview_note(ch, ev.row + offsets[c] as i16, length_ticks);
    });
}

// ============ Camera Follow ============

fn start_index_to_offset(desired_start: i16, max_row_off: i16) -> f32 {
    if max_row_off <= 0 { return 1.0; }
    (1.0 - desired_start as f32 / max_row_off as f32).clamp(0.0, 1.0)
}

fn set_row_target(s: &mut EngineState, new_off: f32) {
    let ch = s.current_channel as usize;
    let clamped = new_off.clamp(0.0, 1.0);
    let diff = (clamped - s.row_offsets[ch]).abs();
    let total = get_total_rows(s);
    let max_off = total - VISIBLE_ROWS as i16;
    let one_row = if max_off > 0 { 1.0 / max_off as f32 } else { 1.0 };
    if diff <= one_row + 0.001 {
        s.row_offsets[ch] = clamped;
    }
    s.target_row_offsets[ch] = clamped;
}

fn set_row_target_index(s: &mut EngineState, desired_start: i16) {
    let total = get_total_rows(s);
    let max_row_off = total - VISIBLE_ROWS as i16;
    set_row_target(s, start_index_to_offset(desired_start, max_row_off));
}

fn follow_note(s: &mut EngineState, row: i16, tick: i32) {
    let min_row = get_min_row(s);
    let total = get_total_rows(s);
    let max_row_off = total - VISIBLE_ROWS as i16;

    if max_row_off > 0 {
        let arr_pos = row - min_row;
        let start_idx = get_start_array_index(s);
        if arr_pos < start_idx {
            set_row_target_index(s, arr_pos);
        } else if arr_pos > start_idx + VISIBLE_ROWS as i16 - 1 {
            set_row_target_index(s, arr_pos - VISIBLE_ROWS as i16 + 1);
        }
    }

    // Column follow
    let tpc = s.zoom;
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    let total_cols = (pat_len + tpc - 1) / tpc;
    let max_col_off = (total_cols - VISIBLE_COLS as i32).max(0);

    if max_col_off > 0 {
        let col = tick / tpc;
        let start_col = (s.col_offset * max_col_off as f32 + 0.5) as i32;
        if col < start_col {
            s.col_offset = (col as f32 / max_col_off as f32).max(0.0);
        } else if col > start_col + VISIBLE_COLS as i32 - 1 {
            s.col_offset = ((col - VISIBLE_COLS as i32 + 1) as f32 / max_col_off as f32).min(1.0);
        }
    }
}

// ============ Pattern Mode Button Press ============

fn handle_pattern_press(s: &mut EngineState, vis_row: u8, vis_col: u8, mods: u8) {
    let row = engine_visible_to_actual_row(s, vis_row);
    let tick = engine_visible_to_tick(s, vis_col);
    let tpc = s.zoom;

    // Alt+click: copy selected event to this position
    if (mods & MOD_ALT) != 0 && (mods & MOD_META) == 0 && (mods & MOD_CTRL) == 0 && s.selected_event_idx >= 0 {
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        if s.patterns[ch][pat_idx].event_count as usize >= MAX_EVENTS { return; }

        engine_place_event(s, s.selected_event_idx as u16);

        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let src = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
        let new_idx = s.patterns[ch][pat_idx].event_count;
        s.patterns[ch][pat_idx].events[new_idx as usize] = src;
        s.patterns[ch][pat_idx].events[new_idx as usize].row = row;
        s.patterns[ch][pat_idx].events[new_idx as usize].position = tick;
        s.patterns[ch][pat_idx].events[new_idx as usize].event_index = engine_alloc_event_id(s);
        s.patterns[ch][pat_idx].event_count += 1;

        s.selected_event_idx = new_idx as i16;
        engine_update_has_notes(s, ch as u8, pat_idx as u8);
        engine_mark_dirty(s, ch as u8);
        let ev = s.patterns[ch][pat_idx].events[new_idx as usize].clone();
        play_event_preview(s, &ev, tpc);
        return;
    }

    // Meta+click (no Shift): disable note
    if (mods & MOD_META) != 0 && (mods & MOD_SHIFT) == 0 {
        let idx = [
            engine_find_event_at(s, row, tick),
            find_event_overlapping(s, row, tick),
            find_event_by_chord(s, row, tick),
        ].iter().copied().find(|&i| i >= 0).unwrap_or(-1);

        if idx >= 0 {
            let ch = s.current_channel as usize;
            let pat_idx = s.current_patterns[ch] as usize;
            if s.patterns[ch][pat_idx].events[idx as usize].enabled != 0 {
                s.patterns[ch][pat_idx].events[idx as usize].enabled = 0;
                if s.selected_event_idx == idx { s.selected_event_idx = -1; }
                engine_mark_dirty(s, ch as u8);
            }
        }
        return;
    }

    // Cmd+Shift+click: set repeat amount to fill until this tick
    if (mods & MOD_META) != 0 && (mods & MOD_SHIFT) != 0 && s.selected_event_idx >= 0 {
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let sel = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
        if sel.row == row && tick > sel.position {
            let span = tick - sel.position;
            let space = if sel.repeat_space < 1 { tpc } else { sel.repeat_space };
            let amt = ((span / space) + 1).clamp(1, 64) as u16;
            engine_set_event_repeat_amount(s, s.selected_event_idx as u16, amt);
            return;
        }
    }

    // Shift+click (no Cmd): resize selected note
    if (mods & MOD_SHIFT) != 0 && (mods & MOD_META) == 0 && s.selected_event_idx >= 0 {
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let sel = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
        if sel.row == row {
            let start = sel.position.min(tick);
            let end = sel.position.max(tick);
            let new_len = end - start + tpc;
            let ev = &mut s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
            if start != ev.position { ev.position = start; }
            ev.length = new_len;
            engine_mark_dirty(s, ch as u8);
            let ev = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
            play_event_preview(s, &ev, tpc);
            return;
        }
    }

    // Click on existing event at exact position
    let idx = engine_find_event_at(s, row, tick);
    if idx >= 0 {
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        if s.patterns[ch][pat_idx].events[idx as usize].enabled == 0 {
            s.patterns[ch][pat_idx].events[idx as usize].enabled = 1;
            engine_mark_dirty(s, ch as u8);
            if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }
            s.selected_event_idx = idx;
            let ev = s.patterns[ch][pat_idx].events[idx as usize].clone();
            play_event_preview(s, &ev, tpc);
            return;
        }
        if s.selected_event_idx == idx {
            engine_place_event(s, idx as u16);
            s.selected_event_idx = -1;
        } else {
            if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }
            s.selected_event_idx = idx;
        }
        let ev = s.patterns[ch][pat_idx].events[idx as usize].clone();
        play_event_preview(s, &ev, tpc);
        return;
    }

    // Click on overlapping event
    let overlap_idx = find_event_overlapping(s, row, tick);
    if overlap_idx >= 0 {
        if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }
        s.selected_event_idx = overlap_idx;
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let ev = s.patterns[ch][pat_idx].events[overlap_idx as usize].clone();
        play_event_preview(s, &ev, tpc);
        return;
    }

    // Click on chord tone
    let chord_idx = find_event_by_chord(s, row, tick);
    if chord_idx >= 0 {
        if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }
        s.selected_event_idx = chord_idx;
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let ev = s.patterns[ch][pat_idx].events[chord_idx as usize].clone();
        play_event_preview(s, &ev, tpc);
        return;
    }

    // Click on empty: create new note
    if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }
    let new_idx = engine_toggle_event(s, row, tick, tpc);
    if new_idx >= 0 { s.selected_event_idx = new_idx; }
    if s.is_playing == 0 {
        crate::platform_play_preview_note(s.current_channel, row, tpc);
    }
}

// ============ Channel Mode Button Press ============

fn handle_channel_press(s: &mut EngineState, vis_row: u8, vis_col: u8, mods: u8) {
    let ch_idx = vis_row as usize;

    if vis_col == 0 {
        if (mods & MOD_ALT) != 0 {
            s.soloed[ch_idx] ^= 1;
        } else {
            s.muted[ch_idx] ^= 1;
        }
        return;
    }

    let pat_idx = vis_col as usize - 1;
    if pat_idx >= NUM_PATTERNS { return; }

    if (mods & MOD_ALT) != 0 && ch_idx == s.current_channel as usize {
        if s.patterns_have_notes[ch_idx][pat_idx] == 0 {
            engine_copy_pattern(s, pat_idx as u8);
        }
    }

    s.current_channel = ch_idx as u8;
    s.current_patterns[ch_idx] = pat_idx as u8;
    engine_mark_dirty(s, ch_idx as u8);
    s.ui_mode = UiMode::Pattern as u8;
}

// ============ Loop Mode Button Press ============

fn handle_loop_press(s: &mut EngineState, _vis_row: u8, vis_col: u8, mods: u8) {
    let tick = engine_visible_to_tick(s, vis_col);
    let tpc = s.zoom;
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let loop_end = s.loops[ch][pat].start + s.loops[ch][pat].length;
    let pat_len = s.patterns[ch][pat].length_ticks;

    let old_looped = if s.current_tick >= 0 && s.loops[ch][pat].length > 0 {
        let r = mod_positive(s.current_tick - s.loops[ch][pat].start, s.loops[ch][pat].length);
        s.loops[ch][pat].start + r
    } else { -1 };

    if (mods & MOD_SHIFT) != 0 {
        let new_start = tick.min(loop_end - tpc);
        s.loops[ch][pat].length = loop_end - new_start;
        s.loops[ch][pat].start = new_start;
    } else {
        let new_end = (tick + tpc).max(s.loops[ch][pat].start + tpc).min(pat_len);
        s.loops[ch][pat].length = new_end - s.loops[ch][pat].start;
    }

    if old_looped >= 0 && s.loops[ch][pat].length > 0 {
        let new_end = s.loops[ch][pat].start + s.loops[ch][pat].length;
        if old_looped >= new_end || old_looped < s.loops[ch][pat].start {
            s.current_tick = s.loops[ch][pat].start;
        } else {
            s.current_tick = old_looped;
        }
    }
}

// ============ Modify Mode Button Press ============

fn handle_modify_press(s: &mut EngineState, vis_row: u8, vis_col: u8, mods: u8) {
    if s.selected_event_idx < 0 {
        let row = engine_visible_to_actual_row(s, vis_row);
        let tick = engine_visible_to_tick(s, vis_col);
        let idx = find_event_overlapping(s, row, tick);
        if idx >= 0 { s.selected_event_idx = idx; }
        return;
    }

    let sm = s.modify_sub_mode;
    let config = engine_get_sub_mode_config(sm);

    let mut levels = [0i16; 128];
    let level_count = engine_generate_levels(config, &mut levels) as usize;
    if level_count == 0 { return; }

    let value = if (mods & MOD_META) != 0 {
        0
    } else {
        let mut visible = [0i16; VISIBLE_ROWS];
        if level_count <= VISIBLE_ROWS {
            visible[..level_count].copy_from_slice(&levels[..level_count]);
        } else {
            let scroll = engine_get_default_modify_scroll(&levels, level_count as u8, config.render_style);
            let max_scroll = level_count - VISIBLE_ROWS;
            let scroll_idx = (scroll * max_scroll as f32) as usize;
            visible.copy_from_slice(&levels[scroll_idx..scroll_idx + VISIBLE_ROWS]);
        }
        if vis_row as usize >= VISIBLE_ROWS { return; }
        visible[vis_row as usize]
    };

    engine_set_sub_mode_value(s, s.selected_event_idx as u16, sm, vis_col as u16, value);
}

// ============ Main Button Press Dispatch ============

pub fn engine_button_press(s: &mut EngineState, row: u8, col: u8, modifiers: u8) {
    if (modifiers & MOD_CTRL) != 0 && row == 7 && col <= 3 {
        static MODE_MAP: [u8; 4] = [
            UiMode::Channel as u8, UiMode::Pattern as u8,
            UiMode::Loop as u8, UiMode::Modify as u8,
        ];
        s.ui_mode = MODE_MAP[col as usize];
        return;
    }

    match UiMode::from_u8(s.ui_mode) {
        UiMode::Pattern => handle_pattern_press(s, row, col, modifiers),
        UiMode::Channel => handle_channel_press(s, row, col, modifiers),
        UiMode::Loop => handle_loop_press(s, row, col, modifiers),
        UiMode::Modify => handle_modify_press(s, row, col, modifiers),
    }
}

// ============ Arrow Press ============

static MODIFY_SUB_MODE_ORDER: [u8; 6] = [
    SubModeId::Velocity as u8, SubModeId::Modulate as u8, SubModeId::Inversion as u8,
    SubModeId::Hit as u8, SubModeId::Flam as u8, SubModeId::Timing as u8,
];

fn handle_arrow_pattern(s: &mut EngineState, dir: u8, mods: u8) {
    if s.selected_event_idx < 0 {
        // No selected note + Alt: cycle scale
        if (mods & MOD_ALT) != 0 && (mods & (MOD_META | MOD_CTRL | MOD_SHIFT)) == 0 {
            match dir {
                DIR_UP | DIR_DOWN => engine_cycle_scale(s, if dir == DIR_UP { 1 } else { -1 }),
                DIR_LEFT | DIR_RIGHT => engine_cycle_scale_root(s, if dir == DIR_RIGHT { 1 } else { -1 }),
                _ => {}
            }
        }
        return;
    }

    let ch = s.current_channel as usize;
    let pat_idx = s.current_patterns[ch] as usize;
    if s.selected_event_idx as u16 >= s.patterns[ch][pat_idx].event_count { return; }
    let tpc = s.zoom;

    // Helper: get chord offsets and follow edge note
    let follow_chord_edge = |s: &mut EngineState, dir: u8| {
        let ev = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
        if ev.chord_amount > 1 {
            let mut offsets = [0i8; MAX_CHORD_SIZE];
            let cnt = get_chord_offsets(s, ev, &mut offsets, 0);
            let follow_row = ev.row + offsets[if dir == DIR_UP { cnt - 1 } else { 0 }] as i16;
            let pos = ev.position;
            follow_note(s, follow_row, pos);
        }
    };

    // Cmd+Shift+Up/Down: adjust chord space
    if (mods & MOD_META) != 0 && (mods & MOD_SHIFT) != 0 {
        if dir == DIR_UP || dir == DIR_DOWN {
            engine_adjust_chord_space(s, s.selected_event_idx as u16, if dir == DIR_UP { 1 } else { -1 });
            follow_chord_edge(s, dir);
            let ev = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
            play_event_preview(s, &ev, tpc);
            return;
        }
        // Cmd+Shift+Left/Right: adjust repeat space
        if dir == DIR_LEFT || dir == DIR_RIGHT {
            let steps = build_step_table_with_triplets(tpc, 1920);
            let cur = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].repeat_space;
            let new_val = step_to(&steps, cur, dir == DIR_RIGHT);
            engine_set_event_repeat_space(s, s.selected_event_idx as u16, new_val);
            return;
        }
    }

    // Cmd+Up/Down: adjust chord amount
    if (mods & MOD_META) != 0 && (mods & MOD_SHIFT) == 0 {
        if dir == DIR_UP || dir == DIR_DOWN {
            engine_adjust_chord_stack(s, s.selected_event_idx as u16, if dir == DIR_UP { 1 } else { -1 });
            follow_chord_edge(s, dir);
            let ev = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
            play_event_preview(s, &ev, tpc);
            return;
        }
        // Cmd+Left/Right: adjust repeat amount
        if dir == DIR_LEFT || dir == DIR_RIGHT {
            let amt = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].repeat_amount;
            let new_amt = if dir == DIR_LEFT { amt.max(2) - 1 } else { amt.min(63) + 1 };
            engine_set_event_repeat_amount(s, s.selected_event_idx as u16, new_amt);
            return;
        }
    }

    // Shift+Up/Down: chord inversion or octave jump
    if (mods & MOD_SHIFT) != 0 && (mods & (MOD_META | MOD_ALT)) == 0 {
        if dir == DIR_UP || dir == DIR_DOWN {
            engine_cycle_chord_inversion(s, s.selected_event_idx as u16, if dir == DIR_UP { 1 } else { -1 });
            let ev = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
            if ev.chord_amount > 1 {
                let mut offsets = [0i8; MAX_CHORD_SIZE];
                let cnt = get_chord_offsets(s, ev, &mut offsets, 0);
                let min_off = offsets[..cnt].iter().min().copied().unwrap_or(0);
                let max_off = offsets[..cnt].iter().max().copied().unwrap_or(0);
                let follow_row = ev.row + if dir == DIR_UP { max_off } else { min_off } as i16;
                let pos = ev.position;
                follow_note(s, follow_row, pos);
                let min_row = get_min_row(s);
                let arr_pos = follow_row - min_row;
                if dir == DIR_UP {
                    set_row_target_index(s, arr_pos - VISIBLE_ROWS as i16 + 1);
                } else {
                    set_row_target_index(s, arr_pos);
                }
            } else {
                let follow_row = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].row;
                let pos = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].position;
                follow_note(s, follow_row, pos);
            }
            let ev = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
            play_event_preview(s, &ev, tpc);
            return;
        }
        // Shift+Left/Right: resize note
        if dir == DIR_LEFT || dir == DIR_RIGHT {
            let ev = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
            let max_len = s.patterns[ch][pat_idx].length_ticks - ev.position;
            let steps = build_step_table(tpc, max_len);
            let new_len = step_to(&steps, ev.length, dir == DIR_RIGHT);
            engine_set_event_length(s, s.selected_event_idx as u16, new_len);
            let ev = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
            play_event_preview(s, &ev, new_len);
            return;
        }
    }

    // Alt+Shift: voicing / arp voices
    if (mods & MOD_ALT) != 0 && (mods & MOD_SHIFT) != 0 && (mods & (MOD_META | MOD_CTRL)) == 0 {
        let ev = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
        if (dir == DIR_UP || dir == DIR_DOWN) && ev.chord_amount > 1 {
            engine_cycle_chord_voicing(s, s.selected_event_idx as u16, if dir == DIR_UP { 1 } else { -1 });
            follow_chord_edge(s, dir);
            let ev = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
            play_event_preview(s, &ev, tpc);
            return;
        }
        if (dir == DIR_LEFT || dir == DIR_RIGHT) && ev.chord_amount > 1 && ev.arp_style != ARP_CHORD {
            engine_adjust_arp_voices(s, s.selected_event_idx as u16, if dir == DIR_RIGHT { 1 } else { -1 });
            return;
        }
    }

    // Alt: arp style / arp offset
    if (mods & MOD_ALT) != 0 && (mods & (MOD_META | MOD_CTRL | MOD_SHIFT)) == 0 {
        let ev = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
        if (dir == DIR_UP || dir == DIR_DOWN) && ev.chord_amount > 1 {
            engine_cycle_arp_style(s, s.selected_event_idx as u16, if dir == DIR_UP { 1 } else { -1 });
            return;
        }
        if (dir == DIR_LEFT || dir == DIR_RIGHT) && ev.chord_amount > 1 && ev.arp_style != ARP_CHORD {
            engine_adjust_arp_offset(s, s.selected_event_idx as u16, if dir == DIR_RIGHT { 1 } else { -1 });
            return;
        }
    }

    // Plain arrows: move note
    if mods == 0 {
        let ev = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
        let (mut new_row, mut new_pos) = (ev.row, ev.position);
        let chord_amount = ev.chord_amount;
        let pat_len = s.patterns[ch][pat_idx].length_ticks;

        match dir {
            DIR_UP => new_row += 1,
            DIR_DOWN => new_row -= 1,
            DIR_LEFT => new_pos = (ev.position - tpc).max(0),
            DIR_RIGHT => new_pos = (ev.position + tpc).min(pat_len - tpc),
            _ => {}
        }

        // Bounds check
        if s.channel_types[ch] == ChannelType::Drum as u8 {
            new_row = new_row.clamp(0, 127);
        } else {
            let idx = s.scale_zero_index as i32 + new_row as i32;
            if idx < 0 || idx >= s.scale_count as i32 { return; }
        }

        if new_row != ev.row || new_pos != ev.position {
            engine_move_event(s, s.selected_event_idx as u16, new_row, new_pos);
            let ev = &s.patterns[ch][pat_idx].events[s.selected_event_idx as usize];
            let mut follow_row = new_row;
            if chord_amount > 1 && (dir == DIR_UP || dir == DIR_DOWN) {
                let mut offsets = [0i8; MAX_CHORD_SIZE];
                let cnt = get_chord_offsets(s, ev, &mut offsets, 0);
                let min_off = offsets[..cnt].iter().min().copied().unwrap_or(0);
                let max_off = offsets[..cnt].iter().max().copied().unwrap_or(0);
                follow_row = new_row + if dir == DIR_UP { max_off } else { min_off } as i16;
            }
            follow_note(s, follow_row, new_pos);
            let ev = s.patterns[ch][pat_idx].events[s.selected_event_idx as usize].clone();
            play_event_preview(s, &ev, tpc);
        }
    }
}

fn handle_arrow_loop(s: &mut EngineState, dir: u8, mods: u8) {
    if mods != 0 && mods != MOD_SHIFT { return; }
    if dir != DIR_LEFT && dir != DIR_RIGHT { return; }

    let tpc = s.zoom;
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    let loop_end = s.loops[ch][pat].start + s.loops[ch][pat].length;

    if (mods & MOD_SHIFT) != 0 {
        let new_start = if dir == DIR_LEFT {
            (s.loops[ch][pat].start - tpc).max(0)
        } else {
            (s.loops[ch][pat].start + tpc).min(loop_end - tpc)
        };
        if new_start != s.loops[ch][pat].start {
            s.loops[ch][pat].length = loop_end - new_start;
            s.loops[ch][pat].start = new_start;
        }
    } else {
        let new_end = if dir == DIR_LEFT {
            (loop_end - tpc).max(s.loops[ch][pat].start + tpc)
        } else {
            (loop_end + tpc).min(pat_len)
        };
        if new_end != loop_end {
            s.loops[ch][pat].length = new_end - s.loops[ch][pat].start;
        }
    }
}

fn handle_arrow_modify(s: &mut EngineState, dir: u8, mods: u8) {
    if (mods & MOD_META) != 0 && (mods & (MOD_ALT | MOD_CTRL | MOD_SHIFT)) == 0 {
        if dir == DIR_UP || dir == DIR_DOWN {
            let idx = MODIFY_SUB_MODE_ORDER.iter()
                .position(|&m| m == s.modify_sub_mode)
                .unwrap_or(0);
            let new_idx = if dir == DIR_DOWN {
                (idx + 1) % MODIFY_SUB_MODE_ORDER.len()
            } else {
                (idx + MODIFY_SUB_MODE_ORDER.len() - 1) % MODIFY_SUB_MODE_ORDER.len()
            };
            s.modify_sub_mode = MODIFY_SUB_MODE_ORDER[new_idx];
            return;
        }
    }

    if s.selected_event_idx < 0 { return; }

    if mods == 0 && (dir == DIR_UP || dir == DIR_DOWN) {
        engine_toggle_sub_mode_loop_mode(s, s.selected_event_idx as u16, s.modify_sub_mode);
        return;
    }

    if mods == 0 && (dir == DIR_LEFT || dir == DIR_RIGHT) {
        let ch = s.current_channel as usize;
        let pat = s.current_patterns[ch] as usize;
        let cur_len = get_sub_mode(&s.sub_mode_pool, &s.patterns[ch][pat].events[s.selected_event_idx as usize].sub_mode_handles, s.modify_sub_mode as usize).length;
        let new_len = if dir == DIR_RIGHT { cur_len + 1 } else { cur_len.max(2) - 1 };
        if new_len != cur_len {
            engine_set_sub_mode_length(s, s.selected_event_idx as u16, s.modify_sub_mode, new_len);
        }
    }
}

pub fn engine_arrow_press(s: &mut EngineState, direction: u8, modifiers: u8) {
    match UiMode::from_u8(s.ui_mode) {
        UiMode::Pattern => handle_arrow_pattern(s, direction, modifiers),
        UiMode::Loop => handle_arrow_loop(s, direction, modifiers),
        UiMode::Modify => handle_arrow_modify(s, direction, modifiers),
        _ => {}
    }
}

// ============ Key Actions ============

pub fn engine_key_action(s: &mut EngineState, action_id: u8) {
    match action_id {
        ACTION_TOGGLE_PLAY => {
            s.is_playing ^= 1;
            if s.is_playing == 0 {
                engine_core_stop(s);
            } else {
                engine_core_play_init(s);
            }
        }
        ACTION_DESELECT => {
            if s.selected_event_idx >= 0 {
                s.selected_event_idx = -1;
            } else {
                s.current_tick = -1;
            }
        }
        ACTION_ZOOM_IN => { s.zoom = zoom_cycle(s.zoom, 1); }
        ACTION_ZOOM_OUT => { s.zoom = zoom_cycle(s.zoom, -1); }
        ACTION_DELETE_NOTE => {
            if s.selected_event_idx >= 0 {
                engine_remove_event(s, s.selected_event_idx as u16);
            }
        }
        ACTION_CLEAR_PATTERN => { engine_clear_pattern(s); }
        _ => {}
    }
}
