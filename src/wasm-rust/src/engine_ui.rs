// engine_ui.rs — Grid rendering, rendered notes, chord offsets

use crate::engine_core::*;
use crate::engine_input::{MOD_CTRL, MOD_META, MOD_SHIFT};

// ============ Sub-mode render configs ============

pub struct SubModeRenderConfig {
    pub render_style: u8, // 0 = bar, 1 = offset
    pub min_val: i16,
    pub max_val: i16,
    pub step: i16,
}

static SUB_MODE_CONFIGS: [SubModeRenderConfig; NUM_SUB_MODES] = [
    SubModeRenderConfig { render_style: 0, min_val: 7, max_val: 127, step: 15 },   // Velocity
    SubModeRenderConfig { render_style: 0, min_val: 12, max_val: 100, step: 12 },   // Hit
    SubModeRenderConfig { render_style: 1, min_val: -50, max_val: 50, step: 5 },    // Timing
    SubModeRenderConfig { render_style: 0, min_val: 12, max_val: 100, step: 12 },   // Flam
    SubModeRenderConfig { render_style: 1, min_val: -12, max_val: 12, step: 1 },    // Modulate
    SubModeRenderConfig { render_style: 1, min_val: -8, max_val: 8, step: 1 },     // Inversion
];

pub fn engine_get_sub_mode_config(sub_mode: u8) -> &'static SubModeRenderConfig {
    let idx = (sub_mode as usize).min(NUM_SUB_MODES - 1);
    &SUB_MODE_CONFIGS[idx]
}

// ============ Level generation ============

pub fn engine_generate_levels(config: &SubModeRenderConfig, out: &mut [i16]) -> u8 {
    let mut count = 0u8;
    let mut v = config.max_val;
    while v >= config.min_val && (count as usize) < out.len() {
        if !(config.render_style == 1 && v == 0) {
            out[count as usize] = v;
            count += 1;
        }
        v -= config.step;
    }
    count
}

pub fn engine_get_default_modify_scroll(levels: &[i16], count: u8, render_style: u8) -> f32 {
    if render_style != 1 || (count as usize) <= VISIBLE_ROWS { return 0.0; }
    let max_scroll = count as usize - VISIBLE_ROWS;
    let zero_idx = levels[..count as usize].iter()
        .position(|&v| v < 0)
        .unwrap_or(0);

    let default_idx = (zero_idx as i16 - VISIBLE_ROWS as i16 / 2)
        .max(0)
        .min(max_scroll as i16);

    if max_scroll > 0 { default_idx as f32 / max_scroll as f32 } else { 0.0 }
}

// ============ Helpers ============

fn resolve_render_sub_mode(s: &EngineState, ev: &NoteEvent, sm: usize, repeat_idx: u16, channel: u8) -> i16 {
    let arr = get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sm);
    resolve_render_sub_mode_inline(arr, repeat_idx, s.counter_snapshots[sm][channel as usize][(ev.event_index as usize) % MAX_EVENTS])
}

/// Variant that works with a pre-extracted SubModeArray and counter snapshot, avoiding borrow conflicts
fn resolve_render_sub_mode_inline(arr: &SubModeArray, repeat_idx: u16, snapshot: u16) -> i16 {
    if arr.length == 0 { return arr.values[0]; }
    match arr.mode() {
        LoopMode::Fill => {
            let idx = repeat_idx.min(arr.length as u16 - 1);
            arr.values[idx as usize]
        },
        LoopMode::Continue => {
            arr.values[((snapshot + repeat_idx) % arr.length as u16) as usize]
        },
        LoopMode::Reset => {
            arr.values[(repeat_idx % arr.length as u16) as usize]
        },
    }
}

// ============ Chord offsets ============

