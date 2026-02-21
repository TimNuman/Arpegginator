#include "engine_input.h"
#include "engine_edit.h"
#include "engine_ui.h"
#include "engine_platform.h"
#include <string.h>

// ============ Zoom Levels (ordered coarse to fine) ============

static const int32_t ZOOM_LEVELS[] = { 480, 240, 120, 60, 30 };
#define NUM_ZOOM_LEVELS 5

// ============ Coordinate Conversion Helpers ============

static inline int32_t i32_clamp(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : (v > hi ? hi : v); }
static inline int32_t i32_max(int32_t a, int32_t b) { return a > b ? a : b; }
static inline int32_t i32_min(int32_t a, int32_t b) { return a < b ? a : b; }

// Total rows for current channel
static int16_t get_total_rows(const EngineState* s) {
    if (s->channel_types[s->current_channel] == CH_DRUM) return 128;
    return (int16_t)s->scale_count;
}

// Min row for current channel
static int16_t get_min_row(const EngineState* s) {
    if (s->channel_types[s->current_channel] == CH_DRUM) return 0;
    // For melodic, minRow is derived from scale mapping (negative index)
    // scale_zero_index is the array index for row 0
    return -(int16_t)s->scale_zero_index;
}

// Start array index from row offset
static int16_t get_start_array_index(const EngineState* s) {
    int16_t total = get_total_rows(s);
    int16_t max_offset = total - VISIBLE_ROWS;
    if (max_offset <= 0) return 0;
    float row_off = s->row_offsets[s->current_channel];
    return (int16_t)((1.0f - row_off) * max_offset + 0.5f);
}

int16_t engine_visible_to_actual_row(const EngineState* s, uint8_t visible_row) {
    int16_t start_idx = get_start_array_index(s);
    int16_t min_row = get_min_row(s);
    // Visible row 0 = top = highest index, 7 = bottom = lowest
    int16_t flipped = VISIBLE_ROWS - 1 - visible_row;
    return start_idx + min_row + flipped;
}

int32_t engine_visible_to_tick(const EngineState* s, uint8_t visible_col) {
    int32_t ticks_per_col = s->zoom;
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    int32_t pat_len = s->patterns[ch][pat].length_ticks;
    int32_t total_cols = (pat_len > 0 && ticks_per_col > 0)
        ? (pat_len + ticks_per_col - 1) / ticks_per_col
        : 0;
    int32_t max_col_offset = i32_max(0, total_cols - VISIBLE_COLS);
    int32_t start_col = max_col_offset > 0
        ? (int32_t)(s->col_offset * max_col_offset + 0.5f)
        : 0;
    return (start_col + visible_col) * ticks_per_col;
}

int16_t engine_find_event_at(const EngineState* s, int16_t row, int32_t tick) {
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    const PatternData_C* pd = &s->patterns[ch][pat];

    for (uint16_t i = 0; i < pd->event_count; i++) {
        const NoteEvent_C* ev = &pd->events[i];
        if (ev->row == row && ev->position == tick) {
            return (int16_t)i;
        }
    }
    return -1;
}

// Find event overlapping (row, tick) — the note at this tick range
static int16_t find_event_overlapping(const EngineState* s, int16_t row, int32_t tick) {
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    const PatternData_C* pd = &s->patterns[ch][pat];
    int32_t tpc = s->zoom;

    for (uint16_t i = 0; i < pd->event_count; i++) {
        const NoteEvent_C* ev = &pd->events[i];
        if (!ev->enabled) continue;
        if (ev->row != row) continue;

        // Check base event and all repeats
        for (uint16_t r = 0; r < ev->repeat_amount; r++) {
            int32_t pos = ev->position + (int32_t)r * ev->repeat_space;
            int32_t end = pos + ev->length;
            if (tick >= pos && tick < end) {
                return (int16_t)i;
            }
        }
    }
    return -1;
}

