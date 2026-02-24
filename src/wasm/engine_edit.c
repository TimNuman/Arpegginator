#include "engine_edit.h"
#include "engine_platform.h"
#include <string.h>

// ============ Helpers ============

// Default values for new events
#define DEFAULT_VELOCITY    100
#define DEFAULT_HIT_CHANCE  100
#define DEFAULT_TIMING      0
#define DEFAULT_FLAM        0
#define DEFAULT_MODULATE    0
#define DEFAULT_PATTERN_TICKS  (TICKS_PER_QUARTER * 4 * 4)  // 4 bars of 4/4
#define DEFAULT_LOOP_TICKS     (TICKS_PER_QUARTER * 4)       // 1 bar

static inline int32_t i32_min(int32_t a, int32_t b) { return a < b ? a : b; }
static inline int32_t i32_max(int32_t a, int32_t b) { return a > b ? a : b; }
static inline int32_t i32_clamp(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Get current pattern data pointer
static PatternData_C* get_current_pattern(EngineState* s) {
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    return &s->patterns[ch][pat];
}

// Initialize a new event with defaults
static void init_event(NoteEvent_C* ev, int16_t row, int32_t position, int32_t length, uint16_t id) {
    memset(ev, 0, sizeof(NoteEvent_C));
    ev->row = row;
    ev->position = position;
    ev->length = length;
    ev->enabled = 1;
    ev->repeat_amount = 1;
    ev->repeat_space = length;
    ev->chord_amount = 1;
    ev->chord_space = 2;       // default: thirds (2 scale degrees apart)
    ev->chord_inversion = 0;
    ev->arp_style = ARP_CHORD;
    ev->arp_offset = 0;
    ev->event_index = id;

    // Default sub-mode values
    ev->sub_modes[SM_VELOCITY].values[0] = DEFAULT_VELOCITY;
    ev->sub_modes[SM_VELOCITY].length = 1;
    ev->sub_modes[SM_VELOCITY].loop_mode = LOOP_RESET;

    ev->sub_modes[SM_HIT].values[0] = DEFAULT_HIT_CHANCE;
    ev->sub_modes[SM_HIT].length = 1;
    ev->sub_modes[SM_HIT].loop_mode = LOOP_RESET;

    ev->sub_modes[SM_TIMING].values[0] = DEFAULT_TIMING;
    ev->sub_modes[SM_TIMING].length = 1;
    ev->sub_modes[SM_TIMING].loop_mode = LOOP_RESET;

    ev->sub_modes[SM_FLAM].values[0] = DEFAULT_FLAM;
    ev->sub_modes[SM_FLAM].length = 1;
    ev->sub_modes[SM_FLAM].loop_mode = LOOP_RESET;

    ev->sub_modes[SM_MODULATE].values[0] = DEFAULT_MODULATE;
    ev->sub_modes[SM_MODULATE].length = 1;
    ev->sub_modes[SM_MODULATE].loop_mode = LOOP_RESET;
}

// Truncate overlapping events on the same row at the given position
static void truncate_overlapping(EngineState* s, PatternData_C* pat, int16_t row, int32_t position, uint16_t exclude_idx) {
    for (uint16_t i = 0; i < pat->event_count; i++) {
        if (i == exclude_idx) continue;
        NoteEvent_C* ev = &pat->events[i];
        if (ev->row != row) continue;
        if (ev->position < position && ev->position + ev->length > position) {
            ev->length = position - ev->position;
        }
    }
}

// Remove event at index, shifting remaining events down
static void remove_event_at(PatternData_C* pat, uint16_t idx) {
    if (idx >= pat->event_count) return;
    for (uint16_t i = idx; i < pat->event_count - 1; i++) {
        pat->events[i] = pat->events[i + 1];
    }
    pat->event_count--;
}

// ============ Event CRUD ============

int16_t engine_toggle_event(EngineState* s, int16_t row, int32_t tick, int32_t length_ticks) {
    PatternData_C* pat = get_current_pattern(s);

    // Find existing event at this position
    for (uint16_t i = 0; i < pat->event_count; i++) {
        if (pat->events[i].row == row && pat->events[i].position == tick) {
            // Remove it
            remove_event_at(pat, i);
            engine_update_has_notes(s, s->current_channel, s->current_patterns[s->current_channel]);
            return -1;
        }
    }

    // No existing event — create new one
    if (pat->event_count >= MAX_EVENTS) return -1;

    truncate_overlapping(s, pat, row, tick, 0xFFFF);

    uint16_t new_idx = pat->event_count;
    init_event(&pat->events[new_idx], row, tick, length_ticks, engine_alloc_event_id(s));
    pat->event_count++;

    engine_update_has_notes(s, s->current_channel, s->current_patterns[s->current_channel]);
    return (int16_t)new_idx;
}

void engine_remove_event(EngineState* s, uint16_t event_idx) {
    PatternData_C* pat = get_current_pattern(s);
    remove_event_at(pat, event_idx);

    // Fix selected event index if needed
    if (s->selected_event_idx >= 0) {
        if ((uint16_t)s->selected_event_idx == event_idx) {
            s->selected_event_idx = -1;
        } else if ((uint16_t)s->selected_event_idx > event_idx) {
            s->selected_event_idx--;
        }
    }

    engine_update_has_notes(s, s->current_channel, s->current_patterns[s->current_channel]);
}

void engine_move_event(EngineState* s, uint16_t event_idx, int16_t new_row, int32_t new_position) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    pat->events[event_idx].row = new_row;
    pat->events[event_idx].position = new_position;
}

