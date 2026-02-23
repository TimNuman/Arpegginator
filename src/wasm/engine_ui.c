#include "engine_ui.h"
#include "engine_platform.h"
#include <string.h>

// ============ Sub-mode render configs ============

static const SubModeRenderConfig SUB_MODE_CONFIGS[NUM_SUB_MODES] = {
    // SM_VELOCITY: bar, 7-127, step 15
    { 0, 7, 127, 15 },
    // SM_HIT: bar, 12-100, step 12
    { 0, 12, 100, 12 },
    // SM_TIMING: offset, -50 to 50, step 5
    { 1, -50, 50, 5 },
    // SM_FLAM: bar, 12-100, step 12
    { 0, 12, 100, 12 },
    // SM_MODULATE: offset, -12 to 12, step 1
    { 1, -12, 12, 1 },
};

const SubModeRenderConfig* engine_get_sub_mode_config(uint8_t sub_mode) {
    if (sub_mode >= NUM_SUB_MODES) return &SUB_MODE_CONFIGS[0];
    return &SUB_MODE_CONFIGS[sub_mode];
}

// ============ Level generation ============

uint8_t engine_generate_levels(const SubModeRenderConfig* config, int16_t* out, uint8_t max_out) {
    uint8_t count = 0;
    for (int16_t v = config->max_val; v >= config->min_val && count < max_out; v -= config->step) {
        if (config->render_style == 1 && v == 0) continue;  // skip zero for offset
        out[count++] = v;
    }
    return count;
}

float engine_get_default_modify_scroll(const int16_t* levels, uint8_t count, uint8_t render_style) {
    if (render_style != 1 || count <= VISIBLE_ROWS) return 0.0f;
    uint8_t max_scroll = count - VISIBLE_ROWS;
    // Find zero-crossing index
    uint8_t zero_idx = 0;
    for (uint8_t i = 0; i < count; i++) {
        if (levels[i] < 0) { zero_idx = i; break; }
    }
    int16_t default_idx = (int16_t)zero_idx - VISIBLE_ROWS / 2;
    if (default_idx < 0) default_idx = 0;
    if (default_idx > max_scroll) default_idx = max_scroll;
    return max_scroll > 0 ? (float)default_idx / (float)max_scroll : 0.0f;
}

// ============ Helpers ============

static inline int32_t i32_min(int32_t a, int32_t b) { return a < b ? a : b; }
static inline int32_t i32_max(int32_t a, int32_t b) { return a > b ? a : b; }
static inline int32_t i32_clamp(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : (v > hi ? hi : v); }

static inline int32_t mod_pos(int32_t a, int32_t b) {
    int32_t r = a % b;
    return r < 0 ? r + b : r;
}

// Get sub-mode value at a given repeat index (with loop mode handling)
static int16_t get_sub_mode_value_at(const NoteEvent_C* ev, uint8_t sm, uint16_t repeat_idx) {
    const SubModeArray* arr = &ev->sub_modes[sm];
    if (arr->length == 0) return arr->values[0];
    return arr->values[repeat_idx % arr->length];
}

static int16_t get_sub_mode_value_fill(const NoteEvent_C* ev, uint8_t sm, uint16_t repeat_idx) {
    const SubModeArray* arr = &ev->sub_modes[sm];
    if (arr->length == 0) return arr->values[0];
    uint16_t idx = repeat_idx < arr->length ? repeat_idx : arr->length - 1;
    return arr->values[idx];
}

// ============ Rendered notes expansion ============

