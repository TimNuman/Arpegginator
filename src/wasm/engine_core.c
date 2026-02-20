#include "engine_core.h"
#include "engine_platform.h"
#include <string.h>

#define DEFAULT_PATTERN_TICKS  (TICKS_PER_QUARTER * 4 * 4)  // 4 bars of 4/4 = 7680
#define DEFAULT_LOOP_TICKS     (TICKS_PER_QUARTER * 4)       // 1 bar = 1920

// ============ Helpers ============

static inline int32_t mod_positive(int32_t a, int32_t b) {
    int32_t r = a % b;
    return r < 0 ? r + b : r;
}

static inline int32_t clamp_i32(int32_t v, int32_t lo, int32_t hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

static inline uint16_t min_u16(uint16_t a, uint16_t b) {
    return a < b ? a : b;
}

static uint32_t engine_random(EngineState* s) {
    uint32_t x = s->rng_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    s->rng_state = x;
    return x;
}

int8_t note_to_midi(int16_t row, const EngineState* s) {
    int32_t idx = (int32_t)s->scale_zero_index + (int32_t)row;
    if (idx < 0 || idx >= (int32_t)s->scale_count) return -1;
    return (int8_t)s->scale_notes[idx];
}

// ============ Scale Definitions ============

//                                       1  b2  2  b3  3   4  b5  5  b6  6  b7  7
static const uint8_t SCALE_PATTERNS[NUM_SCALES][12] = {
    // Western
    {1,0,1,0,1,1,0,1,0,1,0,1}, // major
    {1,0,1,1,0,1,0,1,1,0,1,0}, // naturalMinor
    {1,0,1,1,0,1,0,1,1,0,0,1}, // harmonicMinor
    {1,0,1,1,0,1,0,1,0,1,0,1}, // melodicMinor
    // Modal
    {1,0,1,1,0,1,0,1,0,1,1,0}, // dorian
    {1,1,0,1,0,1,0,1,1,0,1,0}, // phrygian
    {1,0,1,0,1,0,1,1,0,1,0,1}, // lydian
    {1,0,1,0,1,1,0,1,0,1,1,0}, // mixolydian
    {1,0,1,1,0,1,0,1,1,0,1,0}, // aeolian
    {1,1,0,1,0,1,1,0,1,0,1,0}, // locrian
    // Pentatonic
    {1,0,1,0,1,0,0,1,0,1,0,0}, // majorPentatonic
    {1,0,0,1,0,1,0,1,0,0,1,0}, // minorPentatonic
    {1,0,0,1,0,1,1,1,0,0,1,0}, // blues
    // Symmetric
    {1,0,1,0,1,0,1,0,1,0,1,0}, // wholeTone
    {1,1,1,1,1,1,1,1,1,1,1,1}, // chromatic
    {1,0,1,1,0,1,1,0,1,1,0,1}, // diminished
    {1,0,0,1,1,0,0,1,1,0,0,1}, // augmented
    // Exotic
    {1,0,1,1,0,0,0,1,1,0,0,0}, // hirajoshi
    {1,1,0,0,0,1,0,1,0,0,1,0}, // insen
    {1,1,0,0,0,1,1,0,0,0,1,0}, // iwato
    {1,0,1,1,0,0,0,1,0,1,0,0}, // kumoi
    {1,1,0,1,0,0,0,1,1,0,0,0}, // pelog
    {1,1,0,0,1,1,0,1,1,0,0,1}, // hijaz
    {1,1,0,0,1,1,0,1,1,0,0,1}, // doubleHarmonic
    {1,0,1,1,0,0,1,1,1,0,0,1}, // hungarianMinor
    {1,1,0,0,1,0,1,0,1,0,1,1}, // enigmatic
    {1,0,1,0,1,0,1,0,0,1,1,0}, // prometheus
    {1,1,0,0,1,1,1,0,1,0,0,1}, // persian
    {1,0,1,1,0,1,1,1,1,0,0,1}, // algerian
    {1,0,1,1,0,0,1,1,1,0,1,0}, // gypsy
    {1,1,0,1,0,1,0,1,1,0,0,1}, // neapolitanMinor
    {1,1,0,1,0,1,0,1,0,1,0,1}, // neapolitanMajor
};

static const char* SCALE_NAMES[NUM_SCALES] = {
    "Major", "Natural Minor", "Harmonic Minor", "Melodic Minor",
    "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian",
    "Major Pentatonic", "Minor Pentatonic", "Blues",
    "Whole Tone", "Chromatic", "Diminished", "Augmented",
    "Hirajoshi", "In Sen", "Iwato", "Kumoi", "Pelog",
    "Hijaz", "Double Harmonic", "Hungarian Minor", "Enigmatic",
    "Prometheus", "Persian", "Algerian", "Gypsy",
    "Neapolitan Minor", "Neapolitan Major",
};

/**
 * Rebuild scale_notes[] mapping from scale_root and scale_id_idx.
 * C port of TypeScript buildScaleMapping().
 */
void engine_rebuild_scale(EngineState* s) {
    uint8_t root = s->scale_root;
    uint8_t idx = s->scale_id_idx;
    if (idx >= NUM_SCALES) idx = 0;

    const uint8_t* pattern = SCALE_PATTERNS[idx];
    uint16_t count = 0;
    uint16_t zero_index = 0;
    uint8_t zero_midi = 60 + root;  // Root at octave 4

    for (uint8_t midi = 0; midi <= 127; midi++) {
        int32_t pc = ((int32_t)midi - (int32_t)root) % 12;
        if (pc < 0) pc += 12;
        if (pattern[pc]) {
            if (midi == zero_midi) {
                zero_index = count;
            }
            s->scale_notes[count++] = midi;
        }
    }

    s->scale_count = count;
    s->scale_zero_index = zero_index;
}

/**
 * Cycle scale type. direction: +1 = next, -1 = previous.
 */
void engine_cycle_scale(EngineState* s, int8_t direction) {
    int32_t idx = (int32_t)s->scale_id_idx + direction;
    idx = ((idx % NUM_SCALES) + NUM_SCALES) % NUM_SCALES;
    s->scale_id_idx = (uint8_t)idx;
    engine_rebuild_scale(s);
}

/**
 * Cycle scale root by circle of fifths (±7 semitones).
 * direction: +1 = up (sharp direction), -1 = down (flat direction).
 * Notes are shifted to keep their original pitches by finding the new root's
 * scale degree in the old scale and offsetting all note rows.
 */
void engine_cycle_scale_root(EngineState* s, int8_t direction) {
    // Find the new root MIDI in the old scale to get the row offset
    int32_t new_root_midi = (int32_t)s->scale_root + direction * 7;
    new_root_midi = ((new_root_midi % 12) + 12) % 12;

    // Look up new root pitch class in old scale at octave 4 (near zero_index)
    uint8_t target_midi = (uint8_t)(60 + new_root_midi);
    int16_t offset = 0;
    for (uint16_t i = 0; i < s->scale_count; i++) {
        if (s->scale_notes[i] == target_midi) {
            offset = (int16_t)i - (int16_t)s->scale_zero_index;
            break;
        }
    }

    // Shift all melodic notes by -offset to keep original pitches
    for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
        if (s->channel_types[ch] == CH_DRUM) continue;
        for (uint8_t pat = 0; pat < NUM_PATTERNS; pat++) {
            PatternData_C* p = &s->patterns[ch][pat];
            for (uint16_t e = 0; e < p->event_count; e++) {
                p->events[e].row -= offset;
            }
        }
    }

    // Change root and rebuild scale
    s->scale_root = (uint8_t)new_root_midi;
    engine_rebuild_scale(s);
}

