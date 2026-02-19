#include <emscripten.h>
#include "engine_core.h"
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

// ============ Exported Functions ============

EMSCRIPTEN_KEEPALIVE
void engine_init(void) {
    engine_core_init(&g_state);
}

EMSCRIPTEN_KEEPALIVE
void engine_tick(void) {
    engine_core_tick(&g_state);
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
uint8_t* engine_get_scale_buffer(void) {
    return g_state.scale_notes;
}

EMSCRIPTEN_KEEPALIVE
void engine_set_scale_info(uint16_t count, uint16_t zero_index) {
    g_state.scale_count = count;
    g_state.scale_zero_index = zero_index;
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
        case 7: return (int32_t)(uintptr_t)&base->chord_stack_size;
        case 8: return (int32_t)(uintptr_t)&base->chord_shape_index;
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

