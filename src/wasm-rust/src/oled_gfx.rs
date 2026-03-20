// oled_gfx.rs — RGB565 framebuffer graphics library with anti-aliased rendering
// Supports both legacy bitmap fonts (Adafruit GFX) and pre-rasterized AA fonts

// ============ Legacy font structures (Adafruit GFX compatible) ============

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

// ============ Anti-aliased font structures ============

#[derive(Clone, Copy)]
pub struct AAGlyph {
    pub coverage_offset: u16,
    pub width: u8,
    pub height: u8,
    pub x_advance: u8,
    pub x_offset: i8,
    pub y_offset: i8,
}

pub struct AAFont {
    pub coverage: &'static [u8], // alpha/coverage values (0-255 per pixel)
    pub glyphs: &'static [AAGlyph],
    pub first: u16,
    pub last: u16,
    pub y_advance: u8,
}

// ============ Framebuffer ============

pub const GFX_WIDTH: usize = 256;
pub const GFX_HEIGHT: usize = 128;

// RGB565 color helper
pub const fn gfx_rgb565(r: u8, g: u8, b: u8) -> u16 {
    ((r as u16 & 0xF8) << 8) | ((g as u16 & 0xFC) << 3) | ((b as u16 & 0xF8) >> 3)
}

pub const GFX_BLACK: u16 = gfx_rgb565(0x0C, 0x1B, 0x3A);    // bg
pub const GFX_WHITE: u16 = gfx_rgb565(255, 255, 255);
pub const GFX_CYAN: u16 = gfx_rgb565(0, 255, 255);
pub const GFX_YELLOW: u16 = gfx_rgb565(0xFF, 0xDD, 0x00);   // up/down arrows
pub const GFX_RED: u16 = gfx_rgb565(0xFF, 0x00, 0x7B);      // left/right arrows
pub const GFX_DIM: u16 = gfx_rgb565(0x57, 0x60, 0x81);      // muted icons
pub const GFX_PINK: u16 = gfx_rgb565(0xFF, 0x00, 0x7B);     // alias for red
pub const GFX_BLUE: u16 = gfx_rgb565(0xC4, 0xC5, 0xEB);     // grid button color
pub const GFX_LABEL: u16 = gfx_rgb565(0x79, 0x7F, 0xA2);    // label text
pub const GFX_VALUE: u16 = gfx_rgb565(0xC4, 0xC5, 0xEB);    // value text

static mut FRAMEBUFFER: [u16; GFX_WIDTH * GFX_HEIGHT] = [0; GFX_WIDTH * GFX_HEIGHT];

// ============ Core pixel operations ============

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

#[inline(always)]
pub fn gfx_pixel(x: i16, y: i16, color: u16) {
    if x >= 0 && x < GFX_WIDTH as i16 && y >= 0 && y < GFX_HEIGHT as i16 {
        unsafe {
            FRAMEBUFFER[y as usize * GFX_WIDTH + x as usize] = color;
        }
    }
}

/// Read a pixel from the framebuffer
#[inline(always)]
fn gfx_read_pixel(x: i16, y: i16) -> u16 {
    if x >= 0 && x < GFX_WIDTH as i16 && y >= 0 && y < GFX_HEIGHT as i16 {
        unsafe { FRAMEBUFFER[y as usize * GFX_WIDTH + x as usize] }
    } else {
        GFX_BLACK
    }
}

// ============ RGB565 color utilities ============

/// Extract R5, G6, B5 components from RGB565
#[inline(always)]
const fn rgb565_components(c: u16) -> (u8, u8, u8) {
    (
        ((c >> 11) & 0x1F) as u8,
        ((c >> 5) & 0x3F) as u8,
        (c & 0x1F) as u8,
    )
}

/// Pack R5, G6, B5 components into RGB565
#[inline(always)]
const fn rgb565_pack(r: u8, g: u8, b: u8) -> u16 {
    ((r as u16) << 11) | ((g as u16) << 5) | (b as u16)
}