const char* engine_get_scale_name_str(const EngineState* s) {
    uint8_t idx = s->scale_id_idx;
    if (idx >= NUM_SCALES) return "Major";
    return SCALE_NAMES[idx];
}

// ============ Sub-Mode Resolution ============

static int16_t resolve_sub_mode(
    EngineState* s,
    const NoteEvent_C* ev,
    SubModeId sm,
    uint16_t repeat_index,
    uint8_t channel
) {
    const SubModeArray* arr = &ev->sub_modes[sm];
    uint8_t mode = arr->loop_mode;

    if (mode == LOOP_CONTINUE) {
        uint16_t count = s->continue_counters[sm][channel][ev->event_index];
        s->continue_counters[sm][channel][ev->event_index] = count + 1;
        return arr->values[count % arr->length];
    } else if (mode == LOOP_FILL) {
        uint16_t idx = repeat_index < arr->length ? repeat_index : arr->length - 1;
        return arr->values[idx];
    } else { // LOOP_RESET
        return arr->values[repeat_index % arr->length];
    }
}

// Resolve without incrementing counters (for preview)
static int16_t resolve_sub_mode_preview(
    const EngineState* s,
    const NoteEvent_C* ev,
    SubModeId sm,
    uint16_t repeat_index,
    uint8_t channel
) {
    const SubModeArray* arr = &ev->sub_modes[sm];
    uint8_t mode = arr->loop_mode;

    if (mode == LOOP_CONTINUE) {
        uint16_t snapshot = s->counter_snapshots[sm][channel][ev->event_index];
        return arr->values[(snapshot + repeat_index) % arr->length];
    } else if (mode == LOOP_FILL) {
        uint16_t idx = repeat_index < arr->length ? repeat_index : arr->length - 1;
        return arr->values[idx];
    } else {
        return arr->values[repeat_index % arr->length];
    }
}

