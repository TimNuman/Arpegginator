#ifndef ENGINE_CORE_H
#define ENGINE_CORE_H

#include <stdint.h>

// ============ Constants ============

#define NUM_CHANNELS        8
#define NUM_PATTERNS        8
#define MAX_EVENTS          128
#define MAX_SUB_MODE_LEN    32
#define NUM_SUB_MODES       5
#define MAX_CHORD_SIZE      5
#define MAX_CHORD_SHAPES    20
#define MAX_SCALE_NOTES     128
#define MAX_ACTIVE_NOTES    256
#define DIATONIC_OCTAVE     7

// ============ Enums ============

typedef enum { LOOP_RESET = 0, LOOP_CONTINUE = 1, LOOP_FILL = 2 } LoopMode;
typedef enum { CH_MELODIC = 0, CH_DRUM = 1 } ChannelType;
typedef enum { SM_VELOCITY = 0, SM_HIT = 1, SM_TIMING = 2, SM_FLAM = 3, SM_MODULATE = 4 } SubModeId;

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
    uint8_t       chord_stack_size;  // 1-5
    int8_t        chord_shape_index;
    int8_t        chord_inversion;
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

typedef struct {
    // Pattern data
    PatternData_C patterns[NUM_CHANNELS][NUM_PATTERNS];
    PatternLoop_C loops[NUM_CHANNELS][NUM_PATTERNS];

    // Current state
    uint8_t     current_patterns[NUM_CHANNELS];
    int8_t      queued_patterns[NUM_CHANNELS];  // -1 = no queue
    uint8_t     muted[NUM_CHANNELS];
    uint8_t     soloed[NUM_CHANNELS];
    uint8_t     channel_types[NUM_CHANNELS];    // ChannelType

    // Scale mapping
    uint8_t     scale_notes[MAX_SCALE_NOTES];   // MIDI note values
    uint16_t    scale_count;
    uint16_t    scale_zero_index;

    // Chord shapes: [stack_size 0-5][shape_index][note_index]
    int8_t      chord_shapes[MAX_CHORD_SIZE + 1][MAX_CHORD_SHAPES][MAX_CHORD_SIZE];
    uint8_t     chord_shape_counts[MAX_CHORD_SIZE + 1];

    // Tick state
    int32_t     current_tick;

    // Active notes pool
    ActiveNote  active_notes[MAX_ACTIVE_NOTES];

    // Continue counters: [sub_mode][channel][event_index]
    uint16_t    continue_counters[NUM_SUB_MODES][NUM_CHANNELS][MAX_EVENTS];

    // Continue counter snapshots (for preview computation)
    uint16_t    counter_snapshots[NUM_SUB_MODES][NUM_CHANNELS][MAX_EVENTS];

    // RNG state (xorshift32)
    uint32_t    rng_state;
} EngineState;

// ============ Core Functions ============

void engine_core_init(EngineState* s);
void engine_core_tick(EngineState* s);
void engine_core_stop(EngineState* s);

// ============ Chord Shape Generation ============

void engine_generate_chord_shapes(EngineState* s);

// ============ Version ============

int32_t engine_core_get_version(void);

#endif // ENGINE_CORE_H
