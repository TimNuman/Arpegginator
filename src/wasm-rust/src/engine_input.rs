// engine_input.rs — Button press, arrow press, key actions, camera follow

use crate::engine_core::*;
use crate::engine_drums::get_drum_pattern;
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
pub const ACTION_DISABLE_NOTE: u8 = 6;

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

/// Collect all unique source event indices with rendered notes in this cell.
/// Returns count of unique indices written to `out`. Each entry is (source_idx, starts_in_cell).
fn find_rendered_events_in_cell(s: &EngineState, row: i16, tick: i32, tpc: i32, out: &mut [(i16, bool)]) -> usize {
    let notes = &s.rendered_notes;
    let count = s.rendered_count as usize;
    let col_end = tick + tpc;
    let mut n = 0usize;

    (0..count).for_each(|i| {
        if n >= out.len() { return; }
        let rn = &notes[i];
        if rn.row != row { return; }
        let overlaps = rn.position < col_end && rn.position + rn.length > tick;
        if !overlaps { return; }
        let src = rn.source_idx as i16;
        // Deduplicate: skip if already collected
        if (0..n).any(|j| out[j].0 == src) { return; }
        let starts = rn.position >= tick && rn.position < col_end;
        out[n] = (src, starts);
        n += 1;
    });
    n
}

/// Find an event via rendered notes (respects arp filtering, chords, repeats).
/// Searches the full column range [tick, tick + tpc) to handle notes at sub-column subdivisions.
/// Returns (source_event_index, is_exact_start) or (-1, false) if not found.
fn find_rendered_event(s: &EngineState, row: i16, tick: i32, tpc: i32) -> (i16, bool) {
    let mut buf = [(-1i16, false); 8];
    let n = find_rendered_events_in_cell(s, row, tick, tpc, &mut buf);
    if n > 0 { buf[0] } else { (-1, false) }
}

/// Find a disabled event overlapping (row, column range) — these aren't in rendered notes.
fn find_disabled_event_at(s: &EngineState, row: i16, tick: i32, tpc: i32) -> i16 {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pd = &s.patterns[ch][pat];
    let col_end = tick + tpc;
    (0..pd.event_count as usize)
        .find(|&i| {
            let ev = &s.event_pool.slots[pd.event_handles[i] as usize];
            if ev.enabled != 0 || ev.row != row { return false; }
            // Only match the root note (repeat index 0), not repeated/stacked copies
            let pos = ev.position;
            pos < col_end && pos + ev.length > tick
        })
        .map(|i| i as i16)
        .unwrap_or(-1)
}

// Keep public for lib.rs export
pub fn engine_find_event_at(s: &EngineState, row: i16, tick: i32) -> i16 {
    find_rendered_event(s, row, tick, s.zoom).0
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

fn scroll_to_tick(s: &mut EngineState, tick: i32) {
    let tpc = s.zoom;
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    let total_cols = (pat_len + tpc - 1) / tpc;
    let max_col_off = (total_cols - VISIBLE_COLS as i32).max(0);

    if max_col_off > 0 {
        let col = tick / tpc;
        let start_col = (s.target_col_offset * max_col_off as f32 + 0.5) as i32;
        if col < start_col {
            s.target_col_offset = (col as f32 / max_col_off as f32).max(0.0);
        } else if col > start_col + VISIBLE_COLS as i32 - 1 {
            s.target_col_offset = ((col - VISIBLE_COLS as i32 + 1) as f32 / max_col_off as f32).min(1.0);
        }
    }
}

/// Scroll to keep edited loop edge visible, fitting both edges on screen if possible.
fn scroll_to_loop_edge(s: &mut EngineState, edited_tick: i32) {
    let tpc = s.zoom;
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    let total_cols = (pat_len + tpc - 1) / tpc;
    let max_col_off = (total_cols - VISIBLE_COLS as i32).max(0);
    if max_col_off <= 0 { return; }

    let loop_start_col = s.loops[ch][pat].start / tpc;
    let loop_end_col = (s.loops[ch][pat].start + s.loops[ch][pat].length - 1) / tpc;
    let loop_cols = loop_end_col - loop_start_col + 1;

    if loop_cols <= VISIBLE_COLS as i32 {
        // Both edges can fit: scroll to show entire loop
        let start_col = (s.target_col_offset * max_col_off as f32 + 0.5) as i32;
        let end_visible = start_col + VISIBLE_COLS as i32 - 1;
        if loop_start_col < start_col {
            s.target_col_offset = (loop_start_col as f32 / max_col_off as f32).max(0.0);
        } else if loop_end_col > end_visible {
            s.target_col_offset = ((loop_end_col - VISIBLE_COLS as i32 + 1) as f32 / max_col_off as f32).min(1.0);
        }
    } else {
        // Loop too wide: just follow the edited edge
        scroll_to_tick(s, edited_tick);
    }
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
        let start_col = (s.target_col_offset * max_col_off as f32 + 0.5) as i32;
        if col < start_col {
            s.target_col_offset = (col as f32 / max_col_off as f32).max(0.0);
        } else if col > start_col + VISIBLE_COLS as i32 - 1 {
            s.target_col_offset = ((col - VISIBLE_COLS as i32 + 1) as f32 / max_col_off as f32).min(1.0);
        }
    }
}