void engine_set_event_length(EngineState* s, uint16_t event_idx, int32_t length) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    pat->events[event_idx].length = i32_max(1, length);
}

void engine_place_event(EngineState* s, uint16_t event_idx) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];
    truncate_overlapping(s, pat, ev->row, ev->position, event_idx);
}

// ============ Repeat Operations ============

void engine_set_event_repeat_amount(EngineState* s, uint16_t event_idx, uint16_t repeat_amount) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];

    ev->repeat_amount = repeat_amount;
    if (repeat_amount > 1 && ev->length > ev->repeat_space) {
        ev->length = ev->repeat_space;
    }
}

void engine_set_event_repeat_space(EngineState* s, uint16_t event_idx, int32_t repeat_space) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];

    ev->repeat_space = repeat_space;
    if (ev->repeat_amount > 1 && ev->length > repeat_space) {
        ev->length = repeat_space;
    }
}

// ============ Sub-Mode Operations ============

// Materialize a sub-mode array to target length
static void materialize_sub_mode(SubModeArray* arr, uint8_t target_length) {
    if (target_length <= arr->length) {
        arr->length = target_length;
        return;
    }

    // Expand
    uint8_t old_len = arr->length;
    if (old_len == 0) old_len = 1;  // Safety

    for (uint8_t i = old_len; i < target_length && i < MAX_SUB_MODE_LEN; i++) {
        if (arr->loop_mode == LOOP_FILL) {
            arr->values[i] = arr->values[old_len - 1];
        } else {
            arr->values[i] = arr->values[i % old_len];
        }
    }
    arr->length = target_length < MAX_SUB_MODE_LEN ? target_length : MAX_SUB_MODE_LEN;
}

void engine_set_sub_mode_value(EngineState* s, uint16_t event_idx, uint8_t sub_mode, uint16_t repeat_idx, int16_t value) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count || sub_mode >= NUM_SUB_MODES) return;
    NoteEvent_C* ev = &pat->events[event_idx];
    SubModeArray* arr = &ev->sub_modes[sub_mode];

    uint8_t target_len = (uint8_t)(repeat_idx + 1);
    if (target_len > arr->length) {
        materialize_sub_mode(arr, target_len);
    }
    if (repeat_idx < arr->length) {
        arr->values[repeat_idx] = value;
    }
}

void engine_set_sub_mode_length(EngineState* s, uint16_t event_idx, uint8_t sub_mode, uint8_t new_length) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count || sub_mode >= NUM_SUB_MODES) return;
    NoteEvent_C* ev = &pat->events[event_idx];
    SubModeArray* arr = &ev->sub_modes[sub_mode];

    uint8_t clamped = new_length < 1 ? 1 : (new_length > MAX_SUB_MODE_LEN ? MAX_SUB_MODE_LEN : new_length);
    materialize_sub_mode(arr, clamped);
}

void engine_toggle_sub_mode_loop_mode(EngineState* s, uint16_t event_idx, uint8_t sub_mode) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count || sub_mode >= NUM_SUB_MODES) return;
    NoteEvent_C* ev = &pat->events[event_idx];
    SubModeArray* arr = &ev->sub_modes[sub_mode];

    // Cycle: reset(0) → continue(1) → fill(2) → reset(0)
    arr->loop_mode = (arr->loop_mode + 1) % 3;
}

// ============ Chord Operations ============

