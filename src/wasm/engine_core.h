#ifndef ENGINE_CORE_H
#define ENGINE_CORE_H

#include <stdint.h>

// ============ Constants ============

#define NUM_CHANNELS        8
#define NUM_PATTERNS        8
#define MAX_EVENTS          128
#define MAX_SUB_MODE_LEN    32
#define NUM_SUB_MODES       6
#define MAX_CHORD_SIZE      8
#define MAX_SCALE_NOTES     128
#define NUM_SCALES          32
#define MAX_ACTIVE_NOTES    256
#define DIATONIC_OCTAVE     7

// Grid display dimensions
#define VISIBLE_ROWS        8
#define VISIBLE_COLS        16

// Ticks per quarter note (matches JS TICKS_PER_QUARTER)
#define TICKS_PER_QUARTER   480

// ============ Button Value Constants ============
// Lower 4 bits: base color level (0-8)
// Upper bits: flags (combinable via |)

#define BTN_OFF             0
#define BTN_COLOR_25        1
#define BTN_COLOR_50        2
#define BTN_COLOR_75        3
#define BTN_COLOR_100       4
#define BTN_WHITE_25        5
#define BTN_WHITE_50        6
#define BTN_WHITE_75        7
#define BTN_WHITE_100       8

// Flag bits (combinable with base value)
#define FLAG_PLAYHEAD             16
#define FLAG_C_NOTE               32
#define FLAG_LOOP_BOUNDARY        64
#define FLAG_BEAT_MARKER          128
#define FLAG_SELECTED             256
#define FLAG_CONTINUATION         512
#define FLAG_PLAYING              1024
#define FLAG_LOOP_BOUNDARY_PULSING 2048
#define FLAG_DIMMED               4096
#define FLAG_IN_SCALE             8192

// ============ Enums ============

typedef enum { LOOP_RESET = 0, LOOP_CONTINUE = 1, LOOP_FILL = 2 } LoopMode;
typedef enum { CH_MELODIC = 0, CH_DRUM = 1 } ChannelType;
typedef enum { SM_VELOCITY = 0, SM_HIT = 1, SM_TIMING = 2, SM_FLAM = 3, SM_MODULATE = 4, SM_INVERSION = 5 } SubModeId;

// Arpeggio styles (chord notes on repeats)
#define ARP_CHORD     0   // All chord notes play together (default)
#define ARP_UP        1   // Cycle low→high
#define ARP_DOWN      2   // Cycle high→low
#define ARP_UP_DOWN   3   // Bounce: endpoints once (C E G E C E G E...)
#define ARP_DOWN_UP   4   // Bounce reverse (G E C E G E C E...)
#define ARP_CHORD_UP       5   // Rep 0: all, then cycle up
#define ARP_CHORD_DOWN     6   // Rep 0: all, then cycle down
#define ARP_CHORD_UP_DOWN  7   // Rep 0: all, then bounce up/down
#define ARP_CHORD_DOWN_UP  8   // Rep 0: all, then bounce down/up
#define ARP_STYLE_COUNT 9

// UI modes
typedef enum { UI_PATTERN = 0, UI_CHANNEL = 1, UI_LOOP = 2, UI_MODIFY = 3 } UiMode;

// Zoom levels (subdivisions as tick counts)
typedef enum {
    ZOOM_1_4  = 480,   // quarter note
    ZOOM_1_8  = 240,   // eighth note
    ZOOM_1_16 = 120,   // sixteenth note (default)
    ZOOM_1_32 = 60,    // thirty-second note
    ZOOM_1_64 = 30     // sixty-fourth note
} ZoomLevel;

// ============ Data Structures ============

typedef struct {
    int16_t  values[MAX_SUB_MODE_LEN];
    uint8_t  length;     // 1-32
    uint8_t  loop_mode;  // LoopMode
} SubModeArray;

typedef struct {
    int16_t       row;
    int32_t       position;       // start tick
    int32_t       length;         // duration ticks
    uint8_t       enabled;
    uint16_t      repeat_amount;  // 1 = no repeats
    int32_t       repeat_space;   // ticks between repeats
    SubModeArray  sub_modes[NUM_SUB_MODES]; // velocity, hit, timing, flam, modulate
    uint8_t       chord_amount;      // 1 = single note, 2-5 = chord
    uint8_t       chord_space;       // row offset between chord notes (default 2)
    int8_t        chord_inversion;   // infinite inversions (scale-dependent octave)
    uint8_t       chord_voicing;     // voicing index into predefined shape table (0 = base)
    uint8_t       arp_style;         // ARP_CHORD, ARP_UP, ARP_DOWN, ARP_UP_DOWN, ARP_DOWN_UP
    int8_t        arp_offset;        // starting offset into arp cycle (shifts which chord note plays first)
    uint8_t       arp_voices;        // simultaneous chord notes per arp step (1 = single, max = chord_amount-1)
    uint16_t      event_index;    // integer ID (maps to UUID on JS side)
} NoteEvent_C;

