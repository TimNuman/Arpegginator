// engine_edit.rs — Event CRUD, repeat, sub-mode, chord, pattern operations

use crate::engine_core::*;
use crate::engine_ui::engine_mark_dirty;

// ============ Edit Combinators ============
//
// Nearly every edit targets one event of the current pattern and must mark
// that channel's render cache dirty afterwards. These combinators centralize
// the bounds checks, handle lookup, and dirty marking so each operation below
// is only its actual logic.

/// Edit one event of the current pattern. `f` returns whether anything
/// changed; the channel is marked dirty only on change. Out-of-range
/// indices are ignored.
fn with_event(s: &mut EngineState, event_idx: u16, f: impl FnOnce(&mut NoteEvent) -> bool) {
    let (ch, pat) = s.current_indices();
    if event_idx >= s.patterns[ch][pat].event_count { return; }
    let h = s.patterns[ch][pat].event_handles[event_idx as usize];
    if f(&mut s.event_pool[h]) {
        engine_mark_dirty(s, ch as u8);
    }
}

/// Edit one sub-mode array of an event, materializing it from the defaults
/// on first write. Marks the channel dirty. No-op if the event index or
/// sub-mode is out of range, or the sub-mode pool is exhausted.
fn with_sub_mode(s: &mut EngineState, event_idx: u16, sub_mode: u8, f: impl FnOnce(&mut SubModeArray)) {
    if sub_mode as usize >= NUM_SUB_MODES { return; }
    let (ch, pat) = s.current_indices();
    if event_idx >= s.patterns[ch][pat].event_count { return; }
    let h = s.patterns[ch][pat].event_handles[event_idx as usize];
    let handles = &mut s.event_pool[h].sub_mode_handles;
    let Some(arr) = get_sub_mode_mut(&mut s.sub_mode_pool, handles, sub_mode as usize) else { return; };
    f(arr);
    engine_mark_dirty(s, ch as u8);
}

// ============ Helpers ============

fn init_event_fields(ev: &mut NoteEvent, row: i16, position: i32, length: i32, id: u16) {
    *ev = NoteEvent {
        row,
        position,
        length,
        enabled: 1,
        repeat_space: length,
        event_index: id,
        ..NoteEvent::default()
    };
}

/// Deep-copy the event behind `src_handle` into a fresh pool slot: fresh
/// event id and duplicated sub-mode arrays. On sub-mode pool exhaustion the
/// affected handle is reset to `POOL_HANDLE_NONE` so slots are never aliased.
pub fn clone_event_deep(s: &mut EngineState, src_handle: u16) -> Option<u16> {
    let new_handle = s.event_pool.alloc()?;
    s.event_pool[new_handle] = s.event_pool[src_handle].clone();
    s.event_pool[new_handle].event_index = engine_alloc_event_id(s);

    for sm in 0..NUM_SUB_MODES {
        let sm_handle = s.event_pool[new_handle].sub_mode_handles[sm];
        if sm_handle == POOL_HANDLE_NONE { continue; }
        let dup = s.sub_mode_pool.alloc().inspect(|&new_sm| {
            s.sub_mode_pool[new_sm] = s.sub_mode_pool[sm_handle];
        });
        s.event_pool[new_handle].sub_mode_handles[sm] = dup.unwrap_or(POOL_HANDLE_NONE);
    }
    Some(new_handle)
}

fn truncate_overlapping(pat: &mut PatternData, event_pool: &mut NoteEventPool, row: i16, position: i32, exclude_idx: u16) {
    (0..pat.event_count as usize)
        .filter(|&i| i != exclude_idx as usize)
        .for_each(|i| {
            let ev = &mut event_pool[pat.event_handles[i]];
            if ev.row == row && ev.position < position && ev.position + ev.length > position {
                ev.length = position - ev.position;
            }
        });
}

