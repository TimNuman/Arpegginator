// engine_edit.rs — Event CRUD, repeat, sub-mode, chord, pattern operations

use crate::engine_core::*;
use crate::engine_ui::engine_mark_dirty;

// Defaults for new events
const DEFAULT_VELOCITY: i16 = 100;
const DEFAULT_HIT_CHANCE: i16 = 100;
const DEFAULT_TIMING: i16 = 0;
const DEFAULT_FLAM: i16 = 0;
const DEFAULT_MODULATE: i16 = 0;

// ============ Helpers ============

fn get_current_pattern_indices(s: &EngineState) -> (usize, usize) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    (ch, pat)
}

fn init_event(ev: &mut NoteEvent, row: i16, position: i32, length: i32, id: u16) {
    *ev = NoteEvent::default();
    ev.row = row;
    ev.position = position;
    ev.length = length;
    ev.enabled = 1;
    ev.repeat_amount = 1;
    ev.repeat_space = length;
    ev.chord_amount = 1;
    ev.chord_space = 2;
    ev.chord_inversion = 0;
    ev.arp_style = ARP_CHORD;
    ev.arp_offset = 0;
    ev.arp_voices = 1;
    ev.event_index = id;

    let sub_defaults: [(usize, i16); NUM_SUB_MODES] = [
        (0, DEFAULT_VELOCITY),
        (1, DEFAULT_HIT_CHANCE),
        (2, DEFAULT_TIMING),
        (3, DEFAULT_FLAM),
        (4, DEFAULT_MODULATE),
    ];

    sub_defaults.iter().for_each(|&(sm, val)| {
        ev.sub_modes[sm].values[0] = val;
        ev.sub_modes[sm].length = 1;
        ev.sub_modes[sm].loop_mode = LoopMode::Reset as u8;
    });
}

fn truncate_overlapping(pat: &mut PatternData, row: i16, position: i32, exclude_idx: u16) {
    (0..pat.event_count as usize)
        .filter(|&i| i != exclude_idx as usize)
        .for_each(|i| {
            let ev = &mut pat.events[i];
            if ev.row == row && ev.position < position && ev.position + ev.length > position {
                ev.length = position - ev.position;
            }
        });
}

fn remove_event_at(pat: &mut PatternData, idx: u16) {
    let count = pat.event_count as usize;
    if idx as usize >= count { return; }

    (idx as usize..count - 1).for_each(|i| {
        pat.events[i] = pat.events[i + 1].clone();
    });
    pat.event_count -= 1;
}

// ============ Event CRUD ============

pub fn engine_toggle_event(s: &mut EngineState, row: i16, tick: i32, length_ticks: i32) -> i16 {
    let (ch, pat_idx) = get_current_pattern_indices(s);

    // Find existing event at this position
    let found = (0..s.patterns[ch][pat_idx].event_count as usize)
        .find(|&i| s.patterns[ch][pat_idx].events[i].row == row && s.patterns[ch][pat_idx].events[i].position == tick);

    if let Some(idx) = found {
        remove_event_at(&mut s.patterns[ch][pat_idx], idx as u16);
        engine_update_has_notes(s, ch as u8, pat_idx as u8);
        engine_mark_dirty(s, ch as u8);
        return -1;
    }

    // No existing event — create new one
    if s.patterns[ch][pat_idx].event_count >= MAX_EVENTS as u16 { return -1; }

    truncate_overlapping(&mut s.patterns[ch][pat_idx], row, tick, 0xFFFF);

    let new_idx = s.patterns[ch][pat_idx].event_count;
    let id = engine_alloc_event_id(s);
    init_event(&mut s.patterns[ch][pat_idx].events[new_idx as usize], row, tick, length_ticks, id);
    s.patterns[ch][pat_idx].event_count += 1;

    engine_update_has_notes(s, ch as u8, pat_idx as u8);
    engine_mark_dirty(s, ch as u8);
    new_idx as i16
}