typedef struct {
    NoteEvent_C events[MAX_EVENTS];
    uint16_t    event_count;
    int32_t     length_ticks;
} PatternData_C;

typedef struct {
    int32_t start;
    int32_t length;
} PatternLoop_C;

typedef struct {
    uint8_t  channel;
    uint16_t event_index;
    uint8_t  repeat_index;
    uint8_t  chord_index;
    int32_t  start;
    int32_t  end;
    int8_t   midi_note;
    uint8_t  active;  // 1 = in use, 0 = free slot
} ActiveNote;

// ============ Rendered Note ============
// Expanded note instance — repeats, chords, arp filtering all applied.
// Single source of truth for both grid display and playback.
#define MAX_RENDERED_NOTES  1024

typedef struct {
    int16_t  row;            // Final display row (ev->row + mod_offset + chord_offset)
    int32_t  position;       // Tick position (after repeat expansion + wrap)
    int32_t  length;         // Duration in ticks (capped to prevent overlap)
    uint16_t source_idx;     // Index into pattern events[]
    uint16_t repeat_index;   // Which repeat (0 = original)
    uint8_t  chord_index;    // Which chord note (0 = lowest after sort)
    int8_t   chord_offset;   // Scale-degree offset from root
} RenderedNote;

typedef struct {
    // ============ Pattern data ============
    PatternData_C patterns[NUM_CHANNELS][NUM_PATTERNS];
    PatternLoop_C loops[NUM_CHANNELS][NUM_PATTERNS];

    // ============ Channel state ============
    uint8_t     current_patterns[NUM_CHANNELS];
    int8_t      queued_patterns[NUM_CHANNELS];  // -1 = no queue
    uint8_t     muted[NUM_CHANNELS];
    uint8_t     soloed[NUM_CHANNELS];
    uint8_t     channel_types[NUM_CHANNELS];    // ChannelType

    // ============ Scale mapping ============
    uint8_t     scale_notes[MAX_SCALE_NOTES];   // MIDI note values
    uint16_t    scale_count;
    uint16_t    scale_zero_index;
    uint8_t     scale_root;                     // 0-11 (C=0)
    uint8_t     scale_id_idx;                   // index into scale table

    // ============ Scale-derived ============
    uint8_t     scale_octave_size;              // notes per octave in current scale (e.g. 7 for major, 5 for pentatonic)

    // ============ Playback state ============
    int32_t     current_tick;
    int32_t     last_scrub_tick;    // -1 = not scrubbing
    uint8_t     is_playing;
    float       bpm;

    // ============ Active notes pool ============
    ActiveNote  active_notes[MAX_ACTIVE_NOTES];

    // ============ Continue counters ============
    // [sub_mode][channel][event_index]
    uint16_t    continue_counters[NUM_SUB_MODES][NUM_CHANNELS][MAX_EVENTS];
    uint16_t    counter_snapshots[NUM_SUB_MODES][NUM_CHANNELS][MAX_EVENTS];

    // ============ RNG state (xorshift32) ============
    uint32_t    rng_state;

    // ============ UI State ============
    uint8_t     ui_mode;            // UiMode
    uint8_t     modify_sub_mode;    // SubModeId (active in modify mode)
    uint8_t     current_channel;
    int32_t     zoom;               // ZoomLevel (ticks per grid cell)
    int16_t     selected_event_idx; // -1 = none, else index into current pattern's events
    float       row_offsets[NUM_CHANNELS]; // per-channel vertical scroll (0.0-1.0)
    float       target_row_offsets[NUM_CHANNELS]; // easing target
    float       col_offset;         // horizontal scroll (0.0-1.0)

    // Modifier key state (set from JS each frame before compute_grid)
    uint8_t     ctrl_held;

    // Channel display colors (RGB packed as 0xRRGGBB, set once from JS)
    uint32_t    channel_colors[NUM_CHANNELS];

    // ============ Grid Output Buffers ============
    // Filled by engine_compute_grid(), read by JS each frame
    uint16_t    button_values[VISIBLE_ROWS][VISIBLE_COLS];
    uint32_t    color_overrides[VISIBLE_ROWS][VISIBLE_COLS]; // 0 = use channel color, else 0xRRGGBB

    // ============ Derived Display State ============
    // Updated on pattern changes — does pattern[ch][pat] have any events?
    uint8_t     patterns_have_notes[NUM_CHANNELS][NUM_PATTERNS];
    // Updated each tick — is channel actively producing notes right now?
    uint8_t     channels_playing_now[NUM_CHANNELS];

    // ============ Event ID Counter ============
    uint16_t    next_event_id;

    // ============ Rendered Notes Cache ============
    RenderedNote rendered_notes[NUM_CHANNELS][MAX_RENDERED_NOTES];
    uint16_t    rendered_count[NUM_CHANNELS];
    uint8_t     rendered_dirty[NUM_CHANNELS];
} EngineState;