/// Blend a foreground color onto a background color with alpha (0-255)
#[inline(always)]
pub fn gfx_blend(fg: u16, bg: u16, alpha: u8) -> u16 {
    if alpha == 255 {
        return fg;
    }
    if alpha == 0 {
        return bg;
    }
    let (fr, fg_g, fb) = rgb565_components(fg);
    let (br, bg_g, bb) = rgb565_components(bg);
    let a = alpha as u16;
    let inv = 255 - a;
    let r = ((fr as u16 * a + br as u16 * inv + 128) >> 8) as u8;
    let g = ((fg_g as u16 * a + bg_g as u16 * inv + 128) >> 8) as u8;
    let b = ((fb as u16 * a + bb as u16 * inv + 128) >> 8) as u8;
    rgb565_pack(r, g, b)
}

/// Draw a pixel with alpha blending against current framebuffer
#[inline(always)]
pub fn gfx_pixel_alpha(x: i16, y: i16, color: u16, alpha: u8) {
    if alpha == 0 {
        return;
    }
    if alpha == 255 {
        gfx_pixel(x, y, color);
        return;
    }
    if x >= 0 && x < GFX_WIDTH as i16 && y >= 0 && y < GFX_HEIGHT as i16 {
        let bg = gfx_read_pixel(x, y);
        let blended = gfx_blend(color, bg, alpha);
        unsafe {
            FRAMEBUFFER[y as usize * GFX_WIDTH + x as usize] = blended;
        }
    }
}

// ============ Primitive drawing ============

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

// ============ Anti-aliased circle (Xiaolin Wu's algorithm) ============

/// Draw an anti-aliased circle outline
pub fn gfx_aa_circle(cx: i16, cy: i16, radius: i16, color: u16) {
    if radius <= 0 {
        return;
    }
    let r = radius as f32;
    let mut x = r;
    let mut y: f32 = 0.0;

    // Plot the 4 cardinal points
    plot_circle_8(cx, cy, x as i16, 0, color, 255);

    while x > y {
        y += 1.0;
        x = (r * r - y * y).sqrt();
        let xi = x as i16;
        let frac = x - xi as f32;
        let alpha_outer = (frac * 255.0) as u8;
        let alpha_inner = 255 - alpha_outer;

        plot_circle_8(cx, cy, xi + 1, y as i16, color, alpha_outer);
        plot_circle_8(cx, cy, xi, y as i16, color, alpha_inner);
    }
}

/// Draw an anti-aliased thick circle (two concentric AA circles with fill between)
pub fn gfx_aa_circle_thick(cx: i16, cy: i16, radius: i16, thickness: i16, color: u16) {
    if thickness <= 1 {
        gfx_aa_circle(cx, cy, radius, color);
        return;
    }
    let r_outer = radius;
    let r_inner = radius - thickness;

    // Draw outer AA edge
    gfx_aa_circle(cx, cy, r_outer, color);

    // Fill the ring between inner and outer
    if r_inner > 0 {
        // Draw inner AA edge
        gfx_aa_circle(cx, cy, r_inner, color);

        // Fill between the two radii (solid fill)
        let ro2 = (r_outer as i32 - 1) * (r_outer as i32 - 1);
        let ri2 = (r_inner as i32 + 1) * (r_inner as i32 + 1);
        (-r_outer..=r_outer).for_each(|dy| {
            (-r_outer..=r_outer).for_each(|dx| {
                let d2 = (dx as i32) * (dx as i32) + (dy as i32) * (dy as i32);
                if d2 <= ro2 && d2 >= ri2 {
                    gfx_pixel(cx + dx as i16, cy + dy as i16, color);
                }
            });
        });
    } else {
        // Fill solid circle
        gfx_fill_circle(cx, cy, r_outer, color);
    }
}

/// Fill a solid circle
pub fn gfx_fill_circle(cx: i16, cy: i16, radius: i16, color: u16) {
    let r = radius as i32;
    (-r..=r).for_each(|dy| {
        let dx = ((r * r - dy * dy) as f32).sqrt() as i16;
        gfx_hline(cx - dx, cy + dy as i16, dx * 2 + 1, color);
    });
}