// Get chord offsets for a note event (amount + space model)
uint8_t get_chord_offsets(const EngineState* s, const NoteEvent_C* ev, int8_t* offsets, uint8_t max_out) {
    uint8_t amount = ev->chord_amount;
    if (amount <= 1) {
        offsets[0] = 0;
        return 1;
    }
    if (amount > MAX_CHORD_SIZE) amount = MAX_CHORD_SIZE;
    if (amount > max_out) amount = max_out;

    // Build base chord: [0, space, 2*space, ...]
    int16_t offsets16[MAX_CHORD_SIZE];
    for (uint8_t i = 0; i < amount; i++) {
        offsets16[i] = (int16_t)(i * ev->chord_space);
    }

    // Apply inversions using scale-dependent octave
    int16_t octave = (int16_t)s->scale_octave_size;
    int8_t inv = ev->chord_inversion;
    if (inv > 0) {
        for (int8_t n = 0; n < inv; n++) {
            offsets16[n % amount] += octave;
        }
    } else if (inv < 0) {
        for (int8_t n = 0; n < -inv; n++) {
            offsets16[amount - 1 - (n % amount)] -= octave;
        }
    }

    for (uint8_t i = 0; i < amount; i++) {
        offsets[i] = (int8_t)offsets16[i];
    }

    return amount;
}

uint16_t engine_render_events(
    const EngineState* s,
    uint8_t channel,
    uint8_t pattern,
    RenderedNote* out,
    uint16_t max_out
) {
    const PatternData_C* pat = &s->patterns[channel][pattern];
    uint16_t count = 0;

    for (uint16_t e = 0; e < pat->event_count && count < max_out; e++) {
        const NoteEvent_C* ev = &pat->events[e];
        if (!ev->enabled) continue;

        // Get chord offsets
        int8_t chord_offsets[MAX_CHORD_SIZE];
        uint8_t chord_count = get_chord_offsets(s, ev, chord_offsets, MAX_CHORD_SIZE);

        // Expand repeats
        for (uint16_t r = 0; r < ev->repeat_amount && count < max_out; r++) {
            int32_t pos = ev->position + (int32_t)r * ev->repeat_space;

            // Wrap position within pattern length
            if (pat->length_ticks > 0) {
                pos = mod_pos(pos, pat->length_ticks);
            }

            // Get modulation offset for this repeat
            int16_t mod_offset = 0;
            if (ev->sub_modes[SM_MODULATE].length > 0) {
                uint8_t loop_mode = ev->sub_modes[SM_MODULATE].loop_mode;
                if (loop_mode == LOOP_FILL) {
                    mod_offset = get_sub_mode_value_fill(ev, SM_MODULATE, r);
                } else {
                    mod_offset = get_sub_mode_value_at(ev, SM_MODULATE, r);
                }
            }

            // Expand chord notes
            for (uint8_t c = 0; c < chord_count && count < max_out; c++) {
                RenderedNote* rn = &out[count++];
                rn->source_row = ev->row;
                rn->row = ev->row + mod_offset + chord_offsets[c];
                rn->position = pos;
                rn->length = ev->length;
                rn->source_idx = e;
                rn->is_repeat = (r > 0 || c > 0) ? 1 : 0;
                rn->repeat_index = r;
                rn->chord_offset = chord_offsets[c];
            }
        }
    }

    return count;
}

// ============ Helpers for grid coordinate calculations ============

// Get the start tick for the visible window
// Must match engine_visible_to_tick() in engine_input.c
static int32_t get_start_tick(const EngineState* s) {
    int32_t ticks_per_col = s->zoom;
    int32_t total_cols = 0;
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    int32_t pat_len = s->patterns[ch][pat].length_ticks;
    if (pat_len > 0 && ticks_per_col > 0) {
        total_cols = (pat_len + ticks_per_col - 1) / ticks_per_col;
    }
    if (total_cols <= VISIBLE_COLS) return 0;
    int32_t max_col_offset = total_cols - VISIBLE_COLS;
    // round(col_offset * max_col_offset) — matches JS Math.round()
    int32_t start_col = (int32_t)(s->col_offset * max_col_offset + 0.5f);
    start_col = i32_clamp(start_col, 0, max_col_offset);
    return start_col * ticks_per_col;
}