// Find event whose chord tone occupies (row, tick).
// Checks all chord offsets for each event/repeat combination.
static int16_t find_event_by_chord(const EngineState* s, int16_t row, int32_t tick) {
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    const PatternData_C* pd = &s->patterns[ch][pat];

    for (uint16_t i = 0; i < pd->event_count; i++) {
        const NoteEvent_C* ev = &pd->events[i];
        if (!ev->enabled) continue;
        if (ev->chord_stack_size <= 1) continue;  // no chord, skip

        int8_t offsets[MAX_CHORD_SIZE];
        uint8_t chord_count = get_chord_offsets(s, ev, offsets, MAX_CHORD_SIZE);

        // Check if any chord offset matches the row
        uint8_t row_match = 0;
        for (uint8_t c = 0; c < chord_count; c++) {
            if (ev->row + offsets[c] == row) { row_match = 1; break; }
        }
        if (!row_match) continue;

        // Check if tick falls within any repeat
        for (uint16_t r = 0; r < ev->repeat_amount; r++) {
            int32_t pos = ev->position + (int32_t)r * ev->repeat_space;
            int32_t end = pos + ev->length;
            if (tick >= pos && tick < end) {
                return (int16_t)i;
            }
        }
    }
    return -1;
}

// Play preview for an event — plays all chord tones if it has a chord, otherwise single note.
// Only plays when not currently playing back.
static void play_event_preview(const EngineState* s, const NoteEvent_C* ev, int32_t length_ticks) {
    if (s->is_playing) return;
    uint8_t ch = s->current_channel;
    if (ev->chord_stack_size <= 1) {
        platform_play_preview_note(ch, ev->row, length_ticks);
        return;
    }
    int8_t offsets[MAX_CHORD_SIZE];
    uint8_t count = get_chord_offsets(s, ev, offsets, MAX_CHORD_SIZE);
    for (uint8_t c = 0; c < count; c++) {
        platform_play_preview_note(ch, ev->row + offsets[c], length_ticks);
    }
}

// ============ Camera Follow ============

static void follow_note(EngineState* s, int16_t row, int32_t tick) {
    int16_t min_row = get_min_row(s);
    int16_t total = get_total_rows(s);
    int16_t max_row_off = total - VISIBLE_ROWS;

    if (max_row_off > 0) {
        int16_t arr_pos = row - min_row;
        int16_t start_idx = get_start_array_index(s);
        if (arr_pos < start_idx) {
            float new_off = 1.0f - (float)arr_pos / max_row_off;
            s->row_offsets[s->current_channel] = new_off < 0 ? 0 : (new_off > 1 ? 1 : new_off);
        } else if (arr_pos > start_idx + VISIBLE_ROWS - 1) {
            float new_off = 1.0f - (float)(arr_pos - VISIBLE_ROWS + 1) / max_row_off;
            s->row_offsets[s->current_channel] = new_off < 0 ? 0 : (new_off > 1 ? 1 : new_off);
        }
    }

    // Column follow
    int32_t tpc = s->zoom;
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    int32_t pat_len = s->patterns[ch][pat].length_ticks;
    int32_t total_cols = (pat_len + tpc - 1) / tpc;
    int32_t max_col_off = i32_max(0, total_cols - VISIBLE_COLS);

    if (max_col_off > 0) {
        int32_t col = tick / tpc;
        int32_t start_col = (int32_t)(s->col_offset * max_col_off + 0.5f);
        if (col < start_col) {
            s->col_offset = (float)col / max_col_off;
            if (s->col_offset < 0) s->col_offset = 0;
        } else if (col > start_col + VISIBLE_COLS - 1) {
            s->col_offset = (float)(col - VISIBLE_COLS + 1) / max_col_off;
            if (s->col_offset > 1) s->col_offset = 1;
        }
    }
}

// ============ Pattern Mode Button Press ============