// ============ Chord Offsets ============

static void get_chord_offsets(
    const EngineState* s,
    uint8_t stack_size,
    int8_t shape_index,
    int8_t inversion,
    int8_t* out_offsets,
    uint8_t* out_count
) {
    uint8_t clamped = stack_size < 1 ? 1 : (stack_size > MAX_CHORD_SIZE ? MAX_CHORD_SIZE : stack_size);
    uint8_t shape_count = s->chord_shape_counts[clamped];

    if (shape_count == 0 || clamped == 1) {
        out_offsets[0] = 0;
        *out_count = 1;
        return;
    }

    int32_t idx = ((int32_t)(shape_index % (int8_t)shape_count) + shape_count) % shape_count;

    // Copy base shape
    int8_t shape[MAX_CHORD_SIZE];
    for (uint8_t i = 0; i < clamped; i++) {
        shape[i] = s->chord_shapes[clamped][idx][i];
    }

    // Apply inversion
    if (inversion > 0) {
        for (int8_t inv = 0; inv < inversion && inv < (int8_t)clamped; inv++) {
            // Shift bottom note up by DIATONIC_OCTAVE
            int8_t bottom = shape[0];
            for (uint8_t i = 0; i < clamped - 1; i++) {
                shape[i] = shape[i + 1];
            }
            shape[clamped - 1] = bottom + DIATONIC_OCTAVE;
        }
    } else if (inversion < 0) {
        for (int8_t inv = 0; inv < -inversion && inv < (int8_t)clamped; inv++) {
            // Shift top note down by DIATONIC_OCTAVE
            int8_t top = shape[clamped - 1];
            for (uint8_t i = clamped - 1; i > 0; i--) {
                shape[i] = shape[i - 1];
            }
            shape[0] = top - DIATONIC_OCTAVE;
        }
    }

    // Normalize so minimum is 0
    int8_t min_val = shape[0];
    for (uint8_t i = 1; i < clamped; i++) {
        if (shape[i] < min_val) min_val = shape[i];
    }
    for (uint8_t i = 0; i < clamped; i++) {
        out_offsets[i] = shape[i] - min_val;
    }
    *out_count = clamped;
}