// ============ Pattern Mode Button Press ============

fn handle_pattern_press(s: &mut EngineState, vis_row: u8, vis_col: u8, mods: u8) {
    let row = engine_visible_to_actual_row(s, vis_row);
    let tick = engine_visible_to_tick(s, vis_col);
    let tpc = s.zoom;
    let meta  = (mods & MOD_META)  != 0;
    let alt   = (mods & MOD_ALT)   != 0;
    let shift = (mods & MOD_SHIFT) != 0;

    match (meta, alt, shift) {
        (true,  true,  true)  => pattern_press_random(s, row, tick, tpc),
        (true,  true,  false) => {},                                        // Cmd+Alt: placeholder
        (true,  false, true)  => pattern_press_reset_fill(s, row, tick, tpc),
        (true,  false, false) => pattern_press_disable(s, row, tick, tpc),
        (false, true,  true)  => {},                                        // Alt+Shift: placeholder
        (false, true,  false) => pattern_press_copy(s, row, tick, tpc),
        (false, false, true)  => pattern_press_length(s, row, tick, tpc),
        (false, false, false) => pattern_press_bare(s, row, tick, tpc),
    }
}

fn pattern_press_copy(s: &mut EngineState, row: i16, tick: i32, tpc: i32) {
    if s.selected_event_idx < 0 { return; }
    let ch = s.current_channel as usize;
    let pat_idx = s.current_patterns[ch] as usize;
    if s.patterns[ch][pat_idx].event_count as usize >= MAX_EVENTS { return; }

    engine_place_event(s, s.selected_event_idx as u16);

    let ch = s.current_channel as usize;
    let pat_idx = s.current_patterns[ch] as usize;
    let src_handle = s.patterns[ch][pat_idx].event_handles[s.selected_event_idx as usize];
    let new_handle = event_alloc(&mut s.event_pool);
    s.event_pool.slots[new_handle as usize] = s.event_pool.slots[src_handle as usize].clone();
    s.event_pool.slots[new_handle as usize].row = row;
    s.event_pool.slots[new_handle as usize].position = tick;
    s.event_pool.slots[new_handle as usize].event_index = engine_alloc_event_id(s);
    for sm in 0..NUM_SUB_MODES {
        let sh = s.event_pool.slots[new_handle as usize].sub_mode_handles[sm];
        if sh != POOL_HANDLE_NONE {
            let new_sh = pool_alloc(&mut s.sub_mode_pool);
            s.sub_mode_pool.slots[new_sh as usize] = s.sub_mode_pool.slots[sh as usize];
            s.event_pool.slots[new_handle as usize].sub_mode_handles[sm] = new_sh;
        }
    }
    let new_idx = s.patterns[ch][pat_idx].event_count;
    s.patterns[ch][pat_idx].event_handles[new_idx as usize] = new_handle;
    s.patterns[ch][pat_idx].event_count += 1;

    s.selected_event_idx = new_idx as i16;
    engine_update_has_notes(s, ch as u8, pat_idx as u8);
    engine_mark_dirty(s, ch as u8);
    let ev = s.event_pool.slots[new_handle as usize].clone();
    play_event_preview(s, &ev, tpc);
}

