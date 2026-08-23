// oled_gfx.rs — RGB565 framebuffer graphics for a 1-bit-per-channel panel
//
// The framebuffer stays RGB565 so the browser blit and the Teensy path are
// unchanged, but every color written is one of the eight the JDI LPM027M128C
// can actually show. There is no blending here on purpose: with 1 bit per
// channel there is no tone between ink and ground, so shading is ordered
// dither and emphasis is a filled slab.

use crate::cell::Global;

// ============ Bitmap font structures ============

/// One glyph, packed 1 bit per pixel, row-major, MSB first, `ceil(width/8)`
/// bytes per row. `y_offset` is measured from the top of the text line, so the
/// renderer never needs the font ascent.
#[derive(Clone, Copy)]
pub struct BitGlyph {
    pub offset: u16,
    pub width: u8,
    pub height: u8,
    pub x_advance: u8,
    pub x_offset: i8,
    pub y_offset: i8,
}

pub struct BitFont {
    pub bits: &'static [u8],
    pub glyphs: &'static [BitGlyph],
    pub first: u16,
    pub last: u16,
    pub y_advance: u8,
}

// ============ Framebuffer ============

// The module mounts on its side, so the buffer is portrait-native and every
// primitive above it is authored in portrait. A driver pushing this to the
// panel transposes on the way out — the panel's line order is fixed in
// silicon, the coordinate system the UI is drawn in is not.
pub const GFX_WIDTH: usize = 240;
pub const GFX_HEIGHT: usize = 320;

pub const fn gfx_rgb565(r: u8, g: u8, b: u8) -> u16 {
    ((r as u16 & 0xF8) << 8) | ((g as u16 & 0xFC) << 3) | ((b as u16 & 0xF8) >> 3)
}

// The panel's entire palette — 1 bit per channel, no in-between.
pub const GFX_BLACK: u16 = gfx_rgb565(0, 0, 0);
pub const GFX_WHITE: u16 = gfx_rgb565(255, 255, 255);
pub const GFX_RED: u16 = gfx_rgb565(255, 0, 0);
pub const GFX_GREEN: u16 = gfx_rgb565(0, 255, 0);
pub const GFX_BLUE: u16 = gfx_rgb565(0, 0, 255);
pub const GFX_YELLOW: u16 = gfx_rgb565(255, 255, 0);
pub const GFX_MAGENTA: u16 = gfx_rgb565(255, 0, 255);
pub const GFX_CYAN: u16 = gfx_rgb565(0, 255, 255);

// Semantic roles. Reflective panels are paper: ground is white, ink is black.
pub const GFX_GROUND: u16 = GFX_WHITE;
pub const GFX_INK: u16 = GFX_BLACK;
pub const GFX_LABEL: u16 = GFX_BLACK;
pub const GFX_VALUE: u16 = GFX_BLACK;
/// Color is reserved for live modifier state — never for structure.
pub const GFX_AXIS_GRID: u16 = GFX_BLUE;
pub const GFX_AXIS_UD: u16 = GFX_YELLOW;
pub const GFX_AXIS_LR: u16 = GFX_MAGENTA;
pub const GFX_ALERT: u16 = GFX_RED;
pub const GFX_PINK: u16 = GFX_MAGENTA;
pub const GFX_DIM: u16 = GFX_BLACK;

/// Ink that reads on a given fill: white on the dark hues, black on the light.
pub const fn gfx_ink_on(fill: u16) -> u16 {
    match fill {
        GFX_BLUE | GFX_MAGENTA | GFX_RED | GFX_BLACK => GFX_WHITE,
        _ => GFX_BLACK,
    }
}

static FRAMEBUFFER: Global<[u16; GFX_WIDTH * GFX_HEIGHT]> =
    Global::new([0; GFX_WIDTH * GFX_HEIGHT]);

// ============ Core pixel operations ============

pub fn gfx_init() {
    gfx_clear(GFX_GROUND);
}

pub fn gfx_clear(color: u16) {
    FRAMEBUFFER.get_mut().iter_mut().for_each(|p| *p = color);
}

#[inline(always)]
pub fn gfx_pixel(x: i16, y: i16, color: u16) {
    if x >= 0 && x < GFX_WIDTH as i16 && y >= 0 && y < GFX_HEIGHT as i16 {
        FRAMEBUFFER.get_mut()[y as usize * GFX_WIDTH + x as usize] = color;
    }
}

// ============ Lines and rectangles ============

pub fn gfx_hline(x: i16, y: i16, w: i16, color: u16) {
    if y < 0 || y >= GFX_HEIGHT as i16 || w <= 0 {
        return;
    }
    let x0 = x.max(0);
    let x1 = (x + w).min(GFX_WIDTH as i16);
    if x1 <= x0 {
        return;
    }
    let row = y as usize * GFX_WIDTH;
    let fb = FRAMEBUFFER.get_mut();
    (x0..x1).for_each(|px| fb[row + px as usize] = color);
}

pub fn gfx_vline(x: i16, y: i16, h: i16, color: u16) {
    if x < 0 || x >= GFX_WIDTH as i16 || h <= 0 {
        return;
    }
    let y0 = y.max(0);
    let y1 = (y + h).min(GFX_HEIGHT as i16);
    let fb = FRAMEBUFFER.get_mut();
    (y0..y1).for_each(|py| fb[py as usize * GFX_WIDTH + x as usize] = color);
}

pub fn gfx_fill_rect(x: i16, y: i16, w: i16, h: i16, color: u16) {
    (0..h).for_each(|row| gfx_hline(x, y + row, w, color));
}