// ============ Active Notes ============

static void kill_active_notes_for_channel(EngineState* s, uint8_t ch) {
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        ActiveNote* n = &s->active_notes[i];
        if (n->active && n->channel == ch) {
            platform_note_off(ch, (uint8_t)n->midi_note);
            n->active = 0;
        }
    }
}

static void prune_active_notes(EngineState* s, uint8_t ch, int32_t channel_tick) {
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        ActiveNote* n = &s->active_notes[i];
        if (n->active && n->channel == ch && channel_tick > n->end) {
            platform_note_off(ch, (uint8_t)n->midi_note);
            n->active = 0;
        }
    }
}

static void handle_active_note(
    EngineState* s,
    uint8_t ch,
    uint16_t event_index,
    uint8_t repeat_index,
    uint8_t chord_index,
    int32_t channel_tick,
    int32_t note_length,
    int8_t midi_note
) {
    // Find existing note with same key and send note-off
    int free_slot = -1;
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        ActiveNote* n = &s->active_notes[i];
        if (n->active &&
            n->channel == ch &&
            n->event_index == event_index &&
            n->repeat_index == repeat_index &&
            n->chord_index == chord_index) {
            platform_note_off(ch, (uint8_t)n->midi_note);
            // Reuse this slot
            n->start = channel_tick;
            n->end = channel_tick + note_length - 1;
            n->midi_note = midi_note;
            return;
        }
        if (!n->active && free_slot < 0) {
            free_slot = i;
        }
    }

    // Allocate new slot
    if (free_slot >= 0) {
        ActiveNote* n = &s->active_notes[free_slot];
        n->active = 1;
        n->channel = ch;
        n->event_index = event_index;
        n->repeat_index = repeat_index;
        n->chord_index = chord_index;
        n->start = channel_tick;
        n->end = channel_tick + note_length - 1;
        n->midi_note = midi_note;
    }
    // If no free slot, silently drop (shouldn't happen with 256 slots)
}

// ============ Preview Computation ============

static void snapshot_counters_for_channel(EngineState* s, uint8_t ch) {
    uint8_t pat_idx = s->current_patterns[ch];
    const PatternData_C* pd = &s->patterns[ch][pat_idx];

    for (uint16_t ei = 0; ei < pd->event_count; ei++) {
        const NoteEvent_C* ev = &pd->events[ei];
        if (!ev->enabled) continue;
        for (uint8_t sm = 0; sm < NUM_SUB_MODES; sm++) {
            s->counter_snapshots[sm][ch][ev->event_index] =
                s->continue_counters[sm][ch][ev->event_index];
        }
    }
}

static void compute_preview_for_channel(EngineState* s, uint8_t ch) {
    uint8_t pat_idx = s->current_patterns[ch];
    const PatternData_C* pd = &s->patterns[ch][pat_idx];
    const PatternLoop_C* loop = &s->loops[ch][pat_idx];
    int32_t loop_end = loop->start + loop->length;

    for (uint16_t ei = 0; ei < pd->event_count; ei++) {
        const NoteEvent_C* ev = &pd->events[ei];
        if (!ev->enabled) continue;

        for (uint8_t sm = 0; sm < NUM_SUB_MODES; sm++) {
            for (uint16_t r = 0; r < ev->repeat_amount; r++) {
                int32_t ev_tick = ev->position + (int32_t)r * ev->repeat_space;
                if (ev_tick < loop->start || ev_tick >= loop_end) continue;

                int16_t val = resolve_sub_mode_preview(s, ev, (SubModeId)sm, r, ch);
                platform_preview_value(sm, ch, ev->event_index, ev_tick, val);
            }
        }
    }
}