static void handle_pattern_press(EngineState* s, uint8_t vis_row, uint8_t vis_col, uint8_t mods) {
    int16_t row = engine_visible_to_actual_row(s, vis_row);
    int32_t tick = engine_visible_to_tick(s, vis_col);
    int32_t tpc = s->zoom;
    PatternData_C* pat = &s->patterns[s->current_channel][s->current_patterns[s->current_channel]];

    // Meta+click: disable note (only turn off, never re-enable)
    if (mods & MOD_META) {
        int16_t idx = engine_find_event_at(s, row, tick);
        if (idx < 0) idx = find_event_overlapping(s, row, tick);
        if (idx < 0) idx = find_event_by_chord(s, row, tick);
        if (idx >= 0 && pat->events[idx].enabled) {
            pat->events[idx].enabled = 0;
            if (s->selected_event_idx == idx) {
                s->selected_event_idx = -1;
            }
        }
        return;
    }

    // Shift+click: resize selected note to this tick
    if ((mods & MOD_SHIFT) && s->selected_event_idx >= 0) {
        NoteEvent_C* sel = &pat->events[s->selected_event_idx];
        if (sel->row == row) {
            int32_t start = i32_min(sel->position, tick);
            int32_t end = i32_max(sel->position, tick);
            int32_t new_len = end - start + tpc;
            if (start != sel->position) {
                sel->position = start;
            }
            sel->length = new_len;
            play_event_preview(s, sel, tpc);
            return;
        }
    }

    // Click on existing event at exact position
    int16_t idx = engine_find_event_at(s, row, tick);
    if (idx >= 0) {
        // Re-enable disabled event
        if (!pat->events[idx].enabled) {
            pat->events[idx].enabled = 1;
            if (s->selected_event_idx >= 0) {
                engine_place_event(s, (uint16_t)s->selected_event_idx);
            }
            s->selected_event_idx = idx;
            play_event_preview(s, &pat->events[idx], tpc);
            return;
        }
        if (s->selected_event_idx == idx) {
            // Deselect (and place)
            engine_place_event(s, (uint16_t)idx);
            s->selected_event_idx = -1;
        } else {
            // Select
            if (s->selected_event_idx >= 0) {
                engine_place_event(s, (uint16_t)s->selected_event_idx);
            }
            s->selected_event_idx = idx;
        }
        play_event_preview(s, &pat->events[idx], tpc);
        return;
    }

    // Click on overlapping event (continuation/repeat)
    int16_t overlap_idx = find_event_overlapping(s, row, tick);
    if (overlap_idx >= 0) {
        if (s->selected_event_idx >= 0) {
            engine_place_event(s, (uint16_t)s->selected_event_idx);
        }
        s->selected_event_idx = overlap_idx;
        play_event_preview(s, &pat->events[overlap_idx], tpc);
        return;
    }

    // Click on chord tone: select the parent event
    int16_t chord_idx = find_event_by_chord(s, row, tick);
    if (chord_idx >= 0) {
        if (s->selected_event_idx >= 0) {
            engine_place_event(s, (uint16_t)s->selected_event_idx);
        }
        s->selected_event_idx = chord_idx;
        play_event_preview(s, &pat->events[chord_idx], tpc);
        return;
    }

    // Click on empty: create new note
    if (s->selected_event_idx >= 0) {
        engine_place_event(s, (uint16_t)s->selected_event_idx);
    }
    int16_t new_idx = engine_toggle_event(s, row, tick, tpc);
    if (new_idx >= 0) {
        s->selected_event_idx = new_idx;
    }
    if (!s->is_playing) {
        platform_play_preview_note(s->current_channel, row, tpc);
    }
}

// ============ Channel Mode Button Press ============

static void handle_channel_press(EngineState* s, uint8_t vis_row, uint8_t vis_col, uint8_t mods) {
    uint8_t ch_idx = vis_row;

    if (vis_col == 0) {
        // Column 0: mute/solo
        if (mods & MOD_ALT) {
            s->soloed[ch_idx] = !s->soloed[ch_idx];
        } else {
            s->muted[ch_idx] = !s->muted[ch_idx];
        }
        return;
    }

    uint8_t pat_idx = vis_col - 1;
    if (pat_idx >= NUM_PATTERNS) return;

    if ((mods & MOD_SHIFT) && ch_idx == s->current_channel) {
        // Shift+click on empty pattern: copy current pattern
        if (!s->patterns_have_notes[ch_idx][pat_idx]) {
            engine_copy_pattern(s, pat_idx);
        }
    }

    // Select this channel and pattern
    s->current_channel = ch_idx;
    s->current_patterns[ch_idx] = pat_idx;
    // Could also queue pattern change during playback — for now just set directly

    // Switch to pattern mode
    s->ui_mode = UI_PATTERN;
}

// ============ Loop Mode Button Press ============

