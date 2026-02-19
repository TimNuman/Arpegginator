#ifndef ENGINE_INPUT_H
#define ENGINE_INPUT_H

#include "engine_core.h"

// ============ Arrow Directions ============

#define DIR_UP    0
#define DIR_DOWN  1
#define DIR_LEFT  2
#define DIR_RIGHT 3

// ============ Key Action IDs ============
// Passed from JS for non-grid, non-arrow keys

#define ACTION_TOGGLE_PLAY      0
#define ACTION_DESELECT         1   // Backspace
#define ACTION_ZOOM_IN          2   // ]
#define ACTION_ZOOM_OUT         3   // [
#define ACTION_DELETE_NOTE      4   // Delete key
#define ACTION_CLEAR_PATTERN    5

// ============ Modifier Flags ============

#define MOD_CTRL   1
#define MOD_SHIFT  2
#define MOD_META   4
#define MOD_ALT    8

// ============ Input Functions ============

/**
 * Handle a button press on the 8×16 grid.
 * Row 0 = top, Col 0 = left.
 * Dispatches by current ui_mode.
 */
void engine_button_press(EngineState* s, uint8_t row, uint8_t col, uint8_t modifiers);

/**
 * Handle an arrow key press.
 * direction: DIR_UP/DOWN/LEFT/RIGHT.
 * Dispatches by current ui_mode and modifier state.
 */
void engine_arrow_press(EngineState* s, uint8_t direction, uint8_t modifiers);

/**
 * Handle a discrete key action (spacebar, backspace, zoom, etc.).
 */
void engine_key_action(EngineState* s, uint8_t action_id);

// ============ Internal Helpers (exposed for testing) ============

/** Convert visible row (0=top) to scale-relative row index. */
int16_t engine_visible_to_actual_row(const EngineState* s, uint8_t visible_row);

/** Convert visible col to tick position. */
int32_t engine_visible_to_tick(const EngineState* s, uint8_t visible_col);

/** Find event at (actual_row, tick) in current pattern. Returns index or -1. */
int16_t engine_find_event_at(const EngineState* s, int16_t row, int32_t tick);

#endif // ENGINE_INPUT_H