static void snapshot_and_preview_channel(EngineState* s, uint8_t ch) {
    snapshot_counters_for_channel(s, ch);
    compute_preview_for_channel(s, ch);
}

// ============ Chord Shape Generation ============

// Generate all ascending combos [0, ...] of length `size` with max gap 2
static uint8_t g_shape_results[MAX_CHORD_SHAPES][MAX_CHORD_SIZE];
static uint8_t g_shape_count;

static void gen_shapes_recurse(
    int8_t* current, uint8_t depth, uint8_t size,
    int8_t last_val, int8_t max_span
) {
    if (depth == size) {
        if (g_shape_count < MAX_CHORD_SHAPES) {
            for (uint8_t i = 0; i < size; i++) {
                g_shape_results[g_shape_count][i] = current[i];
            }
            g_shape_count++;
        }
        return;
    }
    for (int8_t next = last_val + 1; next <= max_span; next++) {
        current[depth] = next;
        gen_shapes_recurse(current, depth + 1, size, next, max_span);
    }
}

void engine_generate_chord_shapes(EngineState* s) {
    // Size 0 and 1: single note
    s->chord_shape_counts[0] = 1;
    s->chord_shapes[0][0][0] = 0;
    s->chord_shape_counts[1] = 1;
    s->chord_shapes[1][0][0] = 0;

    for (uint8_t size = 2; size <= MAX_CHORD_SIZE; size++) {
        int8_t max_gap = 2;
        int8_t max_span = max_gap * (size - 1);
        int8_t current[MAX_CHORD_SIZE];
        current[0] = 0;

        g_shape_count = 0;
        gen_shapes_recurse(current, 1, size, 0, max_span);

        // Sort by span (compact first), then lexicographic
        // Simple bubble sort — only runs at init, small N
        for (int i = 0; i < (int)g_shape_count - 1; i++) {
            for (int j = 0; j < (int)g_shape_count - 1 - i; j++) {
                uint8_t* a = g_shape_results[j];
                uint8_t* b = g_shape_results[j + 1];
                int span_a = a[size - 1];
                int span_b = b[size - 1];
                int swap = 0;
                if (span_a > span_b) {
                    swap = 1;
                } else if (span_a == span_b) {
                    for (uint8_t k = 0; k < size; k++) {
                        if (a[k] != b[k]) {
                            swap = (a[k] > b[k]);
                            break;
                        }
                    }
                }
                if (swap) {
                    uint8_t tmp[MAX_CHORD_SIZE];
                    memcpy(tmp, a, size);
                    memcpy(a, b, size);
                    memcpy(b, tmp, size);
                }
            }
        }

        s->chord_shape_counts[size] = g_shape_count < MAX_CHORD_SHAPES
            ? g_shape_count : MAX_CHORD_SHAPES;
        for (uint8_t i = 0; i < s->chord_shape_counts[size]; i++) {
            for (uint8_t j = 0; j < size; j++) {
                s->chord_shapes[size][i][j] = (int8_t)g_shape_results[i][j];
            }
        }
    }
}

// ============ Core Functions ============

/**
 * Full initialization — called once when the engine first loads.
 * Resets everything: UI state, playback state, chord shapes, etc.
 */
