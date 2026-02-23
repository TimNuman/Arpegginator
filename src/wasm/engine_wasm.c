#include <emscripten.h>
#include "engine_core.h"
#include "engine_ui.h"
#include "engine_edit.h"
#include "engine_input.h"
#include "engine_platform.h"

// ============ Global Engine State ============

static EngineState g_state;

// ============ JS Callback Bridges (via EM_JS) ============

EM_JS(void, js_step_trigger, (int ch, int note, int tick, int len, int vel, int timing, int flam, int evIdx), {
    if (Module._callbacks && Module._callbacks.stepTrigger) {
        Module._callbacks.stepTrigger(ch, note, tick, len, vel, timing, flam, evIdx);
    }
});

EM_JS(void, js_note_off, (int ch, int note), {
    if (Module._callbacks && Module._callbacks.noteOff) {
        Module._callbacks.noteOff(ch, note);
    }
});

EM_JS(void, js_set_current_tick, (int tick), {
    if (Module._callbacks && Module._callbacks.setCurrentTick) {
        Module._callbacks.setCurrentTick(tick);
    }
});

EM_JS(void, js_set_current_patterns, (int ptr), {
    if (Module._callbacks && Module._callbacks.setCurrentPatterns) {
        var patterns = [];
        for (var i = 0; i < 8; i++) {
            patterns.push(Module.HEAPU8[ptr + i]);
        }
        Module._callbacks.setCurrentPatterns(patterns);
    }
});

EM_JS(void, js_clear_queued_pattern, (int ch), {
    if (Module._callbacks && Module._callbacks.clearQueuedPattern) {
        Module._callbacks.clearQueuedPattern(ch);
    }
});

EM_JS(void, js_preview_value, (int sm, int ch, int evIdx, int tick, int val), {
    if (Module._callbacks && Module._callbacks.previewValue) {
        Module._callbacks.previewValue(sm, ch, evIdx, tick, val);
    }
});

EM_JS(void, js_play_preview_note, (int ch, int row, int length_ticks), {
    if (Module._callbacks && Module._callbacks.playPreviewNote) {
        Module._callbacks.playPreviewNote(ch, row, length_ticks);
    }
});

// ============ Platform Callback Implementations ============

void platform_step_trigger(
    uint8_t channel, uint8_t midi_note, int32_t tick,
    int32_t note_length_ticks, uint8_t velocity,
    int8_t timing_offset_pct, uint8_t flam_count,
    uint16_t event_index
) {
    js_step_trigger(channel, midi_note, tick, note_length_ticks,
                    velocity, timing_offset_pct, flam_count, event_index);
}

void platform_note_off(uint8_t channel, uint8_t midi_note) {
    js_note_off(channel, midi_note);
}

void platform_set_current_tick(int32_t tick) {
    js_set_current_tick(tick);
}

void platform_set_current_patterns(const uint8_t patterns[8]) {
    js_set_current_patterns((int)(uintptr_t)patterns);
}

void platform_clear_queued_pattern(uint8_t channel) {
    js_clear_queued_pattern(channel);
}

void platform_preview_value(
    uint8_t sub_mode, uint8_t channel,
    uint16_t event_index, int32_t tick, int16_t value
) {
    js_preview_value(sub_mode, channel, event_index, tick, value);
}

void platform_play_preview_note(uint8_t channel, int16_t row, int32_t length_ticks) {
    js_play_preview_note(channel, row, length_ticks);
}

// ============ Exported Functions ============

EMSCRIPTEN_KEEPALIVE
void engine_init(void) {
    engine_core_init(&g_state);
}

EMSCRIPTEN_KEEPALIVE
void engine_play_init(void) {
    engine_core_play_init(&g_state);
}

EMSCRIPTEN_KEEPALIVE
void engine_play_init_from_tick(int32_t tick) {
    engine_core_play_init_from_tick(&g_state, tick);
}

EMSCRIPTEN_KEEPALIVE
void engine_tick(void) {
    engine_core_tick(&g_state);
}

EMSCRIPTEN_KEEPALIVE
void engine_scrub_to_tick(int32_t target_tick) {
    engine_core_scrub_to_tick(&g_state, target_tick);
}

EMSCRIPTEN_KEEPALIVE
void engine_scrub_end(void) {
    engine_core_scrub_end(&g_state);
}