fn remove_event_at(pat: &mut PatternData, idx: u16, event_pool: &mut NoteEventPool, sm_pool: &mut SubModePool) {
    let count = pat.event_count as usize;
    if idx as usize >= count { return; }

    event_free_with_sub_modes(event_pool, sm_pool, pat.event_handles[idx as usize]);

    pat.event_handles.copy_within(idx as usize + 1..count, idx as usize);
    pat.event_handles[count - 1] = POOL_HANDLE_NONE;
    pat.event_count -= 1;
}

// ============ Event CRUD ============

pub fn engine_toggle_event(s: &mut EngineState, row: i16, tick: i32, length_ticks: i32) -> i16 {
    let (ch, pat_idx) = s.current_indices();

    // Find existing event at this position
    let found = (0..s.patterns[ch][pat_idx].event_count as usize)
        .find(|&i| {
            let ev = &s.event_pool[s.patterns[ch][pat_idx].event_handles[i]];
            ev.row == row && ev.position == tick
        });

    if let Some(idx) = found {
        remove_event_at(&mut s.patterns[ch][pat_idx], idx as u16, &mut s.event_pool, &mut s.sub_mode_pool);
        engine_update_has_notes(s, ch as u8, pat_idx as u8);
        engine_mark_dirty(s, ch as u8);
        return -1;
    }

    // No existing event — create new one
    if s.patterns[ch][pat_idx].event_count >= MAX_EVENTS as u16 { return -1; }

    truncate_overlapping(&mut s.patterns[ch][pat_idx], &mut s.event_pool, row, tick, 0xFFFF);

    let new_idx = s.patterns[ch][pat_idx].event_count;
    let id = engine_alloc_event_id(s);
    let Some(handle) = s.event_pool.alloc() else { return -1; };
    init_event_fields(&mut s.event_pool[handle], row, tick, length_ticks, id);
    s.patterns[ch][pat_idx].event_handles[new_idx as usize] = handle;
    s.patterns[ch][pat_idx].event_count += 1;

    engine_update_has_notes(s, ch as u8, pat_idx as u8);
    engine_mark_dirty(s, ch as u8);
    new_idx as i16
}

pub fn engine_remove_event(s: &mut EngineState, event_idx: u16) {
    let (ch, pat_idx) = s.current_indices();
    remove_event_at(&mut s.patterns[ch][pat_idx], event_idx, &mut s.event_pool, &mut s.sub_mode_pool);

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
    with_event(s, event_idx, |ev| {
        ev.row = new_row;
        ev.position = new_position;
        true
    });
}

pub fn engine_set_event_length(s: &mut EngineState, event_idx: u16, length: i32) {
    with_event(s, event_idx, |ev| {
        ev.length = length.max(1);
        true
    });
}

pub fn engine_place_event(s: &mut EngineState, event_idx: u16) {
    let (ch, pat_idx) = s.current_indices();
    if event_idx >= s.patterns[ch][pat_idx].event_count { return; }
    let h = s.patterns[ch][pat_idx].event_handles[event_idx as usize];
    let (row, pos) = (s.event_pool[h].row, s.event_pool[h].position);
    truncate_overlapping(&mut s.patterns[ch][pat_idx], &mut s.event_pool, row, pos, event_idx);
    engine_mark_dirty(s, ch as u8);
}

// ============ Repeat Operations ============

pub fn engine_set_event_repeat_amount(s: &mut EngineState, event_idx: u16, repeat_amount: u16) {
    with_event(s, event_idx, |ev| {
        ev.repeat_amount = repeat_amount.max(1);
        // Setting repeat to 1 on a non-chord arp with a chord: auto-set to chord style
        if ev.repeat_amount == 1 && ev.arp_style != ARP_CHORD && ev.chord_amount > 1 {
            ev.arp_style = ARP_CHORD;
        }
        true
    });
}