static void handle_loop_press(EngineState* s, uint8_t vis_row, uint8_t vis_col, uint8_t mods) {
    int32_t tick = engine_visible_to_tick(s, vis_col);
    int32_t tpc = s->zoom;
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    PatternLoop_C* loop = &s->loops[ch][pat];
    int32_t loop_end = loop->start + loop->length;
    int32_t pat_len = s->patterns[ch][pat].length_ticks;

    // Remember looped playhead position before change
    int32_t old_looped = -1;
    if (s->current_tick >= 0 && loop->length > 0) {
        int32_t r = (s->current_tick - loop->start) % loop->length;
        if (r < 0) r += loop->length;
        old_looped = loop->start + r;
    }

    if (mods & MOD_SHIFT) {
        // Shift+click: set loop start
        int32_t new_start = i32_min(tick, loop_end - tpc);
        loop->length = loop_end - new_start;
        loop->start = new_start;
    } else {
        // Click: set loop end
        int32_t new_end = i32_max(tick + tpc, loop->start + tpc);
        if (new_end > pat_len) new_end = pat_len;
        loop->length = new_end - loop->start;
    }

    // Keep playhead at same position; reset to loop start if it falls outside
    if (old_looped >= 0 && loop->length > 0) {
        int32_t new_end = loop->start + loop->length;
        if (old_looped >= new_end || old_looped < loop->start) {
            s->current_tick = loop->start;
        } else {
            s->current_tick = old_looped;
        }
    }
}

// ============ Modify Mode Button Press ============

static void handle_modify_press(EngineState* s, uint8_t vis_row, uint8_t vis_col, uint8_t mods) {
    if (s->selected_event_idx < 0) {
        // No note selected: try to select a note at this cell
        int16_t row = engine_visible_to_actual_row(s, vis_row);
        int32_t tick = engine_visible_to_tick(s, vis_col);
        int16_t idx = find_event_overlapping(s, row, tick);
        if (idx >= 0) {
            s->selected_event_idx = idx;
        }
        return;
    }

    // Note is selected: set sub-mode value at this cell
    uint8_t sm = s->modify_sub_mode;
    const SubModeRenderConfig* config = engine_get_sub_mode_config(sm);

    // Generate all levels
    int16_t levels[128];
    uint8_t level_count = engine_generate_levels(config, levels, 128);
    if (level_count == 0) return;

    int16_t value;
    if (mods & MOD_META) {
        // Meta+click: reset to default (0)
        value = 0;
    } else {
        // Compute visible levels with scroll (same as render_modify_mode)
        int16_t visible[VISIBLE_ROWS];
        if (level_count <= VISIBLE_ROWS) {
            for (uint8_t i = 0; i < level_count; i++)
                visible[i] = levels[i];
            for (uint8_t i = level_count; i < VISIBLE_ROWS; i++)
                visible[i] = 0;
        } else {
            float scroll = engine_get_default_modify_scroll(levels, level_count, config->render_style);
            uint8_t max_scroll = level_count - VISIBLE_ROWS;
            uint8_t scroll_idx = (uint8_t)(scroll * max_scroll);
            for (uint8_t i = 0; i < VISIBLE_ROWS; i++)
                visible[i] = levels[scroll_idx + i];
        }

        if (vis_row >= VISIBLE_ROWS) return;
        value = visible[vis_row];
    }

    engine_set_sub_mode_value(s, (uint16_t)s->selected_event_idx, sm, vis_col, value);
}

// ============ Main Button Press Dispatch ============

void engine_button_press(EngineState* s, uint8_t row, uint8_t col, uint8_t modifiers) {
    // Ctrl+Z/X/C/V: switch UI mode (mapped as bottom row cols 0-3)
    // z=row7col0=channel, x=row7col1=pattern, c=row7col2=loop, v=row7col3=modify
    if ((modifiers & MOD_CTRL) && row == 7 && col <= 3) {
        static const uint8_t mode_map[4] = { UI_CHANNEL, UI_PATTERN, UI_LOOP, UI_MODIFY };
        s->ui_mode = mode_map[col];
        return;
    }

    switch (s->ui_mode) {
        case UI_PATTERN:
            handle_pattern_press(s, row, col, modifiers);
            break;
        case UI_CHANNEL:
            handle_channel_press(s, row, col, modifiers);
            break;
        case UI_LOOP:
            handle_loop_press(s, row, col, modifiers);
            break;
        case UI_MODIFY:
            handle_modify_press(s, row, col, modifiers);
            break;
    }
}

// ============ Arrow Press ============

// Zoom level cycling
static int32_t zoom_cycle(int32_t current, int8_t direction) {
    for (int i = 0; i < NUM_ZOOM_LEVELS; i++) {
        if (ZOOM_LEVELS[i] == current) {
            int new_i = i + direction;
            if (new_i < 0) new_i = 0;
            if (new_i >= NUM_ZOOM_LEVELS) new_i = NUM_ZOOM_LEVELS - 1;
            return ZOOM_LEVELS[new_i];
        }
    }
    return current;
}