// Get the min row for the current channel (same as engine_input.c)
static int16_t get_min_row(const EngineState* s) {
    if (s->channel_types[s->current_channel] == CH_DRUM) return 0;
    return -(int16_t)s->scale_zero_index;
}

// Get the start row for the visible window (accounting for row offset)
// Must match engine_visible_to_actual_row() in engine_input.c and JS convention:
//   startArrayIndex = round((1 - offset) * maxRowOffset)
//   startRow = startArrayIndex + minRow
static int16_t get_start_row(const EngineState* s, int16_t total_rows) {
    int16_t min_row = get_min_row(s);
    if (total_rows <= VISIBLE_ROWS) return min_row;
    uint8_t ch = s->current_channel;
    float offset = s->row_offsets[ch];
    int16_t max_offset = total_rows - VISIBLE_ROWS;
    // Inverted: offset=1 means top (highest rows visible), offset=0 means bottom
    int16_t start_array_index = (int16_t)((1.0f - offset) * max_offset + 0.5f);
    start_array_index = i32_clamp(start_array_index, 0, max_offset);
    return start_array_index + min_row;
}

// Compute looped tick for playhead
static int32_t get_looped_tick(const EngineState* s) {
    if (s->current_tick < 0) return -1;
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    const PatternLoop_C* loop = &s->loops[ch][pat];
    int32_t loop_len = loop->length;
    if (loop_len <= 0) return -1;
    return loop->start + mod_pos(s->current_tick - loop->start, loop_len);
}

// Check if a note is currently active (playing)
// Note: an->end = start + length - 1, so use <= for inclusive range
static uint8_t is_note_active(const EngineState* s, uint8_t channel, uint16_t event_idx, int32_t tick) {
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        const ActiveNote* an = &s->active_notes[i];
        if (an->active && an->channel == channel && an->event_index == event_idx &&
            tick >= an->start && tick <= an->end) {
            return 1;
        }
    }
    return 0;
}

// ============ Color helpers ============

// Parse channel color hex string → RGB packed uint32
// Channel colors are set from JS via engine_set_channel_color(), already uint32.

// Blend color with white based on velocity (7-127)
// Returns packed 0xRRGGBB
static uint32_t velocity_color_blend(uint32_t base_rgb, int16_t velocity) {
    float white_mix = (1.0f - ((float)(velocity - 7) / 120.0f)) * 0.3f;
    uint8_t r = (base_rgb >> 16) & 0xFF;
    uint8_t g = (base_rgb >> 8) & 0xFF;
    uint8_t b = base_rgb & 0xFF;
    uint8_t nr = (uint8_t)(r + (255 - r) * white_mix);
    uint8_t ng = (uint8_t)(g + (255 - g) * white_mix);
    uint8_t nb = (uint8_t)(b + (255 - b) * white_mix);
    return ((uint32_t)nr << 16) | ((uint32_t)ng << 8) | nb;
}

// ============ Pattern Mode Rendering ============