void engine_adjust_chord_stack(EngineState* s, uint16_t event_idx, int8_t direction) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];

    int8_t new_amount = (int8_t)ev->chord_amount + direction;
    if (new_amount < 1) new_amount = 1;
    if (new_amount > MAX_CHORD_SIZE) new_amount = MAX_CHORD_SIZE;

    ev->chord_amount = (uint8_t)new_amount;
}

void engine_adjust_chord_space(EngineState* s, uint16_t event_idx, int8_t direction) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];

    if (ev->chord_amount <= 1) return;

    int8_t new_space = (int8_t)ev->chord_space + direction;
    if (new_space < 1) new_space = 1;
    if (new_space > 12) new_space = 12;

    ev->chord_space = (uint8_t)new_space;
}

void engine_cycle_chord_inversion(EngineState* s, uint16_t event_idx, int8_t direction) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];

    int16_t octave = (int16_t)s->scale_octave_size;
    int16_t min_row = -(int16_t)s->scale_zero_index;
    int16_t max_row = (int16_t)s->scale_count - (int16_t)s->scale_zero_index - 1;

    // Single note: jump octave directly
    if (ev->chord_amount <= 1) {
        int16_t new_row = ev->row + (direction > 0 ? octave : -octave);
        if (new_row < min_row || new_row > max_row) return;
        ev->row = new_row;
        return;
    }

    // Save state for rollback
    int8_t old_inv = ev->chord_inversion;
    int16_t old_row = ev->row;

    ev->chord_inversion += direction;

    // Absorb full octave cycles into the root note
    int8_t amt = (int8_t)ev->chord_amount;
    if (ev->chord_inversion >= amt) {
        ev->chord_inversion -= amt;
        ev->row += octave;
    } else if (ev->chord_inversion <= -amt) {
        ev->chord_inversion += amt;
        ev->row -= octave;
    }

    // Validate: all chord notes must be within MIDI range
    // Compute min/max chord offset using the simple formula
    int16_t chord_min = 0, chord_max = 0;
    for (uint8_t i = 0; i < ev->chord_amount; i++) {
        int16_t off = (int16_t)(i * ev->chord_space);
        if (off < chord_min) chord_min = off;
        if (off > chord_max) chord_max = off;
    }
    // Account for inversions shifting offsets by octave
    int8_t inv = ev->chord_inversion;
    if (inv > 0) chord_max += octave;
    if (inv < 0) chord_min -= octave;

    if (ev->row + chord_min < min_row || ev->row + chord_max > max_row) {
        // Rollback
        ev->chord_inversion = old_inv;
        ev->row = old_row;
    }
}

void engine_cycle_arp_style(EngineState* s, uint16_t event_idx, int8_t direction) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];

    if (ev->chord_amount <= 1) return;  // no chord, no arp

    int8_t new_style = (int8_t)ev->arp_style + direction;
    if (new_style < 0) new_style = ARP_STYLE_COUNT - 1;
    if (new_style >= ARP_STYLE_COUNT) new_style = 0;
    ev->arp_style = (uint8_t)new_style;
}

void engine_adjust_arp_offset(EngineState* s, uint16_t event_idx, int8_t direction) {
    PatternData_C* pat = get_current_pattern(s);
    if (event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[event_idx];

    if (ev->chord_amount <= 1 || ev->arp_style == ARP_CHORD) return;

    ev->arp_offset += direction;
}

// ============ Pattern Operations ============

void engine_copy_pattern(EngineState* s, uint8_t target_pattern) {
    if (target_pattern >= NUM_PATTERNS) return;
    uint8_t ch = s->current_channel;
    uint8_t src = s->current_patterns[ch];
    if (src == target_pattern) return;

    // Copy pattern data
    memcpy(&s->patterns[ch][target_pattern], &s->patterns[ch][src], sizeof(PatternData_C));

    // Assign new event IDs to copied events
    for (uint16_t i = 0; i < s->patterns[ch][target_pattern].event_count; i++) {
        s->patterns[ch][target_pattern].events[i].event_index = engine_alloc_event_id(s);
    }

    // Copy loop settings
    s->loops[ch][target_pattern] = s->loops[ch][src];

    engine_update_has_notes(s, ch, target_pattern);
}

void engine_clear_pattern(EngineState* s) {
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];

    // Reset events
    s->patterns[ch][pat].event_count = 0;
    s->patterns[ch][pat].length_ticks = DEFAULT_PATTERN_TICKS;

    // Reset loop
    s->loops[ch][pat].start = 0;
    s->loops[ch][pat].length = DEFAULT_LOOP_TICKS;

    // Clear selection
    s->selected_event_idx = -1;

    engine_update_has_notes(s, ch, pat);
}