pub fn get_chord_offsets(s: &EngineState, ev: &NoteEvent, offsets: &mut [i8], inversion_extra: i8) -> usize {
    let amount = ev.chord_amount as usize;
    if amount <= 1 {
        offsets[0] = 0;
        return 1;
    }
    let amount = amount.min(MAX_CHORD_SIZE).min(offsets.len());

    // Get base offsets from voicing table
    let mut offsets16 = [0i16; MAX_CHORD_SIZE];
    match get_voicing_list(ev.chord_amount, ev.chord_space) {
        Some(vl) if ev.chord_voicing < vl.count => {
            (0..amount).for_each(|i| {
                offsets16[i] = vl.entries[ev.chord_voicing as usize].offsets[i] as i16;
            });
        }
        _ => {
            (0..amount).for_each(|i| {
                offsets16[i] = (i as i16) * (ev.chord_space as i16);
            });
        }
    }

    // Apply inversions
    let octave = s.scale_octave_size as i16;
    let inv = ev.chord_inversion + inversion_extra;
    if inv > 0 {
        (0..inv as usize).for_each(|n| {
            let idx = n % amount;
            offsets16[idx] += octave;
            (0..4).for_each(|_| {
                let collision = (0..amount).any(|j| j != idx && offsets16[j] == offsets16[idx]);
                if collision { offsets16[idx] += octave; }
            });
        });
    } else if inv < 0 {
        (0..(-inv) as usize).for_each(|n| {
            let idx = amount - 1 - (n % amount);
            offsets16[idx] -= octave;
            (0..4).for_each(|_| {
                let collision = (0..amount).any(|j| j != idx && offsets16[j] == offsets16[idx]);
                if collision { offsets16[idx] -= octave; }
            });
        });
    }

    // Insertion sort by pitch
    (1..amount).for_each(|i| {
        let key = offsets16[i];
        let mut j = i;
        while j > 0 && offsets16[j - 1] > key {
            offsets16[j] = offsets16[j - 1];
            j -= 1;
        }
        offsets16[j] = key;
    });

    (0..amount).for_each(|i| offsets[i] = offsets16[i] as i8);
    amount
}

// ============ Rendered notes ============

pub fn engine_render_events(
    s: &EngineState,
    channel: u8,
    pattern: u8,
    out: &mut [RenderedNote],
    max_out: usize,
) -> u16 {
    let pat = &s.patterns[channel as usize][pattern as usize];
    let mut count = 0usize;

    (0..pat.event_count as usize).for_each(|e| {
        let h = pat.event_handles[e];
        let ev = &s.event_pool.slots[h as usize];
        if ev.enabled == 0 || count >= max_out { return; }

        (0..ev.repeat_amount).for_each(|r| {
            if count >= max_out { return; }
            let mut pos = ev.position + r as i32 * ev.repeat_space;
            if pat.length_ticks > 0 {
                pos = mod_positive(pos, pat.length_ticks);
            }

            let mod_offset = if ev.sub_mode_handles[SubModeId::Modulate as usize] != POOL_HANDLE_NONE {
                resolve_render_sub_mode(s, ev, SubModeId::Modulate as usize, r, channel)
            } else {
                0
            };

            let inv_extra = if ev.sub_mode_handles[SubModeId::Inversion as usize] != POOL_HANDLE_NONE {
                resolve_render_sub_mode(s, ev, SubModeId::Inversion as usize, r, channel) as i8
            } else {
                0
            };

            let mut chord_offsets = [0i8; MAX_CHORD_SIZE];
            let chord_count = get_chord_offsets(s, ev, &mut chord_offsets, inv_extra);

            (0..chord_count).for_each(|c| {
                if count >= max_out { return; }
                if !is_arp_chord_active(ev.arp_style, chord_count as u8, r, ev.arp_offset, ev.arp_voices, c as u8) { return; }

                out[count] = RenderedNote {
                    row: ev.row + mod_offset + chord_offsets[c] as i16,
                    position: pos,
                    length: ev.length,
                    source_idx: e as u16,
                    repeat_index: r,
                    chord_index: c as u8,
                    chord_offset: chord_offsets[c],
                };
                count += 1;
            });
        });
    });

    // Cap note lengths so they don't overlap the next note on the same row
    (0..count).for_each(|i| {
        let rn_pos = out[i].position;
        let rn_row = out[i].row;
        let rn_len = out[i].length;
        let nearest_next = (0..count)
            .filter(|&j| j != i && out[j].row == rn_row && out[j].position > rn_pos && out[j].position < rn_pos + rn_len)
            .map(|j| out[j].position)
            .min()
            .unwrap_or(rn_pos + rn_len);
        out[i].length = nearest_next - rn_pos;
    });

    count as u16
}

