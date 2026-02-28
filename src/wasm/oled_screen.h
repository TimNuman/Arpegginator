// oled_screen.h — OLED screen content rendering (all display logic in C)
// Reads engine state directly and draws to the framebuffer.
// TS only calls oled_render(modifiers) + blit().

#ifndef OLED_SCREEN_H
#define OLED_SCREEN_H

#include <stdint.h>

// Modifier key bitmask (matches TS keyboard state encoding)
#define MOD_SHIFT 1
#define MOD_META  2
#define MOD_ALT   4
#define MOD_CTRL  8

// Render the full OLED screen based on current engine state.
// modifiers: bitmask of MOD_SHIFT | MOD_META | MOD_ALT | MOD_CTRL
void oled_render(uint8_t modifiers);

#endif // OLED_SCREEN_H
