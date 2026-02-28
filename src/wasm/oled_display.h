// oled_display.h — WASM-exported OLED display API
// Wraps oled_gfx with Emscripten exports and color/font indices

#ifndef OLED_DISPLAY_H
#define OLED_DISPLAY_H

#include <stdint.h>

// Color indices (passed from JS)
#define OLED_CYAN    0
#define OLED_YELLOW  1
#define OLED_RED     2
#define OLED_WHITE   3
#define OLED_DIM     4

// Font indices (passed from JS)
#define OLED_FONT_MAIN   0
#define OLED_FONT_SMALL  1

void     oled_init(void);
void     oled_clear(void);
void     oled_draw_text(int16_t x, int16_t y, const char *text,
                        uint8_t color_idx, uint8_t font_idx);
void     oled_draw_hline(int16_t x, int16_t y, int16_t w, uint8_t color_idx);
void     oled_draw_vline(int16_t x, int16_t y, int16_t h, uint8_t color_idx);
void     oled_draw_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1,
                        uint8_t color_idx);
void     oled_draw_rect(int16_t x, int16_t y, int16_t w, int16_t h,
                        uint8_t color_idx);
void     oled_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h,
                        uint8_t color_idx);
void     oled_draw_pixel(int16_t x, int16_t y, uint8_t color_idx);
int16_t  oled_text_width(const char *text, uint8_t font_idx);
int16_t  oled_font_height(uint8_t font_idx);
uint16_t *oled_get_framebuffer(void);
uint32_t  oled_get_framebuffer_size(void);

#endif // OLED_DISPLAY_H