static void render_pattern_mode(EngineState* s, const RenderedNote* notes, uint16_t note_count) {
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    const PatternData_C* pat_data = &s->patterns[ch][pat];
    const PatternLoop_C* loop = &s->loops[ch][pat];
    int32_t ticks_per_col = s->zoom;
    int32_t start_tick = get_start_tick(s);
    int32_t looped_tick = get_looped_tick(s);
    int32_t loop_end = loop->start + loop->length;

    // Total rows depends on channel type
    int16_t total_rows = (s->channel_types[ch] == CH_DRUM) ? 128 : (int16_t)s->scale_count;
    int16_t start_row = get_start_row(s, total_rows);

    uint32_t ch_color = s->channel_colors[ch];

    for (int vr = 0; vr < VISIBLE_ROWS; vr++) {
        int flipped = VISIBLE_ROWS - 1 - vr;
        int16_t actual_row = start_row + flipped;

        for (int vc = 0; vc < VISIBLE_COLS; vc++) {
            int32_t actual_tick = start_tick + vc * ticks_per_col;
            int32_t col_end_tick = actual_tick + ticks_per_col;

            uint16_t value = BTN_OFF;
            uint32_t color = 0;

            // Find notes in this cell
            const RenderedNote* best = NULL;
            const RenderedNote* starting_here = NULL;
            uint8_t any_playing = 0;

            for (uint16_t n = 0; n < note_count; n++) {
                const RenderedNote* rn = &notes[n];
                if (rn->row != actual_row) continue;
                int32_t note_end = rn->position + rn->length;
                if (rn->position >= col_end_tick || note_end <= actual_tick) continue;

                // This note overlaps this cell
                if (rn->position >= actual_tick && rn->position < col_end_tick) {
                    if (!starting_here) starting_here = rn;
                }
                if (!best || rn->position < best->position) {
                    best = rn;
                }

                // Check if playing — use the event's unique ID, not array index
                if (looped_tick >= 0 && looped_tick >= rn->position && looped_tick < note_end) {
                    uint16_t ev_id = pat_data->events[rn->source_idx].event_index;
                    if (is_note_active(s, ch, ev_id, looped_tick)) {
                        any_playing = 1;
                    }
                }
            }

            const RenderedNote* note_at_tick = starting_here ? starting_here : best;

            if (note_at_tick) {
                const NoteEvent_C* src_ev = &pat_data->events[note_at_tick->source_idx];

                // Hit chance determines brightness
                int16_t hit_chance = get_sub_mode_value_at(src_ev, SM_HIT, note_at_tick->repeat_index);
                value = hit_chance >= 75 ? BTN_COLOR_100
                      : hit_chance >= 50 ? BTN_COLOR_50
                      : BTN_COLOR_25;

                // Continuation flag
                uint8_t is_start = (note_at_tick->position >= actual_tick && note_at_tick->position < col_end_tick);
                if (!is_start) value |= FLAG_CONTINUATION;

                // Playing flag
                if (any_playing) value |= FLAG_PLAYING;

                // Selected flag
                if (s->selected_event_idx >= 0 && note_at_tick->source_idx == (uint16_t)s->selected_event_idx) {
                    value |= FLAG_SELECTED;
                }

                // Velocity-based color blend
                int16_t vel = get_sub_mode_value_at(src_ev, SM_VELOCITY, note_at_tick->repeat_index);
                color = velocity_color_blend(ch_color, vel);

            } else {
                // Empty cell — check off-screen indicators on edges
                uint8_t is_top = (vr == 0);
                uint8_t is_bottom = (vr == VISIBLE_ROWS - 1);
                uint8_t is_left = (vc == 0);
                uint8_t is_right = (vc == VISIBLE_COLS - 1);
                int16_t vis_bottom_row = start_row;
                int16_t vis_top_row = start_row + VISIBLE_ROWS - 1;
                int32_t end_tick = start_tick + VISIBLE_COLS * ticks_per_col;

                if (is_top || is_bottom || is_left || is_right) {
                    uint8_t off_screen = 0;
                    for (uint16_t n = 0; n < note_count && !off_screen; n++) {
                        const RenderedNote* rn = &notes[n];
                        int32_t ne = rn->position + rn->length;
                        if (is_top && rn->row > vis_top_row && rn->position <= actual_tick && ne > actual_tick)
                            off_screen = 1;
                        if (is_bottom && rn->row < vis_bottom_row && rn->position <= actual_tick && ne > actual_tick)
                            off_screen = 1;
                        if (is_right && rn->row == actual_row && rn->position >= end_tick)
                            off_screen = 1;
                        if (is_left && rn->row == actual_row && ne <= start_tick)
                            off_screen = 1;
                    }
                    if (off_screen) {
                        value = BTN_COLOR_25;
                        color = ch_color;
                    }
                }

                // Grid markers
                uint8_t in_loop = (actual_tick >= loop->start && actual_tick < loop_end);
                if (in_loop) {
                    // Playhead
                    if (looped_tick >= 0 && actual_tick <= looped_tick && col_end_tick > looped_tick) {
                        value |= FLAG_PLAYHEAD;
                    }
                    // Loop boundaries
                    if (actual_tick == loop->start || (col_end_tick >= loop_end && actual_tick < loop_end)) {
                        value |= FLAG_LOOP_BOUNDARY;
                    }
                }
                // Beat marker (alternate quarter shading, inside and outside loop)
                if ((actual_tick / TICKS_PER_QUARTER) % 2 == 0) {
                    value |= FLAG_BEAT_MARKER;
                }

                // Root/C-note marker
                if (s->channel_types[ch] == CH_DRUM) {
                    if ((actual_row - 36) % 7 == 0 && actual_row >= 36) {
                        value |= FLAG_C_NOTE;
                    }
                } else {
                    // Check if this row's MIDI note has the scale root pitch class
                    int32_t midi_idx = (int32_t)s->scale_zero_index + (int32_t)actual_row;
                    if (midi_idx >= 0 && midi_idx < (int32_t)s->scale_count) {
                        uint8_t midi = s->scale_notes[midi_idx];
                        if (midi % 12 == s->scale_root) {
                            value |= FLAG_C_NOTE;
                        }
                    }
                }
            }

            s->button_values[vr][vc] = value;
            s->color_overrides[vr][vc] = color;
        }
    }
}