// ============ Core Functions ============

void engine_core_init(EngineState* s);
void engine_core_play_init(EngineState* s);
void engine_core_play_init_from_tick(EngineState* s, int32_t tick);
void engine_core_tick(EngineState* s);
void engine_core_stop(EngineState* s);
void engine_core_scrub_to_tick(EngineState* s, int32_t target_tick);
void engine_core_scrub_end(EngineState* s);

// ============ Utility ============

/** Allocate a new event ID (monotonically increasing). */
uint16_t engine_alloc_event_id(EngineState* s);

/** Update patterns_have_notes for a specific channel/pattern. */
void engine_update_has_notes(EngineState* s, uint8_t ch, uint8_t pat);

// ============ Scale Functions ============

/** Rebuild scale_notes[] mapping from current scale_root and scale_id_idx. */
void engine_rebuild_scale(EngineState* s);

/** Cycle scale type: +1 = next, -1 = previous. */
void engine_cycle_scale(EngineState* s, int8_t direction);

/** Cycle scale root by circle of fifths: +1 = sharp, -1 = flat. */
void engine_cycle_scale_root(EngineState* s, int8_t direction);

/** Get display name for the current scale. */
const char* engine_get_scale_name_str(const EngineState* s);

/** Convert scale-relative row to MIDI note. Returns -1 if out of range. */
int8_t note_to_midi(int16_t row, const EngineState* s);

/**
 * Get which chord note index to play for a given repeat.
 * Returns 255 (sentinel) for ARP_CHORD meaning "play all notes".
 * For other styles returns 0..chord_count-1.
 * offset shifts the starting position in the cycle.
 */
uint8_t get_arp_chord_index(uint8_t style, uint8_t chord_count, uint16_t repeat_idx, int8_t offset);

/**
 * Check if a specific chord index should be active for a given repeat.
 * Takes arp_voices into account: for voices > 1, a sliding window of
 * consecutive chord indices is active starting from the base arp index.
 * Returns 1 if active, 0 if not.
 * For ARP_CHORD style (or chord_count <= 1), always returns 1.
 */
uint8_t is_arp_chord_active(uint8_t style, uint8_t chord_count, uint16_t repeat_idx, int8_t offset, uint8_t voices, uint8_t chord_idx);

// ============ Chord Voicings ============

#define MAX_VOICING_COUNT    8   // max voicings per (amount, distance) pair
#define MAX_CHORD_DISTANCE   7   // up to octave (diatonic)

typedef struct {
    int8_t offsets[MAX_CHORD_SIZE];
    const char* name;
} VoicingEntry;

typedef struct {
    VoicingEntry entries[MAX_VOICING_COUNT];
    uint8_t count;
} VoicingList;

/** Look up the voicing list for an (amount, distance) pair. Returns NULL if out of range. */
const VoicingList* get_voicing_list(uint8_t amount, uint8_t distance);

/** Get number of available voicings for an (amount, distance) pair. */
uint8_t get_voicing_count(uint8_t amount, uint8_t distance);

/** Get display name for a voicing. Returns "" for invalid indices. */
const char* get_voicing_name(uint8_t amount, uint8_t distance, uint8_t idx);

/** Get offsets for a voicing. Returns count written to out_offsets. */
uint8_t get_voicing_offsets(uint8_t amount, uint8_t distance, uint8_t idx, int8_t* out_offsets);

// ============ Version ============

int32_t engine_core_get_version(void);

#endif // ENGINE_CORE_H
