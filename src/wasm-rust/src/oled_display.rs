// oled_display.rs — OLED display API with color/font indices
// Wraps oled_gfx with color/font index lookups and WASM-exported API

use crate::oled_gfx::*;
use crate::oled_fonts::*;

// ============ Color indices (passed from JS) ============

pub const OLED_CYAN: u8 = 0;
pub const OLED_YELLOW: u8 = 1;
pub const OLED_RED: u8 = 2;
pub const OLED_WHITE: u8 = 3;
pub const OLED_DIM: u8 = 4;

// ============ Font indices (passed from JS) ============

pub const OLED_FONT_MAIN: u8 = 0;
pub const OLED_FONT_SMALL: u8 = 1;

// ============ Color lookup ============

static COLOR_TABLE: [u16; 5] = [
    GFX_CYAN,   // 0: OLED_CYAN
    GFX_YELLOW, // 1: OLED_YELLOW
    GFX_RED,    // 2: OLED_RED
    GFX_WHITE,  // 3: OLED_WHITE
    GFX_DIM,    // 4: OLED_DIM
];

pub fn color_lookup(idx: u8) -> u16 {
    COLOR_TABLE
        .get(idx as usize)
        .copied()
        .unwrap_or(GFX_CYAN)
}

// ============ Font lookup ============

pub fn font_lookup(idx: u8) -> &'static GFXfont {
    match idx {
        OLED_FONT_SMALL => &FONT_SMALL,
        _ => &FONT_MAIN,
    }
}

// ============ API ============

pub fn oled_init() {
    gfx_init();
}

pub fn oled_clear() {
    gfx_clear(GFX_BLACK);
}

pub fn oled_draw_text(x: i16, y: i16, text: &str, color_idx: u8, font_idx: u8) {
    gfx_text(x, y, text, color_lookup(color_idx), font_lookup(font_idx));
}

pub fn oled_draw_hline(x: i16, y: i16, w: i16, color_idx: u8) {
    gfx_hline(x, y, w, color_lookup(color_idx));
}

pub fn oled_draw_vline(x: i16, y: i16, h: i16, color_idx: u8) {
    gfx_vline(x, y, h, color_lookup(color_idx));
}

pub fn oled_draw_line(x0: i16, y0: i16, x1: i16, y1: i16, color_idx: u8) {
    gfx_line(x0, y0, x1, y1, color_lookup(color_idx));
}

pub fn oled_draw_rect(x: i16, y: i16, w: i16, h: i16, color_idx: u8) {
    gfx_rect(x, y, w, h, color_lookup(color_idx));
}

pub fn oled_fill_rect(x: i16, y: i16, w: i16, h: i16, color_idx: u8) {
    gfx_fill_rect(x, y, w, h, color_lookup(color_idx));
}

pub fn oled_draw_pixel(x: i16, y: i16, color_idx: u8) {
    gfx_pixel(x, y, color_lookup(color_idx));
}

pub fn oled_text_width(text: &str, font_idx: u8) -> i16 {
    gfx_text_width(text, font_lookup(font_idx))
}

pub fn oled_font_height(font_idx: u8) -> i16 {
    gfx_font_height(font_lookup(font_idx))
}

pub fn oled_get_framebuffer() -> *mut u16 {
    gfx_get_framebuffer()
}

pub fn oled_get_framebuffer_size() -> u32 {
    (GFX_WIDTH * GFX_HEIGHT * core::mem::size_of::<u16>()) as u32
}
