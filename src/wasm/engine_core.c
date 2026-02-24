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

    // Compute scale_octave_size = number of 1s in the scale pattern
    uint8_t octave_size = 0;
    for (uint8_t i = 0; i < 12; i++) {
        if (pattern[i]) octave_size++;
    }
    s->scale_octave_size = octave_size;
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

static void get_chord_offsets_raw(
    const EngineState* s,
    uint8_t amount,
    uint8_t space,
    int8_t inversion,
    int16_t* out_offsets,
    uint8_t* out_count
) {
    if (amount <= 1) {
        out_offsets[0] = 0;
        *out_count = 1;
        return;
    }
    uint8_t clamped = amount > MAX_CHORD_SIZE ? MAX_CHORD_SIZE : amount;

    // Build base chord: [0, space, 2*space, ...]
    for (uint8_t i = 0; i < clamped; i++) {
        out_offsets[i] = (int16_t)(i * space);
    }

    // Apply inversions using scale-dependent octave
    int16_t octave = (int16_t)s->scale_octave_size;
    if (inversion > 0) {
        for (int8_t n = 0; n < inversion; n++) {
            out_offsets[n % clamped] += octave;
        }
    } else if (inversion < 0) {
        for (int8_t n = 0; n < -inversion; n++) {
            out_offsets[clamped - 1 - (n % clamped)] -= octave;
        }
    }

    *out_count = clamped;
}

// ============ Arpeggio ============

uint8_t get_arp_chord_index(uint8_t style, uint8_t chord_count, uint16_t repeat_idx, int8_t offset) {
    if (style == ARP_CHORD || chord_count <= 1) return 255; // sentinel: play all

    // Apply offset to repeat index
    int32_t effective = (int32_t)repeat_idx + (int32_t)offset;

    if (style == ARP_UP) {
        effective = ((effective % chord_count) + chord_count) % chord_count;
        return (uint8_t)effective;
    }
    if (style == ARP_DOWN) {
        effective = ((effective % chord_count) + chord_count) % chord_count;
        return (uint8_t)((chord_count - 1) - effective);
    }

    // UP_DOWN / DOWN_UP: bounce, endpoints played once
    // For N notes, cycle length = 2*(N-1). E.g. 3 notes -> cycle 4: [0,1,2,1]
    uint16_t cycle_len = 2 * (chord_count - 1);
    effective = ((effective % cycle_len) + cycle_len) % cycle_len;

    uint8_t idx;
    if (effective < chord_count) {
        idx = (uint8_t)effective;
    } else {
        idx = (uint8_t)(cycle_len - effective);
    }

    if (style == ARP_DOWN_UP) {
        // Reverse: start from top
        idx = (chord_count - 1) - idx;
    }

    return idx;
}

uint8_t is_arp_chord_active(uint8_t style, uint8_t chord_count, uint16_t repeat_idx, int8_t offset, uint8_t voices, uint8_t chord_idx) {
    if (style == ARP_CHORD || chord_count <= 1) return 1; // play all

    uint8_t base = get_arp_chord_index(style, chord_count, repeat_idx, offset);
    if (base == 255) return 1; // sentinel: play all

    uint8_t v = voices < 1 ? 1 : voices;
    if (v >= chord_count) return 1; // all notes active

    // Check if chord_idx is within the window [base, base+1, ..., base+v-1] mod chord_count
    for (uint8_t i = 0; i < v; i++) {
        if ((base + i) % chord_count == chord_idx) return 1;
    }
    return 0;
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

// ============ Core Functions ============

/**
 * Full initialization — called once when the engine first loads.
 * Resets everything: UI state, playback state, chord shapes, etc.
 */
void engine_core_init(EngineState* s) {
    s->current_tick = -1;
    s->last_scrub_tick = -1;
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
        s->target_row_offsets[i] = 0.0f;
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
    s->last_scrub_tick = -1;

    // Clear active notes
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        s->active_notes[i].active = 0;
    }

    // Clear continue counters and snapshots
    memset(s->continue_counters, 0, sizeof(s->continue_counters));
    memset(s->counter_snapshots, 0, sizeof(s->counter_snapshots));
}