// Modify sub-mode cycling
static const uint8_t MODIFY_SUB_MODE_ORDER[] = { SM_VELOCITY, SM_MODULATE, SM_HIT, SM_FLAM, SM_TIMING };
#define NUM_MODIFY_ORDER 5

// Triplet tick values
static const int32_t TRIPLETS[] = { 40, 80, 160, 320, 640 };
#define NUM_TRIPLETS 5
#define MAX_STEPS 128

// Sub-zoom musical values (straight + dotted, no triplets, min 1/32)
static const int32_t SUB_ZOOM[] = { 60, 90, 120, 180 };
#define NUM_SUB_ZOOM 4

static void sort_steps(int32_t* out, int n) {
    for (int i = 1; i < n; i++) {
        int32_t key = out[i];
        int j = i - 1;
        while (j >= 0 && out[j] > key) { out[j + 1] = out[j]; j--; }
        out[j + 1] = key;
    }
}

// Build step table: sub-zoom values + multiples of zoom, no triplets.
static int build_step_table(int32_t zoom, int32_t max_tick, int32_t* out) {
    int n = 0;
    for (int i = 0; i < NUM_SUB_ZOOM && n < MAX_STEPS; i++) {
        if (SUB_ZOOM[i] < zoom && SUB_ZOOM[i] <= max_tick) out[n++] = SUB_ZOOM[i];
    }
    for (int32_t v = zoom; v <= max_tick && n < MAX_STEPS; v += zoom) {
        out[n++] = v;
    }
    sort_steps(out, n);
    return n;
}

// Build step table: sub-zoom values + multiples of zoom + triplets.
static int build_step_table_with_triplets(int32_t zoom, int32_t max_tick, int32_t* out) {
    int n = build_step_table(zoom, max_tick, out);
    for (int i = 0; i < NUM_TRIPLETS; i++) {
        if (TRIPLETS[i] >= zoom && TRIPLETS[i] <= max_tick) {
            int found = 0;
            for (int j = 0; j < n; j++) {
                if (out[j] == TRIPLETS[i]) { found = 1; break; }
            }
            if (!found && n < MAX_STEPS) out[n++] = TRIPLETS[i];
        }
    }
    sort_steps(out, n);
    return n;
}

