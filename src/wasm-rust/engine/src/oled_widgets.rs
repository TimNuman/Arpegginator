// oled_widgets.rs — the summoned figures for the note editor.
//
// EditGroup in engine_core.rs pairs two parameters per modifier combo: one on
// the up/down encoder, one on left/right. So there is exactly one picture to
// draw per combo, and each has two live values and no more.
//
// Every widget screen has the same shape: a square well under the title bar,
// and beneath it two slabs filled with their own axis, each carrying its label
// and its value. There is no button bar here — on a widget screen the value is
// the legend, since a yellow slab reading STACK 4 says what the yellow encoder
// does and where it is set in one mark. What a grid press does survives as a
// hairline knocked out of the well's bottom rule, uncoloured: the grid is not
// an axis, it does not turn, and it must not compete with the two things that
// do.

use core::fmt::Write;
use libm::sqrtf;

use crate::engine_core::*;
use crate::oled_display::*;
use crate::oled_gfx::*;
use crate::oled_screen::{draw_row_two_col, ticks_to_canonical_name, ARP_STYLE_NAMES};

const DISPLAY_W: i16 = GFX_WIDTH as i16;

// The visualisation well: square, the full width less a margin.
const SQ_X: i16 = 8;
const SQ_Y: i16 = 30;
const SQ_S: i16 = 224;
const CX: i16 = SQ_X + SQ_S / 2;
const CY: i16 = SQ_Y + SQ_S / 2;

// The two live values, filling the foot of the panel.
const BLK_Y: i16 = 260;
const BLK_H: i16 = 56;
const BLK_M: i16 = 6;
const BLK_GAP: i16 = 8;
const BLK_SHADOW: i16 = 3;
const BLK_W: i16 = (DISPLAY_W - 2 * BLK_M - BLK_GAP - BLK_SHADOW) / 2;

// ============ Chrome ============

fn well() {
    gfx_frame(SQ_X, SQ_Y, SQ_S, SQ_S, GFX_INK);
}

/// What a grid press does, knocked out of the well's bottom rule the way the
/// title is knocked out of the pinstripes. Where a combo binds nothing to the
/// grid, the rule simply stays unbroken.
fn well_caption(label: &str) {
    if label.is_empty() {
        return;
    }
    const IW: i16 = 6;
    let x0 = SQ_X + 14;
    let tw = gfx_text_width(label, &FONT_SMALL);
    let by = SQ_Y + SQ_S - 1;
    gfx_fill_rect(x0 - 7, by - 6, IW + 6 + tw + 14, 13, GFX_GROUND);
    gfx_fill_rect(x0, by - 3, IW, IW, GFX_INK);
    gfx_text(x0 + IW + 6, by - 4, label, GFX_INK, &FONT_SMALL);
}

fn value_slab(i: i16, label: &str, value: &str, color: u16) {
    let x = BLK_M + i * (BLK_W + BLK_GAP);
    gfx_fill_rect(x + BLK_SHADOW, BLK_Y + BLK_SHADOW, BLK_W, BLK_H, GFX_INK);
    gfx_fill_rect(x, BLK_Y, BLK_W, BLK_H, color);
    gfx_frame(x, BLK_Y, BLK_W, BLK_H, GFX_INK);
    let ink = gfx_ink_on(color);
    gfx_text(x + 8, BLK_Y + 7, label, ink, &FONT_SMALL);
    gfx_text_right(x + BLK_W - 8, BLK_Y + 18, value, ink, &FONT_XLARGE);
}

/// Frame, figure, caption and the pair of values — every widget screen is this.
fn frame_screen(grid: &str, ud: (&str, &str), lr: (&str, &str)) {
    well();
    well_caption(grid);
    value_slab(0, ud.0, ud.1, GFX_AXIS_UD);
    value_slab(1, lr.0, lr.1, GFX_AXIS_LR);
}

// ============ Marks ============