void engine_core_init(EngineState* s) {
    s->current_tick = -1;
    s->is_playing = 0;

    // Clear active notes
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        s->active_notes[i].active = 0;
    }

    // Clear continue counters and snapshots
    memset(s->continue_counters, 0, sizeof(s->continue_counters));
    memset(s->counter_snapshots, 0, sizeof(s->counter_snapshots));

    // Initialize UI state
    s->ui_mode = UI_PATTERN;
    s->modify_sub_mode = SM_VELOCITY;
    s->current_channel = 0;
    s->zoom = ZOOM_1_16;
    s->selected_event_idx = -1;
    s->col_offset = 0.0f;
    for (int i = 0; i < NUM_CHANNELS; i++) {
        s->row_offsets[i] = 0.0f;
    }

    // Initialize BPM
    if (s->bpm < 20.0f) s->bpm = 120.0f;

    // Initialize event ID counter
    if (s->next_event_id == 0) s->next_event_id = 1;

    // Clear grid output buffers
    memset(s->button_values, 0, sizeof(s->button_values));
    memset(s->color_overrides, 0, sizeof(s->color_overrides));

    // Clear display state
    memset(s->patterns_have_notes, 0, sizeof(s->patterns_have_notes));
    memset(s->channels_playing_now, 0, sizeof(s->channels_playing_now));

    // Initialize all pattern lengths and loops to defaults
    for (int ch = 0; ch < NUM_CHANNELS; ch++) {
        for (int pat = 0; pat < NUM_PATTERNS; pat++) {
            s->patterns[ch][pat].length_ticks = DEFAULT_PATTERN_TICKS;
            s->loops[ch][pat].start = 0;
            s->loops[ch][pat].length = DEFAULT_LOOP_TICKS;
        }
        s->queued_patterns[ch] = -1;
    }

    // Generate chord shapes
    engine_generate_chord_shapes(s);

    // Default RNG seed
    if (s->rng_state == 0) s->rng_state = 12345;

    // Build initial scale mapping (default: C Major)
    s->scale_root = 0;
    s->scale_id_idx = 0;
    engine_rebuild_scale(s);
}

/**
 * Playback init — called when play starts.
 * Only resets playback state (active notes, counters, tick).
 * Does NOT touch UI state, patterns, or chord shapes.
 */
void engine_core_play_init(EngineState* s) {
    s->current_tick = -1;

    // Clear active notes
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        s->active_notes[i].active = 0;
    }

    // Clear continue counters and snapshots
    memset(s->continue_counters, 0, sizeof(s->continue_counters));
    memset(s->counter_snapshots, 0, sizeof(s->counter_snapshots));
}

void engine_core_stop(EngineState* s) {
    // Send note-off for all active notes
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        ActiveNote* n = &s->active_notes[i];
        if (n->active) {
            platform_note_off(n->channel, (uint8_t)n->midi_note);
            n->active = 0;
        }
    }

    // Clear counters
    memset(s->continue_counters, 0, sizeof(s->continue_counters));
    memset(s->counter_snapshots, 0, sizeof(s->counter_snapshots));

    s->current_tick = -1;

    // Clear queued patterns
    for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
        s->queued_patterns[ch] = -1;
    }
}