pub fn engine_remove_event(s: &mut EngineState, event_idx: u16) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    remove_event_at(&mut s.patterns[ch][pat_idx], event_idx);

    if s.selected_event_idx >= 0 {
        if s.selected_event_idx as u16 == event_idx {
            s.selected_event_idx = -1;
        } else if s.selected_event_idx as u16 > event_idx {
            s.selected_event_idx -= 1;
        }
    }

    engine_update_has_notes(s, ch as u8, pat_idx as u8);
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_move_event(s: &mut EngineState, event_idx: u16, new_row: i16, new_position: i32) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    s.patterns[ch][pat_idx].events[event_idx as usize].row = new_row;
    s.patterns[ch][pat_idx].events[event_idx as usize].position = new_position;
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_set_event_length(s: &mut EngineState, event_idx: u16, length: i32) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    s.patterns[ch][pat_idx].events[event_idx as usize].length = length.max(1);
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_place_event(s: &mut EngineState, event_idx: u16) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let row = s.patterns[ch][pat_idx].events[event_idx as usize].row;
    let pos = s.patterns[ch][pat_idx].events[event_idx as usize].position;
    truncate_overlapping(&mut s.patterns[ch][pat_idx], row, pos, event_idx);
    engine_mark_dirty(s, ch as u8);
}

// ============ Repeat Operations ============

pub fn engine_set_event_repeat_amount(s: &mut EngineState, event_idx: u16, repeat_amount: u16) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    s.patterns[ch][pat_idx].events[event_idx as usize].repeat_amount = repeat_amount;
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_set_event_repeat_space(s: &mut EngineState, event_idx: u16, repeat_space: i32) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    s.patterns[ch][pat_idx].events[event_idx as usize].repeat_space = repeat_space;
    engine_mark_dirty(s, ch as u8);
}

// ============ Sub-Mode Operations ============

fn materialize_sub_mode(arr: &mut SubModeArray, target_length: u8) {
    if target_length <= arr.length {
        arr.length = target_length;
        return;
    }

    let old_len = (arr.length as usize).max(1);
    let target = (target_length as usize).min(MAX_SUB_MODE_LEN);

    (old_len..target).for_each(|i| {
        arr.values[i] = match arr.mode() {
            LoopMode::Fill => arr.values[old_len - 1],
            _ => arr.values[i % old_len],
        };
    });

    arr.length = target as u8;
}

pub fn engine_set_sub_mode_value(s: &mut EngineState, event_idx: u16, sub_mode: u8, repeat_idx: u16, value: i16) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count || sub_mode as usize >= NUM_SUB_MODES { return; }

    let target_len = (repeat_idx + 1) as u8;
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];
    if target_len > ev.sub_modes[sub_mode as usize].length {
        materialize_sub_mode(&mut ev.sub_modes[sub_mode as usize], target_len);
    }
    if repeat_idx < ev.sub_modes[sub_mode as usize].length as u16 {
        ev.sub_modes[sub_mode as usize].values[repeat_idx as usize] = value;
    }
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_set_sub_mode_length(s: &mut EngineState, event_idx: u16, sub_mode: u8, new_length: u8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count || sub_mode as usize >= NUM_SUB_MODES { return; }

    let clamped = new_length.max(1).min(MAX_SUB_MODE_LEN as u8);
    materialize_sub_mode(&mut s.patterns[ch][pat_idx].events[event_idx as usize].sub_modes[sub_mode as usize], clamped);
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_toggle_sub_mode_loop_mode(s: &mut EngineState, event_idx: u16, sub_mode: u8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count || sub_mode as usize >= NUM_SUB_MODES { return; }

    let arr = &mut s.patterns[ch][pat_idx].events[event_idx as usize].sub_modes[sub_mode as usize];
    arr.loop_mode = (arr.loop_mode + 1) % 3;
    engine_mark_dirty(s, ch as u8);
}

// ============ Chord Operations ============

pub fn engine_adjust_chord_stack(s: &mut EngineState, event_idx: u16, direction: i8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];

    ev.chord_amount = ((ev.chord_amount as i8 + direction).max(1).min(MAX_CHORD_SIZE as i8)) as u8;
    ev.chord_voicing = 0;
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_adjust_chord_space(s: &mut EngineState, event_idx: u16, direction: i8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];

    if ev.chord_amount <= 1 { return; }
    ev.chord_space = ((ev.chord_space as i8 + direction).max(1).min(DIATONIC_OCTAVE as i8)) as u8;
    ev.chord_voicing = 0;
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_cycle_chord_voicing(s: &mut EngineState, event_idx: u16, direction: i8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];

    if ev.chord_amount <= 1 { return; }

    let count = get_voicing_count(ev.chord_amount, ev.chord_space) as i8;
    if count <= 1 { return; }

    let new_v = ((ev.chord_voicing as i8 + direction) % count + count) % count;
    ev.chord_voicing = new_v as u8;
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_cycle_chord_inversion(s: &mut EngineState, event_idx: u16, direction: i8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];

    let octave = s.scale_octave_size as i16;
    let min_row = -(s.scale_zero_index as i16);
    let max_row = s.scale_count as i16 - s.scale_zero_index as i16 - 1;

    // Single note: jump octave directly
    if ev.chord_amount <= 1 {
        let new_row = ev.row + if direction > 0 { octave } else { -octave };
        if new_row < min_row || new_row > max_row { return; }
        ev.row = new_row;
        engine_mark_dirty(s, ch as u8);
        return;
    }

    // Save state for rollback
    let old_inv = ev.chord_inversion;
    let old_row = ev.row;

    ev.chord_inversion += direction;

    let amt = ev.chord_amount as i8;
    if ev.chord_inversion >= amt {
        ev.chord_inversion -= amt;
        ev.row += octave;
    } else if ev.chord_inversion <= -amt {
        ev.chord_inversion += amt;
        ev.row -= octave;
    }

    // Validate range
    let chord_min = (0..ev.chord_amount as i16).map(|i| i * ev.chord_space as i16).min().unwrap_or(0);
    let mut chord_max = (0..ev.chord_amount as i16).map(|i| i * ev.chord_space as i16).max().unwrap_or(0);
    let mut final_min = chord_min;

    if ev.chord_inversion > 0 { chord_max += octave; }
    if ev.chord_inversion < 0 { final_min -= octave; }

    if ev.row + final_min < min_row || ev.row + chord_max > max_row {
        ev.chord_inversion = old_inv;
        ev.row = old_row;
    } else {
        engine_mark_dirty(s, ch as u8);
    }
}