// ============ Rendered notes cache ============

pub fn engine_mark_dirty(s: &mut EngineState, channel: u8) {
    if (channel as usize) < NUM_CHANNELS {
        s.rendered_dirty[channel as usize] = 1;
    }
}

pub fn engine_ensure_rendered(s: &mut EngineState, channel: u8) {
    if channel as usize >= NUM_CHANNELS { return; }
    let channel_changed = s.rendered_for_channel != channel;
    if !channel_changed && s.rendered_dirty[channel as usize] == 0 { return; }
    let pat = s.current_patterns[channel as usize];
    // Use a heap-allocated temp buffer to avoid simultaneous &EngineState + &mut s.rendered_notes
    let mut temp_buf = alloc::vec![RenderedNote::default(); MAX_RENDERED_NOTES];
    let count = engine_render_events(s, channel, pat, &mut temp_buf, MAX_RENDERED_NOTES);
    s.rendered_notes[..count as usize].copy_from_slice(&temp_buf[..count as usize]);
    s.rendered_count = count;
    s.rendered_for_channel = channel;
    s.rendered_dirty[channel as usize] = 0;
}

// ============ Grid coordinate helpers ============

fn get_start_tick(s: &EngineState) -> i32 {
    let ticks_per_col = s.zoom;
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let pat_len = s.patterns[ch][pat].length_ticks;
    let total_cols = if pat_len > 0 && ticks_per_col > 0 {
        (pat_len + ticks_per_col - 1) / ticks_per_col
    } else { 0 };

    if total_cols <= VISIBLE_COLS as i32 { return 0; }
    let max_col_offset = total_cols - VISIBLE_COLS as i32;
    let start_col = (s.col_offset * max_col_offset as f32 + 0.5).min(max_col_offset as f32).max(0.0) as i32;
    start_col * ticks_per_col
}

fn get_min_row(s: &EngineState) -> i16 {
    if s.channel_types[s.current_channel as usize] == ChannelType::Drum as u8 {
        0
    } else {
        -(s.scale_zero_index as i16)
    }
}

fn get_start_row(s: &EngineState, total_rows: i16) -> i16 {
    let min_row = get_min_row(s);
    if total_rows <= VISIBLE_ROWS as i16 { return min_row; }
    let ch = s.current_channel as usize;
    let offset = s.row_offsets[ch];
    let max_offset = total_rows - VISIBLE_ROWS as i16;
    let start_array_index = ((1.0 - offset as f64) * max_offset as f64 + 0.5)
        .max(0.0)
        .min(max_offset as f64) as i16;
    start_array_index + min_row
}

fn get_looped_tick(s: &EngineState) -> i32 {
    if s.current_tick < 0 { return -1; }
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let lp = &s.loops[ch][pat];
    if lp.length <= 0 { return -1; }
    lp.start + mod_positive(s.current_tick - lp.start, lp.length)
}

#[allow(dead_code)]
fn is_note_active(s: &EngineState, channel: u8, event_idx: u16, tick: i32) -> bool {
    s.active_notes.iter().any(|an|
        an.active && an.channel == channel && an.event_index == event_idx &&
        tick >= an.start && tick <= an.end
    )
}

// ============ Color helpers ============

fn velocity_color_blend(base_rgb: u32, velocity: i16) -> u32 {
    let white_mix = (1.0 - ((velocity - 7) as f32 / 120.0)) * 0.3;
    let r = ((base_rgb >> 16) & 0xFF) as f32;
    let g = ((base_rgb >> 8) & 0xFF) as f32;
    let b = (base_rgb & 0xFF) as f32;
    let nr = (r + (255.0 - r) * white_mix) as u8;
    let ng = (g + (255.0 - g) * white_mix) as u8;
    let nb = (b + (255.0 - b) * white_mix) as u8;
    ((nr as u32) << 16) | ((ng as u32) << 8) | nb as u32
}

// ============ Pattern Mode Rendering ============

