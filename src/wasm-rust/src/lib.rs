// lib.rs — WASM exports and JS callback bridges for the Rust engine
// Equivalent to engine_wasm.c in the C version
//
// Single-threaded WASM — mutable statics are safe in this context.
#![allow(static_mut_refs)]

pub mod engine_core;
pub mod engine_edit;
pub mod engine_ui;
pub mod engine_input;
pub mod oled_gfx;
pub mod oled_fonts;
pub mod oled_display;
pub mod oled_screen;

use engine_core::*;

// ============ Alloc (required for cdylib) ============

extern crate alloc;

// ============ Global Engine State ============

static mut G_STATE: Option<Box<EngineState>> = None;

/// Get a mutable reference to the global state. Panics if not initialized.
fn state() -> &'static mut EngineState {
    unsafe {
        G_STATE.as_deref_mut().expect("engine not initialized")
    }
}

/// Get an immutable reference to the global state.
fn state_ref() -> &'static EngineState {
    unsafe {
        G_STATE.as_deref().expect("engine not initialized")
    }
}

// Pointer for oled_screen to access
pub static mut G_STATE_PTR: *const EngineState = core::ptr::null();

// ============ JS Callback Imports (WASM only) ============

#[cfg(not(test))]
extern "C" {
    fn js_step_trigger(ch: i32, note: i32, tick: i32, len: i32, vel: i32, timing: i32, flam: i32, ev_idx: i32);
    fn js_note_off(ch: i32, note: i32);
    fn js_set_current_tick(tick: i32);
    fn js_set_current_patterns(ptr: i32);
    fn js_clear_queued_pattern(ch: i32);
    fn js_preview_value(sm: i32, ch: i32, ev_idx: i32, tick: i32, val: i32);
    fn js_play_preview_note(ch: i32, row: i32, length_ticks: i32);
}

// ============ Platform Callback Implementations ============

#[cfg(not(test))]
pub fn platform_step_trigger(
    channel: u8, midi_note: u8, tick: i32,
    note_length_ticks: i32, velocity: u8,
    timing_offset_pct: i8, flam_count: u8,
    event_index: u16,
) {
    unsafe {
        js_step_trigger(
            channel as i32, midi_note as i32, tick,
            note_length_ticks, velocity as i32,
            timing_offset_pct as i32, flam_count as i32,
            event_index as i32,
        );
    }
}

#[cfg(not(test))]
pub fn platform_note_off(channel: u8, midi_note: u8) {
    unsafe { js_note_off(channel as i32, midi_note as i32); }
}

#[cfg(not(test))]
pub fn platform_set_current_tick(tick: i32) {
    unsafe { js_set_current_tick(tick); }
}

#[cfg(not(test))]
pub fn platform_set_current_patterns(patterns: &[u8; NUM_CHANNELS]) {
    unsafe { js_set_current_patterns(patterns.as_ptr() as i32); }
}

#[cfg(not(test))]
pub fn platform_clear_queued_pattern(channel: u8) {
    unsafe { js_clear_queued_pattern(channel as i32); }
}

#[cfg(not(test))]
pub fn platform_preview_value(
    sub_mode: u8, channel: u8,
    event_index: u16, tick: i32, value: i16,
) {
    unsafe {
        js_preview_value(
            sub_mode as i32, channel as i32,
            event_index as i32, tick, value as i32,
        );
    }
}

#[cfg(not(test))]
pub fn platform_play_preview_note(channel: u8, row: i16, length_ticks: i32) {
    unsafe { js_play_preview_note(channel as i32, row as i32, length_ticks); }
}

// ============ Platform Callback Stubs (test only) ============

#[cfg(test)]
pub fn platform_step_trigger(
    _channel: u8, _midi_note: u8, _tick: i32,
    _note_length_ticks: i32, _velocity: u8,
    _timing_offset_pct: i8, _flam_count: u8,
    _event_index: u16,
) {}

#[cfg(test)]
pub fn platform_note_off(_channel: u8, _midi_note: u8) {}

#[cfg(test)]
pub fn platform_set_current_tick(_tick: i32) {}

#[cfg(test)]
pub fn platform_set_current_patterns(_patterns: &[u8; NUM_CHANNELS]) {}

#[cfg(test)]
pub fn platform_clear_queued_pattern(_channel: u8) {}

#[cfg(test)]
pub fn platform_preview_value(
    _sub_mode: u8, _channel: u8,
    _event_index: u16, _tick: i32, _value: i16,
) {}