fn pattern_press_random(s: &mut EngineState, row: i16, tick: i32, tpc: i32) {
    let ch = s.current_channel as usize;
    let pat_idx = s.current_patterns[ch] as usize;
    if s.patterns[ch][pat_idx].event_count as usize >= MAX_EVENTS { return; }
    if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }

    let new_idx = engine_toggle_event(s, row, tick, tpc);
    if new_idx < 0 { return; }
    let is_drum = s.channel_types[ch] == ChannelType::Drum as u8;

    if is_drum {
        let pat = get_drum_pattern(row as i16, engine_random(s));
        let amt = pat.amount;
        let speed_roll = engine_random(s) % 100;
        let space = if speed_roll < 15 && pat.space_mul >= 2 {
            (pat.space_mul / 2) as i32
        } else if speed_roll >= 85 {
            (pat.space_mul * 2) as i32
        } else {
            pat.space_mul as i32
        };

        let mut vel_vals = [0i16; MAX_SUB_MODE_LEN];
        let mut hit_vals = [0i16; MAX_SUB_MODE_LEN];
        for i in 0..amt as usize {
            let v = pat.vel[i] as i32;
            if v > 0 {
                let jitter = (engine_random(s) % 31) as i32 - 15;
                vel_vals[i] = (v + jitter).clamp(20, 100) as i16;
            }
            hit_vals[i] = pat.hit[i] as i16;
        }

        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let h = s.patterns[ch][pat_idx].event_handles[new_idx as usize];
        let ev = &mut s.event_pool.slots[h as usize];
        ev.length = tpc;
        ev.repeat_amount = amt as u16;
        ev.repeat_space = space * tpc;
        ev.chord_amount = 1;
        ev.arp_style = ARP_CHORD;
        ev.arp_offset = 0;
        ev.arp_voices = 1;

        let handles = &mut s.event_pool.slots[h as usize].sub_mode_handles;
        let vel_arr = get_sub_mode_mut(&mut s.sub_mode_pool, handles, SubModeId::Velocity as usize);
        vel_arr.length = amt;
        vel_arr.loop_mode = 0;
        vel_arr.values[..amt as usize].copy_from_slice(&vel_vals[..amt as usize]);

        let handles = &mut s.event_pool.slots[h as usize].sub_mode_handles;
        let hit_arr = get_sub_mode_mut(&mut s.sub_mode_pool, handles, SubModeId::Hit as usize);
        hit_arr.length = amt;
        hit_arr.loop_mode = 0;
        hit_arr.values[..amt as usize].copy_from_slice(&hit_vals[..amt as usize]);

        s.selected_event_idx = new_idx;
        engine_mark_dirty(s, ch as u8);
        let ev = s.event_pool.slots[h as usize].clone();
        play_event_preview(s, &ev, tpc);
        return;
    }

    // Melodic random
    let steps = build_step_table_with_triplets(tpc, 1920);
    let r_len = ((engine_random(s) % 4) + 1) as i32 * tpc;
    let r_repeat_amt = ((engine_random(s) % 8) + 1) as u16;
    let max_space = tpc * 8;
    let space_limit = steps.iter().position(|&st| st > max_space).unwrap_or(steps.len());
    let r_repeat_space = (engine_random(s) as usize) % space_limit.max(1);
    let r_chord_amt = ((engine_random(s) % 5) + 1) as u8;
    let r_chord_space = ((engine_random(s) % DIATONIC_OCTAVE as u32) + 1) as u8;
    let r_arp_style = (engine_random(s) % ARP_STYLE_COUNT as u32) as u8;
    let r_arp_offset = engine_random(s);
    let r_arp_voices = engine_random(s);

    let mut sm_pick = [SubModeId::Velocity as usize, SubModeId::Hit as usize, SubModeId::Modulate as usize, 0];
    let sm_count = ((engine_random(s) % 2) + 1) as usize;
    for i in 0..3usize {
        let j = (engine_random(s) as usize) % (3 - i) + i;
        sm_pick.swap(i, j);
    }
    let mut sm_data: [([i16; MAX_SUB_MODE_LEN], u8, u8); 2] = [([0; MAX_SUB_MODE_LEN], 0, 0); 2];
    for i in 0..sm_count {
        let arr_len = ((engine_random(s) % 15) + 2) as u8;
        let mut loop_mode = (engine_random(s) % 3) as u8;
        if arr_len as u16 > r_repeat_amt { loop_mode = 1; }
        let mut vals = [0i16; MAX_SUB_MODE_LEN];
        for (j, v) in vals.iter_mut().take(arr_len as usize).enumerate() {
            *v = if j == 0 && sm_pick[i] == 4 {
                0
            } else {
                match sm_pick[i] {
                    0 => ((engine_random(s) % 81) + 20) as i16,
                    1 => [0i16, 60, 100][(engine_random(s) % 3) as usize],
                    4 => (engine_random(s) % 9) as i16 - 4,
                    _ => 0,
                }
            };
        }
        sm_data[i] = (vals, arr_len, loop_mode);
    }

    let ch = s.current_channel as usize;
    let pat_idx = s.current_patterns[ch] as usize;
    let h = s.patterns[ch][pat_idx].event_handles[new_idx as usize];
    let ev = &mut s.event_pool.slots[h as usize];

    ev.length = r_len;
    ev.repeat_amount = r_repeat_amt;
    if !steps.is_empty() { ev.repeat_space = steps[r_repeat_space]; }
    ev.chord_amount = r_chord_amt;
    ev.chord_space = r_chord_space;
    ev.chord_inversion = 0;
    ev.chord_voicing = 0;
    ev.arp_style = r_arp_style;
    if ev.chord_amount > 1 && ev.arp_style != ARP_CHORD {
        ev.arp_offset = (r_arp_offset % ev.chord_amount as u32) as i8;
        ev.arp_voices = ((r_arp_voices % (ev.chord_amount as u32 - 1)) + 1) as u8;
    } else {
        ev.arp_offset = 0;
        ev.arp_voices = 1;
    }

    for i in 0..sm_count {
        let sm = sm_pick[i];
        let (ref vals, arr_len, loop_mode) = sm_data[i];
        let handles = &mut s.event_pool.slots[h as usize].sub_mode_handles;
        let arr = get_sub_mode_mut(&mut s.sub_mode_pool, handles, sm);
        arr.length = arr_len;
        arr.loop_mode = loop_mode;
        arr.values[..arr_len as usize].copy_from_slice(&vals[..arr_len as usize]);
    }

    s.selected_event_idx = new_idx;
    engine_mark_dirty(s, ch as u8);
    let ev = s.event_pool.slots[h as usize].clone();
    play_event_preview(s, &ev, tpc);
}

