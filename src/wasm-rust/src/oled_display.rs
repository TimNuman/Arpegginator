// oled_display.rs — OLED display constants and color/font lookup

use crate::oled_gfx::*;
use crate::oled_fonts_aa::*;

// ============ Color indices ============

pub const OLED_CYAN: u8 = 0;
pub const OLED_YELLOW: u8 = 1;
pub const OLED_RED: u8 = 2;
pub const OLED_WHITE: u8 = 3;
pub const OLED_DIM: u8 = 4;
pub const OLED_PINK: u8 = 5;
pub const OLED_BLUE: u8 = 6;

// ============ AA Font indices ============

pub const OLED_AA_SMALL: u8 = 0;
pub const OLED_AA_MEDIUM: u8 = 1;
pub const OLED_AA_LARGE: u8 = 2;
pub const OLED_AA_XLARGE: u8 = 3;

// ============ Color lookup ============

static COLOR_TABLE: [u16; 7] = [
    GFX_CYAN,   // 0: OLED_CYAN
    GFX_YELLOW, // 1: OLED_YELLOW
    GFX_RED,    // 2: OLED_RED
    GFX_WHITE,  // 3: OLED_WHITE
    GFX_DIM,    // 4: OLED_DIM
    GFX_PINK,   // 5: OLED_PINK
    GFX_BLUE,   // 6: OLED_BLUE
];

pub fn color_lookup(idx: u8) -> u16 {
    COLOR_TABLE
        .get(idx as usize)
        .copied()
        .unwrap_or(GFX_CYAN)
}

// ============ Font lookup ============

pub fn aa_font_lookup(idx: u8) -> &'static AAFont {
    match idx {
        OLED_AA_MEDIUM => &FONT_AA_MEDIUM,
        OLED_AA_LARGE => &FONT_AA_LARGE,
        OLED_AA_XLARGE => &FONT_AA_XLARGE,
        _ => &FONT_AA_SMALL,
    }
}

// ============ Init ============

pub fn oled_init() {
    gfx_init();
}