fn render_pattern_mode(s: &mut EngineState, notes: &[RenderedNote], note_count: usize) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let lp_start = s.loops[ch][pat].start;
    let lp_length = s.loops[ch][pat].length;
    let ticks_per_col = s.zoom;
    let start_tick = get_start_tick(s);
    let looped_tick = get_looped_tick(s);
    let loop_end = lp_start + lp_length;

    let total_rows = if s.channel_types[ch] == ChannelType::Drum as u8 { 128 } else { s.scale_count as i16 };
    let start_row = get_start_row(s, total_rows);
    let ch_color = s.channel_colors[ch];

    // Pre-extract event data to avoid borrow conflict (patterns vs active_notes/button_values)
    let event_count = s.patterns[ch][pat].event_count as usize;
    let mut ev_indexes = [0u16; MAX_EVENTS];
    // Heap-allocate to avoid ~50KB stack usage (128 events × 6 sub-modes × 66 bytes)
    let mut ev_sub_modes = alloc::vec![[SubModeArray::default(); NUM_SUB_MODES]; MAX_EVENTS];
    let mut ev_hit_snapshots = [0u16; MAX_EVENTS];
    let mut ev_vel_snapshots = [0u16; MAX_EVENTS];
    (0..event_count).for_each(|i| {
        let h = s.patterns[ch][pat].event_handles[i];
        let ev = &s.event_pool.slots[h as usize];
        let ev_idx = ev.event_index;
        ev_indexes[i] = ev_idx;
        for sm in 0..NUM_SUB_MODES {
            ev_sub_modes[i][sm] = *get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sm);
        }
        ev_hit_snapshots[i] = s.counter_snapshots[SubModeId::Hit as usize][ch][(ev_idx as usize) % MAX_EVENTS];
        ev_vel_snapshots[i] = s.counter_snapshots[SubModeId::Velocity as usize][ch][(ev_idx as usize) % MAX_EVENTS];
    });

    let selected_idx = s.selected_event_idx;
    let active_notes = s.active_notes;
    let is_playing = s.is_playing;
    let scale_zero_index = s.scale_zero_index;
    let scale_count = s.scale_count;
    let scale_root = s.scale_root;
    let is_drum = s.channel_types[ch] == ChannelType::Drum as u8;

    (0..VISIBLE_ROWS).for_each(|vr| {
        let flipped = VISIBLE_ROWS - 1 - vr;
        let actual_row = start_row + flipped as i16;

        (0..VISIBLE_COLS).for_each(|vc| {
            let actual_tick = start_tick + vc as i32 * ticks_per_col;
            let col_end_tick = actual_tick + ticks_per_col;

            let mut value: u16 = BTN_OFF;
            let mut color: u32 = 0;

            // Find notes in this cell — selected event always wins
            let mut best: Option<usize> = None;
            let mut starting_here: Option<usize> = None;
            let mut selected_here: Option<usize> = None;
            let mut playing_note: Option<usize> = None;

            (0..note_count).for_each(|n| {
                let rn = &notes[n];
                if rn.row != actual_row { return; }
                let note_end = rn.position + rn.length;
                if rn.position >= col_end_tick || note_end <= actual_tick { return; }

                if selected_idx >= 0 && rn.source_idx == selected_idx as u16 {
                    let rn_starts = rn.position >= actual_tick && rn.position < col_end_tick;
                    let prev_starts = selected_here.map_or(false, |si|
                        notes[si].position >= actual_tick && notes[si].position < col_end_tick
                    );
                    // Prefer a selected note that starts in this cell over one just continuing
                    if selected_here.is_none() || (rn_starts && !prev_starts) {
                        selected_here = Some(n);
                    }
                }
                if rn.position >= actual_tick && rn.position < col_end_tick && starting_here.is_none() {
                    starting_here = Some(n);
                }
                if best.is_none() || rn.position < notes[best.unwrap()].position {
                    best = Some(n);
                }

                if looped_tick >= 0 && looped_tick >= rn.position && looped_tick < note_end {
                    let ev_id = ev_indexes[rn.source_idx as usize];
                    if active_notes.iter().any(|an| {
                        an.active && an.channel == ch as u8 && an.event_index == ev_id && an.start <= looped_tick && an.end >= looped_tick
                    }) {
                        playing_note = Some(n);
                    }
                }
            });

            let note_at_tick = selected_here.or(starting_here).or(best);

            if let Some(ni) = note_at_tick {
                let rn = &notes[ni];
                let src_sub_modes = &ev_sub_modes[rn.source_idx as usize];

                let hit_sm = &src_sub_modes[SubModeId::Hit as usize];
                let hit_chance = resolve_render_sub_mode_inline(hit_sm, rn.repeat_index, ev_hit_snapshots[rn.source_idx as usize]);
                value = if hit_chance >= 75 { BTN_COLOR_100 }
                    else if hit_chance >= 50 { BTN_COLOR_50 }
                    else { BTN_COLOR_25 };

                let is_start = rn.position >= actual_tick && rn.position < col_end_tick;
                if !is_start { value |= FLAG_CONTINUATION; }
                // Show playing highlight if the displayed note itself is playing,
                // but not if a different note's hold is underneath a hit
                let chosen_playing = playing_note.map_or(false, |pn| pn == ni);
                if chosen_playing || (playing_note.is_some() && !is_start) {
                    value |= FLAG_PLAYING;
                }
                if selected_idx >= 0 && rn.source_idx == selected_idx as u16 {
                    value |= FLAG_SELECTED;
                }

                let vel_sm = &src_sub_modes[SubModeId::Velocity as usize];
                let vel = resolve_render_sub_mode_inline(vel_sm, rn.repeat_index, ev_vel_snapshots[rn.source_idx as usize]);
                color = velocity_color_blend(ch_color, vel);
            } else {
                // Off-screen indicators
                let is_top = vr == 0;
                let is_bottom = vr == VISIBLE_ROWS - 1;
                let is_left = vc == 0;
                let is_right = vc == VISIBLE_COLS - 1;

                if is_top || is_bottom || is_left || is_right {
                    let vis_bottom_row = start_row;
                    let vis_top_row = start_row + VISIBLE_ROWS as i16 - 1;
                    let end_tick = start_tick + VISIBLE_COLS as i32 * ticks_per_col;

                    let off_screen = (0..note_count).any(|n| {
                        let rn = &notes[n];
                        let ne = rn.position + rn.length;
                        (is_top && rn.row > vis_top_row && rn.position <= actual_tick && ne > actual_tick) ||
                        (is_bottom && rn.row < vis_bottom_row && rn.position <= actual_tick && ne > actual_tick) ||
                        (is_right && rn.row == actual_row && rn.position >= end_tick) ||
                        (is_left && rn.row == actual_row && ne <= start_tick)
                    });

                    if off_screen {
                        value = BTN_COLOR_25;
                        color = ch_color;
                    }
                }

                // Grid markers
                let in_loop = actual_tick >= lp_start && actual_tick < loop_end;
                if in_loop {
                    if looped_tick >= 0 && actual_tick <= looped_tick && col_end_tick > looped_tick {
                        value |= FLAG_PLAYHEAD;
                    }
                    if actual_tick == lp_start || (col_end_tick >= loop_end && actual_tick < loop_end) {
                        value |= FLAG_LOOP_BOUNDARY;
                    }
                }

                if (actual_tick / TICKS_PER_QUARTER) % 2 == 0 {
                    value |= FLAG_BEAT_MARKER;
                }

                // Root/C-note marker
                if is_drum {
                    if actual_row >= 36 && (actual_row - 36) % 7 == 0 {
                        value |= FLAG_C_NOTE;
                    }
                } else {
                    let midi_idx = scale_zero_index as i32 + actual_row as i32;
                    if midi_idx >= 0 && midi_idx < scale_count as i32 {
                        let midi = s.scale_notes[midi_idx as usize];
                        if midi % 12 == scale_root {
                            value |= FLAG_C_NOTE;
                        }
                    }
                }
            }

            s.button_values[vr][vc] = value;
            s.color_overrides[vr][vc] = color;
        });
    });
}