static void handle_arrow_pattern(EngineState* s, uint8_t dir, uint8_t mods) {
    if (s->selected_event_idx < 0) {
        // No selected note + Alt: cycle scale
        if ((mods & MOD_ALT) && !(mods & MOD_META) && !(mods & MOD_CTRL) && !(mods & MOD_SHIFT)) {
            if (dir == DIR_UP || dir == DIR_DOWN) {
                engine_cycle_scale(s, dir == DIR_UP ? 1 : -1);
            } else {
                engine_cycle_scale_root(s, dir == DIR_RIGHT ? 1 : -1);
            }
        }
        return;
    }

    PatternData_C* pat = &s->patterns[s->current_channel][s->current_patterns[s->current_channel]];
    if ((uint16_t)s->selected_event_idx >= pat->event_count) return;
    NoteEvent_C* ev = &pat->events[s->selected_event_idx];
    int32_t tpc = s->zoom;

    // Cmd+Shift+Up/Down: cycle chord shape
    if ((mods & MOD_META) && (mods & MOD_SHIFT)) {
        if (dir == DIR_UP || dir == DIR_DOWN) {
            engine_cycle_chord_shape(s, (uint16_t)s->selected_event_idx, dir == DIR_UP ? 1 : -1);
            play_event_preview(s, ev, tpc);
            return;
        }
    }

    // Cmd+Up/Down: adjust chord stack size
    if ((mods & MOD_META) && !(mods & MOD_SHIFT)) {
        if (dir == DIR_UP || dir == DIR_DOWN) {
            engine_adjust_chord_stack(s, (uint16_t)s->selected_event_idx, dir == DIR_UP ? 1 : -1);
            play_event_preview(s, ev, tpc);
            return;
        }
    }

    // Shift+Up/Down: cycle chord inversion (only when chord active)
    if ((mods & MOD_SHIFT) && !(mods & MOD_META) && !(mods & MOD_ALT)) {
        if (ev->chord_stack_size > 1 && (dir == DIR_UP || dir == DIR_DOWN)) {
            engine_cycle_chord_inversion(s, (uint16_t)s->selected_event_idx, dir == DIR_UP ? 1 : -1);
            play_event_preview(s, ev, tpc);
            return;
        }
    }

    // Cmd+Shift+Left/Right: adjust repeat space (zoom-level steps + triplets)
    if ((mods & MOD_META) && (mods & MOD_SHIFT)) {
        if (dir == DIR_LEFT || dir == DIR_RIGHT) {
            int32_t steps[MAX_STEPS];
            int n = build_step_table_with_triplets(tpc, 1920, steps);
            int32_t cur = ev->repeat_space;
            int increase = (dir == DIR_RIGHT);
            int idx = -1;
            for (int i = 0; i < n; i++) {
                if (steps[i] >= cur) { idx = i; break; }
            }
            if (idx < 0) idx = n - 1;
            if (steps[idx] == cur) {
                if (increase) idx = idx < n - 1 ? idx + 1 : idx;
                else idx = idx > 0 ? idx - 1 : idx;
            }
            engine_set_event_repeat_space(s, (uint16_t)s->selected_event_idx, steps[idx]);
            return;
        }
    }

    // Cmd+Left/Right: adjust repeat amount
    if ((mods & MOD_META) && !(mods & MOD_SHIFT)) {
        if (dir == DIR_LEFT || dir == DIR_RIGHT) {
            uint16_t amt = ev->repeat_amount;
            if (dir == DIR_LEFT) {
                amt = amt > 1 ? amt - 1 : 1;
            } else {
                amt = amt < 64 ? amt + 1 : 64;
            }
            engine_set_event_repeat_amount(s, (uint16_t)s->selected_event_idx, amt);
            return;
        }
    }

    // Shift+Left/Right: resize note (zoom-level steps + triplets)
    if ((mods & MOD_SHIFT) && !(mods & MOD_META) && !(mods & MOD_ALT)) {
        if (dir == DIR_LEFT || dir == DIR_RIGHT) {
            int32_t max_len = pat->length_ticks - ev->position;
            if (ev->repeat_amount > 1) {
                max_len = i32_min(max_len, ev->repeat_space);
            }
            int32_t steps[MAX_STEPS];
            int n = build_step_table(tpc, max_len, steps);
            int32_t cur = ev->length;
            int increase = (dir == DIR_RIGHT);
            int idx = -1;
            for (int i = 0; i < n; i++) {
                if (steps[i] >= cur) { idx = i; break; }
            }
            if (idx < 0) idx = n - 1;
            if (steps[idx] == cur) {
                if (increase) idx = idx < n - 1 ? idx + 1 : idx;
                else idx = idx > 0 ? idx - 1 : idx;
            }
            int32_t new_len = steps[idx];
            engine_set_event_length(s, (uint16_t)s->selected_event_idx, new_len);
            play_event_preview(s, ev, new_len);
            return;
        }
    }

    // Plain arrows: move note
    if (mods == 0) {
        int16_t new_row = ev->row;
        int32_t new_pos = ev->position;

        if (dir == DIR_UP) new_row = ev->row + 1;
        else if (dir == DIR_DOWN) new_row = ev->row - 1;
        else if (dir == DIR_LEFT) new_pos = i32_max(0, ev->position - tpc);
        else if (dir == DIR_RIGHT) new_pos = i32_min(pat->length_ticks - tpc, ev->position + tpc);

        // Bounds check for row
        if (s->channel_types[s->current_channel] == CH_DRUM) {
            new_row = i32_clamp(new_row, 0, 127);
        } else {
            // Check scale bounds
            int32_t idx = (int32_t)s->scale_zero_index + new_row;
            if (idx < 0 || idx >= (int32_t)s->scale_count) return;
        }

        if (new_row != ev->row || new_pos != ev->position) {
            engine_move_event(s, (uint16_t)s->selected_event_idx, new_row, new_pos);
            follow_note(s, new_row, new_pos);
            play_event_preview(s, ev, tpc);
        }
    }
}