#[cfg(test)]
pub fn platform_play_preview_note(_channel: u8, _row: i16, _length_ticks: i32) {}

// ============ Exported Functions ============

#[no_mangle]
pub extern "C" fn engine_init() {
    let mut s = Box::new(EngineState::default());
    engine_core::engine_core_init(&mut s);
    unsafe {
        G_STATE = Some(s);
        G_STATE_PTR = G_STATE.as_deref().unwrap() as *const EngineState;
    }
}

#[no_mangle]
pub extern "C" fn engine_play_init() {
    engine_core::engine_core_play_init(state());
}

#[no_mangle]
pub extern "C" fn engine_play_init_from_tick(tick: i32) {
    engine_core::engine_core_play_init_from_tick(state(), tick);
}

#[no_mangle]
pub extern "C" fn engine_tick() {
    engine_core::engine_core_tick(state());
}

#[no_mangle]
pub extern "C" fn engine_scrub_to_tick(target_tick: i32) {
    engine_core::engine_core_scrub_to_tick(state(), target_tick);
}

#[no_mangle]
pub extern "C" fn engine_scrub_end() {
    engine_core::engine_core_scrub_end(state());
}

#[no_mangle]
pub extern "C" fn engine_stop() {
    engine_core::engine_core_stop(state());
}

#[no_mangle]
pub extern "C" fn engine_get_version() -> i32 {
    engine_core::engine_core_get_version()
}

// ============ Buffer Accessors ============