// ============ Channel Mode Rendering ============

fn render_channel_mode(s: &mut EngineState, notes: &[RenderedNote], note_count: usize) {
    let any_soloed = s.soloed.iter().any(|&v| v != 0);

    render_pattern_mode(s, notes, note_count);

    (0..VISIBLE_ROWS).for_each(|vr| {
        let ch_idx = vr;
        let ch_color = s.channel_colors[ch_idx];
        let cur_pat = s.current_patterns[ch_idx];
        let is_muted = s.muted[ch_idx] != 0;
        let is_soloed = s.soloed[ch_idx] != 0;
        let is_eff_muted = is_muted || (any_soloed && !is_soloed);

        (0..VISIBLE_COLS).for_each(|vc| {
            if vc == 0 {
                let is_playing_now = s.channels_playing_now[ch_idx] != 0;
                let val = if is_soloed { BTN_WHITE_25 }
                    else if is_eff_muted { BTN_COLOR_25 }
                    else { BTN_COLOR_100 };
                s.button_values[vr][vc] = val | if is_playing_now { FLAG_PLAYHEAD } else { 0 };
                s.color_overrides[vr][vc] = ch_color;
                return;
            }

            let pat_idx = vc - 1;
            if pat_idx >= NUM_PATTERNS {
                s.button_values[vr][vc] |= FLAG_DIMMED;
                return;
            }

            let has_notes = s.patterns_have_notes[ch_idx][pat_idx] != 0;
            let is_selected = ch_idx == s.current_channel as usize && pat_idx == cur_pat as usize;
            let is_active = pat_idx == cur_pat as usize;
            let is_queued = s.queued_patterns[ch_idx] == pat_idx as i8;
            let is_playing_now = is_active && s.channels_playing_now[ch_idx] != 0;
            let is_empty = !has_notes && !is_queued;

            if !is_empty {
                let mut val = if is_selected { BTN_COLOR_100 } else { BTN_COLOR_50 };
                if is_eff_muted { val = BTN_COLOR_25; }
                else if is_soloed && !is_selected { val = BTN_WHITE_25; }
                if is_playing_now || is_queued { val |= FLAG_PLAYHEAD; }
                s.button_values[vr][vc] = val;
                s.color_overrides[vr][vc] = ch_color;
            } else {
                s.button_values[vr][vc] |= FLAG_DIMMED;
            }
        });
    });
}

