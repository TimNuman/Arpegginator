#ifndef ENGINE_PLATFORM_H
#define ENGINE_PLATFORM_H

#include <stdint.h>

// Platform callbacks — implemented per target:
//   - engine_wasm.c (Emscripten → JS)
//   - teensy_hal.c  (Teensy → MIDI hardware)

void platform_step_trigger(
    uint8_t  channel,
    uint8_t  midi_note,
    int32_t  tick,
    int32_t  note_length_ticks,
    uint8_t  velocity,
    int8_t   timing_offset_pct,
    uint8_t  flam_count,
    uint16_t event_index
);

void platform_note_off(uint8_t channel, uint8_t midi_note);

void platform_set_current_tick(int32_t tick);

void platform_set_current_patterns(const uint8_t patterns[8]);

void platform_clear_queued_pattern(uint8_t channel);

void platform_preview_value(
    uint8_t  sub_mode,
    uint8_t  channel,
    uint16_t event_index,
    int32_t  tick,
    int16_t  value
);

// ============ UI-driven callbacks ============

/** Play a preview note (for auditory feedback during editing). */
void platform_play_preview_note(uint8_t channel, int16_t row, int32_t length_ticks);

/** Cycle the scale (called from input handler). direction: +1 = up, -1 = down. */
void platform_cycle_scale(int8_t direction);

/** Cycle the scale root. direction: +1 = up, -1 = down. */
void platform_cycle_scale_root(int8_t direction);

#endif // ENGINE_PLATFORM_H