/// 1px outline
pub fn gfx_frame(x: i16, y: i16, w: i16, h: i16, color: u16) {
    if w <= 0 || h <= 0 {
        return;
    }
    gfx_hline(x, y, w, color);
    gfx_hline(x, y + h - 1, w, color);
    gfx_vline(x, y, h, color);
    gfx_vline(x + w - 1, y, h, color);
}

/// Bresenham, 1px, no anti-aliasing — there is nothing to anti-alias with.
pub fn gfx_line(x0: i16, y0: i16, x1: i16, y1: i16, color: u16) {
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let sy = if y0 < y1 { 1 } else { -1 };
    let (mut x, mut y) = (x0, y0);
    let mut err = dx + dy;
    loop {
        gfx_pixel(x, y, color);
        if x == x1 && y == y1 {
            break;
        }
        let e2 = err * 2;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
    }
}

/// Midpoint circle, 1px outline.
pub fn gfx_circle(cx: i16, cy: i16, r: i16, color: u16) {
    let (mut x, mut y) = (r, 0i16);
    let mut err = 1 - r;
    while x >= y {
        [
            (cx + x, cy + y), (cx - x, cy + y), (cx + x, cy - y), (cx - x, cy - y),
            (cx + y, cy + x), (cx - y, cy + x), (cx + y, cy - x), (cx - y, cy - x),
        ]
        .iter()
        .for_each(|&(px, py)| gfx_pixel(px, py, color));
        y += 1;
        if err < 0 {
            err += 2 * y + 1;
        } else {
            x -= 1;
            err += 2 * (y - x) + 1;
        }
    }
}

// ============ Ordered dither ============

/// 4x4 Bayer matrix — the only "grey" this panel has.
const BAYER: [[u8; 4]; 4] = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
];

/// Fill a rect with `level`/16 ink coverage. Aligned to screen coordinates so
/// adjacent patches tile continuously. Areas only — never glyphs or 1px rules,
/// where a broken-up stem reads as a rendering fault.
pub fn gfx_dither_rect(x: i16, y: i16, w: i16, h: i16, level: u8, ink: u16, ground: u16) {
    (0..h).for_each(|row| {
        let py = y + row;
        (0..w).for_each(|col| {
            let px = x + col;
            let threshold = BAYER[(py & 3) as usize][(px & 3) as usize];
            gfx_pixel(px, py, if threshold < level { ink } else { ground });
        });
    });
}

// ============ Bitmap text rendering ============

#[inline]
fn glyph_for(font: &BitFont, ch: u8) -> Option<&BitGlyph> {
    if (ch as u16) < font.first || (ch as u16) > font.last {
        return None;
    }
    font.glyphs.get((ch as u16 - font.first) as usize)
}

/// Draw one glyph. `y` is the top of the text line.
fn gfx_draw_glyph(x: i16, y: i16, glyph: &BitGlyph, font: &BitFont, color: u16, clip: (i16, i16)) {
    let w = glyph.width as usize;
    let h = glyph.height as usize;
    let stride = (w + 7) / 8;
    let base = glyph.offset as usize;
    let xo = x + glyph.x_offset as i16;
    let yo = y + glyph.y_offset as i16;

    (0..h).for_each(|row| {
        let row_base = base + row * stride;
        (0..w).for_each(|col| {
            let byte = match font.bits.get(row_base + col / 8) {
                Some(b) => *b,
                None => return,
            };
            if byte & (0x80 >> (col % 8)) != 0 {
                let px = xo + col as i16;
                if px >= clip.0 && px < clip.1 {
                    gfx_pixel(px, yo + row as i16, color);
                }
            }
        });
    });
}

/// Draw text with horizontal clipping — only pixels in [clip_left, clip_right) land.
pub fn gfx_text_clipped(
    x: i16,
    y: i16,
    s: &str,
    color: u16,
    font: &BitFont,
    clip_left: i16,
    clip_right: i16,
) {
    let mut cx = x;
    s.bytes().for_each(|ch| {
        if let Some(glyph) = glyph_for(font, ch) {
            let adv = glyph.x_advance as i16;
            if cx + adv > clip_left && cx < clip_right {
                gfx_draw_glyph(cx, y, glyph, font, color, (clip_left, clip_right));
            }
            cx += adv;
        }
    });
}

pub fn gfx_text(x: i16, y: i16, s: &str, color: u16, font: &BitFont) {
    let mut cx = x;
    s.bytes().for_each(|ch| {
        if let Some(glyph) = glyph_for(font, ch) {
            gfx_draw_glyph(cx, y, glyph, font, color, (i16::MIN, i16::MAX));
            cx += glyph.x_advance as i16;
        }
    });
}

pub fn gfx_text_width(s: &str, font: &BitFont) -> i16 {
    s.bytes()
        .filter_map(|ch| glyph_for(font, ch))
        .map(|g| g.x_advance as i16)
        .sum()
}

pub fn gfx_font_height(font: &BitFont) -> i16 {
    font.y_advance as i16
}

/// Right-aligned; returns the x where the text started.
pub fn gfx_text_right(right_x: i16, y: i16, s: &str, color: u16, font: &BitFont) -> i16 {
    let x = right_x - gfx_text_width(s, font);
    gfx_text(x, y, s, color, font);
    x
}

/// Centered; returns the x where the text started.
pub fn gfx_text_center(center_x: i16, y: i16, s: &str, color: u16, font: &BitFont) -> i16 {
    let x = center_x - gfx_text_width(s, font) / 2;
    gfx_text(x, y, s, color, font);
    x
}

// ============ Framebuffer access ============

pub fn gfx_get_framebuffer() -> *mut u16 {
    FRAMEBUFFER.as_ptr() as *mut u16
}