// ============ Channel Mode Rendering ============

static void render_channel_mode(EngineState* s, const RenderedNote* notes, uint16_t note_count) {
    uint8_t any_soloed = 0;
    for (int i = 0; i < NUM_CHANNELS; i++) {
        if (s->soloed[i]) { any_soloed = 1; break; }
    }

    // First: render the note grid as the background layer (same as pattern mode)
    // But we'll do a simpler version — fill all cells with the pattern grid then overlay channel UI
    render_pattern_mode(s, notes, note_count);

    // Now overlay channel mode on top
    for (int vr = 0; vr < VISIBLE_ROWS; vr++) {
        uint8_t ch_idx = vr;
        uint32_t ch_color = s->channel_colors[ch_idx];
        uint8_t cur_pat = s->current_patterns[ch_idx];
        uint8_t is_muted = s->muted[ch_idx];
        uint8_t is_soloed = s->soloed[ch_idx];
        uint8_t is_eff_muted = is_muted || (any_soloed && !is_soloed);

        for (int vc = 0; vc < VISIBLE_COLS; vc++) {
            if (vc == 0) {
                // Column 0: mute/solo indicator
                uint8_t is_playing_now = s->channels_playing_now[ch_idx];
                uint16_t val;
                if (is_soloed)
                    val = BTN_WHITE_25;
                else if (is_eff_muted)
                    val = BTN_COLOR_25;
                else
                    val = BTN_COLOR_100;
                if (is_playing_now) val |= FLAG_PLAYHEAD;
                s->button_values[vr][vc] = val;
                s->color_overrides[vr][vc] = ch_color;
                continue;
            }

            uint8_t pat_idx = vc - 1;
            if (pat_idx >= NUM_PATTERNS) {
                // Beyond pattern columns — show dimmed note grid
                s->button_values[vr][vc] |= FLAG_DIMMED;
                continue;
            }

            uint8_t has_notes = s->patterns_have_notes[ch_idx][pat_idx];
            uint8_t is_selected = (ch_idx == s->current_channel && pat_idx == cur_pat);
            uint8_t is_active = (pat_idx == cur_pat);
            uint8_t is_queued = (s->queued_patterns[ch_idx] == (int8_t)pat_idx);
            uint8_t is_playing_now = is_active && s->channels_playing_now[ch_idx];
            uint8_t is_empty = !has_notes && !is_queued;

            if (!is_empty) {
                uint16_t val = BTN_COLOR_50;
                if (is_selected)
                    val = BTN_COLOR_100;
                else if (is_queued)
                    val = BTN_COLOR_50;  // TODO: pulse on beat

                if (is_eff_muted)
                    val = BTN_COLOR_25;
                else if (is_soloed && !is_selected)
                    val = BTN_WHITE_25;

                if (is_playing_now || is_queued) val |= FLAG_PLAYHEAD;

                s->button_values[vr][vc] = val;
                s->color_overrides[vr][vc] = ch_color;
            } else {
                // Empty slot: show dimmed note grid underneath
                s->button_values[vr][vc] |= FLAG_DIMMED;
            }
        }
    }
}

