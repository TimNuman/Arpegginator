// oled_display.c — WASM-exported OLED display API

#include "oled_display.h"
#include "oled_gfx.h"
#include "oled_fonts.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

// ============ Color lookup ============

static const uint16_t COLOR_TABLE[] = {
    GFX_CYAN,    // 0: OLED_CYAN
    GFX_YELLOW,  // 1: OLED_YELLOW
    GFX_RED,     // 2: OLED_RED
    GFX_WHITE,   // 3: OLED_WHITE
    GFX_DIM,     // 4: OLED_DIM
};
#define NUM_COLORS (sizeof(COLOR_TABLE) / sizeof(COLOR_TABLE[0]))

static uint16_t color_lookup(uint8_t idx) {
    return idx < NUM_COLORS ? COLOR_TABLE[idx] : GFX_CYAN;
}

// ============ Font lookup ============

static const GFXfont *font_lookup(uint8_t idx) {
    switch (idx) {
        case OLED_FONT_SMALL: return &font_small;
        default:              return &font_main;
    }
}

// ============ Exported API ============

EMSCRIPTEN_KEEPALIVE
void oled_init(void) {
    gfx_init();
}

EMSCRIPTEN_KEEPALIVE
void oled_clear(void) {
    gfx_clear(GFX_BLACK);
}

EMSCRIPTEN_KEEPALIVE
void oled_draw_text(int16_t x, int16_t y, const char *text,
                    uint8_t color_idx, uint8_t font_idx) {
    gfx_text(x, y, text, color_lookup(color_idx), font_lookup(font_idx));
}

EMSCRIPTEN_KEEPALIVE
void oled_draw_hline(int16_t x, int16_t y, int16_t w, uint8_t color_idx) {
    gfx_hline(x, y, w, color_lookup(color_idx));
}

EMSCRIPTEN_KEEPALIVE
void oled_draw_vline(int16_t x, int16_t y, int16_t h, uint8_t color_idx) {
    gfx_vline(x, y, h, color_lookup(color_idx));
}

EMSCRIPTEN_KEEPALIVE
void oled_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1,
                    uint8_t color_idx) {
    gfx_line(x0, y0, x1, y1, color_lookup(color_idx));
}

EMSCRIPTEN_KEEPALIVE
void oled_draw_rect(int16_t x, int16_t y, int16_t w, int16_t h,
                    uint8_t color_idx) {
    gfx_rect(x, y, w, h, color_lookup(color_idx));
}

EMSCRIPTEN_KEEPALIVE
void oled_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h,
                    uint8_t color_idx) {
    gfx_fill_rect(x, y, w, h, color_lookup(color_idx));
}

EMSCRIPTEN_KEEPALIVE
void oled_draw_pixel(int16_t x, int16_t y, uint8_t color_idx) {
    gfx_pixel(x, y, color_lookup(color_idx));
}

EMSCRIPTEN_KEEPALIVE
int16_t oled_text_width(const char *text, uint8_t font_idx) {
    return gfx_text_width(text, font_lookup(font_idx));
}

EMSCRIPTEN_KEEPALIVE
int16_t oled_font_height(uint8_t font_idx) {
    return gfx_font_height(font_lookup(font_idx));
}

EMSCRIPTEN_KEEPALIVE
uint16_t *oled_get_framebuffer(void) {
    return gfx_get_framebuffer();
}

EMSCRIPTEN_KEEPALIVE
uint32_t oled_get_framebuffer_size(void) {
    return GFX_WIDTH * GFX_HEIGHT * sizeof(uint16_t);
}