// ============ Loop Mode Rendering ============

fn render_loop_mode(s: &mut EngineState, notes: &[RenderedNote], note_count: usize) {
    render_pattern_mode(s, notes, note_count);

    (0..VISIBLE_ROWS).for_each(|vr| {
        (0..VISIBLE_COLS).for_each(|vc| {
            if s.button_values[vr][vc] & FLAG_LOOP_BOUNDARY != 0 {
                s.button_values[vr][vc] |= FLAG_LOOP_BOUNDARY_PULSING;
            }
            if s.is_playing == 0 {
                s.button_values[vr][vc] &= !FLAG_PLAYHEAD;
            }
        });
    });
}

// ============ Modify Mode Rendering ============

fn render_modify_mode(s: &mut EngineState) {
    if s.selected_event_idx < 0 {
        (0..VISIBLE_ROWS).for_each(|r| {
            (0..VISIBLE_COLS).for_each(|c| {
                s.button_values[r][c] = BTN_OFF | FLAG_DIMMED;
                s.color_overrides[r][c] = 0;
            });
        });
        return;
    }

    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let ev_idx = s.selected_event_idx as usize;
    if ev_idx >= s.patterns[ch][pat].event_count as usize { return; }

    let sm = s.modify_sub_mode as usize;
    let config = engine_get_sub_mode_config(sm as u8);

    // Read event data via pool to avoid borrow issues
    let h = s.patterns[ch][pat].event_handles[ev_idx];
    let ev = &s.event_pool.slots[h as usize];
    let repeat_amount = ev.repeat_amount;
    let sm_arr = get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sm);
    let array_length = sm_arr.length;
    let loop_mode = sm_arr.loop_mode;
    let ev_position = ev.position;
    let ev_repeat_space = ev.repeat_space;
    let ev_length = ev.length;
    let ev_event_index = ev.event_index;

    let mut all_levels = [0i16; 128];
    let all_levels_count = engine_generate_levels(config, &mut all_levels) as usize;
    if all_levels_count == 0 { return; }

    let mut visible_levels = [0i16; VISIBLE_ROWS];
    if all_levels_count <= VISIBLE_ROWS {
        visible_levels[..all_levels_count].copy_from_slice(&all_levels[..all_levels_count]);
    } else {
        let scroll = engine_get_default_modify_scroll(&all_levels, all_levels_count as u8, config.render_style);
        let max_scroll = all_levels_count - VISIBLE_ROWS;
        let scroll_idx = (scroll * max_scroll as f32) as usize;
        visible_levels.copy_from_slice(&all_levels[scroll_idx..scroll_idx + VISIBLE_ROWS]);
    }

    // Center rows for offset rendering
    let mut center_rows = [false; VISIBLE_ROWS];
    if config.render_style == 1 {
        (0..VISIBLE_ROWS - 1).for_each(|i| {
            if visible_levels[i] > 0 && visible_levels[i + 1] < 0 {
                center_rows[i] = true;
                center_rows[i + 1] = true;
            }
        });
    }

    // Determine playing column
    let looped_tick = get_looped_tick(s);
    let playing_col: i16 = if looped_tick >= 0 {
        (0..repeat_amount).find_map(|r| {
            let tick_start = ev_position + r as i32 * ev_repeat_space;
            let tick_end = tick_start + ev_length;
            if looped_tick >= tick_start && looped_tick < tick_end {
                if loop_mode == LoopMode::Continue as u8 {
                    let counter = s.continue_counters[sm][ch][(ev_event_index as usize) % MAX_EVENTS];
                    let last_used = if counter > 0 { counter - 1 } else { 0 };
                    Some((last_used % array_length as u16) as i16)
                } else {
                    Some(r as i16)
                }
            } else { None }
        }).unwrap_or(-1)
    } else { -1 };

    let get_value = |idx: u16| -> i16 {
        if sm_arr.length == 0 { return sm_arr.values[0]; }
        if loop_mode == LoopMode::Fill as u8 {
            sm_arr.values[idx.min(sm_arr.length as u16 - 1) as usize]
        } else {
            sm_arr.values[(idx % sm_arr.length as u16) as usize]
        }
    };

    (0..VISIBLE_ROWS).for_each(|vr| {
        let threshold = visible_levels[vr];

        (0..VISIBLE_COLS).for_each(|vc| {
            let is_playing_col = vc as i16 == playing_col;
            let is_explicit = (vc as u8) < array_length;
            let is_in_repeat = (vc as u16) < repeat_amount;

            if !is_explicit && !is_in_repeat {
                s.button_values[vr][vc] = if is_playing_col { FLAG_PLAYHEAD } else { BTN_OFF };
                s.color_overrides[vr][vc] = 0;
                return;
            }

            let val = get_value(vc as u16);

            if config.render_style == 1 {
                // Offset mode
                let match_row = (0..VISIBLE_ROWS as u8).find(|&i| visible_levels[i as usize] == val);
                if match_row == Some(vr as u8) {
                    let intensity = if is_explicit { BTN_COLOR_100 } else { BTN_COLOR_50 };
                    s.button_values[vr][vc] = intensity | if is_playing_col { FLAG_PLAYING } else { 0 };
                } else if center_rows[vr] {
                    s.button_values[vr][vc] = BTN_COLOR_25 | if is_playing_col { FLAG_PLAYING } else { 0 };
                } else {
                    s.button_values[vr][vc] = if is_playing_col { FLAG_PLAYHEAD } else { BTN_OFF };
                }
            } else {
                // Bar mode
                if val >= threshold {
                    let intensity = if is_explicit { BTN_COLOR_100 } else { BTN_COLOR_50 };
                    s.button_values[vr][vc] = intensity | if is_playing_col { FLAG_PLAYING } else { 0 };
                } else {
                    s.button_values[vr][vc] = if is_playing_col { FLAG_PLAYHEAD } else { BTN_OFF };
                }
            }
            s.color_overrides[vr][vc] = 0;
        });
    });
}