// ============ Loop Mode Rendering ============

static void render_loop_mode(EngineState* s, const RenderedNote* notes, uint16_t note_count) {
    // Same as pattern mode but with pulsing loop boundaries
    render_pattern_mode(s, notes, note_count);

    // Add pulsing flag to loop boundary cells; hide playhead when not playing
    // to avoid confusion with loop boundary lines
    for (int vr = 0; vr < VISIBLE_ROWS; vr++) {
        for (int vc = 0; vc < VISIBLE_COLS; vc++) {
            uint16_t* v = &s->button_values[vr][vc];
            if (*v & FLAG_LOOP_BOUNDARY) {
                *v |= FLAG_LOOP_BOUNDARY_PULSING;
            }
            if (!s->is_playing) {
                *v &= ~FLAG_PLAYHEAD;
            }
        }
    }
}

// ============ Modify Mode Rendering ============

// Scratch buffers for modify mode levels (stored in EngineState would bloat it)
static int16_t g_all_levels[128];
static uint8_t g_all_levels_count;
static int16_t g_visible_levels[VISIBLE_ROWS];
static float   g_modify_scroll;

static void render_modify_mode(EngineState* s) {
    // If no selected event, render pattern grid but dimmed
    if (s->selected_event_idx < 0) {
        // We'd need rendered notes for dim grid — but modify without selected note is just dimmed
        memset(s->button_values, 0, sizeof(s->button_values));
        memset(s->color_overrides, 0, sizeof(s->color_overrides));
        // Dim everything
        for (int r = 0; r < VISIBLE_ROWS; r++)
            for (int c = 0; c < VISIBLE_COLS; c++)
                s->button_values[r][c] = BTN_OFF | FLAG_DIMMED;
        return;
    }

    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];
    const PatternData_C* pat_data = &s->patterns[ch][pat];
    uint16_t ev_idx = (uint16_t)s->selected_event_idx;
    if (ev_idx >= pat_data->event_count) return;
    const NoteEvent_C* ev = &pat_data->events[ev_idx];

    uint8_t sm = s->modify_sub_mode;
    const SubModeRenderConfig* config = engine_get_sub_mode_config(sm);
    const SubModeArray* arr = &ev->sub_modes[sm];

    // Generate all levels
    g_all_levels_count = engine_generate_levels(config, g_all_levels, 128);
    if (g_all_levels_count == 0) return;

    // Compute visible levels with scrolling
    if (g_all_levels_count <= VISIBLE_ROWS) {
        g_modify_scroll = 0;
        for (uint8_t i = 0; i < g_all_levels_count; i++)
            g_visible_levels[i] = g_all_levels[i];
        // Pad remaining with 0
        for (uint8_t i = g_all_levels_count; i < VISIBLE_ROWS; i++)
            g_visible_levels[i] = 0;
    } else {
        // Use stored scroll (managed by JS — modify_scroll stored externally)
        // For now use default scroll
        g_modify_scroll = engine_get_default_modify_scroll(g_all_levels, g_all_levels_count, config->render_style);
        uint8_t max_scroll = g_all_levels_count - VISIBLE_ROWS;
        uint8_t scroll_idx = (uint8_t)(g_modify_scroll * max_scroll);
        for (uint8_t i = 0; i < VISIBLE_ROWS; i++)
            g_visible_levels[i] = g_all_levels[scroll_idx + i];
    }

    uint16_t repeat_amount = ev->repeat_amount;
    uint8_t array_length = arr->length;
    uint8_t loop_mode = arr->loop_mode;

    // Detect center rows for offset rendering
    uint8_t center_rows[VISIBLE_ROWS];
    memset(center_rows, 0, sizeof(center_rows));
    if (config->render_style == 1) {
        for (int i = 0; i < VISIBLE_ROWS - 1; i++) {
            if (g_visible_levels[i] > 0 && g_visible_levels[i + 1] < 0) {
                center_rows[i] = 1;
                center_rows[i + 1] = 1;
            }
        }
    }

    // Determine playing column
    int32_t looped_tick = get_looped_tick(s);
    int16_t playing_col = -1;
    if (looped_tick >= 0) {
        for (uint16_t r = 0; r < repeat_amount; r++) {
            int32_t tick_start = ev->position + (int32_t)r * ev->repeat_space;
            int32_t tick_end = tick_start + ev->length;
            if (looped_tick >= tick_start && looped_tick < tick_end) {
                if (loop_mode == LOOP_CONTINUE) {
                    uint16_t counter = s->continue_counters[sm][ch][ev->event_index];
                    uint16_t last_used = counter > 0 ? counter - 1 : 0;
                    playing_col = last_used % array_length;
                } else {
                    playing_col = r;
                }
                break;
            }
        }
    }

    // Value getter
    #define GET_VALUE(idx) (loop_mode == LOOP_FILL \
        ? get_sub_mode_value_fill(ev, sm, (idx)) \
        : get_sub_mode_value_at(ev, sm, (idx)))

    for (int vr = 0; vr < VISIBLE_ROWS; vr++) {
        int16_t threshold = g_visible_levels[vr];

        for (int vc = 0; vc < VISIBLE_COLS; vc++) {
            uint8_t is_playing_col = (vc == playing_col);
            uint8_t is_explicit = (vc < array_length);
            uint8_t is_in_repeat = (vc < repeat_amount);

            if (!is_explicit && !is_in_repeat) {
                s->button_values[vr][vc] = is_playing_col ? FLAG_PLAYHEAD : BTN_OFF;
                s->color_overrides[vr][vc] = 0;
                continue;
            }

            int16_t val = GET_VALUE(vc);

            if (config->render_style == 1) {
                // Offset mode: single lit cell at matching row
                int16_t match_row = -1;
                if (val != 0) {
                    for (uint8_t i = 0; i < VISIBLE_ROWS; i++) {
                        if (g_visible_levels[i] == val) { match_row = i; break; }
                    }
                }
                if (match_row == vr) {
                    uint16_t intensity = is_explicit ? BTN_COLOR_100 : BTN_COLOR_50;
                    if (is_playing_col) intensity |= FLAG_PLAYING;
                    s->button_values[vr][vc] = intensity;
                } else if (center_rows[vr]) {
                    uint16_t intensity = BTN_COLOR_25;
                    if (is_playing_col) intensity |= FLAG_PLAYING;
                    s->button_values[vr][vc] = intensity;
                } else {
                    s->button_values[vr][vc] = is_playing_col ? FLAG_PLAYHEAD : BTN_OFF;
                }
            } else {
                // Bar mode: fill from bottom up
                if (val >= threshold) {
                    uint16_t intensity = is_explicit ? BTN_COLOR_100 : BTN_COLOR_50;
                    if (is_playing_col) intensity |= FLAG_PLAYING;
                    s->button_values[vr][vc] = intensity;
                } else {
                    s->button_values[vr][vc] = is_playing_col ? FLAG_PLAYHEAD : BTN_OFF;
                }
            }
            s->color_overrides[vr][vc] = 0;
        }
    }

    #undef GET_VALUE
}

