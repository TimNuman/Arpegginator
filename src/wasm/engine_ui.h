#ifndef ENGINE_UI_H
#define ENGINE_UI_H

#include "engine_core.h"

// ============ Grid Rendering ============

/**
 * Compute the grid display buffers (button_values + color_overrides).
 * Called once per animation frame from JS.
 * Reads current state from EngineState, writes to button_values/color_overrides.
 */
void engine_compute_grid(EngineState* s);

// ============ Rendered Note (internal) ============
// Expanded note instance for display — repeats, chords expanded.

#define MAX_RENDERED_NOTES  1024

typedef struct {
    int16_t  row;            // Display row (scale-relative, after modulation)
    int32_t  position;       // Tick position
    int32_t  length;         // Length in ticks
    uint16_t source_idx;     // Index into pattern events array
    int16_t  source_row;     // Original row of parent event
    uint8_t  is_repeat;      // 1 if this is a repeat (not original)
    uint16_t repeat_index;   // Which repeat (0 = original)
    int8_t   chord_offset;   // Scale-degree offset (0 = root)
} RenderedNote;

/**
 * Expand events for current channel/pattern into rendered notes.
 * Returns count of rendered notes written to `out`.
 */
uint16_t engine_render_events(
    const EngineState* s,
    uint8_t channel,
    uint8_t pattern,
    RenderedNote* out,
    uint16_t max_out
);

// ============ Sub-mode rendering config ============

typedef struct {
    uint8_t  render_style;  // 0 = bar, 1 = offset
    int16_t  min_val;
    int16_t  max_val;
    int16_t  step;
} SubModeRenderConfig;

// Get config for a sub-mode
const SubModeRenderConfig* engine_get_sub_mode_config(uint8_t sub_mode);

// ============ Modify mode helpers ============

// Generate all levels for a sub-mode (high to low). Returns count.
uint8_t engine_generate_levels(const SubModeRenderConfig* config, int16_t* out, uint8_t max_out);

// Get default scroll for offset-style levels (centered on zero crossing)
float engine_get_default_modify_scroll(const int16_t* levels, uint8_t count, uint8_t render_style);

// Get chord offsets for a note event (from pre-computed shapes table).
// Returns the number of chord notes (1 if no chord). Writes offsets to `offsets`.
uint8_t get_chord_offsets(const EngineState* s, const NoteEvent_C* ev, int8_t* offsets, uint8_t max_out);

#endif // ENGINE_UI_H