/**
 * Play init from a specific tick (resume after scrub).
 * Sets current_tick to tick-1 so the first tick() call advances to the target.
 */
void engine_core_play_init_from_tick(EngineState* s, int32_t tick) {
    s->current_tick = tick - 1;
    s->last_scrub_tick = -1;

    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        s->active_notes[i].active = 0;
    }

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

    // NOTE: current_tick is intentionally NOT reset here.
    // The playhead stays visible at the last position.
    // Use engine_core_play_init() to reset to beginning.

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
                    int16_t offsets16[MAX_CHORD_SIZE];
                    get_chord_offsets_raw(s, ev->chord_amount, ev->chord_space,
                                         ev->chord_inversion, offsets16, &offset_count);
                    for (uint8_t _ci = 0; _ci < offset_count; _ci++) offsets[_ci] = (int8_t)offsets16[_ci];

                    for (uint8_t ci = 0; ci < offset_count; ci++) {
                        // Skip notes not selected by arpeggio
                        if (!is_arp_chord_active(ev->arp_style, offset_count, r, ev->arp_offset, ev->arp_voices, ci)) continue;

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

// ============ Scrub (playhead drag preview) ============

#define SCRUB_NOTE_LENGTH 1  // Very short so notes release quickly

void engine_core_scrub_to_tick(EngineState* s, int32_t target_tick) {
    // Kill all active notes from previous scrub position
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        ActiveNote* n = &s->active_notes[i];
        if (n->active) {
            platform_note_off(n->channel, (uint8_t)n->midi_note);
            n->active = 0;
        }
    }

    // Compute any_soloed once
    uint8_t any_soloed = 0;
    for (uint8_t i = 0; i < NUM_CHANNELS; i++) {
        if (s->soloed[i]) { any_soloed = 1; break; }
    }

    for (uint8_t ch = 0; ch < NUM_CHANNELS; ch++) {
        uint8_t pat_idx = s->current_patterns[ch];
        const PatternData_C* pd = &s->patterns[ch][pat_idx];
        const PatternLoop_C* loop = &s->loops[ch][pat_idx];
        int32_t loop_len = loop->length;
        int32_t loop_end = loop->start + loop_len;

        // Mute/solo check
        uint8_t should_play = any_soloed
            ? (s->soloed[ch] && !s->muted[ch])
            : (!s->muted[ch]);
        if (!should_play) continue;

        // Compute looped positions
        int32_t curr_looped = loop->start +
            mod_positive(target_tick - loop->start, loop_len);

        int32_t scan_start, scan_end;

        if (s->last_scrub_tick < 0) {
            scan_start = curr_looped;
            scan_end = curr_looped;
        } else {
            int32_t prev_looped = loop->start +
                mod_positive(s->last_scrub_tick - loop->start, loop_len);

            if (target_tick >= s->last_scrub_tick) {
                scan_start = prev_looped + 1;
                scan_end = curr_looped;
            } else {
                scan_start = curr_looped;
                scan_end = prev_looped - 1;
            }
        }

        // Normalize range
        if (scan_start > scan_end) {
            int32_t tmp = scan_start;
            scan_start = scan_end;
            scan_end = tmp;
        }
        if (scan_start < loop->start) scan_start = loop->start;
        if (scan_end >= loop_end) scan_end = loop_end - 1;

        // Scan events in range
        for (uint16_t ei = 0; ei < pd->event_count; ei++) {
            const NoteEvent_C* ev = &pd->events[ei];
            if (!ev->enabled) continue;

            for (uint16_t r = 0; r < ev->repeat_amount; r++) {
                int32_t ev_tick = ev->position + (int32_t)r * ev->repeat_space;
                if (ev_tick >= pd->length_ticks) break;
                if (ev_tick < scan_start || ev_tick > scan_end) continue;

                // Resolve sub-modes (preview = no counter increment)
                int16_t velocity = resolve_sub_mode_preview(s, ev, SM_VELOCITY, r, ch);
                int16_t mod_val  = resolve_sub_mode_preview(s, ev, SM_MODULATE, r, ch);
                int16_t effective_row = ev->row + mod_val;

                // Chord expansion
                int8_t offsets[MAX_CHORD_SIZE];
                uint8_t offset_count;
                    int16_t offsets16[MAX_CHORD_SIZE];
                    get_chord_offsets_raw(s, ev->chord_amount, ev->chord_space,
                                         ev->chord_inversion, offsets16, &offset_count);
                    for (uint8_t _ci = 0; _ci < offset_count; _ci++) offsets[_ci] = (int8_t)offsets16[_ci];

                for (uint8_t ci = 0; ci < offset_count; ci++) {
                    int16_t chord_row = effective_row + offsets[ci];
                    int8_t midi_note;

                    if (s->channel_types[ch] == CH_DRUM) {
                        midi_note = (int8_t)clamp_i32(chord_row, 0, 127);
                    } else {
                        midi_note = note_to_midi(chord_row, s);
                        if (midi_note < 0) continue;
                    }

                    // Short note length so it releases quickly
                    handle_active_note(s, ch, ev->event_index,
                                      (uint8_t)r, ci,
                                      curr_looped, SCRUB_NOTE_LENGTH, midi_note);

                    platform_step_trigger(
                        ch, (uint8_t)midi_note, ev_tick,
                        SCRUB_NOTE_LENGTH, (uint8_t)clamp_i32(velocity, 0, 127),
                        0, 0, ev->event_index
                    );
                }
            }
        }
    }

    // Register active notes for UI highlighting: any event whose range
    // covers curr_looped on the current channel (no audio trigger).
    {
        uint8_t view_ch = s->current_channel;
        uint8_t view_pat = s->current_patterns[view_ch];
        const PatternData_C* vpd = &s->patterns[view_ch][view_pat];
        const PatternLoop_C* vloop = &s->loops[view_ch][view_pat];
        int32_t vloop_len = vloop->length;
        int32_t view_looped = vloop->start +
            mod_positive(target_tick - vloop->start, vloop_len);

        for (uint16_t ei = 0; ei < vpd->event_count; ei++) {
            const NoteEvent_C* ev = &vpd->events[ei];
            if (!ev->enabled) continue;

            for (uint16_t r = 0; r < ev->repeat_amount; r++) {
                int32_t ev_tick = ev->position + (int32_t)r * ev->repeat_space;
                if (ev_tick >= vpd->length_ticks) break;
                int32_t ev_end = ev_tick + ev->length;
                if (view_looped >= ev_tick && view_looped < ev_end) {
                    // This event covers the scrub position — mark active for UI
                    int16_t mod_val = resolve_sub_mode_preview(s, ev, SM_MODULATE, r, view_ch);
                    int16_t effective_row = ev->row + mod_val;

                    int8_t offsets[MAX_CHORD_SIZE];
                    uint8_t offset_count;
                    int16_t offsets16[MAX_CHORD_SIZE];
                    get_chord_offsets_raw(s, ev->chord_amount, ev->chord_space,
                                         ev->chord_inversion, offsets16, &offset_count);
                    for (uint8_t _ci = 0; _ci < offset_count; _ci++) offsets[_ci] = (int8_t)offsets16[_ci];

                    for (uint8_t ci = 0; ci < offset_count; ci++) {
                        int16_t chord_row = effective_row + offsets[ci];
                        int8_t midi_note;
                        if (s->channel_types[view_ch] == CH_DRUM) {
                            midi_note = (int8_t)clamp_i32(chord_row, 0, 127);
                        } else {
                            midi_note = note_to_midi(chord_row, s);
                            if (midi_note < 0) continue;
                        }
                        // Register with a range that covers the current tick
                        handle_active_note(s, view_ch, ev->event_index,
                                          (uint8_t)r, ci,
                                          view_looped, 1, midi_note);
                    }
                }
            }
        }
    }

    // Update playhead position so grid shows it
    s->current_tick = target_tick;
    platform_set_current_tick(target_tick);

    s->last_scrub_tick = target_tick;
}

void engine_core_scrub_end(EngineState* s) {
    s->last_scrub_tick = -1;
    // Send note-off for all active scrub notes
    for (int i = 0; i < MAX_ACTIVE_NOTES; i++) {
        ActiveNote* n = &s->active_notes[i];
        if (n->active) {
            platform_note_off(n->channel, (uint8_t)n->midi_note);
            n->active = 0;
        }
    }
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