/// A diagonal drawn as a fixed stair rather than by Bresenham: one pixel across
/// for every two down. Bresenham picks whatever pattern the endpoints imply, so
/// no two arrows rasterise alike; a fixed ratio makes every arrow in the set the
/// same object rotated, which is the only consistency 1 bit offers at this size.
fn stair_line(x0: i16, y0: i16, x1: i16, y1: i16, t: i16, col: u16) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let n = if dx == 0 { 1 } else { dx.abs() };
    let sx = if dx < 0 { -1 } else { 1 };
    (0..n).for_each(|i| {
        let ya = y0 + (dy * i) / n;
        let yb = y0 + (dy * (i + 1)) / n;
        let top = ya.min(yb);
        gfx_fill_rect(x0 + i * sx, top, t, (yb - ya).abs() + t, col);
    });
}

/// A head that points wherever the shaft does: walk back from the apex along the
/// direction, widening across the perpendicular.
fn arrow_head(x: f32, y: f32, ux: f32, uy: f32, len: f32, half_w: f32, col: u16) {
    let steps = (len * 2.0) as i16;
    (0..=steps).for_each(|si| {
        let s = si as f32 * 0.5;
        let hw = half_w * s / len;
        let bx = x - ux * s;
        let by = y - uy * s;
        let wsteps = (hw * 2.0) as i16;
        (-wsteps..=wsteps).for_each(|wi| {
            let w = wi as f32 * 0.5;
            gfx_pixel((bx - uy * w + 0.5) as i16, (by + ux * w + 0.5) as i16, col);
        });
    });
}

/// One move in the path: a straight shaft on the fixed stair, and a head turned
/// to face the target. The shaft runs the whole way and the notes are laid over
/// it, so the ratio stays exact instead of being bent by a clearance trim.
fn arrow_to(x0: i16, y0: i16, x1: i16, y1: i16, col: u16) {
    let dx = (x1 - x0) as f32;
    let dy = (y1 - y0) as f32;
    let d = sqrtf(dx * dx + dy * dy);
    if d < 1.0 {
        return;
    }
    let (ux, uy) = (dx / d, dy / d);
    const CLEAR: f32 = 15.0;
    stair_line(x0, y0, x1, y1, 3, col);
    arrow_head(x1 as f32 - ux * CLEAR, y1 as f32 - uy * CLEAR, ux, uy, 9.0, 5.0, col);
}

// ============ Figures ============

/// Cmd — U/D stacks notes, L/R repeats them. No axes and no arrows: the blocks
/// are the axes. The column the stack grows up is yellow, the row the repeats
/// run along is magenta, and the block they share is a 50% checker of the two —
/// the only way a panel with no blending can say "and".
fn fig_stack(stack: i16, repeat: i16) {
    const BW: i16 = 34;
    const BH: i16 = 24;
    const GX: i16 = 10;
    const GY: i16 = 9;
    let grid_w = repeat * BW + (repeat - 1) * GX;
    let grid_h = stack * BH + (stack - 1) * GY;
    let ox = CX - grid_w / 2;
    let oy = CY + grid_h / 2;
    (0..stack).for_each(|r| {
        (0..repeat).for_each(|k| {
            let x = ox + k * (BW + GX);
            let y = oy - (r + 1) * BH - r * GY;
            if r == 0 && k == 0 {
                gfx_dither_rect(x, y, BW, BH, 8, GFX_AXIS_UD, GFX_AXIS_LR);
            } else if k == 0 {
                gfx_fill_rect(x, y, BW, BH, GFX_AXIS_UD);
            } else if r == 0 {
                gfx_fill_rect(x, y, BW, BH, GFX_AXIS_LR);
            } else {
                gfx_dither_rect(x, y, BW, BH, 8, GFX_INK, GFX_GROUND);
            }
            gfx_frame(x, y, BW, BH, GFX_INK);
        });
    });
}