pub fn engine_set_event_repeat_space(s: &mut EngineState, event_idx: u16, repeat_space: i32) {
    with_event(s, event_idx, |ev| {
        ev.repeat_space = repeat_space;
        if ev.repeat_amount == 1 {
            ev.repeat_amount = 2;
        }
        true
    });
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
    with_sub_mode(s, event_idx, sub_mode, |arr| {
        let target_len = (repeat_idx + 1) as u8;
        if target_len > arr.length {
            materialize_sub_mode(arr, target_len);
        }
        if repeat_idx < arr.length as u16 {
            arr.values[repeat_idx as usize] = value;
        }
    });
}

pub fn engine_set_sub_mode_length(s: &mut EngineState, event_idx: u16, sub_mode: u8, new_length: u8) {
    with_sub_mode(s, event_idx, sub_mode, |arr| {
        materialize_sub_mode(arr, new_length.clamp(1, MAX_SUB_MODE_LEN as u8));
    });
}

pub fn engine_cycle_sub_mode_loop_mode(s: &mut EngineState, event_idx: u16, sub_mode: u8, forward: bool) {
    with_sub_mode(s, event_idx, sub_mode, |arr| {
        arr.loop_mode = (arr.loop_mode + if forward { 1 } else { 2 }) % 3;
    });
}

pub fn engine_set_sub_mode_stay(s: &mut EngineState, event_idx: u16, sub_mode: u8, stay: u8) {
    with_sub_mode(s, event_idx, sub_mode, |arr| {
        arr.stay = stay.clamp(1, MAX_SUB_MODE_LEN as u8);
    });
}

// ============ Chord Operations ============

pub fn engine_adjust_chord_stack(s: &mut EngineState, event_idx: u16, direction: i8) {
    with_event(s, event_idx, |ev| {
        ev.chord_amount = (ev.chord_amount as i8 + direction).clamp(1, MAX_CHORD_SIZE as i8) as u8;
        ev.chord_voicing = 0;
        true
    });
}

pub fn engine_adjust_chord_space(s: &mut EngineState, event_idx: u16, direction: i8) {
    with_event(s, event_idx, |ev| {
        if ev.chord_amount <= 1 { return false; }
        ev.chord_space = (ev.chord_space as i8 + direction).clamp(1, DIATONIC_OCTAVE as i8) as u8;
        ev.chord_voicing = 0;
        true
    });
}

pub fn engine_cycle_chord_voicing(s: &mut EngineState, event_idx: u16, direction: i8) {
    with_event(s, event_idx, |ev| {
        if ev.chord_amount <= 1 { return false; }
        let count = get_voicing_count(ev.chord_amount, ev.chord_space) as i8;
        if count <= 1 { return false; }
        ev.chord_voicing = (ev.chord_voicing as i8 + direction).rem_euclid(count) as u8;
        true
    });
}

pub fn engine_cycle_chord_inversion(s: &mut EngineState, event_idx: u16, direction: i8) {
    let octave = s.scale_octave_size as i16;
    let min_row = -(s.scale_zero_index as i16);
    let max_row = s.scale_count as i16 - s.scale_zero_index as i16 - 1;

    with_event(s, event_idx, |ev| {
        // Single note: jump octave directly
        if ev.chord_amount <= 1 {
            let new_row = ev.row + if direction > 0 { octave } else { -octave };
            if new_row < min_row || new_row > max_row { return false; }
            ev.row = new_row;
            return true;
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
            false
        } else {
            true
        }
    });
}

pub fn engine_cycle_arp_style(s: &mut EngineState, event_idx: u16, direction: i8) {
    with_event(s, event_idx, |ev| {
        if ev.chord_amount <= 1 { return false; }
        let old_style = ev.arp_style;
        let new_style = (ev.arp_style as i8 + direction).rem_euclid(ARP_STYLE_COUNT as i8) as u8;
        ev.arp_style = new_style;
        // Re-seed random arp each time we land on it
        if new_style == ARP_RANDOM {
            engine_reseed_random_arp();
        }
        // Switching from chord to non-chord with repeat=1: auto-set repeat to natural cycle length
        if old_style == ARP_CHORD && new_style != ARP_CHORD && ev.repeat_amount == 1 {
            ev.repeat_amount = get_arp_cycle_length(new_style, ev.chord_amount);
        }
        true
    });
}

