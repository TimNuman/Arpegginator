// oled_fonts.rs — Bitmap font data (Maple Mono, generated via Adafruit fontconvert)
// Ported byte-for-byte from oled_fonts.c

use crate::oled_gfx::{GFXfont, GFXglyph};

// ============ Maple Mono 7pt (main font) ============
// 8px wide, 18px line height, ~20 chars/line on 160px display

static FONT_MAIN_BITMAPS: [u8; 677] = [
    0x00, 0x49, 0x24, 0x90, 0x48, 0x99, 0x99, 0x36, 0x36, 0xFF, 0x24, 0x24,
    0x24, 0xFF, 0x24, 0x24, 0x24, 0x10, 0x45, 0xB5, 0x92, 0x07, 0x06, 0x16,
    0x59, 0x57, 0x10, 0x40, 0x61, 0x2E, 0x73, 0x40, 0x05, 0x9C, 0xA9, 0xD2,
    0x18, 0x38, 0x99, 0x03, 0x03, 0x12, 0x62, 0xC3, 0x8C, 0xF4, 0xF0, 0x03,
    0x64, 0xC8, 0x88, 0x88, 0xC4, 0x63, 0x10, 0x0C, 0x62, 0x31, 0x11, 0x11,
    0x32, 0x6C, 0x80, 0x11, 0xAD, 0xF3, 0xED, 0x62, 0x04, 0x00, 0x10, 0x23,
    0xF8, 0x81, 0x02, 0x00, 0x6C, 0x9C, 0xFC, 0xF0, 0x00, 0x10, 0x82, 0x18,
    0x41, 0x0C, 0x20, 0x86, 0x10, 0x43, 0x00, 0x79, 0x28, 0x63, 0xBF, 0x9C,
    0x61, 0x49, 0xE0, 0x33, 0x49, 0x04, 0x10, 0x41, 0x04, 0x13, 0xF0, 0x78,
    0x10, 0x41, 0x0C, 0x63, 0x18, 0xC3, 0xF0, 0xF0, 0x20, 0x86, 0x70, 0x30,
    0x41, 0x0F, 0xE0, 0x08, 0x62, 0x8A, 0x4B, 0x2F, 0xC2, 0x08, 0x20, 0xFA,
    0x08, 0x20, 0xF8, 0x30, 0x41, 0x0F, 0xE0, 0x10, 0x84, 0x2E, 0xCE, 0x18,
    0x61, 0xCD, 0xE0, 0xFC, 0x30, 0xC2, 0x18, 0x43, 0x08, 0x21, 0x80, 0x7A,
    0x18, 0x61, 0x7B, 0x38, 0x61, 0xCD, 0xE0, 0x7B, 0x38, 0x61, 0xCD, 0xD0,
    0x82, 0x10, 0x80, 0xF0, 0x0F, 0x6C, 0x00, 0xD9, 0x38, 0x0C, 0xEE, 0x30,
    0x70, 0x70, 0x40, 0xFC, 0x00, 0x00, 0xFC, 0xC1, 0xC1, 0xC3, 0x3B, 0x88,
    0x00, 0xF4, 0x42, 0x33, 0x10, 0x80, 0x63, 0x00, 0xF9, 0x08, 0x1B, 0x19,
    0x32, 0x64, 0xC8, 0x91, 0x9C, 0x30, 0x60, 0xA2, 0x44, 0x89, 0x3F, 0x42,
    0x85, 0x0C, 0xFA, 0x18, 0x61, 0xFA, 0x38, 0x61, 0x8F, 0xE0, 0x3D, 0x18,
    0x20, 0x82, 0x08, 0x30, 0x40, 0xF0, 0xF2, 0x28, 0x61, 0x86, 0x18, 0x61,
    0x8B, 0xC0, 0xFE, 0x08, 0x20, 0xFA, 0x08, 0x20, 0x83, 0xF0, 0xFE, 0x08,
    0x20, 0xFA, 0x08, 0x20, 0x82, 0x00, 0x79, 0x18, 0x20, 0x9E, 0x18, 0x61,
    0x4C, 0xE0, 0x86, 0x18, 0x61, 0xFE, 0x18, 0x61, 0x86, 0x10, 0xF9, 0x08,
    0x42, 0x10, 0x84, 0x27, 0xC0, 0x3C, 0x10, 0x41, 0x04, 0x10, 0x61, 0xCD,
    0xE0, 0x8A, 0x6B, 0x28, 0xE3, 0x8B, 0x24, 0x8A, 0x30, 0x82, 0x08, 0x20,
    0x82, 0x08, 0x20, 0x83, 0xF0, 0xCF, 0x3C, 0xED, 0xB6, 0xD8, 0x61, 0x86,
    0x10, 0xC7, 0x1E, 0x69, 0xB6, 0xD9, 0x67, 0x8E, 0x30, 0x79, 0x28, 0x61,
    0x86, 0x18, 0x61, 0x49, 0xE0, 0xFA, 0x18, 0x61, 0xFA, 0x08, 0x20, 0x82,
    0x00, 0x79, 0x28, 0x61, 0x86, 0x18, 0x61, 0x49, 0xE0, 0x06, 0x0C, 0xFA,
    0x18, 0x61, 0xFA, 0x49, 0xA2, 0x8E, 0x10, 0x72, 0x28, 0x20, 0x70, 0x70,
    0x61, 0xC5, 0xE0, 0xFE, 0x20, 0x40, 0x81, 0x02, 0x04, 0x08, 0x10, 0x20,
    0x86, 0x18, 0x61, 0x86, 0x18, 0x61, 0x8D, 0xE0, 0x86, 0x1C, 0x53, 0x49,
    0x26, 0x8C, 0x30, 0xC0, 0xC1, 0x43, 0x5B, 0x5A, 0x5A, 0x5A, 0x56, 0x76,
    0x66, 0x66, 0x85, 0x34, 0x8E, 0x30, 0xC3, 0x92, 0xCE, 0x10, 0x82, 0x89,
    0x11, 0x42, 0x82, 0x04, 0x08, 0x10, 0x20, 0xFC, 0x30, 0x86, 0x30, 0xC6,
    0x10, 0xC3, 0xF0, 0xF8, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0xF0, 0x03,
    0x04, 0x10, 0x60, 0x82, 0x04, 0x10, 0x60, 0x82, 0x0C, 0x10, 0xF1, 0x11,
    0x11, 0x11, 0x11, 0x11, 0x11, 0xF0, 0x30, 0xC7, 0x92, 0xC4, 0xFC, 0xC6,
    0x21, 0x3C, 0x8B, 0x14, 0x28, 0x50, 0xA3, 0x3A, 0x82, 0x0F, 0xB3, 0x86,
    0x18, 0x61, 0xCE, 0xE0, 0x7B, 0x18, 0x20, 0x82, 0x0C, 0x1E, 0x04, 0x17,
    0xF3, 0x86, 0x18, 0x61, 0xCD, 0xD0, 0x79, 0x38, 0x7F, 0x83, 0x04, 0x5E,
    0x1C, 0x82, 0x3F, 0x20, 0x82, 0x08, 0x20, 0x80, 0x77, 0x38, 0x61, 0x86,
    0x1C, 0xDD, 0x07, 0x37, 0x80, 0x82, 0x0B, 0xB3, 0x86, 0x18, 0x61, 0x86,
    0x10, 0x30, 0x60, 0x03, 0x81, 0x02, 0x04, 0x08, 0x10, 0x23, 0xF8, 0x18,
    0xC0, 0xF0, 0x84, 0x21, 0x08, 0x42, 0x18, 0xB8, 0x82, 0x08, 0xA6, 0xB3,
    0x8F, 0x24, 0x8A, 0x30, 0xE0, 0x82, 0x08, 0x20, 0x82, 0x08, 0x20, 0x70,
    0xFF, 0x26, 0x4C, 0x99, 0x32, 0x64, 0xC9, 0xBB, 0x38, 0x61, 0x86, 0x18,
    0x61, 0x7B, 0x38, 0x61, 0x86, 0x1C, 0x9E, 0xBB, 0x38, 0x61, 0x86, 0x1C,
    0xFE, 0x82, 0x00, 0x77, 0x38, 0x61, 0x86, 0x1C, 0xDD, 0x04, 0x10, 0xBB,
    0x18, 0x60, 0x82, 0x08, 0x20, 0x79, 0x3C, 0x1E, 0x1C, 0x1C, 0x5E, 0x20,
    0x8F, 0xC8, 0x20, 0x82, 0x08, 0x20, 0x70, 0x86, 0x18, 0x61, 0x86, 0x1C,
    0xDD, 0x87, 0x14, 0xD2, 0x68, 0xE3, 0x0C, 0xC1, 0x43, 0x5B, 0x5A, 0x5A,
    0x56, 0x66, 0x66, 0xC5, 0x27, 0x8C, 0x31, 0xE4, 0xE1, 0x87, 0x14, 0xD2,
    0x68, 0xE3, 0x0C, 0x30, 0x8C, 0x00, 0xF8, 0x21, 0x8C, 0x21, 0x0C, 0x3F,
    0x04, 0x71, 0x04, 0x10, 0x43, 0x38, 0x30, 0x41, 0x04, 0x10, 0x70, 0xC0,
    0xFF, 0xF8, 0x83, 0x82, 0x08, 0x20, 0x83, 0x07, 0x30, 0x82, 0x08, 0x21,
    0x8C, 0x00, 0xE6, 0xD9, 0xC0,
];

