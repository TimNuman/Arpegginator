// oled_gfx.h — Minimal RGB565 framebuffer graphics library
// Uses Adafruit GFX font format for text rendering

#ifndef OLED_GFX_H
#define OLED_GFX_H

#include <stdint.h>

// ============ Font structures (Adafruit GFX compatible) ============

typedef struct {
    uint16_t bitmapOffset;  // Pointer into GFXfont->bitmap
    uint8_t  width;         // Bitmap dimensions in pixels
    uint8_t  height;        // Bitmap dimensions in pixels
    uint8_t  xAdvance;      // Distance to advance cursor (x axis)
    int8_t   xOffset;       // X dist from cursor pos to UL corner
    int8_t   yOffset;       // Y dist from cursor pos to UL corner
} GFXglyph;

typedef struct {
    const uint8_t  *bitmap;  // Glyph bitmaps, concatenated
    const GFXglyph *glyph;   // Glyph array
    uint16_t first;          // ASCII extents (first char)
    uint16_t last;           // ASCII extents (last char)
    uint8_t  yAdvance;       // Newline distance (y axis)
} GFXfont;

// ============ Framebuffer ============

#define GFX_WIDTH   160
#define GFX_HEIGHT  128

// RGB565 color helpers
#define GFX_RGB565(r, g, b) \
    ((uint16_t)(((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | (((b) & 0xF8) >> 3))

#define GFX_BLACK   0x0000
#define GFX_WHITE   GFX_RGB565(255, 255, 255)
#define GFX_CYAN    GFX_RGB565(0, 255, 255)
#define GFX_YELLOW  GFX_RGB565(255, 255, 0)
#define GFX_RED     GFX_RGB565(255, 85, 85)
#define GFX_DIM     GFX_RGB565(0, 128, 128)

// ============ API ============

void     gfx_init(void);
void     gfx_clear(uint16_t color);
void     gfx_pixel(int16_t x, int16_t y, uint16_t color);
void     gfx_hline(int16_t x, int16_t y, int16_t w, uint16_t color);
void     gfx_vline(int16_t x, int16_t y, int16_t h, uint16_t color);
void     gfx_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
void     gfx_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
void     gfx_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
void     gfx_text(int16_t x, int16_t y, const char *str, uint16_t color, const GFXfont *font);
int16_t  gfx_text_width(const char *str, const GFXfont *font);
int16_t  gfx_font_height(const GFXfont *font);

uint16_t *gfx_get_framebuffer(void);

#endif // OLED_GFX_H