pub fn engine_adjust_arp_voices(s: &mut EngineState, event_idx: u16, direction: i8) {
    with_event(s, event_idx, |ev| {
        if ev.chord_amount <= 1 || ev.arp_style == ARP_CHORD { return false; }
        ev.arp_voices = (ev.arp_voices as i8 + direction).clamp(1, ev.chord_amount as i8 - 1) as u8;
        true
    });
}

pub fn engine_adjust_arp_offset(s: &mut EngineState, event_idx: u16, direction: i8) {
    with_event(s, event_idx, |ev| {
        if ev.chord_amount <= 1 || ev.arp_style == ARP_CHORD { return false; }
        ev.arp_offset = (ev.arp_offset + direction).rem_euclid(ev.chord_amount as i8);
        true
    });
}

// ============ Pattern Operations ============

pub fn engine_copy_pattern(s: &mut EngineState, target_pattern: u8) {
    if target_pattern as usize >= NUM_PATTERNS { return; }
    let (ch, src) = s.current_indices();
    if ch >= NUM_CHANNELS || src >= NUM_PATTERNS { return; }
    let tgt = target_pattern as usize;
    if src == tgt { return; }

    // Free existing target event+sub-mode pool handles
    let tgt_ec = s.patterns[ch][tgt].event_count;
    (0..tgt_ec as usize).for_each(|i| {
        event_free_with_sub_modes(&mut s.event_pool, &mut s.sub_mode_pool, s.patterns[ch][tgt].event_handles[i]);
    });

    // Copy metadata
    let src_ec = s.patterns[ch][src].event_count;
    s.patterns[ch][tgt].length_ticks = s.patterns[ch][src].length_ticks;

    // Deep-copy each event. On pool exhaustion, stop and set event_count to
    // what was actually copied so no freed/stale handle is left referenced
    // (which would alias or double-free a slot).
    let mut copied = 0usize;
    for i in 0..src_ec as usize {
        let src_handle = s.patterns[ch][src].event_handles[i];
        let Some(new_handle) = clone_event_deep(s, src_handle) else { break; };
        s.patterns[ch][tgt].event_handles[i] = new_handle;
        copied = i + 1;
    }
    s.patterns[ch][tgt].event_count = copied as u16;

    // Clear remaining handles in target (covers both unused slots and any source
    // events skipped on pool exhaustion).
    s.patterns[ch][tgt].event_handles[copied..].fill(POOL_HANDLE_NONE);

    s.loops[ch][tgt] = s.loops[ch][src];

    engine_update_has_notes(s, ch as u8, target_pattern);
    engine_mark_dirty(s, ch as u8);
}

pub fn engine_clear_pattern(s: &mut EngineState) {
    let (ch, pat_idx) = s.current_indices();

    // Free event+sub-mode pool handles for all events
    let ec = s.patterns[ch][pat_idx].event_count;
    (0..ec as usize).for_each(|i| {
        event_free_with_sub_modes(&mut s.event_pool, &mut s.sub_mode_pool, s.patterns[ch][pat_idx].event_handles[i]);
        s.patterns[ch][pat_idx].event_handles[i] = POOL_HANDLE_NONE;
    });

    s.patterns[ch][pat_idx].event_count = 0;
    s.patterns[ch][pat_idx].length_ticks = DEFAULT_PATTERN_TICKS;

    s.loops[ch][pat_idx] = PatternLoop { start: 0, length: DEFAULT_LOOP_TICKS };

    s.selected_event_idx = -1;

    engine_update_has_notes(s, ch as u8, pat_idx as u8);
    engine_mark_dirty(s, ch as u8);
}
