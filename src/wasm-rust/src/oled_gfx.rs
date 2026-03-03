// oled_gfx.rs — Minimal RGB565 framebuffer graphics library
// Inspired by Adafruit GFX but pure Rust, no dependencies

// ============ Font structures (Adafruit GFX compatible) ============

#[derive(Clone, Copy)]
pub struct GFXglyph {
    pub bitmap_offset: u16,
    pub width: u8,
    pub height: u8,
    pub x_advance: u8,
    pub x_offset: i8,
    pub y_offset: i8,
}

pub struct GFXfont {
    pub bitmap: &'static [u8],
    pub glyph: &'static [GFXglyph],
    pub first: u16,
    pub last: u16,
    pub y_advance: u8,
}

// ============ Framebuffer ============

pub const GFX_WIDTH: usize = 160;
pub const GFX_HEIGHT: usize = 128;

// RGB565 color helper
pub const fn gfx_rgb565(r: u8, g: u8, b: u8) -> u16 {
    ((r as u16 & 0xF8) << 8) | ((g as u16 & 0xFC) << 3) | ((b as u16 & 0xF8) >> 3)
}

pub const GFX_BLACK: u16 = 0x0000;
pub const GFX_WHITE: u16 = gfx_rgb565(255, 255, 255);
pub const GFX_CYAN: u16 = gfx_rgb565(0, 255, 255);
pub const GFX_YELLOW: u16 = gfx_rgb565(255, 255, 0);
pub const GFX_RED: u16 = gfx_rgb565(255, 85, 85);
pub const GFX_DIM: u16 = gfx_rgb565(0, 128, 128);

static mut FRAMEBUFFER: [u16; GFX_WIDTH * GFX_HEIGHT] = [0; GFX_WIDTH * GFX_HEIGHT];

// ============ API ============

pub fn gfx_init() {
    unsafe {
        FRAMEBUFFER.iter_mut().for_each(|p| *p = 0);
    }
}

pub fn gfx_clear(color: u16) {
    unsafe {
        FRAMEBUFFER.iter_mut().for_each(|p| *p = color);
    }
}

pub fn gfx_pixel(x: i16, y: i16, color: u16) {
    if x >= 0 && x < GFX_WIDTH as i16 && y >= 0 && y < GFX_HEIGHT as i16 {
        unsafe {
            FRAMEBUFFER[y as usize * GFX_WIDTH + x as usize] = color;
        }
    }
}

pub fn gfx_hline(x: i16, y: i16, w: i16, color: u16) {
    if y < 0 || y >= GFX_HEIGHT as i16 || w <= 0 {
        return;
    }
    let mut x = x;
    let mut w = w;
    if x < 0 {
        w += x;
        x = 0;
    }
    if x + w > GFX_WIDTH as i16 {
        w = GFX_WIDTH as i16 - x;
    }
    if w <= 0 {
        return;
    }
    let start = y as usize * GFX_WIDTH + x as usize;
    unsafe {
        FRAMEBUFFER[start..start + w as usize]
            .iter_mut()
            .for_each(|p| *p = color);
    }
}

pub fn gfx_vline(x: i16, y: i16, h: i16, color: u16) {
    if x < 0 || x >= GFX_WIDTH as i16 || h <= 0 {
        return;
    }
    let mut y = y;
    let mut h = h;
    if y < 0 {
        h += y;
        y = 0;
    }
    if y + h > GFX_HEIGHT as i16 {
        h = GFX_HEIGHT as i16 - y;
    }
    if h <= 0 {
        return;
    }
    unsafe {
        (0..h as usize).for_each(|i| {
            FRAMEBUFFER[(y as usize + i) * GFX_WIDTH + x as usize] = color;
        });
    }
}

/// Bresenham's line algorithm
pub fn gfx_line(x0: i16, y0: i16, x1: i16, y1: i16, color: u16) {
    let dx = (x1 - x0).abs();
    let dy = -(y1 - y0).abs();
    let sx: i16 = if x0 < x1 { 1 } else { -1 };
    let sy: i16 = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    let mut cx = x0;
    let mut cy = y0;

    loop {
        gfx_pixel(cx, cy, color);
        if cx == x1 && cy == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            cx += sx;
        }
        if e2 <= dx {
            err += dx;
            cy += sy;
        }
    }
}

pub fn gfx_rect(x: i16, y: i16, w: i16, h: i16, color: u16) {
    gfx_hline(x, y, w, color);
    gfx_hline(x, y + h - 1, w, color);
    gfx_vline(x, y, h, color);
    gfx_vline(x + w - 1, y, h, color);
}

pub fn gfx_fill_rect(x: i16, y: i16, w: i16, h: i16, color: u16) {
    (y..y + h).for_each(|row| {
        gfx_hline(x, row, w, color);
    });
}

// ============ Text rendering (Adafruit GFX font format) ============

fn gfx_draw_char(x: i16, y: i16, c: u8, color: u16, font: &GFXfont) {
    if (c as u16) < font.first || (c as u16) > font.last {
        return;
    }

    let glyph = &font.glyph[(c as u16 - font.first) as usize];
    let w = glyph.width;
    let h = glyph.height;
    let xo = glyph.x_offset;
    let yo = glyph.y_offset;
    let mut bo = glyph.bitmap_offset as usize;

    let mut bits: u8 = 0;
    let mut bit: u8 = 0;

    (0..h).for_each(|yy| {
        (0..w).for_each(|xx| {
            if (bit & 7) == 0 {
                bits = font.bitmap[bo];
                bo += 1;
            }
            bit += 1;
            if bits & 0x80 != 0 {
                gfx_pixel(
                    x + xo as i16 + xx as i16,
                    y + yo as i16 + yy as i16,
                    color,
                );
            }
            bits <<= 1;
        });
    });
}

pub fn gfx_text(x: i16, y: i16, s: &str, color: u16, font: &GFXfont) {
    let mut cx = x;
    s.bytes().for_each(|ch| {
        if ch as u16 >= font.first && ch as u16 <= font.last {
            gfx_draw_char(cx, y, ch, color, font);
            cx += font.glyph[(ch as u16 - font.first) as usize].x_advance as i16;
        }
    });
}

pub fn gfx_text_width(s: &str, font: &GFXfont) -> i16 {
    s.bytes()
        .filter(|&ch| ch as u16 >= font.first && ch as u16 <= font.last)
        .map(|ch| font.glyph[(ch as u16 - font.first) as usize].x_advance as i16)
        .sum()
}

pub fn gfx_font_height(font: &GFXfont) -> i16 {
    font.y_advance as i16
}

pub fn gfx_get_framebuffer() -> *mut u16 {
    unsafe { FRAMEBUFFER.as_mut_ptr() }
}