#[no_mangle]
pub extern "C" fn engine_get_event_buffer(ch: u8, pat: u8) -> *mut NoteEvent {
    let s = state();
    s.patterns[ch as usize][pat as usize].events.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_set_event_count(ch: u8, pat: u8, count: u16) {
    state().patterns[ch as usize][pat as usize].event_count = count;
}

#[no_mangle]
pub extern "C" fn engine_set_pattern_length(ch: u8, pat: u8, len: i32) {
    state().patterns[ch as usize][pat as usize].length_ticks = len;
}

#[no_mangle]
pub extern "C" fn engine_get_loops_buffer() -> *mut PatternLoop {
    let s = state();
    s.loops[0].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_muted_buffer() -> *mut u8 {
    state().muted.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_soloed_buffer() -> *mut u8 {
    state().soloed.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_channel_types_buffer() -> *mut u8 {
    state().channel_types.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_current_patterns_buffer() -> *mut u8 {
    state().current_patterns.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_queued_patterns_buffer() -> *mut i8 {
    state().queued_patterns.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_set_rng_seed(seed: u32) {
    state().rng_state = if seed > 0 { seed } else { 12345 };
}

#[no_mangle]
pub extern "C" fn engine_get_note_event_size() -> i32 {
    core::mem::size_of::<NoteEvent>() as i32
}

#[no_mangle]
pub extern "C" fn engine_get_field_offset(field_id: i32) -> i32 {
    let base = core::ptr::null::<NoteEvent>();
    unsafe {
        match field_id {
            0 => core::ptr::addr_of!((*base).row) as i32,
            1 => core::ptr::addr_of!((*base).position) as i32,
            2 => core::ptr::addr_of!((*base).length) as i32,
            3 => core::ptr::addr_of!((*base).enabled) as i32,
            4 => core::ptr::addr_of!((*base).repeat_amount) as i32,
            5 => core::ptr::addr_of!((*base).repeat_space) as i32,
            6 => core::ptr::addr_of!((*base).sub_modes) as i32,
            7 => core::ptr::addr_of!((*base).chord_amount) as i32,
            8 => core::ptr::addr_of!((*base).chord_space) as i32,
            9 => core::ptr::addr_of!((*base).chord_inversion) as i32,
            10 => core::ptr::addr_of!((*base).event_index) as i32,
            11 => core::ptr::addr_of!((*base).arp_style) as i32,
            12 => core::ptr::addr_of!((*base).arp_offset) as i32,
            13 => core::ptr::addr_of!((*base).arp_voices) as i32,
            14 => core::ptr::addr_of!((*base).chord_voicing) as i32,
            _ => -1,
        }
    }
}

#[no_mangle]
pub extern "C" fn engine_get_sub_mode_array_size() -> i32 {
    core::mem::size_of::<SubModeArray>() as i32
}

#[no_mangle]
pub extern "C" fn engine_get_continue_counter(sub_mode: u8, channel: u8, event_index: u16) -> u16 {
    let s = state_ref();
    if (sub_mode as usize) >= NUM_SUB_MODES || (channel as usize) >= NUM_CHANNELS || (event_index as usize) >= MAX_EVENTS {
        return 0;
    }
    s.continue_counters[sub_mode as usize][channel as usize][event_index as usize]
}

// ============ UI State Setters ============

#[no_mangle]
pub extern "C" fn engine_set_ui_mode(mode: u8) { state().ui_mode = mode; }

#[no_mangle]
pub extern "C" fn engine_set_modify_sub_mode(sm: u8) { state().modify_sub_mode = sm; }

#[no_mangle]
pub extern "C" fn engine_set_current_channel(ch: u8) { state().current_channel = ch; }

#[no_mangle]
pub extern "C" fn engine_set_zoom(ticks_per_col: i32) { state().zoom = ticks_per_col; }

#[no_mangle]
pub extern "C" fn engine_set_selected_event(idx: i16) { state().selected_event_idx = idx; }

#[no_mangle]
pub extern "C" fn engine_set_row_offset(ch: u8, offset: f32) {
    let s = state();
    if (ch as usize) < NUM_CHANNELS {
        s.row_offsets[ch as usize] = offset;
        s.target_row_offsets[ch as usize] = offset;
    }
}

#[no_mangle]
pub extern "C" fn engine_get_row_offset(ch: u8) -> f32 {
    if (ch as usize) < NUM_CHANNELS { state_ref().row_offsets[ch as usize] } else { 0.0 }
}

#[no_mangle]
pub extern "C" fn engine_set_col_offset(offset: f32) { state().col_offset = offset; }

#[no_mangle]
pub extern "C" fn engine_get_col_offset() -> f32 { state_ref().col_offset }

#[no_mangle]
pub extern "C" fn engine_set_bpm(bpm: f32) { state().bpm = bpm; }

#[no_mangle]
pub extern "C" fn engine_set_is_playing(playing: u8) { state().is_playing = playing; }

#[no_mangle]
pub extern "C" fn engine_set_ctrl_held(held: u8) { state().ctrl_held = held; }

#[no_mangle]
pub extern "C" fn engine_set_channel_color(ch: u8, rgb: u32) {
    if (ch as usize) < NUM_CHANNELS { state().channel_colors[ch as usize] = rgb; }
}

// ============ UI State Getters ============

#[no_mangle]
pub extern "C" fn engine_get_ui_mode() -> u8 { state_ref().ui_mode }

#[no_mangle]
pub extern "C" fn engine_get_modify_sub_mode() -> u8 { state_ref().modify_sub_mode }

#[no_mangle]
pub extern "C" fn engine_get_current_channel() -> u8 { state_ref().current_channel }

#[no_mangle]
pub extern "C" fn engine_get_zoom() -> i32 { state_ref().zoom }

#[no_mangle]
pub extern "C" fn engine_get_selected_event() -> i16 { state_ref().selected_event_idx }

#[no_mangle]
pub extern "C" fn engine_get_bpm() -> f32 { state_ref().bpm }

#[no_mangle]
pub extern "C" fn engine_get_is_playing() -> u8 { state_ref().is_playing }

// ============ Grid Output Buffer Accessors ============

#[no_mangle]
pub extern "C" fn engine_get_button_values_buffer() -> *mut u16 {
    state().button_values[0].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_color_overrides_buffer() -> *mut u32 {
    state().color_overrides[0].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_patterns_have_notes_buffer() -> *mut u8 {
    state().patterns_have_notes[0].as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn engine_get_channels_playing_now_buffer() -> *mut u8 {
    state().channels_playing_now.as_mut_ptr()
}

// ============ Event ID Allocation ============

#[no_mangle]
pub extern "C" fn engine_alloc_event_id_export() -> u16 {
    engine_core::engine_alloc_event_id(state())
}

// ============ Grid Rendering ============

#[no_mangle]
pub extern "C" fn engine_compute_grid_export() {
    engine_ui::engine_compute_grid(state());
}

#[no_mangle]
pub extern "C" fn engine_is_animating_export() -> u8 {
    if engine_ui::engine_is_animating(state_ref()) { 1 } else { 0 }
}

// ============ Pattern Data Getters ============

#[no_mangle]
pub extern "C" fn engine_get_event_count(ch: u8, pat: u8) -> u16 {
    state_ref().patterns[ch as usize][pat as usize].event_count
}

#[no_mangle]
pub extern "C" fn engine_get_pattern_length(ch: u8, pat: u8) -> i32 {
    state_ref().patterns[ch as usize][pat as usize].length_ticks
}

// ============ Event Editing Exports ============

#[no_mangle]
pub extern "C" fn engine_toggle_event_export(row: i16, tick: i32, length_ticks: i32) -> i16 {
    engine_edit::engine_toggle_event(state(), row, tick, length_ticks)
}

#[no_mangle]
pub extern "C" fn engine_remove_event_export(event_idx: u16) {
    engine_edit::engine_remove_event(state(), event_idx);
}

#[no_mangle]
pub extern "C" fn engine_move_event_export(event_idx: u16, new_row: i16, new_position: i32) {
    engine_edit::engine_move_event(state(), event_idx, new_row, new_position);
}

#[no_mangle]
pub extern "C" fn engine_set_event_length_export(event_idx: u16, length: i32) {
    engine_edit::engine_set_event_length(state(), event_idx, length);
}

#[no_mangle]
pub extern "C" fn engine_place_event_export(event_idx: u16) {
    engine_edit::engine_place_event(state(), event_idx);
}

#[no_mangle]
pub extern "C" fn engine_set_event_repeat_amount_export(event_idx: u16, amount: u16) {
    engine_edit::engine_set_event_repeat_amount(state(), event_idx, amount);
}

#[no_mangle]
pub extern "C" fn engine_set_event_repeat_space_export(event_idx: u16, space: i32) {
    engine_edit::engine_set_event_repeat_space(state(), event_idx, space);
}

#[no_mangle]
pub extern "C" fn engine_set_sub_mode_value_export(event_idx: u16, sub_mode: u8, repeat_idx: u16, value: i16) {
    engine_edit::engine_set_sub_mode_value(state(), event_idx, sub_mode, repeat_idx, value);
}

#[no_mangle]
pub extern "C" fn engine_set_sub_mode_length_export(event_idx: u16, sub_mode: u8, new_length: u8) {
    engine_edit::engine_set_sub_mode_length(state(), event_idx, sub_mode, new_length);
}

#[no_mangle]
pub extern "C" fn engine_toggle_sub_mode_loop_mode_export(event_idx: u16, sub_mode: u8) {
    engine_edit::engine_toggle_sub_mode_loop_mode(state(), event_idx, sub_mode);
}

#[no_mangle]
pub extern "C" fn engine_adjust_chord_stack_export(event_idx: u16, direction: i8) {
    engine_edit::engine_adjust_chord_stack(state(), event_idx, direction);
}

#[no_mangle]
pub extern "C" fn engine_adjust_chord_space_export(event_idx: u16, direction: i8) {
    engine_edit::engine_adjust_chord_space(state(), event_idx, direction);
}

#[no_mangle]
pub extern "C" fn engine_cycle_chord_inversion_export(event_idx: u16, direction: i8) {
    engine_edit::engine_cycle_chord_inversion(state(), event_idx, direction);
}

#[no_mangle]
pub extern "C" fn engine_cycle_arp_style_export(event_idx: u16, direction: i8) {
    engine_edit::engine_cycle_arp_style(state(), event_idx, direction);
}

#[no_mangle]
pub extern "C" fn engine_adjust_arp_offset_export(event_idx: u16, direction: i8) {
    engine_edit::engine_adjust_arp_offset(state(), event_idx, direction);
}

#[no_mangle]
pub extern "C" fn engine_adjust_arp_voices_export(event_idx: u16, direction: i8) {
    engine_edit::engine_adjust_arp_voices(state(), event_idx, direction);
}

#[no_mangle]
pub extern "C" fn engine_copy_pattern_export(target_pattern: u8) {
    engine_edit::engine_copy_pattern(state(), target_pattern);
}

#[no_mangle]
pub extern "C" fn engine_clear_pattern_export() {
    engine_edit::engine_clear_pattern(state());
}

// ============ Input Handling Exports ============

#[no_mangle]
pub extern "C" fn engine_button_press_export(row: u8, col: u8, modifiers: u8) {
    engine_input::engine_button_press(state(), row, col, modifiers);
}

#[no_mangle]
pub extern "C" fn engine_arrow_press_export(direction: u8, modifiers: u8) {
    engine_input::engine_arrow_press(state(), direction, modifiers);
}

#[no_mangle]
pub extern "C" fn engine_key_action_export(action_id: u8) {
    engine_input::engine_key_action(state(), action_id);
}

// ============ Selected Event Getters ============

fn get_selected_event() -> Option<&'static NoteEvent> {
    let s = state_ref();
    if s.selected_event_idx < 0 { return None; }
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    if s.selected_event_idx as u16 >= s.patterns[ch][pat].event_count { return None; }
    Some(&s.patterns[ch][pat].events[s.selected_event_idx as usize])
}

#[no_mangle]
pub extern "C" fn engine_get_sel_row() -> i16 {
    get_selected_event().map_or(-9999, |ev| ev.row)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_length() -> i32 {
    get_selected_event().map_or(0, |ev| ev.length)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_repeat_amount() -> u16 {
    get_selected_event().map_or(0, |ev| ev.repeat_amount)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_repeat_space() -> i32 {
    get_selected_event().map_or(0, |ev| ev.repeat_space)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_chord_amount() -> u8 {
    get_selected_event().map_or(0, |ev| ev.chord_amount)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_chord_space() -> u8 {
    get_selected_event().map_or(2, |ev| ev.chord_space)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_chord_inversion() -> i8 {
    get_selected_event().map_or(0, |ev| ev.chord_inversion)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_chord_voicing() -> u8 {
    get_selected_event().map_or(0, |ev| ev.chord_voicing)
}

#[no_mangle]
pub extern "C" fn engine_get_voicing_count_export(amount: u8, distance: u8) -> u8 {
    engine_core::get_voicing_count(amount, distance)
}

static mut VOICING_NAME_BUF: [u8; 32] = [0; 32];

#[no_mangle]
pub extern "C" fn engine_get_voicing_name_export(amount: u8, distance: u8, idx: u8) -> *const u8 {
    let name = engine_core::get_voicing_name(amount, distance, idx);
    unsafe {
        let bytes = name.as_bytes();
        let len = bytes.len().min(31);
        VOICING_NAME_BUF[..len].copy_from_slice(&bytes[..len]);
        VOICING_NAME_BUF[len] = 0;
        VOICING_NAME_BUF.as_ptr()
    }
}

#[no_mangle]
pub extern "C" fn engine_get_sel_arp_style() -> u8 {
    get_selected_event().map_or(0, |ev| ev.arp_style)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_arp_offset() -> i8 {
    get_selected_event().map_or(0, |ev| ev.arp_offset)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_arp_voices() -> u8 {
    get_selected_event().map_or(1, |ev| ev.arp_voices)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_sub_mode_loop_mode(sm: u8) -> u8 {
    get_selected_event()
        .filter(|_| (sm as usize) < NUM_SUB_MODES)
        .map_or(0, |ev| ev.sub_modes[sm as usize].loop_mode)
}

#[no_mangle]
pub extern "C" fn engine_get_sel_sub_mode_array_length(sm: u8) -> u8 {
    get_selected_event()
        .filter(|_| (sm as usize) < NUM_SUB_MODES)
        .map_or(0, |ev| ev.sub_modes[sm as usize].length)
}

// ============ Current Pattern/Loop Convenience Getters ============

#[no_mangle]
pub extern "C" fn engine_get_current_loop_start() -> i32 {
    let s = state_ref();
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    s.loops[ch][pat].start
}

#[no_mangle]
pub extern "C" fn engine_get_current_loop_length() -> i32 {
    let s = state_ref();
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    s.loops[ch][pat].length
}

#[no_mangle]
pub extern "C" fn engine_get_current_pattern_length_ticks() -> i32 {
    let s = state_ref();
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    s.patterns[ch][pat].length_ticks
}

#[no_mangle]
pub extern "C" fn engine_get_current_tick() -> i32 { state_ref().current_tick }

#[no_mangle]
pub extern "C" fn engine_get_current_pattern(ch: u8) -> u8 {
    if (ch as usize) < NUM_CHANNELS { state_ref().current_patterns[ch as usize] } else { 0 }
}

#[no_mangle]
pub extern "C" fn engine_get_channel_type(ch: u8) -> u8 {
    if (ch as usize) < NUM_CHANNELS { state_ref().channel_types[ch as usize] } else { 0 }
}

#[no_mangle]
pub extern "C" fn engine_get_scale_root() -> u8 { state_ref().scale_root }

#[no_mangle]
pub extern "C" fn engine_get_scale_id_idx() -> u8 { state_ref().scale_id_idx }

// ============ Scale Exports ============

#[no_mangle]
pub extern "C" fn engine_note_to_midi_export(row: i16) -> i8 {
    engine_core::note_to_midi(row, state_ref())
}

static mut SCALE_NAME_BUF: [u8; 32] = [0; 32];

#[no_mangle]
pub extern "C" fn engine_get_scale_name() -> *const u8 {
    let name = engine_core::engine_get_scale_name_str(state_ref());
    unsafe {
        let bytes = name.as_bytes();
        let len = bytes.len().min(31);
        SCALE_NAME_BUF[..len].copy_from_slice(&bytes[..len]);
        SCALE_NAME_BUF[len] = 0;
        SCALE_NAME_BUF.as_ptr()
    }
}

#[no_mangle]
pub extern "C" fn engine_get_scale_count() -> u16 { state_ref().scale_count }

#[no_mangle]
pub extern "C" fn engine_get_scale_zero_index() -> u16 { state_ref().scale_zero_index }

#[no_mangle]
pub extern "C" fn engine_get_num_scales() -> u8 { NUM_SCALES as u8 }

// ============ Chord Name Analysis ============

static NOTE_NAMES: [&str; 12] = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

struct ChordTemplate {
    intervals: [u8; 4],
    count: u8,
    suffix: &'static str,
}

static CHORD_TEMPLATES: &[ChordTemplate] = &[
    ChordTemplate { intervals: [4,7,0,0], count: 2, suffix: "" },
    ChordTemplate { intervals: [3,7,0,0], count: 2, suffix: "m" },
    ChordTemplate { intervals: [3,6,0,0], count: 2, suffix: "dim" },
    ChordTemplate { intervals: [4,8,0,0], count: 2, suffix: "aug" },
    ChordTemplate { intervals: [2,7,0,0], count: 2, suffix: "sus2" },
    ChordTemplate { intervals: [5,7,0,0], count: 2, suffix: "sus4" },
    ChordTemplate { intervals: [4,7,11,0], count: 3, suffix: "maj7" },
    ChordTemplate { intervals: [4,7,10,0], count: 3, suffix: "7" },
    ChordTemplate { intervals: [3,7,10,0], count: 3, suffix: "m7" },
    ChordTemplate { intervals: [3,7,11,0], count: 3, suffix: "mM7" },
    ChordTemplate { intervals: [3,6,10,0], count: 3, suffix: "m7b5" },
    ChordTemplate { intervals: [3,6,9,0], count: 3, suffix: "dim7" },
    ChordTemplate { intervals: [4,8,10,0], count: 3, suffix: "aug7" },
    ChordTemplate { intervals: [4,7,9,0], count: 3, suffix: "6" },
    ChordTemplate { intervals: [3,7,9,0], count: 3, suffix: "m6" },
    ChordTemplate { intervals: [5,7,10,0], count: 3, suffix: "7sus4" },
    ChordTemplate { intervals: [7,0,0,0], count: 1, suffix: "5" },
];

static ROMAN: [&str; 7] = ["I","II","III","IV","V","VI","VII"];

fn find_scale_degree(s: &EngineState, pc: u8) -> i8 {
    let zi = s.scale_zero_index as usize;
    let octave_size = s.scale_octave_size as usize;

    (0..octave_size.min(12))
        .find(|&d| zi + d < s.scale_count as usize && s.scale_notes[zi + d] % 12 == pc)
        .map(|d| d as i8)
        .or_else(|| {
            (0..octave_size.min(12))
                .find(|&d| d + 1 <= zi && s.scale_notes[zi - d - 1] % 12 == pc)
                .map(|d| (octave_size - d - 1) as i8)
        })
        .unwrap_or(-1)
}

fn interval_to_ext(semitones: u8) -> Option<&'static str> {
    match semitones {
        1 => Some("b9"), 2 => Some("9"), 3 => Some("#9"), 5 => Some("11"),
        6 => Some("#11"), 8 => Some("b13"), 9 => Some("13"), 10 => Some("b7"),
        11 => Some("maj7"), _ => None,
    }
}

static mut CHORD_NAME_BUF: [u8; 64] = [0; 64];

#[no_mangle]
pub extern "C" fn engine_get_chord_name() -> *const u8 {
    unsafe { CHORD_NAME_BUF[0] = 0; }

    let s = state_ref();
    let ev = match get_selected_event() {
        Some(e) if e.chord_amount > 1 => e,
        _ => return unsafe { CHORD_NAME_BUF.as_ptr() },
    };

    let mut offsets = [0i8; MAX_CHORD_SIZE];
    let chord_count = engine_ui::get_chord_offsets(s, ev, &mut offsets);

    let mut pitch_classes = [0u8; MAX_CHORD_SIZE];
    let mut pc_count = 0usize;
    let mut lowest_midi: i8 = 127;
    let mut bass_pc: u8 = 0;

    (0..chord_count).for_each(|i| {
        let midi = engine_core::note_to_midi(ev.row + offsets[i] as i16, s);
        if midi < 0 { return; }
        if midi < lowest_midi { lowest_midi = midi; bass_pc = (midi % 12) as u8; }
        let pc = (midi % 12) as u8;
        if !pitch_classes[..pc_count].contains(&pc) && pc_count < MAX_CHORD_SIZE {
            pitch_classes[pc_count] = pc;
            pc_count += 1;
        }
    });

    if pc_count < 2 { return unsafe { CHORD_NAME_BUF.as_ptr() }; }

    pitch_classes[..pc_count].sort_unstable();

    // Find bass_pc index
    let bass_idx = pitch_classes[..pc_count].iter().position(|&p| p == bass_pc).unwrap_or(0);

    let mut best_suffix: Option<&str> = None;
    let mut best_root_pc: u8 = 0;
    let mut best_match_count: u8 = 0;
    let mut best_intervals = [0u8; MAX_CHORD_SIZE - 1];
    let mut best_n_intervals: usize = 0;
    let mut best_matched = [false; MAX_CHORD_SIZE - 1];

    (0..pc_count).for_each(|r| {
        let rot = if r == 0 { bass_idx } else if r <= bass_idx { r - 1 } else { r };
        let root_pc = pitch_classes[rot];
        let mut intervals = [0u8; MAX_CHORD_SIZE - 1];
        let mut n_intervals = 0usize;

        (0..pc_count).filter(|&i| i != rot).for_each(|i| {
            intervals[n_intervals] = ((pitch_classes[i] as i16 - root_pc as i16 + 12) % 12) as u8;
            n_intervals += 1;
        });
        intervals[..n_intervals].sort_unstable();

        CHORD_TEMPLATES.iter().for_each(|tmpl| {
            if tmpl.count > n_intervals as u8 || tmpl.count <= best_match_count { return; }
            let mut matched = [false; MAX_CHORD_SIZE - 1];
            let all_found = (0..tmpl.count as usize).all(|k| {
                (0..n_intervals).find(|&m| intervals[m] == tmpl.intervals[k]).map(|m| matched[m] = true).is_some()
            });
            if all_found {
                best_suffix = Some(tmpl.suffix);
                best_root_pc = root_pc;
                best_match_count = tmpl.count;
                best_n_intervals = n_intervals;
                best_intervals[..n_intervals].copy_from_slice(&intervals[..n_intervals]);
                best_matched[..n_intervals].copy_from_slice(&matched[..n_intervals]);
            }
        });
    });

    let mut result = String::new();

    if let Some(suffix) = best_suffix {
        result.push_str(NOTE_NAMES[best_root_pc as usize]);
        result.push_str(suffix);
        (0..best_n_intervals)
            .filter(|&i| !best_matched[i])
            .for_each(|i| {
                if let Some(ext) = interval_to_ext(best_intervals[i]) {
                    result.push('+');
                    result.push_str(ext);
                }
            });
        if best_root_pc != bass_pc {
            result.push('/');
            result.push_str(NOTE_NAMES[bass_pc as usize]);
        }
    } else {
        let root_pc = pitch_classes[0];
        result.push_str(NOTE_NAMES[root_pc as usize]);
        result.push('(');
        (1..pc_count).for_each(|i| {
            if i > 1 { result.push(','); }
            let iv = ((pitch_classes[i] as i16 - root_pc as i16 + 12) % 12) as u8;
            result.push_str(&alloc::format!("{}", iv));
        });
        result.push(')');
        best_root_pc = root_pc;
    }

    let degree = find_scale_degree(s, best_root_pc);
    if degree >= 0 && degree < 7 {
        result.push_str(" (");
        result.push_str(ROMAN[degree as usize]);
        result.push(')');
    }

    unsafe {
        let bytes = result.as_bytes();
        let len = bytes.len().min(63);
        CHORD_NAME_BUF[..len].copy_from_slice(&bytes[..len]);
        CHORD_NAME_BUF[len] = 0;
        CHORD_NAME_BUF.as_ptr()
    }
}

// ============ Grid Dimension Getters ============

#[no_mangle]
pub extern "C" fn engine_get_visible_rows() -> i32 { VISIBLE_ROWS as i32 }

#[no_mangle]
pub extern "C" fn engine_get_visible_cols() -> i32 { VISIBLE_COLS as i32 }

#[no_mangle]
pub extern "C" fn engine_get_num_channels() -> i32 { NUM_CHANNELS as i32 }

// ============ Memory Allocator Exports (for JS string marshalling) ============

#[no_mangle]
pub extern "C" fn wasm_alloc(size: u32) -> *mut u8 {
    let layout = core::alloc::Layout::from_size_align(size as usize, 1).unwrap();
    unsafe { alloc::alloc::alloc(layout) }
}

#[no_mangle]
pub extern "C" fn wasm_free(ptr: *mut u8, size: u32) {
    if ptr.is_null() { return; }
    let layout = core::alloc::Layout::from_size_align(size as usize, 1).unwrap();
    unsafe { alloc::alloc::dealloc(ptr, layout); }
}

// ============ OLED Exports ============

#[no_mangle]
pub extern "C" fn oled_init() { oled_display::oled_init(); }

#[no_mangle]
pub extern "C" fn oled_clear() { oled_display::oled_clear(); }

#[no_mangle]
pub extern "C" fn oled_draw_text(x: i16, y: i16, text: *const u8, color_idx: u8, font_idx: u8) {
    let text_str = unsafe {
        let mut len = 0;
        while *text.add(len) != 0 { len += 1; }
        core::str::from_utf8_unchecked(core::slice::from_raw_parts(text, len))
    };
    oled_display::oled_draw_text(x, y, text_str, color_idx, font_idx);
}

#[no_mangle]
pub extern "C" fn oled_draw_hline(x: i16, y: i16, w: i16, color_idx: u8) {
    oled_display::oled_draw_hline(x, y, w, color_idx);
}

#[no_mangle]
pub extern "C" fn oled_draw_vline(x: i16, y: i16, h: i16, color_idx: u8) {
    oled_display::oled_draw_vline(x, y, h, color_idx);
}

#[no_mangle]
pub extern "C" fn oled_draw_line(x0: i16, y0: i16, x1: i16, y1: i16, color_idx: u8) {
    oled_display::oled_draw_line(x0, y0, x1, y1, color_idx);
}

#[no_mangle]
pub extern "C" fn oled_draw_rect(x: i16, y: i16, w: i16, h: i16, color_idx: u8) {
    oled_display::oled_draw_rect(x, y, w, h, color_idx);
}

#[no_mangle]
pub extern "C" fn oled_fill_rect(x: i16, y: i16, w: i16, h: i16, color_idx: u8) {
    oled_display::oled_fill_rect(x, y, w, h, color_idx);
}

#[no_mangle]
pub extern "C" fn oled_draw_pixel(x: i16, y: i16, color_idx: u8) {
    oled_display::oled_draw_pixel(x, y, color_idx);
}

#[no_mangle]
pub extern "C" fn oled_text_width(text: *const u8, font_idx: u8) -> i16 {
    let text_str = unsafe {
        let mut len = 0;
        while *text.add(len) != 0 { len += 1; }
        core::str::from_utf8_unchecked(core::slice::from_raw_parts(text, len))
    };
    oled_display::oled_text_width(text_str, font_idx)
}

#[no_mangle]
pub extern "C" fn oled_font_height(font_idx: u8) -> i16 {
    oled_display::oled_font_height(font_idx)
}

#[no_mangle]
pub extern "C" fn oled_get_framebuffer() -> *mut u16 {
    oled_gfx::gfx_get_framebuffer()
}

#[no_mangle]
pub extern "C" fn oled_get_framebuffer_size() -> u32 {
    (oled_gfx::GFX_WIDTH * oled_gfx::GFX_HEIGHT * 2) as u32
}

#[no_mangle]
pub extern "C" fn oled_render(modifiers: u8) {
    oled_screen::oled_render(modifiers);
}

// ============ Tests ============

#[cfg(test)]
mod test_core;
#[cfg(test)]
mod test_edit;
#[cfg(test)]
mod test_rendered;