void engine_core_tick(EngineState* s) {
    int32_t next_tick = s->current_tick + 1;

    uint8_t switch_channels[NUM_CHANNELS];
    int8_t  switch_targets[NUM_CHANNELS];
    uint8_t switch_count = 0;

    // Compute any_soloed once
    uint8_t any_soloed = 0;
    for (uint8_t i = 0; i < NUM_CHANNELS; i++) {
        if (s->soloed[i]) { any_soloed = 1; break; }
    }

    for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
        uint8_t pat_idx = s->current_patterns[ch];
        const PatternLoop_C* loop = &s->loops[ch][pat_idx];
        int32_t loop_end = loop->start + loop->length;
        int32_t channel_tick = loop->start +
            mod_positive(next_tick - loop->start, loop->length);

        // 1. Loop reset
        if (channel_tick == loop->start) {
            kill_active_notes_for_channel(s, ch);
            snapshot_and_preview_channel(s, ch);

            if (s->queued_patterns[ch] >= 0) {
                switch_channels[switch_count] = ch;
                switch_targets[switch_count] = s->queued_patterns[ch];
                switch_count++;
            }
        }

        // 2. Prune expired active notes
        prune_active_notes(s, ch, channel_tick);

        // 3. Mute/solo check
        uint8_t should_play = any_soloed
            ? (s->soloed[ch] && !s->muted[ch])
            : (!s->muted[ch]);

        // 4. Find and trigger events
        if (should_play && channel_tick >= loop->start && channel_tick < loop_end) {
            const PatternData_C* pd = &s->patterns[ch][pat_idx];

            for (uint16_t ei = 0; ei < pd->event_count; ei++) {
                const NoteEvent_C* ev = &pd->events[ei];
                if (!ev->enabled) continue;

                for (uint16_t r = 0; r < ev->repeat_amount; r++) {
                    int32_t ev_tick = ev->position + (int32_t)r * ev->repeat_space;
                    if (ev_tick >= pd->length_ticks) break;
                    if (ev_tick != channel_tick) continue;

                    // Resolve sub-mode values
                    int16_t velocity  = resolve_sub_mode(s, ev, SM_VELOCITY, r, ch);
                    int16_t chance    = resolve_sub_mode(s, ev, SM_HIT, r, ch);
                    int16_t timing    = resolve_sub_mode(s, ev, SM_TIMING, r, ch);
                    int16_t flam_prob = resolve_sub_mode(s, ev, SM_FLAM, r, ch);
                    int16_t mod_val   = resolve_sub_mode(s, ev, SM_MODULATE, r, ch);

                    // Chance gate
                    if (chance < 100 && (engine_random(s) % 100) >= (uint32_t)chance) {
                        continue;
                    }

                    // Flam resolution
                    uint8_t flam_count = 0;
                    if (flam_prob > 0 && (engine_random(s) % 100) < (uint32_t)flam_prob) {
                        flam_count = 1;
                    }

                    int16_t effective_row = ev->row + mod_val;

                    // Chord expansion
                    int8_t offsets[MAX_CHORD_SIZE];
                    uint8_t offset_count;
                    get_chord_offsets(s, ev->chord_stack_size, ev->chord_shape_index,
                                     ev->chord_inversion, offsets, &offset_count);

                    for (uint8_t ci = 0; ci < offset_count; ci++) {
                        int16_t chord_row = effective_row + offsets[ci];
                        int8_t midi_note;

                        if (s->channel_types[ch] == CH_DRUM) {
                            midi_note = (int8_t)clamp_i32(chord_row, 0, 127);
                        } else {
                            midi_note = note_to_midi(chord_row, s);
                            if (midi_note < 0) continue;
                        }

                        handle_active_note(s, ch, ev->event_index,
                                          (uint8_t)r, ci,
                                          channel_tick, ev->length, midi_note);

                        platform_step_trigger(
                            ch, (uint8_t)midi_note, channel_tick,
                            ev->length, (uint8_t)clamp_i32(velocity, 0, 127),
                            (int8_t)timing, flam_count, ev->event_index
                        );
                    }
                }
            }
        }
    }

    // Apply pattern switches
    if (switch_count > 0) {
        for (uint8_t i = 0; i < switch_count; i++) {
            uint8_t ch = switch_channels[i];
            s->current_patterns[ch] = (uint8_t)switch_targets[i];
            s->queued_patterns[ch] = -1;
            platform_clear_queued_pattern(ch);
        }
        platform_set_current_patterns(s->current_patterns);

        // Recompute previews for switched channels
        for (uint8_t i = 0; i < switch_count; i++) {
            compute_preview_for_channel(s, switch_channels[i]);
        }
    }

    s->current_tick = next_tick;
    platform_set_current_tick(next_tick);
}

int32_t engine_core_get_version(void) {
    return 3000; // v3.0 — WASM owns all state
}

// ============ Utility Functions ============

uint16_t engine_alloc_event_id(EngineState* s) {
    return s->next_event_id++;
}

void engine_update_has_notes(EngineState* s, uint8_t ch, uint8_t pat) {
    if (ch >= NUM_CHANNELS || pat >= NUM_PATTERNS) return;
    s->patterns_have_notes[ch][pat] = (s->patterns[ch][pat].event_count > 0) ? 1 : 0;
}
