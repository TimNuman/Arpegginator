// oled_display.rs — palette roles and font ladder for the memory-LCD UI

use crate::oled_gfx::*;

// Fonts. One family, three sizes on an exact 2x ladder, so the whole UI shares
// stem weights and letterforms. There is no bold: at this scale a 2px stem
// against a 1px stem reads as blurry rather than heavy, so emphasis comes from
// size or inversion instead.
pub use crate::oled_fonts::SPLEEN_5X8 as FONT_SMALL; // field labels
pub use crate::oled_fonts::SPLEEN_8X16 as FONT_MEDIUM; // buttons, title bar
pub use crate::oled_fonts::SPLEEN_8X16 as FONT_VALUE; // parameter values
pub use crate::oled_fonts::SPLEEN_12X24 as FONT_LARGE; // emphasized values
pub use crate::oled_fonts::SPLEEN_16X32 as FONT_COF; // key letter in the dial
pub use crate::oled_fonts::SPLEEN_16X32 as FONT_XLARGE; // hero readout

// ============ Color indices ============

pub const OLED_CYAN: u8 = 0;
pub const OLED_YELLOW: u8 = 1;
pub const OLED_RED: u8 = 2;
pub const OLED_WHITE: u8 = 3;
pub const OLED_DIM: u8 = 4;
pub const OLED_PINK: u8 = 5;
pub const OLED_BLUE: u8 = 6;

// ============ Color lookup ============

// Everything structural is ink on paper; the indices that used to carry hue
// now resolve to ink, and the axis colors are handed out only by the button
// row and whatever the held modifier is pointing at.
static COLOR_TABLE: [u16; 7] = [
    GFX_INK,      // 0: OLED_CYAN
    GFX_AXIS_UD,  // 1: OLED_YELLOW
    GFX_AXIS_LR,  // 2: OLED_RED
    GFX_INK,      // 3: OLED_WHITE
    GFX_INK,      // 4: OLED_DIM
    GFX_AXIS_LR,  // 5: OLED_PINK
    GFX_AXIS_GRID, // 6: OLED_BLUE
];

pub fn color_lookup(idx: u8) -> u16 {
    COLOR_TABLE.get(idx as usize).copied().unwrap_or(GFX_INK)
}

// ============ Init ============

pub fn oled_init() {
    gfx_init();
}