/// Plot 8-way symmetric points for circle drawing
fn plot_circle_8(cx: i16, cy: i16, x: i16, y: i16, color: u16, alpha: u8) {
    gfx_pixel_alpha(cx + x, cy + y, color, alpha);
    gfx_pixel_alpha(cx - x, cy + y, color, alpha);
    gfx_pixel_alpha(cx + x, cy - y, color, alpha);
    gfx_pixel_alpha(cx - x, cy - y, color, alpha);
    gfx_pixel_alpha(cx + y, cy + x, color, alpha);
    gfx_pixel_alpha(cx - y, cy + x, color, alpha);
    gfx_pixel_alpha(cx + y, cy - x, color, alpha);
    gfx_pixel_alpha(cx - y, cy - x, color, alpha);
}

/// Draw an anti-aliased arc (angle in degrees, 0 = top, clockwise)
pub fn gfx_aa_arc(cx: i16, cy: i16, radius: i16, thickness: i16, start_deg: i16, end_deg: i16, color: u16) {
    if radius <= 0 || thickness <= 0 {
        return;
    }
    let r_outer = radius as f32;
    let r_inner = (radius - thickness) as f32;
    let r_mid = (r_outer + r_inner) / 2.0;
    let half_thick = (r_outer - r_inner) / 2.0;

    // Normalize angles
    let start = start_deg as f32;
    let end = end_deg as f32;

    let bounds = radius + 1;
    (-bounds..=bounds).for_each(|dy| {
        (-bounds..=bounds).for_each(|dx| {
            let px = dx as f32;
            let py = dy as f32;
            let dist = (px * px + py * py).sqrt();

            if dist < r_inner - 1.0 || dist > r_outer + 1.0 {
                return;
            }

            // Check angle (0 = top, clockwise)
            let mut angle = (px.atan2(-py)).to_degrees();
            if angle < 0.0 {
                angle += 360.0;
            }

            let in_arc = if start <= end {
                angle >= start && angle <= end
            } else {
                angle >= start || angle <= end
            };

            if !in_arc {
                return;
            }

            // Distance from the ring center line
            let ring_dist = (dist - r_mid).abs();
            if ring_dist <= half_thick + 1.0 {
                let alpha = if ring_dist <= half_thick - 0.5 {
                    255u8
                } else if ring_dist <= half_thick + 0.5 {
                    ((half_thick + 0.5 - ring_dist) * 255.0) as u8
                } else {
                    0u8
                };
                if alpha > 0 {
                    gfx_pixel_alpha(cx + dx as i16, cy + dy as i16, color, alpha);
                }
            }
        });
    });
}

// ============ Filled rounded rectangle ============

pub fn gfx_fill_rounded_rect(x: i16, y: i16, w: i16, h: i16, r: i16, color: u16) {
    // Fill center
    gfx_fill_rect(x + r, y, w - 2 * r, h, color);
    // Fill left/right strips
    gfx_fill_rect(x, y + r, r, h - 2 * r, color);
    gfx_fill_rect(x + w - r, y + r, r, h - 2 * r, color);
    // Fill corners
    let ri = r as i32;
    (0..r).for_each(|dy| {
        let dx = ((ri * ri - (dy as i32) * (dy as i32)) as f32).sqrt() as i16;
        // Top-left
        gfx_hline(x + r - dx, y + r - dy, dx, color);
        // Top-right
        gfx_hline(x + w - r, y + r - dy, dx, color);
        // Bottom-left
        gfx_hline(x + r - dx, y + h - r - 1 + dy, dx, color);
        // Bottom-right
        gfx_hline(x + w - r, y + h - r - 1 + dy, dx, color);
    });
}

// ============ Legacy text rendering (Adafruit GFX bitmap fonts) ============

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