/// Cmd+Shift — the same figure, but the gaps are the subject now, so the blocks
/// drop to dither and the gaps get counted instead. One yellow dot per note up
/// the first column, one magenta dot per sixteenth along the bottom row: the gap
/// is built out of the value rather than drawn to a length and then labelled.
fn fig_spacing(stack_notes: i16, repeat_sixteenths: i16) {
    const DOT: i16 = 3;
    const PITCH: i16 = 9;
    const PAD: i16 = (PITCH - DOT) / 2;
    const BW: i16 = 42;
    const BH: i16 = 22;
    const ROWS: i16 = 3;
    const COLS: i16 = 2;
    let stack_gap = stack_notes * PITCH;
    let repeat_gap = repeat_sixteenths * PITCH;
    let grid_w = COLS * BW + repeat_gap;
    let grid_h = ROWS * BH + (ROWS - 1) * stack_gap;
    let ox = CX - grid_w / 2;
    let oy = CY + grid_h / 2;
    let bx = |k: i16| ox + k * (BW + repeat_gap);
    let by = |r: i16| oy - (r + 1) * BH - r * stack_gap;

    // One ruler each, on the edge the value runs along. Marking every gap said
    // the same thing four times over.
    let sx = bx(0) + BW / 2 - 1;
    (0..ROWS - 1).for_each(|r| {
        let top = by(r + 1) + BH;
        (0..stack_notes).for_each(|d| {
            gfx_fill_rect(sx, top + d * PITCH + PAD, DOT, DOT, GFX_AXIS_UD);
        });
    });
    let ry = by(0) + BH / 2 - 1;
    (0..repeat_sixteenths).for_each(|d| {
        gfx_fill_rect(bx(0) + BW + d * PITCH + PAD, ry, DOT, DOT, GFX_AXIS_LR);
    });

    (0..ROWS).for_each(|r| {
        (0..COLS).for_each(|k| {
            gfx_dither_rect(bx(k), by(r), BW, BH, 8, GFX_INK, GFX_GROUND);
            gfx_frame(bx(k), by(r), BW, BH, GFX_INK);
        });
    });
}

/// Which lane each event visits. Chord styles sound every tone at once, so they
/// draw as one column and the caller skips the arrows.
fn arp_path(style: u8, voices: i16, out: &mut [i16; 12]) -> usize {
    let n = voices.max(2).min(6);
    let up = |out: &mut [i16; 12]| {
        (0..n).for_each(|i| out[i as usize] = i);
        n as usize
    };
    let down = |out: &mut [i16; 12]| {
        (0..n).for_each(|i| out[i as usize] = n - 1 - i);
        n as usize
    };
    match style {
        // CHD: everything at once, no path
        ARP_CHORD => 0,
        // DN, C.DN, Z.DN
        2 | 6 | 11 => down(out),
        // U/D, C.U/D, Z.U/D, E1M1
        3 | 7 | 12 | 9 => {
            let mut len = up(out);
            (1..n - 1).rev().for_each(|i| {
                out[len] = i;
                len += 1;
            });
            len
        }
        // D/U, C.D/U, Z.D/U
        4 | 8 | 13 => {
            let mut len = down(out);
            (1..n - 1).for_each(|i| {
                out[len] = i;
                len += 1;
            });
            len
        }
        // RND: a fixed scatter, so the figure is stable while you read it
        14 => {
            let seq = [2, 0, 3, 1, 2, 0];
            (0..6).for_each(|i| out[i] = seq[i] % n);
            6
        }
        // UP, C.UP, Z.UP and anything unrecognised
        _ => up(out),
    }
}

/// Alt — U/D picks the style, L/R the offset. One lane per chord tone, one node
/// per event, and each move a straight arrow on a fixed 2:1 stair. Yellow,
/// because the style is what the yellow encoder shapes: the arrows are the
/// parameter, not a join between two marks.
fn fig_arp(style: u8, voices: i16) {
    const STEP_W: i16 = 28;
    const LANE: i16 = 2 * STEP_W; // a one-lane move lands on 2:1 exactly
    let lanes = voices.max(2).min(4);
    let mut buf = [0i16; 12];
    let len = arp_path(style, lanes, &mut buf);

    let lx = SQ_X + 22;
    let lw = SQ_S - 44;
    let oy = CY - (lanes - 1) * LANE / 2;
    (0..lanes).for_each(|i| {
        gfx_dither_rect(lx, oy + (lanes - 1 - i) * LANE, lw, 1, 8, GFX_INK, GFX_GROUND);
    });

    let py = |n: i16| oy + (lanes - 1 - n) * LANE;
    if len == 0 {
        // A chord: every tone on one column, sounding together.
        (0..lanes).for_each(|i| gfx_fill_rect(CX - 5, py(i) - 5, 11, 11, GFX_INK));
        return;
    }
    let span = (len as i16 - 1) * STEP_W;
    let px = |i: usize| CX - span / 2 + i as i16 * STEP_W;

    (1..len).for_each(|i| {
        arrow_to(px(i - 1), py(buf[i - 1]), px(i), py(buf[i]), GFX_AXIS_UD);
    });
    // The clearance is punched afterwards, as ground around each note, so the
    // shaft's ratio is never bent by a trim.
    (0..len).for_each(|i| {
        gfx_fill_rect(px(i) - 9, py(buf[i]) - 9, 19, 19, GFX_GROUND);
        gfx_fill_rect(px(i) - 5, py(buf[i]) - 5, 11, 11, GFX_INK);
    });
}