fn pattern_press_disable(s: &mut EngineState, row: i16, tick: i32, tpc: i32) {
    let (idx, _) = find_rendered_event(s, row, tick, tpc);
    if idx >= 0 {
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let h = s.patterns[ch][pat_idx].event_handles[idx as usize];
        if s.event_pool.slots[h as usize].enabled != 0 {
            s.event_pool.slots[h as usize].enabled = 0;
            if s.selected_event_idx == idx { s.selected_event_idx = -1; }
            engine_mark_dirty(s, ch as u8);
        }
    }
}

fn pattern_press_reset_fill(s: &mut EngineState, row: i16, tick: i32, tpc: i32) {
    if s.selected_event_idx < 0 { return; }
    let ch = s.current_channel as usize;
    let pat_idx = s.current_patterns[ch] as usize;
    let h = s.patterns[ch][pat_idx].event_handles[s.selected_event_idx as usize];
    let sel = &s.event_pool.slots[h as usize];
    if sel.row == row && tick == sel.position {
        let ev = &mut s.event_pool.slots[h as usize];
        ev.length = tpc;
        ev.repeat_amount = 1;
        ev.repeat_space = tpc;
        ev.chord_amount = 1;
        ev.chord_space = 2;
        ev.chord_inversion = 0;
        ev.chord_voicing = 0;
        ev.arp_style = ARP_CHORD;
        ev.arp_offset = 0;
        ev.arp_voices = 1;
        pool_free_event_handles(&mut s.sub_mode_pool, &mut ev.sub_mode_handles);
        engine_mark_dirty(s, ch as u8);
        return;
    }
    if sel.row == row && tick > sel.position {
        let span = tick - sel.position;
        let space = if sel.repeat_space < 1 { tpc } else { sel.repeat_space };
        let amt = ((span / space) + 1).clamp(1, 64) as u16;
        engine_set_event_repeat_amount(s, s.selected_event_idx as u16, amt);
    }
}

fn pattern_press_length(s: &mut EngineState, row: i16, tick: i32, tpc: i32) {
    if s.selected_event_idx < 0 { return; }
    let ch = s.current_channel as usize;
    let pat_idx = s.current_patterns[ch] as usize;
    let h = s.patterns[ch][pat_idx].event_handles[s.selected_event_idx as usize];
    let sel = &s.event_pool.slots[h as usize];
    if sel.row == row {
        let space = if sel.repeat_space < 1 { tpc } else { sel.repeat_space };
        let last_repeat_pos = sel.position + (sel.repeat_amount as i32 - 1) * space;
        let new_len = if tick >= last_repeat_pos {
            tick - last_repeat_pos + tpc
        } else {
            tpc
        };
        let ev = &mut s.event_pool.slots[h as usize];
        ev.length = new_len;
        engine_mark_dirty(s, ch as u8);
        let ev = s.event_pool.slots[h as usize].clone();
        play_event_preview(s, &ev, tpc);
    }
}

