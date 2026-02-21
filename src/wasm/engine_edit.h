#ifndef ENGINE_EDIT_H
#define ENGINE_EDIT_H

#include "engine_core.h"

// ============ Event CRUD ============

/**
 * Toggle event at (row, tick). If an event exists at that position, remove it.
 * If no event exists, create one with the given length.
 * Returns the index of the new event, or -1 if removed.
 */
int16_t engine_toggle_event(EngineState* s, int16_t row, int32_t tick, int32_t length_ticks);

/**
 * Remove an event by index from the current channel/pattern.
 */
void engine_remove_event(EngineState* s, uint16_t event_idx);

/**
 * Move an event to a new row and position.
 */
void engine_move_event(EngineState* s, uint16_t event_idx, int16_t new_row, int32_t new_position);

/**
 * Set the length of an event (in ticks).
 */
void engine_set_event_length(EngineState* s, uint16_t event_idx, int32_t length);

/**
 * Finalize event position — truncate overlapping events on the same row.
 */
void engine_place_event(EngineState* s, uint16_t event_idx);

// ============ Repeat Operations ============

/**
 * Set the repeat amount for an event. Clamps length if needed.
 */
void engine_set_event_repeat_amount(EngineState* s, uint16_t event_idx, uint16_t repeat_amount);

/**
 * Set the repeat space for an event. Clamps length if needed.
 */
void engine_set_event_repeat_space(EngineState* s, uint16_t event_idx, int32_t repeat_space);

// ============ Sub-Mode Operations ============

/**
 * Set a value in a sub-mode array at a specific repeat index.
 * Materializes the array to the required length if needed.
 */
void engine_set_sub_mode_value(EngineState* s, uint16_t event_idx, uint8_t sub_mode, uint16_t repeat_idx, int16_t value);

/**
 * Set the array length for a sub-mode. Materializes/truncates as needed.
 */
void engine_set_sub_mode_length(EngineState* s, uint16_t event_idx, uint8_t sub_mode, uint8_t new_length);

/**
 * Toggle loop mode: reset → continue → fill → reset.
 */
void engine_toggle_sub_mode_loop_mode(EngineState* s, uint16_t event_idx, uint8_t sub_mode);

// ============ Chord Operations ============

/**
 * Adjust chord stack size. direction: 1 = up (add), -1 = down (remove).
 */
void engine_adjust_chord_stack(EngineState* s, uint16_t event_idx, int8_t direction);

/**
 * Adjust chord space (gap between notes). direction: 1 = wider, -1 = narrower.
 */
void engine_adjust_chord_space(EngineState* s, uint16_t event_idx, int8_t direction);

/**
 * Cycle chord inversion. direction: 1 = up, -1 = down.
 */
void engine_cycle_chord_inversion(EngineState* s, uint16_t event_idx, int8_t direction);

// ============ Pattern Operations ============

/**
 * Copy current pattern to target pattern slot (same channel).
 */
void engine_copy_pattern(EngineState* s, uint8_t target_pattern);

/**
 * Clear the current pattern (remove all events, reset loop).
 */
void engine_clear_pattern(EngineState* s);

#endif // ENGINE_EDIT_H