/// Alt+Shift — U/D chooses the voicing, L/R how many tones sound. A pitch ladder
/// with octave ticks, so a spread voicing reads as spread. Sounding tones are
/// solid and carry a magenta marker; tones in the chord but not played dither.
fn fig_voicing(total: i16, voices: i16) {
    const BW: i16 = 118;
    let n = total.max(2).min(5);
    let lane = if n <= 4 { 42 } else { 34 };
    let ox = SQ_X + 52;
    let oy = CY - ((n - 1) * lane + 20) / 2;
    (0..n).for_each(|i| {
        let y = oy + (n - 1 - i) * lane;
        let on = i < voices;
        if on {
            gfx_fill_rect(ox, y, BW, 20, GFX_INK);
        } else {
            gfx_dither_rect(ox, y, BW, 20, 6, GFX_INK, GFX_GROUND);
        }
        gfx_frame(ox, y, BW, 20, GFX_INK);
        if on {
            gfx_fill_rect(ox - 18, y + 6, 10, 8, GFX_AXIS_LR);
        }
    });
    // The axis brackets the tones and no further: a rule that runs past the part
    // it measures reads as a second thing on the screen.
    let ax = ox - 30;
    let top = oy - 16;
    let h = (n - 1) * lane + 52;
    gfx_vline(ax, top, h, GFX_INK);
    (0..=3).for_each(|t| gfx_hline(ax - 5, top + 8 + t * (h - 16) / 3, 6, GFX_INK));
}

// ============ The idle screen ============

/// Nothing held. Turning an encoder moves the note, which needs no picture — you
/// can watch it move. What this screen owes you instead is the note as it
/// stands, and a way to decide which modifier to reach for: every combo, and
/// what each encoder becomes under it, in the colours it will actually wear. The
/// map is a preview of the two slabs the widget screens put at the foot.
static MAP: [(&str, &str, &str); 5] = [
    ("SHIFT", "INVERT", "LENGTH"),
    ("CMD", "STACK", "REPEAT"),
    ("CMD+SHIFT", "SPACING", "SPACING"),
    ("OPT", "ARP", "OFFSET"),
    ("OPT+SHIFT", "VOICING", "VOICES"),
];

const ICON_SIZE: i16 = 10;

fn caret(kind: u8, x: i16, y: i16, col: u16) {
    if kind == 0 {
        let cx = x + ICON_SIZE / 2;
        gfx_pixel(cx, y, col);
        gfx_hline(cx - 1, y + 1, 3, col);
        gfx_hline(cx - 2, y + 2, 5, col);
        gfx_hline(cx - 3, y + 3, 7, col);
        gfx_hline(cx - 3, y + 6, 7, col);
        gfx_hline(cx - 2, y + 7, 5, col);
        gfx_hline(cx - 1, y + 8, 3, col);
        gfx_pixel(cx, y + 9, col);
    } else {
        let cy = y + ICON_SIZE / 2;
        gfx_pixel(x, cy, col);
        gfx_vline(x + 1, cy - 1, 3, col);
        gfx_vline(x + 2, cy - 2, 5, col);
        gfx_vline(x + 3, cy - 3, 7, col);
        gfx_vline(x + 6, cy - 3, 7, col);
        gfx_vline(x + 7, cy - 2, 5, col);
        gfx_vline(x + 8, cy - 1, 3, col);
        gfx_pixel(x + 9, cy, col);
    }
}