static FONT_MAIN_GLYPHS: [GFXglyph; 95] = [
    GFXglyph { bitmap_offset:   0, width: 1, height:  1, x_advance: 8, x_offset:  0, y_offset:   0 }, // 0x20 ' '
    GFXglyph { bitmap_offset:   1, width: 3, height: 10, x_advance: 8, x_offset:  3, y_offset:  -9 }, // 0x21 '!'
    GFXglyph { bitmap_offset:   5, width: 4, height:  4, x_advance: 8, x_offset:  2, y_offset:  -9 }, // 0x22 '"'
    GFXglyph { bitmap_offset:   7, width: 8, height: 10, x_advance: 8, x_offset:  0, y_offset:  -9 }, // 0x23 '#'
    GFXglyph { bitmap_offset:  17, width: 6, height: 14, x_advance: 8, x_offset:  1, y_offset: -11 }, // 0x24 '$'
    GFXglyph { bitmap_offset:  28, width: 7, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x25 '%'
    GFXglyph { bitmap_offset:  37, width: 7, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x26 '&'
    GFXglyph { bitmap_offset:  46, width: 1, height:  4, x_advance: 8, x_offset:  3, y_offset:  -9 }, // 0x27 '''
    GFXglyph { bitmap_offset:  47, width: 4, height: 15, x_advance: 8, x_offset:  2, y_offset: -12 }, // 0x28 '('
    GFXglyph { bitmap_offset:  55, width: 4, height: 15, x_advance: 8, x_offset:  2, y_offset: -12 }, // 0x29 ')'
    GFXglyph { bitmap_offset:  63, width: 7, height:  7, x_advance: 8, x_offset:  0, y_offset:  -7 }, // 0x2A '*'
    GFXglyph { bitmap_offset:  70, width: 7, height:  6, x_advance: 8, x_offset:  0, y_offset:  -7 }, // 0x2B '+'
    GFXglyph { bitmap_offset:  76, width: 3, height:  5, x_advance: 8, x_offset:  2, y_offset:  -1 }, // 0x2C ','
    GFXglyph { bitmap_offset:  78, width: 6, height:  1, x_advance: 8, x_offset:  1, y_offset:  -4 }, // 0x2D '-'
    GFXglyph { bitmap_offset:  79, width: 2, height:  2, x_advance: 8, x_offset:  3, y_offset:  -1 }, // 0x2E '.'
    GFXglyph { bitmap_offset:  80, width: 6, height: 14, x_advance: 8, x_offset:  1, y_offset: -11 }, // 0x2F '/'
    GFXglyph { bitmap_offset:  91, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x30 '0'
    GFXglyph { bitmap_offset:  99, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x31 '1'
    GFXglyph { bitmap_offset: 107, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x32 '2'
    GFXglyph { bitmap_offset: 115, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x33 '3'
    GFXglyph { bitmap_offset: 123, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x34 '4'
    GFXglyph { bitmap_offset: 131, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x35 '5'
    GFXglyph { bitmap_offset: 139, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x36 '6'
    GFXglyph { bitmap_offset: 147, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x37 '7'
    GFXglyph { bitmap_offset: 155, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x38 '8'
    GFXglyph { bitmap_offset: 163, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x39 '9'
    GFXglyph { bitmap_offset: 171, width: 2, height:  8, x_advance: 8, x_offset:  3, y_offset:  -7 }, // 0x3A ':'
    GFXglyph { bitmap_offset: 173, width: 3, height: 10, x_advance: 8, x_offset:  2, y_offset:  -7 }, // 0x3B ';'
    GFXglyph { bitmap_offset: 177, width: 6, height:  7, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x3C '<'
    GFXglyph { bitmap_offset: 183, width: 6, height:  5, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x3D '='
    GFXglyph { bitmap_offset: 187, width: 6, height:  7, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x3E '>'
    GFXglyph { bitmap_offset: 193, width: 5, height: 10, x_advance: 8, x_offset:  2, y_offset:  -9 }, // 0x3F '?'
    GFXglyph { bitmap_offset: 200, width: 7, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x40 '@'
    GFXglyph { bitmap_offset: 209, width: 7, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x41 'A'
    GFXglyph { bitmap_offset: 218, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x42 'B'
    GFXglyph { bitmap_offset: 226, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x43 'C'
    GFXglyph { bitmap_offset: 234, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x44 'D'
    GFXglyph { bitmap_offset: 242, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x45 'E'
    GFXglyph { bitmap_offset: 250, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x46 'F'
    GFXglyph { bitmap_offset: 258, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x47 'G'
    GFXglyph { bitmap_offset: 266, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x48 'H'
    GFXglyph { bitmap_offset: 274, width: 5, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x49 'I'
    GFXglyph { bitmap_offset: 281, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x4A 'J'
    GFXglyph { bitmap_offset: 289, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x4B 'K'
    GFXglyph { bitmap_offset: 297, width: 6, height: 10, x_advance: 8, x_offset:  2, y_offset:  -9 }, // 0x4C 'L'
    GFXglyph { bitmap_offset: 305, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x4D 'M'
    GFXglyph { bitmap_offset: 313, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x4E 'N'
    GFXglyph { bitmap_offset: 321, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x4F 'O'
    GFXglyph { bitmap_offset: 329, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x50 'P'
    GFXglyph { bitmap_offset: 337, width: 6, height: 13, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x51 'Q'
    GFXglyph { bitmap_offset: 347, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x52 'R'
    GFXglyph { bitmap_offset: 355, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x53 'S'
    GFXglyph { bitmap_offset: 363, width: 7, height: 10, x_advance: 8, x_offset:  0, y_offset:  -9 }, // 0x54 'T'
    GFXglyph { bitmap_offset: 372, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x55 'U'
    GFXglyph { bitmap_offset: 380, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x56 'V'
    GFXglyph { bitmap_offset: 388, width: 8, height: 10, x_advance: 8, x_offset:  0, y_offset:  -9 }, // 0x57 'W'
    GFXglyph { bitmap_offset: 398, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x58 'X'
    GFXglyph { bitmap_offset: 406, width: 7, height: 10, x_advance: 8, x_offset:  0, y_offset:  -9 }, // 0x59 'Y'
    GFXglyph { bitmap_offset: 415, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x5A 'Z'
    GFXglyph { bitmap_offset: 423, width: 4, height: 15, x_advance: 8, x_offset:  2, y_offset: -12 }, // 0x5B '['
    GFXglyph { bitmap_offset: 431, width: 6, height: 14, x_advance: 8, x_offset:  1, y_offset: -11 }, // 0x5C '\'
    GFXglyph { bitmap_offset: 442, width: 4, height: 15, x_advance: 8, x_offset:  2, y_offset: -12 }, // 0x5D ']'
    GFXglyph { bitmap_offset: 450, width: 6, height:  5, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x5E '^'
    GFXglyph { bitmap_offset: 454, width: 6, height:  1, x_advance: 8, x_offset:  1, y_offset:   2 }, // 0x5F '_'
    GFXglyph { bitmap_offset: 455, width: 4, height:  4, x_advance: 8, x_offset:  2, y_offset: -11 }, // 0x60 '`'
    GFXglyph { bitmap_offset: 457, width: 7, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x61 'a'
    GFXglyph { bitmap_offset: 464, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x62 'b'
    GFXglyph { bitmap_offset: 472, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x63 'c'
    GFXglyph { bitmap_offset: 478, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x64 'd'
    GFXglyph { bitmap_offset: 486, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x65 'e'
    GFXglyph { bitmap_offset: 492, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x66 'f'
    GFXglyph { bitmap_offset: 500, width: 6, height: 11, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x67 'g'
    GFXglyph { bitmap_offset: 509, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x68 'h'
    GFXglyph { bitmap_offset: 517, width: 7, height: 11, x_advance: 8, x_offset:  1, y_offset: -10 }, // 0x69 'i'
    GFXglyph { bitmap_offset: 527, width: 5, height: 14, x_advance: 8, x_offset:  1, y_offset: -10 }, // 0x6A 'j'
    GFXglyph { bitmap_offset: 536, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x6B 'k'
    GFXglyph { bitmap_offset: 544, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x6C 'l'
    GFXglyph { bitmap_offset: 552, width: 7, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x6D 'm'
    GFXglyph { bitmap_offset: 559, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x6E 'n'
    GFXglyph { bitmap_offset: 565, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x6F 'o'
    GFXglyph { bitmap_offset: 571, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x70 'p'
    GFXglyph { bitmap_offset: 579, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x71 'q'
    GFXglyph { bitmap_offset: 587, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x72 'r'
    GFXglyph { bitmap_offset: 593, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x73 's'
    GFXglyph { bitmap_offset: 599, width: 6, height: 10, x_advance: 8, x_offset:  1, y_offset:  -9 }, // 0x74 't'
    GFXglyph { bitmap_offset: 607, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x75 'u'
    GFXglyph { bitmap_offset: 613, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x76 'v'
    GFXglyph { bitmap_offset: 619, width: 8, height:  8, x_advance: 8, x_offset:  0, y_offset:  -7 }, // 0x77 'w'
    GFXglyph { bitmap_offset: 627, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x78 'x'
    GFXglyph { bitmap_offset: 633, width: 6, height: 11, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x79 'y'
    GFXglyph { bitmap_offset: 642, width: 6, height:  8, x_advance: 8, x_offset:  1, y_offset:  -7 }, // 0x7A 'z'
    GFXglyph { bitmap_offset: 648, width: 6, height: 15, x_advance: 8, x_offset:  1, y_offset: -12 }, // 0x7B '{'
    GFXglyph { bitmap_offset: 660, width: 1, height: 13, x_advance: 8, x_offset:  3, y_offset: -10 }, // 0x7C '|'
    GFXglyph { bitmap_offset: 662, width: 6, height: 15, x_advance: 8, x_offset:  2, y_offset: -12 }, // 0x7D '}'
    GFXglyph { bitmap_offset: 674, width: 6, height:  3, x_advance: 8, x_offset:  1, y_offset:  -6 }, // 0x7E '~'
];

pub static FONT_MAIN: GFXfont = GFXfont {
    bitmap: &FONT_MAIN_BITMAPS,
    glyph: &FONT_MAIN_GLYPHS,
    first: 0x20,
    last: 0x7E,
    y_advance: 18,
};

// ============ Maple Mono 5pt (small font) ============
// 6px wide, 13px line height, ~26 chars/line on 160px display

static FONT_SMALL_BITMAPS: [u8; 384] = [
    0x00, 0xAA, 0x83, 0xB6, 0x80, 0x28, 0xAF, 0xD2, 0x53, 0xF5, 0x14, 0x21,
    0x2D, 0x5A, 0x38, 0x65, 0xA9, 0x88, 0xE5, 0x6D, 0xE7, 0xB6, 0xA7, 0x64,
    0xB0, 0x8A, 0xC6, 0x4F, 0xE0, 0x29, 0x49, 0x24, 0x4C, 0x80, 0x89, 0x12,
    0x49, 0x5A, 0x00, 0x27, 0xC9, 0xF2, 0x00, 0x21, 0x3E, 0x42, 0x00, 0x6C,
    0xE0, 0xF0, 0xC0, 0x01, 0x22, 0x24, 0x44, 0x48, 0x80, 0x76, 0xE7, 0x7E,
    0xE7, 0x6E, 0x65, 0x08, 0x42, 0x10, 0x9F, 0xE1, 0x11, 0x24, 0x8F, 0x70,
    0x42, 0x60, 0x84, 0x2E, 0x11, 0x94, 0xA9, 0x7C, 0x42, 0x7A, 0x10, 0xE0,
    0x84, 0x2E, 0x22, 0x11, 0x6C, 0xC6, 0x2E, 0xF1, 0x12, 0x22, 0x44, 0x64,
    0xA4, 0xC9, 0xC6, 0x2E, 0x74, 0x63, 0x17, 0x88, 0x44, 0xCC, 0x6C, 0x06,
    0xCE, 0x36, 0x86, 0x10, 0xF0, 0x0F, 0x86, 0x16, 0x80, 0xE9, 0x13, 0x64,
    0x06, 0x72, 0x20, 0x4D, 0x55, 0x55, 0x1F, 0x31, 0x8C, 0xA4, 0xBD, 0x31,
    0xE9, 0x9E, 0x99, 0x9E, 0x72, 0x61, 0x08, 0x41, 0x0F, 0xEB, 0x99, 0x99,
    0xBE, 0xF8, 0x8F, 0x88, 0x8F, 0xF8, 0x8F, 0x88, 0x88, 0x76, 0xA1, 0x09,
    0xC7, 0x2E, 0x99, 0x9F, 0x99, 0x99, 0xE9, 0x24, 0x97, 0x38, 0x42, 0x10,
    0x85, 0x2E, 0x9A, 0xAC, 0xAA, 0x99, 0x88, 0x88, 0x88, 0x8F, 0xDE, 0xF7,
    0xDA, 0xC6, 0x31, 0x9D, 0xDD, 0xDB, 0xB9, 0x76, 0xE3, 0x18, 0xC7, 0x6E,
    0xF4, 0x63, 0xE8, 0x42, 0x10, 0x76, 0xE3, 0x18, 0xC7, 0x6E, 0x01, 0x80,
    0xF4, 0x63, 0xEB, 0x4A, 0x51, 0x3A, 0x50, 0xC1, 0x85, 0x2E, 0xF9, 0x08,
    0x42, 0x10, 0x84, 0x99, 0x99, 0x99, 0x96, 0x99, 0x99, 0xE6, 0x66, 0x86,
    0x2A, 0xAE, 0x79, 0xE5, 0x92, 0x99, 0x66, 0x66, 0x99, 0x8C, 0x54, 0xA2,
    0x10, 0x84, 0xF1, 0x22, 0x44, 0x8F, 0xF2, 0x49, 0x24, 0x93, 0x80, 0x08,
    0x84, 0x44, 0x22, 0x21, 0x10, 0xE4, 0x92, 0x49, 0x27, 0x80, 0x66, 0x91,
    0xF0, 0xB4, 0x7D, 0x99, 0x97, 0x88, 0xE9, 0x99, 0x9E, 0x78, 0x88, 0x87,
    0x11, 0x79, 0x99, 0x97, 0x74, 0xBF, 0x08, 0x38, 0x19, 0x09, 0xF2, 0x10,
    0x84, 0x79, 0x99, 0x97, 0x96, 0x88, 0xE9, 0x99, 0x99, 0x20, 0x38, 0x42,
    0x10, 0x9F, 0x10, 0x71, 0x11, 0x11, 0x96, 0x88, 0x9A, 0xEA, 0x99, 0xE1,
    0x08, 0x42, 0x10, 0x83, 0xFD, 0x6B, 0x5A, 0xD4, 0xE9, 0x99, 0x99, 0x69,
    0x99, 0x96, 0xE9, 0x99, 0x9E, 0x88, 0x79, 0x99, 0x97, 0x11, 0xF9, 0x98,
    0x88, 0xE9, 0xC3, 0x9E, 0x01, 0x3E, 0x42, 0x10, 0x83, 0x99, 0x99, 0x97,
    0x99, 0x96, 0x66, 0x86, 0x2B, 0x9E, 0x79, 0x20, 0x96, 0x66, 0xA9, 0x99,
    0x96, 0x62, 0x48, 0xF1, 0x24, 0x8F, 0x19, 0x08, 0x42, 0x60, 0x84, 0x21,
    0x0E, 0xFF, 0xC0, 0xC1, 0x08, 0x42, 0x0C, 0x84, 0x21, 0x38, 0xED, 0xC0,
];

static FONT_SMALL_GLYPHS: [GFXglyph; 95] = [
    GFXglyph { bitmap_offset:   0, width: 1, height:  1, x_advance: 6, x_offset:  0, y_offset:   0 }, // 0x20 ' '
    GFXglyph { bitmap_offset:   1, width: 2, height:  8, x_advance: 6, x_offset:  2, y_offset:  -7 }, // 0x21 '!'
    GFXglyph { bitmap_offset:   3, width: 3, height:  3, x_advance: 6, x_offset:  2, y_offset:  -7 }, // 0x22 '"'
    GFXglyph { bitmap_offset:   5, width: 6, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x23 '#'
    GFXglyph { bitmap_offset:  11, width: 5, height: 11, x_advance: 6, x_offset:  1, y_offset:  -9 }, // 0x24 '$'
    GFXglyph { bitmap_offset:  18, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x25 '%'
    GFXglyph { bitmap_offset:  23, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x26 '&'
    GFXglyph { bitmap_offset:  28, width: 1, height:  3, x_advance: 6, x_offset:  2, y_offset:  -7 }, // 0x27 '''
    GFXglyph { bitmap_offset:  29, width: 3, height: 11, x_advance: 6, x_offset:  1, y_offset:  -8 }, // 0x28 '('
    GFXglyph { bitmap_offset:  34, width: 3, height: 11, x_advance: 6, x_offset:  2, y_offset:  -8 }, // 0x29 ')'
    GFXglyph { bitmap_offset:  39, width: 5, height:  5, x_advance: 6, x_offset:  0, y_offset:  -5 }, // 0x2A '*'
    GFXglyph { bitmap_offset:  43, width: 5, height:  5, x_advance: 6, x_offset:  0, y_offset:  -5 }, // 0x2B '+'
    GFXglyph { bitmap_offset:  47, width: 3, height:  4, x_advance: 6, x_offset:  1, y_offset:  -1 }, // 0x2C ','
    GFXglyph { bitmap_offset:  49, width: 4, height:  1, x_advance: 6, x_offset:  1, y_offset:  -3 }, // 0x2D '-'
    GFXglyph { bitmap_offset:  50, width: 1, height:  2, x_advance: 6, x_offset:  2, y_offset:  -1 }, // 0x2E '.'
    GFXglyph { bitmap_offset:  51, width: 4, height: 11, x_advance: 6, x_offset:  1, y_offset:  -9 }, // 0x2F '/'
    GFXglyph { bitmap_offset:  57, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x30 '0'
    GFXglyph { bitmap_offset:  62, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x31 '1'
    GFXglyph { bitmap_offset:  67, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x32 '2'
    GFXglyph { bitmap_offset:  71, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x33 '3'
    GFXglyph { bitmap_offset:  76, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x34 '4'
    GFXglyph { bitmap_offset:  81, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x35 '5'
    GFXglyph { bitmap_offset:  86, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x36 '6'
    GFXglyph { bitmap_offset:  91, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x37 '7'
    GFXglyph { bitmap_offset:  95, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x38 '8'
    GFXglyph { bitmap_offset: 100, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x39 '9'
    GFXglyph { bitmap_offset: 105, width: 1, height:  6, x_advance: 6, x_offset:  2, y_offset:  -5 }, // 0x3A ':'
    GFXglyph { bitmap_offset: 106, width: 3, height:  8, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x3B ';'
    GFXglyph { bitmap_offset: 109, width: 4, height:  5, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x3C '<'
    GFXglyph { bitmap_offset: 112, width: 4, height:  4, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x3D '='
    GFXglyph { bitmap_offset: 114, width: 4, height:  5, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x3E '>'
    GFXglyph { bitmap_offset: 117, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x3F '?'
    GFXglyph { bitmap_offset: 121, width: 6, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x40 '@'
    GFXglyph { bitmap_offset: 127, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x41 'A'
    GFXglyph { bitmap_offset: 132, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x42 'B'
    GFXglyph { bitmap_offset: 136, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x43 'C'
    GFXglyph { bitmap_offset: 141, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x44 'D'
    GFXglyph { bitmap_offset: 145, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x45 'E'
    GFXglyph { bitmap_offset: 149, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x46 'F'
    GFXglyph { bitmap_offset: 153, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x47 'G'
    GFXglyph { bitmap_offset: 158, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x48 'H'
    GFXglyph { bitmap_offset: 162, width: 3, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x49 'I'
    GFXglyph { bitmap_offset: 165, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x4A 'J'
    GFXglyph { bitmap_offset: 170, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x4B 'K'
    GFXglyph { bitmap_offset: 174, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x4C 'L'
    GFXglyph { bitmap_offset: 178, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x4D 'M'
    GFXglyph { bitmap_offset: 183, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x4E 'N'
    GFXglyph { bitmap_offset: 187, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x4F 'O'
    GFXglyph { bitmap_offset: 192, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x50 'P'
    GFXglyph { bitmap_offset: 197, width: 5, height: 10, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x51 'Q'
    GFXglyph { bitmap_offset: 204, width: 5, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x52 'R'
    GFXglyph { bitmap_offset: 209, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x53 'S'
    GFXglyph { bitmap_offset: 214, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x54 'T'
    GFXglyph { bitmap_offset: 219, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x55 'U'
    GFXglyph { bitmap_offset: 223, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x56 'V'
    GFXglyph { bitmap_offset: 227, width: 6, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x57 'W'
    GFXglyph { bitmap_offset: 233, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x58 'X'
    GFXglyph { bitmap_offset: 237, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x59 'Y'
    GFXglyph { bitmap_offset: 242, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x5A 'Z'
    GFXglyph { bitmap_offset: 246, width: 3, height: 11, x_advance: 6, x_offset:  1, y_offset:  -8 }, // 0x5B '['
    GFXglyph { bitmap_offset: 251, width: 4, height: 11, x_advance: 6, x_offset:  1, y_offset:  -9 }, // 0x5C '\'
    GFXglyph { bitmap_offset: 257, width: 3, height: 11, x_advance: 6, x_offset:  2, y_offset:  -8 }, // 0x5D ']'
    GFXglyph { bitmap_offset: 262, width: 4, height:  4, x_advance: 6, x_offset:  1, y_offset:  -6 }, // 0x5E '^'
    GFXglyph { bitmap_offset: 264, width: 4, height:  1, x_advance: 6, x_offset:  1, y_offset:   2 }, // 0x5F '_'
    GFXglyph { bitmap_offset: 265, width: 2, height:  3, x_advance: 6, x_offset:  2, y_offset:  -8 }, // 0x60 '`'
    GFXglyph { bitmap_offset: 266, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x61 'a'
    GFXglyph { bitmap_offset: 269, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x62 'b'
    GFXglyph { bitmap_offset: 273, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x63 'c'
    GFXglyph { bitmap_offset: 276, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x64 'd'
    GFXglyph { bitmap_offset: 280, width: 5, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x65 'e'
    GFXglyph { bitmap_offset: 284, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x66 'f'
    GFXglyph { bitmap_offset: 289, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x67 'g'
    GFXglyph { bitmap_offset: 293, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x68 'h'
    GFXglyph { bitmap_offset: 297, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x69 'i'
    GFXglyph { bitmap_offset: 302, width: 4, height: 10, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x6A 'j'
    GFXglyph { bitmap_offset: 307, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -7 }, // 0x6B 'k'
    GFXglyph { bitmap_offset: 311, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x6C 'l'
    GFXglyph { bitmap_offset: 316, width: 5, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x6D 'm'
    GFXglyph { bitmap_offset: 320, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x6E 'n'
    GFXglyph { bitmap_offset: 323, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x6F 'o'
    GFXglyph { bitmap_offset: 326, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x70 'p'
    GFXglyph { bitmap_offset: 330, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x71 'q'
    GFXglyph { bitmap_offset: 334, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x72 'r'
    GFXglyph { bitmap_offset: 337, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x73 's'
    GFXglyph { bitmap_offset: 340, width: 5, height:  8, x_advance: 6, x_offset:  0, y_offset:  -7 }, // 0x74 't'
    GFXglyph { bitmap_offset: 345, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x75 'u'
    GFXglyph { bitmap_offset: 348, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x76 'v'
    GFXglyph { bitmap_offset: 351, width: 6, height:  6, x_advance: 6, x_offset:  0, y_offset:  -5 }, // 0x77 'w'
    GFXglyph { bitmap_offset: 356, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x78 'x'
    GFXglyph { bitmap_offset: 359, width: 4, height:  8, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x79 'y'
    GFXglyph { bitmap_offset: 363, width: 4, height:  6, x_advance: 6, x_offset:  1, y_offset:  -5 }, // 0x7A 'z'
    GFXglyph { bitmap_offset: 366, width: 5, height: 11, x_advance: 6, x_offset:  0, y_offset:  -8 }, // 0x7B '{'
    GFXglyph { bitmap_offset: 373, width: 1, height: 10, x_advance: 6, x_offset:  2, y_offset:  -8 }, // 0x7C '|'
    GFXglyph { bitmap_offset: 375, width: 5, height: 11, x_advance: 6, x_offset:  1, y_offset:  -8 }, // 0x7D '}'
    GFXglyph { bitmap_offset: 382, width: 5, height:  2, x_advance: 6, x_offset:  1, y_offset:  -4 }, // 0x7E '~'
];

pub static FONT_SMALL: GFXfont = GFXfont {
    bitmap: &FONT_SMALL_BITMAPS,
    glyph: &FONT_SMALL_GLYPHS,
    first: 0x20,
    last: 0x7E,
    y_advance: 13,
};