// ============ Ctrl Overlay ============

fn apply_ctrl_overlay(s: &mut EngineState) {
    if (s.modifiers_held & MOD_CTRL) == 0 { return; }

    static MODE_COLORS: [u32; 3] = [0x33CCFF, 0x33FF66, 0xFF6633];
    static COL_TO_MODE: [u8; 3] = [
        UiMode::Channel as u8, UiMode::Pattern as u8,
        UiMode::Modify as u8,
    ];

    (0..VISIBLE_ROWS).for_each(|r| {
        (0..VISIBLE_COLS).for_each(|c| {
            if r == 7 && c <= 2 {
                let is_current = s.ui_mode == COL_TO_MODE[c];
                s.button_values[r][c] = if is_current { BTN_COLOR_100 } else { BTN_COLOR_50 };
                s.color_overrides[r][c] = MODE_COLORS[c];
            } else {
                s.button_values[r][c] |= FLAG_DIMMED;
            }
        });
    });
}

// ============ Main Entry Point ============

const EASE_FACTOR: f32 = 0.12;
const EASE_SNAP: f32 = 0.001;

pub fn engine_compute_grid(s: &mut EngineState) {
    // Auto-scroll to follow playhead
    crate::engine_strip::engine_playhead_follow(s);

    // Apply strip inertia (both strips)
    crate::engine_strip::engine_strip_inertia_tick(s, 0);
    crate::engine_strip::engine_strip_inertia_tick(s, 1);

    let ch = s.current_channel as usize;

    // Ease row offset toward target
    let cur = s.row_offsets[ch];
    let tgt = s.target_row_offsets[ch];
    if cur != tgt {
        let diff = tgt - cur;
        if diff.abs() < EASE_SNAP {
            s.row_offsets[ch] = tgt;
        } else {
            s.row_offsets[ch] = cur + diff * EASE_FACTOR;
        }
    }

    // Clear buffers
    s.button_values = [[0; VISIBLE_COLS]; VISIBLE_ROWS];
    s.color_overrides = [[0; VISIBLE_COLS]; VISIBLE_ROWS];

    engine_ensure_rendered(s, ch as u8);

    // Copy rendered notes to avoid borrow conflict
    let notes: Vec<RenderedNote> = s.rendered_notes[..s.rendered_count as usize].to_vec();
    let note_count = notes.len();

    match UiMode::from_u8(s.ui_mode) {
        UiMode::Channel => render_channel_mode(s, &notes, note_count),
        UiMode::Loop => render_loop_mode(s, &notes, note_count),
        UiMode::Modify => render_modify_mode(s),
        UiMode::Pattern => {
            render_pattern_mode(s, &notes, note_count);
            // Pulse loop boundary when Cmd held in pattern mode with no selection
            if (s.modifiers_held & MOD_META) != 0 && s.selected_event_idx < 0 {
                let ch = s.current_channel as usize;
                let pat = s.current_patterns[ch] as usize;
                let lp_start = s.loops[ch][pat].start;
                let loop_end = lp_start + s.loops[ch][pat].length;
                let tpc = s.zoom;
                let start_tick = get_start_tick(s);
                let pulse_shift = (s.modifiers_held & MOD_SHIFT) != 0;

                (0..VISIBLE_COLS).for_each(|vc| {
                    let actual_tick = start_tick + vc as i32 * tpc;
                    let col_end_tick = actual_tick + tpc;
                    let is_start_col = actual_tick == lp_start;
                    let is_end_col = col_end_tick >= loop_end && actual_tick < loop_end;

                    if (pulse_shift && is_start_col) || (!pulse_shift && is_end_col) {
                        (0..VISIBLE_ROWS).for_each(|vr| {
                            s.button_values[vr][vc] |= FLAG_LOOP_BOUNDARY_PULSING;
                        });
                    }
                });
            }
        }
    }

    apply_ctrl_overlay(s);

    // Update channels_playing_now
    (0..NUM_CHANNELS).for_each(|i| {
        s.channels_playing_now[i] = if s.active_notes.iter().any(|n| n.active && n.channel == i as u8) { 1 } else { 0 };
    });
}

pub fn engine_is_animating(s: &EngineState) -> bool {
    s.row_offsets.iter().zip(s.target_row_offsets.iter())
        .any(|(cur, tgt)| (tgt - cur).abs() > EASE_SNAP)
    // Only count strip velocity when not actively dragging (inertia is a no-op during drag)
    || (s.strip_dragging[0] == 0 && s.strip_velocity[0].abs() > 0.0001)
    || (s.strip_dragging[1] == 0 && s.strip_velocity[1].abs() > 0.0001)
}