// ============ Ctrl Mode Hint Overlay ============

static void apply_ctrl_overlay(EngineState* s) {
    if (!s->ctrl_held) return;

    // Mode hint colors (packed RGB) for cols 0-3:
    // col 0 = Z = channel, col 1 = X = pattern, col 2 = C = loop, col 3 = V = modify
    static const uint32_t mode_colors[4] = {
        0x33CCFF, // channel - cyan
        0x33FF66, // pattern - green
        0xFFCC33, // loop - yellow
        0xFF6633, // modify - orange
    };

    // Map col → UI mode for the "is current" check
    static const uint8_t col_to_mode[4] = { UI_CHANNEL, UI_PATTERN, UI_LOOP, UI_MODIFY };

    for (int r = 0; r < VISIBLE_ROWS; r++) {
        for (int c = 0; c < VISIBLE_COLS; c++) {
            if (r == 7 && c <= 3) {
                // Mode hint buttons: bright if current mode, dimmer if not
                uint8_t is_current = (s->ui_mode == col_to_mode[c]);
                s->button_values[r][c] = is_current ? BTN_COLOR_100 : BTN_COLOR_50;
                s->color_overrides[r][c] = mode_colors[c];
            } else {
                s->button_values[r][c] |= FLAG_DIMMED;
            }
        }
    }
}