fn pattern_press_bare(s: &mut EngineState, row: i16, tick: i32, tpc: i32) {
    // Click on disabled event at exact position — re-enable it
    let disabled_idx = find_disabled_event_at(s, row, tick, tpc);
    if disabled_idx >= 0 {
        let ch = s.current_channel as usize;
        let pat_idx = s.current_patterns[ch] as usize;
        let h = s.patterns[ch][pat_idx].event_handles[disabled_idx as usize];
        s.event_pool.slots[h as usize].enabled = 1;
        engine_mark_dirty(s, ch as u8);
        if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }
        s.selected_event_idx = disabled_idx;
        let ev = s.event_pool.slots[h as usize].clone();
        play_event_preview(s, &ev, tpc);
        return;
    }

    // Click on any visible note — select or cycle
    let mut cell_events = [(-1i16, false); 8];
    let cell_count = find_rendered_events_in_cell(s, row, tick, tpc, &mut cell_events);
    if cell_count > 0 {
        let new_idx = if s.selected_event_idx >= 0 {
            if let Some(pos) = (0..cell_count).find(|&j| cell_events[j].0 == s.selected_event_idx) {
                if cell_count > 1 {
                    cell_events[(pos + 1) % cell_count].0
                } else {
                    -1
                }
            } else {
                cell_events[0].0
            }
        } else {
            cell_events[0].0
        };

        if new_idx < 0 {
            engine_place_event(s, s.selected_event_idx as u16);
            s.selected_event_idx = -1;
        } else {
            if s.selected_event_idx >= 0 { engine_place_event(s, s.selected_event_idx as u16); }
            s.selected_event_idx = new_idx;
            let ch = s.current_channel as usize;
            let pat_idx = s.current_patterns[ch] as usize;
            let h = s.patterns[ch][pat_idx].event_handles[new_idx as usize];
            let ev = s.event_pool.slots[h as usize].clone();
            play_event_preview(s, &ev, tpc);
        }
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
    s.selected_event_idx = -1;
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
        // No note selected — pattern view shown, only allow selection
        let row = engine_visible_to_actual_row(s, vis_row);
        let tick = engine_visible_to_tick(s, vis_col);
        let tpc = s.zoom;
        let (idx, _) = find_rendered_event(s, row, tick, tpc);
        if idx >= 0 {
            s.selected_event_idx = idx;
            let ch = s.current_channel as usize;
            let pat_idx = s.current_patterns[ch] as usize;
            let h = s.patterns[ch][pat_idx].event_handles[idx as usize];
            let ev = s.event_pool.slots[h as usize].clone();
            play_event_preview(s, &ev, tpc);
        }
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
    if (modifiers & MOD_CTRL) != 0 {
        // Row 7: mode buttons + ghost toggle
        if row == 7 {
            if col <= 1 {
                static MODE_MAP: [u8; 2] = [UiMode::Pattern as u8, UiMode::Modify as u8];
                let mode = MODE_MAP[col as usize];
                // Block Modify mode when current pattern has no notes
                if mode == UiMode::Modify as u8 {
                    let ch = s.current_channel as usize;
                    let pat = s.current_patterns[ch] as usize;
                    if s.patterns[ch][pat].event_count == 0 { return; }
                }
                s.ui_mode = mode;
            } else if col == 15 {
                s.ghost_enabled = if s.ghost_enabled != 0 { 0 } else { 1 };
            }
            return;
        }

        // Rows 0..NUM_CHANNELS: channel/pattern selection
        let ch_idx = row as usize;
        if ch_idx < NUM_CHANNELS {
            if col == 0 {
                // Mute/Solo toggle
                if (modifiers & MOD_ALT) != 0 {
                    s.soloed[ch_idx] ^= 1;
                } else {
                    s.muted[ch_idx] ^= 1;
                }
            } else {
                let pat_idx = col as usize - 1;
                if pat_idx < NUM_PATTERNS {
                    if (modifiers & MOD_ALT) != 0 && ch_idx == s.current_channel as usize {
                        if s.patterns_have_notes[ch_idx][pat_idx] == 0 {
                            engine_copy_pattern(s, pat_idx as u8);
                        }
                    }
                    s.current_channel = ch_idx as u8;
                    s.current_patterns[ch_idx] = pat_idx as u8;
                    s.selected_event_idx = -1;
                    engine_mark_dirty(s, ch_idx as u8);
                }
            }
            return;
        }

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

fn adjust_loop_end(s: &mut EngineState, dir: u8, fine: bool) {
    let tpc = s.zoom;
    let step = if fine { tpc } else { tpc * 4 };
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    let loop_end = s.loops[ch][pat].start + s.loops[ch][pat].length;
    s.loop_edit_target = 0;
    let new_end = if dir == DIR_LEFT {
        (loop_end - step).max(s.loops[ch][pat].start + tpc)
    } else {
        (loop_end + step).min(pat_len)
    };
    if new_end != loop_end {
        s.loops[ch][pat].length = new_end - s.loops[ch][pat].start;
        scroll_to_loop_edge(s, new_end - tpc);
    }
}

fn adjust_loop_start(s: &mut EngineState, dir: u8, fine: bool) {
    let tpc = s.zoom;
    let step = if fine { tpc } else { tpc * 4 };
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let loop_end = s.loops[ch][pat].start + s.loops[ch][pat].length;
    s.loop_edit_target = 1;
    let new_start = if dir == DIR_LEFT {
        (s.loops[ch][pat].start - step).max(0)
    } else {
        (s.loops[ch][pat].start + step).min(loop_end - tpc)
    };
    if new_start != s.loops[ch][pat].start {
        s.loops[ch][pat].length = loop_end - new_start;
        s.loops[ch][pat].start = new_start;
        scroll_to_loop_edge(s, new_start);
    }
}

fn scroll_camera(s: &mut EngineState, dir: u8, jump: bool) {
    let ch = s.current_channel as usize;
    match dir {
        DIR_UP | DIR_DOWN => {
            let step = if jump {
                if s.channel_types[ch] == ChannelType::Drum as u8 {
                    VISIBLE_ROWS as i16
                } else {
                    s.scale_octave_size as i16
                }
            } else { 1 };
            let start_idx = get_start_array_index(s);
            let new_start = if dir == DIR_UP { start_idx + step } else { start_idx - step };
            set_row_target_index(s, new_start);
        }
        DIR_LEFT | DIR_RIGHT => {
            let tpc = s.zoom;
            let pat = s.current_patterns[ch] as usize;
            let pat_len = s.patterns[ch][pat].length_ticks;
            let total_cols = (pat_len + tpc - 1) / tpc;
            let max_col_off = (total_cols - VISIBLE_COLS as i32).max(0);
            if max_col_off > 0 {
                let step = if jump { (TICKS_PER_QUARTER / tpc).max(1) } else { 1 };
                let start_col = (s.target_col_offset * max_col_off as f32 + 0.5) as i32;
                let new_col = if dir == DIR_RIGHT {
                    (start_col + step).min(max_col_off)
                } else {
                    (start_col - step).max(0)
                };
                s.target_col_offset = new_col as f32 / max_col_off as f32;
            }
        }
        _ => {}
    }
}

fn handle_arrow_pattern(s: &mut EngineState, dir: u8, mods: u8) {
    let meta  = (mods & MOD_META)  != 0;
    let alt   = (mods & MOD_ALT)   != 0;
    let shift = (mods & MOD_SHIFT) != 0;

    if s.selected_event_idx < 0 {
        // ---- No note selected ----
        match (meta, alt, shift) {
            (true,  true,  true)  => { // Cmd+Opt+Shift+L/R: loop start fine
                if dir == DIR_LEFT || dir == DIR_RIGHT { adjust_loop_start(s, dir, true); }
            }
            (true,  true,  false) => { // Cmd+Opt+L/R: loop start
                if dir == DIR_LEFT || dir == DIR_RIGHT { adjust_loop_start(s, dir, false); }
            }
            (true,  false, true)  => {} // Cmd+Shift: placeholder
            (true,  false, false) => { // Cmd: cycle scale (U/D) / key (L/R)
                match dir {
                    DIR_UP | DIR_DOWN => engine_cycle_scale(s, if dir == DIR_UP { 1 } else { -1 }),
                    DIR_LEFT | DIR_RIGHT => engine_cycle_scale_root(s, if dir == DIR_RIGHT { 1 } else { -1 }),
                    _ => {}
                }
            }
            (false, true,  true)  => { // Alt+Shift+L/R: loop end fine
                if dir == DIR_LEFT || dir == DIR_RIGHT { adjust_loop_end(s, dir, true); }
            }
            (false, true,  false) => { // Alt+L/R: loop end
                if dir == DIR_LEFT || dir == DIR_RIGHT { adjust_loop_end(s, dir, false); }
            }
            (false, false, true)  => { // Shift: camera octave/beat
                scroll_camera(s, dir, true);
            }
            (false, false, false) => { // Bare: camera ±1
                scroll_camera(s, dir, false);
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
        let h = s.patterns[ch][pat_idx].event_handles[s.selected_event_idx as usize];
        let ev = &s.event_pool.slots[h as usize];
        if ev.chord_amount > 1 {
            let mut offsets = [0i8; MAX_CHORD_SIZE];
            let cnt = get_chord_offsets(s, ev, &mut offsets, 0);
            let follow_row = ev.row + offsets[if dir == DIR_UP { cnt - 1 } else { 0 }] as i16;
            let pos = ev.position;
            follow_note(s, follow_row, pos);
        }
    };

    // ---- Note selected: dispatch by EditGroup ----
    let eg = EditGroup::from_mods(meta, alt, shift);
    let sel = s.selected_event_idx as u16;

    match eg {
        EditGroup::Move => { // Bare: move note
            let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
            let ev = &s.event_pool.slots[h as usize];
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

            if s.channel_types[ch] == ChannelType::Drum as u8 {
                new_row = new_row.clamp(0, 127);
            } else {
                let idx = s.scale_zero_index as i32 + new_row as i32;
                if idx < 0 || idx >= s.scale_count as i32 { return; }
            }

            if new_row != ev.row || new_pos != ev.position {
                engine_move_event(s, sel, new_row, new_pos);
                let ev = &s.event_pool.slots[h as usize];
                let mut follow_row = new_row;
                if chord_amount > 1 && (dir == DIR_UP || dir == DIR_DOWN) {
                    let mut offsets = [0i8; MAX_CHORD_SIZE];
                    let cnt = get_chord_offsets(s, ev, &mut offsets, 0);
                    let min_off = offsets[..cnt].iter().min().copied().unwrap_or(0);
                    let max_off = offsets[..cnt].iter().max().copied().unwrap_or(0);
                    follow_row = new_row + if dir == DIR_UP { max_off } else { min_off } as i16;
                }
                follow_note(s, follow_row, new_pos);
                let ev = s.event_pool.slots[h as usize].clone();
                play_event_preview(s, &ev, tpc);
            }
        }
        EditGroup::Inversion => { // Shift: inversion (U/D), length (L/R)
            if dir == DIR_UP || dir == DIR_DOWN {
                engine_cycle_chord_inversion(s, sel, if dir == DIR_UP { 1 } else { -1 });
                let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
                let ev = &s.event_pool.slots[h as usize];
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
                    let follow_row = s.event_pool.slots[h as usize].row;
                    let pos = s.event_pool.slots[h as usize].position;
                    follow_note(s, follow_row, pos);
                }
                let ev = s.event_pool.slots[h as usize].clone();
                play_event_preview(s, &ev, tpc);
            } else if dir == DIR_LEFT || dir == DIR_RIGHT {
                let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
                let ev = &s.event_pool.slots[h as usize];
                let max_len = s.patterns[ch][pat_idx].length_ticks - ev.position;
                let steps = build_step_table(tpc, max_len);
                let new_len = step_to(&steps, ev.length, dir == DIR_RIGHT);
                engine_set_event_length(s, sel, new_len);
                let ev = s.event_pool.slots[h as usize].clone();
                play_event_preview(s, &ev, new_len);
            }
        }
        EditGroup::Stack => { // Cmd: stack amount (U/D), repeat amount (L/R)
            if dir == DIR_UP || dir == DIR_DOWN {
                engine_adjust_chord_stack(s, sel, if dir == DIR_UP { 1 } else { -1 });
                follow_chord_edge(s, dir);
                let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
                let ev = s.event_pool.slots[h as usize].clone();
                play_event_preview(s, &ev, tpc);
            } else if dir == DIR_LEFT || dir == DIR_RIGHT {
                let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
                let ev = &s.event_pool.slots[h as usize];
                let amt = ev.repeat_amount;
                let new_amt = if dir == DIR_LEFT { amt.max(2) - 1 } else { amt.min(63) + 1 };
                if amt == 1 && new_amt == 2 && ev.length > tpc {
                    engine_set_event_repeat_space(s, sel, ev.length);
                }
                engine_set_event_repeat_amount(s, sel, new_amt);
            }
        }
        EditGroup::Spacing => { // Cmd+Shift: stack space (U/D), repeat space (L/R)
            if dir == DIR_UP || dir == DIR_DOWN {
                engine_adjust_chord_space(s, sel, if dir == DIR_UP { 1 } else { -1 });
                follow_chord_edge(s, dir);
                let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
                let ev = s.event_pool.slots[h as usize].clone();
                play_event_preview(s, &ev, tpc);
            } else if dir == DIR_LEFT || dir == DIR_RIGHT {
                let steps = build_step_table_with_triplets(tpc, 1920);
                let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
                let cur = s.event_pool.slots[h as usize].repeat_space;
                let new_val = step_to(&steps, cur, dir == DIR_RIGHT);
                engine_set_event_repeat_space(s, sel, new_val);
            }
        }
        EditGroup::Arp => { // Alt: arp style (U/D), arp offset (L/R)
            let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
            let ev = &s.event_pool.slots[h as usize];
            if (dir == DIR_UP || dir == DIR_DOWN) && ev.chord_amount > 1 {
                engine_cycle_arp_style(s, sel, if dir == DIR_UP { 1 } else { -1 });
            } else if (dir == DIR_LEFT || dir == DIR_RIGHT) && ev.chord_amount > 1 && ev.arp_style != ARP_CHORD {
                engine_adjust_arp_offset(s, sel, if dir == DIR_RIGHT { 1 } else { -1 });
            }
        }
        EditGroup::Voicing => { // Alt+Shift: voicing (U/D), arp voices (L/R)
            let h = s.patterns[ch][pat_idx].event_handles[sel as usize];
            let ev = &s.event_pool.slots[h as usize];
            if (dir == DIR_UP || dir == DIR_DOWN) && ev.chord_amount > 1 {
                engine_cycle_chord_voicing(s, sel, if dir == DIR_UP { 1 } else { -1 });
                follow_chord_edge(s, dir);
                let ev = s.event_pool.slots[h as usize].clone();
                play_event_preview(s, &ev, tpc);
            } else if (dir == DIR_LEFT || dir == DIR_RIGHT) && ev.chord_amount > 1 && ev.arp_style != ARP_CHORD {
                engine_adjust_arp_voices(s, sel, if dir == DIR_RIGHT { 1 } else { -1 });
            }
        }
        EditGroup::None => {} // Cmd+Alt combos: no arrow action
    }
}

fn handle_arrow_loop(s: &mut EngineState, dir: u8, mods: u8) {
    if dir != DIR_LEFT && dir != DIR_RIGHT { return; }
    let meta  = (mods & MOD_META)  != 0;
    let alt   = (mods & MOD_ALT)   != 0;
    let shift = (mods & MOD_SHIFT) != 0;

    match (meta, alt, shift) {
        (true,  true,  true)  => {}                         // Cmd+Opt+Shift: placeholder
        (true,  true,  false) => {}                         // Cmd+Opt: placeholder
        (true,  false, true)  => adjust_loop_start(s, dir, true),  // Cmd+Shift: start fine
        (true,  false, false) => adjust_loop_start(s, dir, false), // Cmd: start
        (false, true,  true)  => {}                         // Alt+Shift: placeholder
        (false, true,  false) => {}                         // Alt: placeholder
        (false, false, true)  => adjust_loop_end(s, dir, true),    // Shift: end fine
        (false, false, false) => adjust_loop_end(s, dir, false),   // Bare: end
    }
}

fn handle_arrow_modify(s: &mut EngineState, dir: u8, mods: u8) {
    let meta  = (mods & MOD_META)  != 0;
    let alt   = (mods & MOD_ALT)   != 0;
    let shift = (mods & MOD_SHIFT) != 0;

    match (meta, alt, shift) {
        (true,  true,  true)  => {} // Cmd+Opt+Shift: placeholder
        (true,  true,  false) => {} // Cmd+Opt: placeholder
        (true,  false, true)  => {} // Cmd+Shift: placeholder
        (true,  false, false) => { // Cmd: loop mode (U/D), stay (L/R)
            if s.selected_event_idx < 0 { return; }
            if dir == DIR_UP || dir == DIR_DOWN {
                engine_toggle_sub_mode_loop_mode(s, s.selected_event_idx as u16, s.modify_sub_mode);
            } else if dir == DIR_LEFT || dir == DIR_RIGHT {
                let ch = s.current_channel as usize;
                let pat = s.current_patterns[ch] as usize;
                let h = s.patterns[ch][pat].event_handles[s.selected_event_idx as usize];
                let cur_stay = get_sub_mode(&s.sub_mode_pool, &s.event_pool.slots[h as usize].sub_mode_handles, s.modify_sub_mode as usize).stay;
                let new_stay = if dir == DIR_RIGHT { cur_stay + 1 } else { cur_stay.max(2) - 1 };
                if new_stay != cur_stay {
                    engine_set_sub_mode_stay(s, s.selected_event_idx as u16, s.modify_sub_mode, new_stay);
                }
            }
        }
        (false, true,  true)  => {} // Alt+Shift: placeholder
        (false, true,  false) => {} // Alt: placeholder
        (false, false, true)  => {} // Shift: placeholder
        (false, false, false) => { // Bare: cycle sub-mode (U/D), array length (L/R)
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
            } else if dir == DIR_LEFT || dir == DIR_RIGHT {
                if s.selected_event_idx < 0 { return; }
                let ch = s.current_channel as usize;
                let pat = s.current_patterns[ch] as usize;
                let h = s.patterns[ch][pat].event_handles[s.selected_event_idx as usize];
                let cur_len = get_sub_mode(&s.sub_mode_pool, &s.event_pool.slots[h as usize].sub_mode_handles, s.modify_sub_mode as usize).length;
                let new_len = if dir == DIR_RIGHT { cur_len + 1 } else { cur_len.max(2) - 1 };
                if new_len != cur_len {
                    engine_set_sub_mode_length(s, s.selected_event_idx as u16, s.modify_sub_mode, new_len);
                }
            }
        }
    }
}

pub fn engine_arrow_press(s: &mut EngineState, direction: u8, modifiers: u8) {
    // Ctrl held = channel/pattern overlay — arrows do nothing
    if (modifiers & MOD_CTRL) != 0 { return; }

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
                s.last_deselected_event_idx = s.selected_event_idx;
                s.selected_event_idx = -1;
            } else if s.last_deselected_event_idx >= 0 {
                let ch = s.current_channel as usize;
                let pat_idx = s.current_patterns[ch] as usize;
                let idx = s.last_deselected_event_idx as usize;
                if (idx as u16) < s.patterns[ch][pat_idx].event_count {
                    s.selected_event_idx = s.last_deselected_event_idx;
                    let h = s.patterns[ch][pat_idx].event_handles[idx];
                    if s.event_pool.slots[h as usize].enabled == 0 {
                        s.event_pool.slots[h as usize].enabled = 1;
                        engine_mark_dirty(s, ch as u8);
                    }
                }
                s.last_deselected_event_idx = -1;
            } else {
                s.current_tick = -1;
            }
        }
        ACTION_ZOOM_IN => { s.zoom = zoom_cycle(s.zoom, 1); }
        ACTION_ZOOM_OUT => {
            let new_zoom = zoom_cycle(s.zoom, -1);
            if new_zoom != s.zoom {
                s.zoom = new_zoom;
                // Snap view to show loop boundaries
                let ch = s.current_channel as usize;
                let pat = s.current_patterns[ch] as usize;
                let pat_len = s.patterns[ch][pat].length_ticks;
                let total_cols = if pat_len > 0 && new_zoom > 0 {
                    (pat_len + new_zoom - 1) / new_zoom
                } else { 0 };
                let max_col_off = (total_cols - VISIBLE_COLS as i32).max(0);
                if max_col_off > 0 {
                    let lp_start = s.loops[ch][pat].start;
                    let lp_end = lp_start + s.loops[ch][pat].length;
                    let start_col = lp_start / new_zoom;
                    let end_col = (lp_end + new_zoom - 1) / new_zoom;
                    let loop_cols = end_col - start_col;

                    if loop_cols <= VISIBLE_COLS as i32 {
                        // Loop fits: center it in view
                        let center_col = start_col + loop_cols / 2;
                        let view_start = (center_col - VISIBLE_COLS as i32 / 2).clamp(0, max_col_off);
                        s.target_col_offset = view_start as f32 / max_col_off as f32;
                    } else {
                        // Loop doesn't fit: show loop start
                        let view_start = start_col.clamp(0, max_col_off);
                        s.target_col_offset = view_start as f32 / max_col_off as f32;
                    }
                }
            }
        }
        ACTION_DELETE_NOTE => {
            if s.selected_event_idx >= 0 {
                engine_remove_event(s, s.selected_event_idx as u16);
            }
        }
        ACTION_CLEAR_PATTERN => { engine_clear_pattern(s); }
        ACTION_DISABLE_NOTE => {
            if s.selected_event_idx >= 0 {
                let ch = s.current_channel as usize;
                let pat_idx = s.current_patterns[ch] as usize;
                let h = s.patterns[ch][pat_idx].event_handles[s.selected_event_idx as usize];
                s.event_pool.slots[h as usize].enabled = 0;
                s.last_deselected_event_idx = s.selected_event_idx;
                s.selected_event_idx = -1;
                engine_mark_dirty(s, ch as u8);
            }
        }
        _ => {}
    }
}