static void handle_arrow_loop(EngineState* s, uint8_t dir, uint8_t mods) {
    if (mods != 0 && mods != MOD_SHIFT) return;
    if (dir != DIR_LEFT && dir != DIR_RIGHT) return;

    int32_t tpc = s->zoom;
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    PatternLoop_C* loop = &s->loops[ch][pat];
    int32_t pat_len = s->patterns[ch][pat].length_ticks;
    int32_t loop_end = loop->start + loop->length;

    if (mods & MOD_SHIFT) {
        // Adjust loop start
        int32_t new_start = loop->start;
        if (dir == DIR_LEFT) new_start = i32_max(0, loop->start - tpc);
        else new_start = i32_min(loop_end - tpc, loop->start + tpc);
        if (new_start != loop->start) {
            loop->length = loop_end - new_start;
            loop->start = new_start;
        }
    } else {
        // Adjust loop end
        int32_t new_end = loop_end;
        if (dir == DIR_LEFT) new_end = i32_max(loop->start + tpc, loop_end - tpc);
        else new_end = i32_min(pat_len, loop_end + tpc);
        if (new_end != loop_end) {
            loop->length = new_end - loop->start;
        }
    }
}

static void handle_arrow_modify(EngineState* s, uint8_t dir, uint8_t mods) {
    // Cmd+Up/Down: cycle modify sub-modes
    if ((mods & MOD_META) && !(mods & MOD_ALT) && !(mods & MOD_CTRL) && !(mods & MOD_SHIFT)) {
        if (dir == DIR_UP || dir == DIR_DOWN) {
            // Find current index in order
            int idx = 0;
            for (int i = 0; i < NUM_MODIFY_ORDER; i++) {
                if (MODIFY_SUB_MODE_ORDER[i] == s->modify_sub_mode) { idx = i; break; }
            }
            if (dir == DIR_DOWN) idx = (idx + 1) % NUM_MODIFY_ORDER;
            else idx = (idx - 1 + NUM_MODIFY_ORDER) % NUM_MODIFY_ORDER;
            s->modify_sub_mode = MODIFY_SUB_MODE_ORDER[idx];
            return;
        }
    }

    if (s->selected_event_idx < 0) return;

    // Up/Down: toggle loop mode
    if (mods == 0 && (dir == DIR_UP || dir == DIR_DOWN)) {
        engine_toggle_sub_mode_loop_mode(s, (uint16_t)s->selected_event_idx, s->modify_sub_mode);
        return;
    }

    // Left/Right: adjust array length
    if (mods == 0 && (dir == DIR_LEFT || dir == DIR_RIGHT)) {
        uint8_t ch = s->current_channel;
        uint8_t pat = s->current_patterns[ch];
        const NoteEvent_C* ev = &s->patterns[ch][pat].events[s->selected_event_idx];
        uint8_t cur_len = ev->sub_modes[s->modify_sub_mode].length;
        uint8_t new_len = cur_len;
        if (dir == DIR_RIGHT) new_len = cur_len + 1;
        else if (cur_len > 1) new_len = cur_len - 1;
        if (new_len != cur_len) {
            engine_set_sub_mode_length(s, (uint16_t)s->selected_event_idx, s->modify_sub_mode, new_len);
        }
        return;
    }
}

void engine_arrow_press(EngineState* s, uint8_t direction, uint8_t modifiers) {
    switch (s->ui_mode) {
        case UI_PATTERN:
            handle_arrow_pattern(s, direction, modifiers);
            break;
        case UI_LOOP:
            handle_arrow_loop(s, direction, modifiers);
            break;
        case UI_MODIFY:
            handle_arrow_modify(s, direction, modifiers);
            break;
        default:
            break;
    }
}

// ============ Key Actions ============

void engine_key_action(EngineState* s, uint8_t action_id) {
    switch (action_id) {
        case ACTION_TOGGLE_PLAY:
            s->is_playing = !s->is_playing;
            if (!s->is_playing) {
                engine_core_stop(s);
            } else {
                engine_core_play_init(s);
            }
            break;

        case ACTION_DESELECT:
            if (s->selected_event_idx >= 0) {
                s->selected_event_idx = -1;
            } else {
                // Reset playhead
                s->current_tick = -1;
            }
            break;

        case ACTION_ZOOM_IN:
            s->zoom = zoom_cycle(s->zoom, 1);  // toward finer (smaller ticks)
            break;

        case ACTION_ZOOM_OUT:
            s->zoom = zoom_cycle(s->zoom, -1);  // toward coarser (larger ticks)
            break;

        case ACTION_DELETE_NOTE:
            if (s->selected_event_idx >= 0) {
                engine_remove_event(s, (uint16_t)s->selected_event_idx);
                // selected_event_idx is cleared inside engine_remove_event
            }
            break;

        case ACTION_CLEAR_PATTERN:
            engine_clear_pattern(s);
            break;
    }
}