/// Draw text right-aligned
pub fn gfx_text_right(right_x: i16, y: i16, s: &str, color: u16, font: &GFXfont) -> i16 {
    let w = gfx_text_width(s, font);
    let x = right_x - w;
    gfx_text(x, y, s, color, font);
    x
}

// ============ Anti-aliased text rendering ============

fn gfx_draw_char_aa(x: i16, y: i16, c: u8, color: u16, font: &AAFont) {
    if (c as u16) < font.first || (c as u16) > font.last {
        return;
    }

    let glyph = &font.glyphs[(c as u16 - font.first) as usize];
    let w = glyph.width as usize;
    let h = glyph.height as usize;
    let xo = glyph.x_offset as i16;
    let yo = glyph.y_offset as i16;
    let offset = glyph.coverage_offset as usize;

    (0..h).for_each(|row| {
        (0..w).for_each(|col| {
            let alpha = font.coverage[offset + row * w + col];
            if alpha > 0 {
                gfx_pixel_alpha(
                    x + xo + col as i16,
                    y + yo + row as i16,
                    color,
                    alpha,
                );
            }
        });
    });
}

/// Draw AA text with horizontal clipping — only pixels in [clip_left, clip_right) are drawn
pub fn gfx_aa_text_clipped(x: i16, y: i16, s: &str, color: u16, font: &AAFont, clip_left: i16, clip_right: i16) {
    let mut cx = x;
    s.bytes().for_each(|ch| {
        if ch as u16 >= font.first && ch as u16 <= font.last {
            let glyph = &font.glyphs[(ch as u16 - font.first) as usize];
            let adv = glyph.x_advance as i16;
            // Only draw if char overlaps clip region
            if cx + adv > clip_left && cx < clip_right {
                let w = glyph.width as usize;
                let h = glyph.height as usize;
                let xo = glyph.x_offset as i16;
                let yo = glyph.y_offset as i16;
                let offset = glyph.coverage_offset as usize;
                (0..h).for_each(|row| {
                    (0..w).for_each(|col| {
                        let px = cx + xo + col as i16;
                        if px >= clip_left && px < clip_right {
                            let alpha = font.coverage[offset + row * w + col];
                            if alpha > 0 {
                                gfx_pixel_alpha(px, y + yo + row as i16, color, alpha);
                            }
                        }
                    });
                });
            }
            cx += adv;
        }
    });
}

pub fn gfx_aa_text(x: i16, y: i16, s: &str, color: u16, font: &AAFont) {
    let mut cx = x;
    s.bytes().for_each(|ch| {
        if ch as u16 >= font.first && ch as u16 <= font.last {
            gfx_draw_char_aa(cx, y, ch, color, font);
            cx += font.glyphs[(ch as u16 - font.first) as usize].x_advance as i16;
        }
    });
}

pub fn gfx_aa_text_width(s: &str, font: &AAFont) -> i16 {
    s.bytes()
        .filter(|&ch| ch as u16 >= font.first && ch as u16 <= font.last)
        .map(|ch| font.glyphs[(ch as u16 - font.first) as usize].x_advance as i16)
        .sum()
}

pub fn gfx_aa_font_height(font: &AAFont) -> i16 {
    font.y_advance as i16
}

/// Draw AA text right-aligned: returns x position where text started
pub fn gfx_aa_text_right(right_x: i16, y: i16, s: &str, color: u16, font: &AAFont) -> i16 {
    let w = gfx_aa_text_width(s, font);
    let x = right_x - w;
    gfx_aa_text(x, y, s, color, font);
    x
}

/// Draw AA text centered: returns x position where text started
pub fn gfx_aa_text_center(center_x: i16, y: i16, s: &str, color: u16, font: &AAFont) -> i16 {
    let w = gfx_aa_text_width(s, font);
    let x = center_x - w / 2;
    gfx_aa_text(x, y, s, color, font);
    x
}

// ============ Framebuffer access ============

pub fn gfx_get_framebuffer() -> *mut u16 {
    unsafe { FRAMEBUFFER.as_mut_ptr() }
}