// ============ Main Entry Point ============

// Scratch buffer for rendered notes
static RenderedNote g_rendered_notes[MAX_RENDERED_NOTES];

#define EASE_FACTOR   0.12f
#define EASE_SNAP     0.001f

void engine_compute_grid(EngineState* s) {
    uint8_t ch = s->current_channel;
    uint8_t pat = s->current_patterns[ch];

    // Ease row offset toward target (smooth float lerp, snap at end)
    float cur = s->row_offsets[ch];
    float tgt = s->target_row_offsets[ch];
    if (cur != tgt) {
        float diff = tgt - cur;
        float abs_diff = diff > 0 ? diff : -diff;
        if (abs_diff < EASE_SNAP) {
            s->row_offsets[ch] = tgt;
        } else {
            s->row_offsets[ch] = cur + diff * EASE_FACTOR;
        }
    }

    // Clear buffers
    memset(s->button_values, 0, sizeof(s->button_values));
    memset(s->color_overrides, 0, sizeof(s->color_overrides));

    // Expand current pattern's events to rendered notes
    uint16_t note_count = engine_render_events(s, ch, pat, g_rendered_notes, MAX_RENDERED_NOTES);

    switch (s->ui_mode) {
        case UI_CHANNEL:
            render_channel_mode(s, g_rendered_notes, note_count);
            break;
        case UI_LOOP:
            render_loop_mode(s, g_rendered_notes, note_count);
            break;
        case UI_MODIFY:
            render_modify_mode(s);
            break;
        case UI_PATTERN:
        default:
            render_pattern_mode(s, g_rendered_notes, note_count);
            break;
    }

    // Apply Ctrl overlay (dims grid, highlights mode buttons)
    apply_ctrl_overlay(s);

    // Update channels_playing_now for display
    for (int i = 0; i < NUM_CHANNELS; i++) {
        s->channels_playing_now[i] = 0;
        for (int j = 0; j < MAX_ACTIVE_NOTES; j++) {
            if (s->active_notes[j].active && s->active_notes[j].channel == i) {
                s->channels_playing_now[i] = 1;
                break;
            }
        }
    }
}

uint8_t engine_is_animating(const EngineState* s) {
    for (int i = 0; i < NUM_CHANNELS; i++) {
        float diff = s->target_row_offsets[i] - s->row_offsets[i];
        if (diff > EASE_SNAP || diff < -EASE_SNAP) return 1;
    }
    return 0;
}