fn map_cell(x: i16, y: i16, w: i16, h: i16, fill: u16, icon: Option<u8>, label: &str, font: &BitFont) {
    gfx_fill_rect(x, y, w, h, fill);
    gfx_frame(x, y, w, h, GFX_INK);
    let ink = gfx_ink_on(fill);
    let mut tx = x + 6;
    if let Some(k) = icon {
        caret(k, tx, y + (h - ICON_SIZE) / 2, ink);
        tx += ICON_SIZE + 4;
    }
    gfx_text(tx, y + (h - gfx_font_height(font)) / 2, label, ink, font);
}

pub fn draw_note_map(note: &str, pos: &str, len: &str, arp: &str, stk: &str, rpt: &str) {
    // The note itself, inverted the way a selection has always been shown here.
    gfx_fill_rect(6, 30, 228, 32, GFX_INK);
    gfx_text(14, 34, note, GFX_GROUND, &FONT_LARGE);
    gfx_text_right(228, 38, pos, GFX_GROUND, &FONT_MEDIUM);

    // Four values, so the screen still answers "what is this note" on its own.
    draw_row_two_col(72, "LEN", len, GFX_VALUE, "ARP", arp, GFX_VALUE);
    draw_row_two_col(99, "STK", stk, GFX_VALUE, "RPT", rpt, GFX_VALUE);

    const M: i16 = 6;
    const MW: i16 = 56;
    const GAP: i16 = 4;
    const CW: i16 = 82;
    const H: i16 = 28;
    const PITCH: i16 = 33;
    MAP.iter().enumerate().for_each(|(i, (m, ud, lr))| {
        let y = 130 + i as i16 * PITCH;
        map_cell(M, y, MW, H, GFX_GROUND, None, m, &FONT_SMALL);
        map_cell(M + MW + GAP, y, CW, H, GFX_AXIS_UD, Some(0), ud, &FONT_MEDIUM);
        map_cell(M + MW + GAP + CW + GAP, y, CW, H, GFX_AXIS_LR, Some(1), lr, &FONT_MEDIUM);
    });

    gfx_fill_rect(14, 302, 6, 6, GFX_INK);
    gfx_text(26, 301, "DESELECT", GFX_INK, &FONT_SMALL);
}

// ============ Screens ============

pub fn screen_stack(ev: &NoteEvent) {
    let stack = (ev.chord_amount as i16).max(1).min(6);
    let repeat = (ev.repeat_amount as i16).max(1).min(5);
    fig_stack(stack, repeat);
    let mut a = FmtBuf::<8>::new();
    let _ = write!(a, "{}", ev.chord_amount);
    let mut b = FmtBuf::<8>::new();
    let _ = write!(b, "{}", ev.repeat_amount);
    frame_screen("DISABLE", ("STACK", a.as_str()), ("REPEAT", b.as_str()));
}

pub fn screen_spacing(ev: &NoteEvent) {
    let sixteenth = TICKS_PER_QUARTER / 4;
    let dots = ((ev.repeat_space / sixteenth.max(1)) as i16).max(1).min(8);
    let notes = (ev.chord_space as i16).max(1).min(8);
    fig_spacing(notes, dots);
    let mut a = FmtBuf::<8>::new();
    let _ = write!(a, "{}", ev.chord_space);
    let b = ticks_to_canonical_name(ev.repeat_space);
    frame_screen("RST/RPT", ("STK SPC", a.as_str()), ("RPT SPC", b.as_str()));
}

pub fn screen_arp(ev: &NoteEvent) {
    fig_arp(ev.arp_style, ev.chord_amount as i16);
    let style = *ARP_STYLE_NAMES.get(ev.arp_style as usize).unwrap_or(&"CHD");
    let mut off = FmtBuf::<8>::new();
    let sign = if ev.arp_offset > 0 { "+" } else { "" };
    let _ = write!(off, "{}{}", sign, ev.arp_offset);
    frame_screen("COPY", ("ARP", style), ("OFFSET", off.as_str()));
}

pub fn screen_voicing(ev: &NoteEvent) {
    fig_voicing(ev.chord_amount as i16, ev.arp_voices as i16);
    let name = get_voicing_name(ev.chord_amount, ev.chord_space, ev.chord_voicing);
    let mut v = FmtBuf::<8>::new();
    let _ = write!(v, "{}", ev.arp_voices);
    frame_screen("", ("VOICING", name), ("VOICES", v.as_str()));
}