pub fn engine_cycle_arp_style(s: &mut EngineState, event_idx: u16, direction: i8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];

    if ev.chord_amount <= 1 { return; }
    let new_style = ((ev.arp_style as i8 + direction) % ARP_STYLE_COUNT as i8 + ARP_STYLE_COUNT as i8) % ARP_STYLE_COUNT as i8;
    ev.arp_style = new_style as u8;
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_adjust_arp_voices(s: &mut EngineState, event_idx: u16, direction: i8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];

    if ev.chord_amount <= 1 || ev.arp_style == ARP_CHORD { return; }
    let new_voices = (ev.arp_voices as i8 + direction).max(1).min(ev.chord_amount as i8 - 1);
    ev.arp_voices = new_voices as u8;
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_adjust_arp_offset(s: &mut EngineState, event_idx: u16, direction: i8) {
    let (ch, pat_idx) = get_current_pattern_indices(s);
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let ev = &mut s.patterns[ch][pat_idx].events[event_idx as usize];

    if ev.chord_amount <= 1 || ev.arp_style == ARP_CHORD { return; }
    ev.arp_offset += direction;
    engine_mark_dirty(s, ch as u8);
}

// ============ Pattern Operations ============

pub fn engine_copy_pattern(s: &mut EngineState, target_pattern: u8) {
    if target_pattern as usize >= NUM_PATTERNS { return; }
    let ch = s.current_channel as usize;
    let src = s.current_patterns[ch] as usize;
    let tgt = target_pattern as usize;
    if src == tgt { return; }

    s.patterns[ch][tgt] = s.patterns[ch][src].clone();

    // Assign new event IDs
    let ec = s.patterns[ch][tgt].event_count;
    (0..ec as usize).for_each(|i| {
        s.patterns[ch][tgt].events[i].event_index = engine_alloc_event_id(s);
    });

    s.loops[ch][tgt] = s.loops[ch][src];

    engine_update_has_notes(s, ch as u8, target_pattern);
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_clear_pattern(s: &mut EngineState) {
    let (ch, pat_idx) = get_current_pattern_indices(s);

    s.patterns[ch][pat_idx].event_count = 0;
    s.patterns[ch][pat_idx].length_ticks = DEFAULT_PATTERN_TICKS;

    s.loops[ch][pat_idx].start = 0;
    s.loops[ch][pat_idx].length = DEFAULT_LOOP_TICKS;

    s.selected_event_idx = -1;

    engine_update_has_notes(s, ch as u8, pat_idx as u8);
    engine_mark_dirty(s, ch as u8);
}