EMSCRIPTEN_KEEPALIVE
void engine_stop(void) {
    engine_core_stop(&g_state);
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_version(void) {
    return engine_core_get_version();
}

// ============ Buffer Accessors ============
// JS writes directly into WASM linear memory via these pointers

EMSCRIPTEN_KEEPALIVE
NoteEvent_C* engine_get_event_buffer(uint8_t ch, uint8_t pat) {
    return g_state.patterns[ch][pat].events;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_event_count(uint8_t ch, uint8_t pat, uint16_t count) {
    g_state.patterns[ch][pat].event_count = count;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_pattern_length(uint8_t ch, uint8_t pat, int32_t len) {
    g_state.patterns[ch][pat].length_ticks = len;
}

EMSCRIPTEN_KEEPALIVE
PatternLoop_C* engine_get_loops_buffer(void) {
    return &g_state.loops[0][0];
}

EMSCRIPTEN_KEEPALIVE
uint8_t* engine_get_muted_buffer(void) {
    return g_state.muted;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* engine_get_soloed_buffer(void) {
    return g_state.soloed;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* engine_get_channel_types_buffer(void) {
    return g_state.channel_types;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* engine_get_current_patterns_buffer(void) {
    return g_state.current_patterns;
}

EMSCRIPTEN_KEEPALIVE
int8_t* engine_get_queued_patterns_buffer(void) {
    return g_state.queued_patterns;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_rng_seed(uint32_t seed) {
    g_state.rng_state = seed > 0 ? seed : 12345;
}

// Return sizeof(NoteEvent_C) so JS can calculate struct offsets
EMSCRIPTEN_KEEPALIVE
int32_t engine_get_note_event_size(void) {
    return (int32_t)sizeof(NoteEvent_C);
}

// Return offsets of key fields in NoteEvent_C for JS struct writing
EMSCRIPTEN_KEEPALIVE
int32_t engine_get_field_offset(int32_t field_id) {
    NoteEvent_C* base = (NoteEvent_C*)0;
    switch (field_id) {
        case 0: return (int32_t)(uintptr_t)&base->row;
        case 1: return (int32_t)(uintptr_t)&base->position;
        case 2: return (int32_t)(uintptr_t)&base->length;
        case 3: return (int32_t)(uintptr_t)&base->enabled;
        case 4: return (int32_t)(uintptr_t)&base->repeat_amount;
        case 5: return (int32_t)(uintptr_t)&base->repeat_space;
        case 6: return (int32_t)(uintptr_t)&base->sub_modes;
        case 7: return (int32_t)(uintptr_t)&base->chord_amount;
        case 8: return (int32_t)(uintptr_t)&base->chord_space;
        case 9: return (int32_t)(uintptr_t)&base->chord_inversion;
        case 10: return (int32_t)(uintptr_t)&base->event_index;
        default: return -1;
    }
}

// Return sizeof(SubModeArray) for JS
EMSCRIPTEN_KEEPALIVE
int32_t engine_get_sub_mode_array_size(void) {
    return (int32_t)sizeof(SubModeArray);
}

// Return the current continue counter for a sub-mode/channel/event
EMSCRIPTEN_KEEPALIVE
uint16_t engine_get_continue_counter(uint8_t sub_mode, uint8_t channel, uint16_t event_index) {
    if (sub_mode >= NUM_SUB_MODES || channel >= NUM_CHANNELS || event_index >= MAX_EVENTS) return 0;
    return g_state.continue_counters[sub_mode][channel][event_index];
}

// ============ UI State Setters ============

EMSCRIPTEN_KEEPALIVE
void engine_set_ui_mode(uint8_t mode) {
    g_state.ui_mode = mode;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_modify_sub_mode(uint8_t sm) {
    g_state.modify_sub_mode = sm;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_current_channel(uint8_t ch) {
    g_state.current_channel = ch;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_zoom(int32_t ticks_per_col) {
    g_state.zoom = ticks_per_col;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_selected_event(int16_t idx) {
    g_state.selected_event_idx = idx;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_row_offset(uint8_t ch, float offset) {
    if (ch < NUM_CHANNELS) {
        g_state.row_offsets[ch] = offset;
        g_state.target_row_offsets[ch] = offset;
    }
}

EMSCRIPTEN_KEEPALIVE
float engine_get_row_offset(uint8_t ch) {
    return (ch < NUM_CHANNELS) ? g_state.row_offsets[ch] : 0.0f;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_col_offset(float offset) {
    g_state.col_offset = offset;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_col_offset(void) {
    return g_state.col_offset;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_bpm(float bpm) {
    g_state.bpm = bpm;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_is_playing(uint8_t playing) {
    g_state.is_playing = playing;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_ctrl_held(uint8_t held) {
    g_state.ctrl_held = held;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_channel_color(uint8_t ch, uint32_t rgb) {
    if (ch < NUM_CHANNELS) g_state.channel_colors[ch] = rgb;
}

// ============ UI State Getters ============

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_ui_mode(void) {
    return g_state.ui_mode;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_modify_sub_mode(void) {
    return g_state.modify_sub_mode;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_current_channel(void) {
    return g_state.current_channel;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_zoom(void) {
    return g_state.zoom;
}

EMSCRIPTEN_KEEPALIVE
int16_t engine_get_selected_event(void) {
    return g_state.selected_event_idx;
}

EMSCRIPTEN_KEEPALIVE
float engine_get_bpm(void) {
    return g_state.bpm;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_is_playing(void) {
    return g_state.is_playing;
}

// ============ Grid Output Buffer Accessors ============

EMSCRIPTEN_KEEPALIVE
uint16_t* engine_get_button_values_buffer(void) {
    return &g_state.button_values[0][0];
}

EMSCRIPTEN_KEEPALIVE
uint32_t* engine_get_color_overrides_buffer(void) {
    return &g_state.color_overrides[0][0];
}

EMSCRIPTEN_KEEPALIVE
uint8_t* engine_get_patterns_have_notes_buffer(void) {
    return &g_state.patterns_have_notes[0][0];
}

EMSCRIPTEN_KEEPALIVE
uint8_t* engine_get_channels_playing_now_buffer(void) {
    return g_state.channels_playing_now;
}

// ============ Event ID Allocation ============

EMSCRIPTEN_KEEPALIVE
uint16_t engine_alloc_event_id_export(void) {
    return engine_alloc_event_id(&g_state);
}

// ============ Grid Rendering ============

EMSCRIPTEN_KEEPALIVE
void engine_compute_grid_export(void) {
    engine_compute_grid(&g_state);
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_is_animating_export(void) {
    return engine_is_animating(&g_state);
}

// ============ Pattern Data Getters ============

EMSCRIPTEN_KEEPALIVE
uint16_t engine_get_event_count(uint8_t ch, uint8_t pat) {
    return g_state.patterns[ch][pat].event_count;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_pattern_length(uint8_t ch, uint8_t pat) {
    return g_state.patterns[ch][pat].length_ticks;
}

// ============ Event Editing Exports ============

EMSCRIPTEN_KEEPALIVE
int16_t engine_toggle_event_export(int16_t row, int32_t tick, int32_t length_ticks) {
    return engine_toggle_event(&g_state, row, tick, length_ticks);
}

EMSCRIPTEN_KEEPALIVE
void engine_remove_event_export(uint16_t event_idx) {
    engine_remove_event(&g_state, event_idx);
}

EMSCRIPTEN_KEEPALIVE
void engine_move_event_export(uint16_t event_idx, int16_t new_row, int32_t new_position) {
    engine_move_event(&g_state, event_idx, new_row, new_position);
}

EMSCRIPTEN_KEEPALIVE
void engine_set_event_length_export(uint16_t event_idx, int32_t length) {
    engine_set_event_length(&g_state, event_idx, length);
}

EMSCRIPTEN_KEEPALIVE
void engine_place_event_export(uint16_t event_idx) {
    engine_place_event(&g_state, event_idx);
}

EMSCRIPTEN_KEEPALIVE
void engine_set_event_repeat_amount_export(uint16_t event_idx, uint16_t amount) {
    engine_set_event_repeat_amount(&g_state, event_idx, amount);
}

EMSCRIPTEN_KEEPALIVE
void engine_set_event_repeat_space_export(uint16_t event_idx, int32_t space) {
    engine_set_event_repeat_space(&g_state, event_idx, space);
}

EMSCRIPTEN_KEEPALIVE
void engine_set_sub_mode_value_export(uint16_t event_idx, uint8_t sub_mode, uint16_t repeat_idx, int16_t value) {
    engine_set_sub_mode_value(&g_state, event_idx, sub_mode, repeat_idx, value);
}

EMSCRIPTEN_KEEPALIVE
void engine_set_sub_mode_length_export(uint16_t event_idx, uint8_t sub_mode, uint8_t new_length) {
    engine_set_sub_mode_length(&g_state, event_idx, sub_mode, new_length);
}

EMSCRIPTEN_KEEPALIVE
void engine_toggle_sub_mode_loop_mode_export(uint16_t event_idx, uint8_t sub_mode) {
    engine_toggle_sub_mode_loop_mode(&g_state, event_idx, sub_mode);
}

EMSCRIPTEN_KEEPALIVE
void engine_adjust_chord_stack_export(uint16_t event_idx, int8_t direction) {
    engine_adjust_chord_stack(&g_state, event_idx, direction);
}

EMSCRIPTEN_KEEPALIVE
void engine_adjust_chord_space_export(uint16_t event_idx, int8_t direction) {
    engine_adjust_chord_space(&g_state, event_idx, direction);
}

EMSCRIPTEN_KEEPALIVE
void engine_cycle_chord_inversion_export(uint16_t event_idx, int8_t direction) {
    engine_cycle_chord_inversion(&g_state, event_idx, direction);
}

EMSCRIPTEN_KEEPALIVE
void engine_copy_pattern_export(uint8_t target_pattern) {
    engine_copy_pattern(&g_state, target_pattern);
}

EMSCRIPTEN_KEEPALIVE
void engine_clear_pattern_export(void) {
    engine_clear_pattern(&g_state);
}

// ============ Input Handling Exports ============

EMSCRIPTEN_KEEPALIVE
void engine_button_press_export(uint8_t row, uint8_t col, uint8_t modifiers) {
    engine_button_press(&g_state, row, col, modifiers);
}

EMSCRIPTEN_KEEPALIVE
void engine_arrow_press_export(uint8_t direction, uint8_t modifiers) {
    engine_arrow_press(&g_state, direction, modifiers);
}

EMSCRIPTEN_KEEPALIVE
void engine_key_action_export(uint8_t action_id) {
    engine_key_action(&g_state, action_id);
}

// ============ Selected Event Getters (for OLED display) ============

static const NoteEvent_C* _get_selected_event(void) {
    if (g_state.selected_event_idx < 0) return NULL;
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    if ((uint16_t)g_state.selected_event_idx >= g_state.patterns[ch][pat].event_count) return NULL;
    return &g_state.patterns[ch][pat].events[g_state.selected_event_idx];
}

EMSCRIPTEN_KEEPALIVE
int16_t engine_get_sel_row(void) {
    const NoteEvent_C* ev = _get_selected_event();
    return ev ? ev->row : -9999;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_sel_length(void) {
    const NoteEvent_C* ev = _get_selected_event();
    return ev ? ev->length : 0;
}

EMSCRIPTEN_KEEPALIVE
uint16_t engine_get_sel_repeat_amount(void) {
    const NoteEvent_C* ev = _get_selected_event();
    return ev ? ev->repeat_amount : 0;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_sel_repeat_space(void) {
    const NoteEvent_C* ev = _get_selected_event();
    return ev ? ev->repeat_space : 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_sel_chord_amount(void) {
    const NoteEvent_C* ev = _get_selected_event();
    return ev ? ev->chord_amount : 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_sel_chord_space(void) {
    const NoteEvent_C* ev = _get_selected_event();
    return ev ? ev->chord_space : 2;
}

EMSCRIPTEN_KEEPALIVE
int8_t engine_get_sel_chord_inversion(void) {
    const NoteEvent_C* ev = _get_selected_event();
    return ev ? ev->chord_inversion : 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_sel_sub_mode_loop_mode(uint8_t sm) {
    const NoteEvent_C* ev = _get_selected_event();
    if (!ev || sm >= 5) return 0;
    return ev->sub_modes[sm].loop_mode;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_sel_sub_mode_array_length(uint8_t sm) {
    const NoteEvent_C* ev = _get_selected_event();
    if (!ev || sm >= 5) return 0;
    return ev->sub_modes[sm].length;
}

// ============ Current Pattern/Loop Convenience Getters ============

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_current_loop_start(void) {
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    return g_state.loops[ch][pat].start;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_current_loop_length(void) {
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    return g_state.loops[ch][pat].length;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_current_pattern_length_ticks(void) {
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    return g_state.patterns[ch][pat].length_ticks;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_current_tick(void) {
    return g_state.current_tick;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_current_pattern(uint8_t ch) {
    return (ch < NUM_CHANNELS) ? g_state.current_patterns[ch] : 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_channel_type(uint8_t ch) {
    return (ch < NUM_CHANNELS) ? g_state.channel_types[ch] : 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_scale_root(void) {
    return g_state.scale_root;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_scale_id_idx(void) {
    return g_state.scale_id_idx;
}

// ============ Scale Exports ============

EMSCRIPTEN_KEEPALIVE
int8_t engine_note_to_midi_export(int16_t row) {
    return note_to_midi(row, &g_state);
}

EMSCRIPTEN_KEEPALIVE
const char* engine_get_scale_name(void) {
    return engine_get_scale_name_str(&g_state);
}

EMSCRIPTEN_KEEPALIVE
uint16_t engine_get_scale_count(void) {
    return g_state.scale_count;
}

EMSCRIPTEN_KEEPALIVE
uint16_t engine_get_scale_zero_index(void) {
    return g_state.scale_zero_index;
}

EMSCRIPTEN_KEEPALIVE
uint8_t engine_get_num_scales(void) {
    return NUM_SCALES;
}

// ============ Grid Dimension Getters ============

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_visible_rows(void) {
    return VISIBLE_ROWS;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_visible_cols(void) {
    return VISIBLE_COLS;
}

EMSCRIPTEN_KEEPALIVE
int32_t engine_get_num_channels(void) {
    return NUM_CHANNELS;
}

