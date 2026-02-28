// oled_gfx.c — Minimal RGB565 framebuffer graphics library
// Inspired by Adafruit GFX but pure C, no dependencies

#include "oled_gfx.h"
#include <string.h>
#include <stdlib.h>

static uint16_t framebuffer[GFX_WIDTH * GFX_HEIGHT];

void gfx_init(void) {
    memset(framebuffer, 0, sizeof(framebuffer));
}

void gfx_clear(uint16_t color) {
    for (int i = 0; i < GFX_WIDTH * GFX_HEIGHT; i++) {
        framebuffer[i] = color;
    }
}

void gfx_pixel(int16_t x, int16_t y, uint16_t color) {
    if (x >= 0 && x < GFX_WIDTH && y >= 0 && y < GFX_HEIGHT) {
        framebuffer[y * GFX_WIDTH + x] = color;
    }
}

void gfx_hline(int16_t x, int16_t y, int16_t w, uint16_t color) {
    if (y < 0 || y >= GFX_HEIGHT || w <= 0) return;
    if (x < 0) { w += x; x = 0; }
    if (x + w > GFX_WIDTH) w = GFX_WIDTH - x;
    if (w <= 0) return;
    uint16_t *p = &framebuffer[y * GFX_WIDTH + x];
    for (int16_t i = 0; i < w; i++) p[i] = color;
}

void gfx_vline(int16_t x, int16_t y, int16_t h, uint16_t color) {
    if (x < 0 || x >= GFX_WIDTH || h <= 0) return;
    if (y < 0) { h += y; y = 0; }
    if (y + h > GFX_HEIGHT) h = GFX_HEIGHT - y;
    if (h <= 0) return;
    for (int16_t i = 0; i < h; i++) {
        framebuffer[(y + i) * GFX_WIDTH + x] = color;
    }
}

// Bresenham's line algorithm
void gfx_line(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
    int16_t dx = abs(x1 - x0);
    int16_t dy = -abs(y1 - y0);
    int16_t sx = x0 < x1 ? 1 : -1;
    int16_t sy = y0 < y1 ? 1 : -1;
    int16_t err = dx + dy;

    for (;;) {
        gfx_pixel(x0, y0, color);
        if (x0 == x1 && y0 == y1) break;
        int16_t e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

void gfx_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    gfx_hline(x, y, w, color);
    gfx_hline(x, y + h - 1, w, color);
    gfx_vline(x, y, h, color);
    gfx_vline(x + w - 1, y, h, color);
}

void gfx_fill_rect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    for (int16_t row = y; row < y + h; row++) {
        gfx_hline(x, row, w, color);
    }
}

// ============ Text rendering (Adafruit GFX font format) ============

static void gfx_draw_char(int16_t x, int16_t y, char c, uint16_t color,
                           const GFXfont *font) {
    uint8_t ch = (uint8_t)c;
    if (ch < font->first || ch > font->last) return;

    const GFXglyph *glyph = &font->glyph[ch - font->first];
    const uint8_t *bitmap = font->bitmap;
    uint16_t bo = glyph->bitmapOffset;
    uint8_t  w  = glyph->width;
    uint8_t  h  = glyph->height;
    int8_t   xo = glyph->xOffset;
    int8_t   yo = glyph->yOffset;

    uint8_t bits = 0, bit = 0;
    for (uint8_t yy = 0; yy < h; yy++) {
        for (uint8_t xx = 0; xx < w; xx++) {
            if (!(bit & 7)) {
                bits = bitmap[bo++];
            }
            bit++;
            if (bits & 0x80) {
                gfx_pixel(x + xo + xx, y + yo + yy, color);
            }
            bits <<= 1;
        }
    }
}

void gfx_text(int16_t x, int16_t y, const char *str, uint16_t color,
              const GFXfont *font) {
    if (!str || !font) return;
    int16_t cx = x;
    while (*str) {
        uint8_t ch = (uint8_t)*str;
        if (ch >= font->first && ch <= font->last) {
            const GFXglyph *glyph = &font->glyph[ch - font->first];
            gfx_draw_char(cx, y, *str, color, font);
            cx += glyph->xAdvance;
        }
        str++;
    }
}

int16_t gfx_text_width(const char *str, const GFXfont *font) {
    if (!str || !font) return 0;
    int16_t w = 0;
    while (*str) {
        uint8_t ch = (uint8_t)*str;
        if (ch >= font->first && ch <= font->last) {
            w += font->glyph[ch - font->first].xAdvance;
        }
        str++;
    }
    return w;
}

int16_t gfx_font_height(const GFXfont *font) {
    if (!font) return 0;
    return font->yAdvance;
}

uint16_t *gfx_get_framebuffer(void) {
    return framebuffer;
}
