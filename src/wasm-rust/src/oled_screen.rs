// oled_screen.rs — OLED screen content rendering
// Full-width layout with 256×128 display, IBM Plex Mono fonts

extern crate alloc;
use alloc::format;

use crate::oled_gfx::*;
use crate::oled_fonts::FONT_MAIN;
use crate::oled_fonts_aa::*;
use crate::oled_display::*;
use crate::engine_core::*;
use crate::engine_ui;

const CH_DRUM: u8 = ChannelType::Drum as u8;

// ============ Layout constants (256×128) ============

const DISPLAY_W: i16 = GFX_WIDTH as i16;
const PAD_X: i16 = 10;
const CONTENT_RIGHT: i16 = 154; // 60% of display — right 40% reserved for future dial
const CONTENT_W: i16 = CONTENT_RIGHT - PAD_X;
const HALF_W: i16 = CONTENT_W / 2;

// Row Y positions (4 data rows + dots + bottom legend)
const ROW_Y: [i16; 4] = [8, 28, 48, 68];
// 5-row layout for selected note view (tighter spacing, no dots)
const ROW_Y5: [i16; 5] = [8, 27, 46, 65, 84];

// Pattern indicator dots
const DOT_Y: i16 = 90;
const DOT_SIZE: i16 = 6;
const DOT_GAP: i16 = 3;

// Bottom legend bar
const LEGEND_Y: i16 = 108;
const LEGEND_COL_W: i16 = DISPLAY_W / 3;
const ICON_SIZE: i16 = 10;
const ICON_LABEL_GAP: i16 = 4;

// ============ Ticker animation ============

const TICKER_PAUSE_FRAMES: u32 = 120;  // 2s at 60fps
const TICKER_PX_FRAMES: u32 = 15;     // 0.25s per pixel
const TICKER_WRAP_GAP: i16 = 15;      // pixel gap between looping copies

static mut FRAME_COUNT: u32 = 0;

const NUM_TICKERS: usize = 7; // 0-3: rows, 4-6: legend columns

struct TickerState {
    text_hash: u32,
    frame_start: u32,
    scroll_dist: i16,   // total_w + gap (full wrap cycle in pixels)
}

impl TickerState {
    const fn new() -> Self {
        Self { text_hash: 0, frame_start: 0, scroll_dist: 0 }
    }
}

static mut TICKERS: [TickerState; NUM_TICKERS] = [
    TickerState::new(), TickerState::new(),
    TickerState::new(), TickerState::new(),
    TickerState::new(), TickerState::new(),
    TickerState::new(),
];

fn simple_hash(s: &str) -> u32 {
    s.bytes().fold(5381u32, |h, b| h.wrapping_mul(33).wrapping_add(b as u32))
}

/// Compute the scroll offset for a wrapping ticker.
/// `scroll_dist` = total_w + TICKER_WRAP_GAP (full wrap distance).
/// Returns 0..scroll_dist; callers draw two copies separated by scroll_dist.
fn ticker_offset_hash(slot: usize, hash: u32, scroll_dist: i16) -> i16 {
    if scroll_dist <= 0 || slot >= NUM_TICKERS { return 0; }

    let frame = unsafe { FRAME_COUNT };
    let tk = unsafe { &mut TICKERS[slot] };

    if tk.text_hash != hash || tk.scroll_dist != scroll_dist {
        tk.text_hash = hash;
        tk.frame_start = frame;
        tk.scroll_dist = scroll_dist;
    }

    let elapsed = frame.wrapping_sub(tk.frame_start);
    let scroll_frames = scroll_dist as u32 * TICKER_PX_FRAMES;
    let cycle_len = TICKER_PAUSE_FRAMES + scroll_frames;

    let phase = elapsed % cycle_len;
    if phase < TICKER_PAUSE_FRAMES {
        0
    } else {
        ((phase - TICKER_PAUSE_FRAMES) / TICKER_PX_FRAMES) as i16
    }
}

fn ticker_offset(slot: usize, text: &str, scroll_dist: i16) -> i16 {
    ticker_offset_hash(slot, simple_hash(text), scroll_dist)
}

/// Returns true if any ticker is currently scrolling (needs continuous rendering)
pub fn oled_is_animating() -> bool {
    unsafe {
        TICKERS.iter().any(|tk| tk.scroll_dist > 0)
    }
}

// ============ Modifier key bitmask ============

const MOD_SHIFT: u8 = 1;
const MOD_META: u8 = 2;
const MOD_ALT: u8 = 4;
#[allow(dead_code)]
const MOD_CTRL: u8 = 8;

// ============ String helpers ============

static NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

fn midi_note_to_name(note: i8) -> alloc::string::String {
    if note < 0 {
        return alloc::string::String::from("??");
    }
    let octave = (note as i32 / 12) - 1;
    let idx = (note as usize) % 12;
    format!("{}{}", NOTE_NAMES[idx], octave)
}

fn tick_to_beat_display(tick: i32) -> alloc::string::String {
    let beat = (tick / TICKS_PER_QUARTER) + 1;
    let sub = tick % TICKS_PER_QUARTER;
    if sub == 0 {
        format!("{}", beat)
    } else {
        let sixteenth = (sub / (TICKS_PER_QUARTER / 4)) + 1;
        format!("{}.{}", beat, sixteenth)
    }
}

// Musical name lookup tables
struct MusicalName {
    ticks: i32,
    name: &'static str,
}

static MUSICAL_NAMES: &[MusicalName] = &[
    MusicalName { ticks: 30, name: "1/64" },
    MusicalName { ticks: 40, name: "1/32T" },
    MusicalName { ticks: 45, name: "1/64." },
    MusicalName { ticks: 60, name: "1/32" },
    MusicalName { ticks: 80, name: "1/16T" },
    MusicalName { ticks: 90, name: "1/32." },
    MusicalName { ticks: 120, name: "1/16" },
    MusicalName { ticks: 160, name: "1/8T" },
    MusicalName { ticks: 180, name: "1/16." },
    MusicalName { ticks: 240, name: "1/8" },
    MusicalName { ticks: 320, name: "1/4T" },
    MusicalName { ticks: 360, name: "1/8." },
    MusicalName { ticks: 480, name: "1/4" },
    MusicalName { ticks: 640, name: "1/2T" },
    MusicalName { ticks: 720, name: "1/4." },
    MusicalName { ticks: 960, name: "1/2" },
    MusicalName { ticks: 1440, name: "1/2." },
    MusicalName { ticks: 1920, name: "1" },
];

struct TripletName {
    ticks: i32,
    name: &'static str,
}

static TRIPLET_NAMES: &[TripletName] = &[
    TripletName { ticks: 40, name: "1/32T" },
    TripletName { ticks: 80, name: "1/16T" },
    TripletName { ticks: 160, name: "1/8T" },
    TripletName { ticks: 320, name: "1/4T" },
    TripletName { ticks: 640, name: "1/2T" },
];

fn lookup_triplet(ticks: i32) -> Option<&'static str> {
    TRIPLET_NAMES.iter().find(|t| t.ticks == ticks).map(|t| t.name)
}

fn lookup_musical(ticks: i32) -> Option<&'static str> {
    MUSICAL_NAMES.iter().find(|m| m.ticks == ticks).map(|m| m.name)
}

fn ticks_to_musical_name(ticks: i32, zoom: i32) -> alloc::string::String {
    if let Some(trip) = lookup_triplet(ticks) {
        return alloc::string::String::from(trip);
    }
    if ticks > 0 && zoom > 0 && (ticks % zoom == 0) {
        let n = ticks / zoom;
        let denom = 1920 / zoom;
        return format!("{}/{}", n, denom);
    }
    if let Some(mus) = lookup_musical(ticks) {
        return alloc::string::String::from(mus);
    }
    format!("{}t", ticks)
}

fn ticks_to_canonical_name(ticks: i32) -> alloc::string::String {
    if let Some(trip) = lookup_triplet(ticks) {
        return alloc::string::String::from(trip);
    }
    if let Some(mus) = lookup_musical(ticks) {
        return alloc::string::String::from(mus);
    }
    if ticks > 0 && (ticks % 1920 == 0) {
        return format!("{}", ticks / 1920);
    }
    MUSICAL_NAMES.iter()
        .find(|m| m.ticks > 0 && (ticks % m.ticks == 0) && m.name.starts_with("1/"))
        .map(|m| {
            let denom: i32 = m.name[2..].parse().unwrap_or(0);
            if denom > 0 {
                format!("{}/{}", ticks / m.ticks, denom)
            } else {
                format!("{}t", ticks)
            }
        })
        .unwrap_or_else(|| format!("{}t", ticks))
}

// GM Drum names (MIDI 35-81)
static GM_DRUM_NAMES: &[&str] = &[
    "KICK 2", "KICK", "STICK", "SNARE", "CLAP", "E.SNR",       // 35-40
    "LO TOM", "CL HH", "HI TOM", "PED HH", "LO TOM", "OP HH",// 41-46
    "LM TOM", "HM TOM", "CRASH", "HI TOM", "RIDE", "CHINA",    // 47-52
    "RIDEBL", "TAMB", "SPLASH", "COWBEL", "CRASH2", "VIBRA",    // 53-58
    "RIDE2", "HI BON", "LO BON", "MT CON", "OP CON", "LO CON", // 59-64
    "HI TIM", "LO TIM", "HI AGA", "LO AGA", "CABASA", "MARACA",// 65-70
    "S.WHST", "L.WHST", "S.GUIR", "L.GUIR", "CLAVES", "HI BLK",// 71-76
    "LO BLK", "MT CGA", "OP CGA", "MT TRI", "OP TRI",          // 77-81
];
const GM_DRUM_MIN: i8 = 35;
const GM_DRUM_MAX: i8 = 81;

fn get_drum_name(midi: i8) -> alloc::string::String {
    if midi >= GM_DRUM_MIN && midi <= GM_DRUM_MAX {
        alloc::string::String::from(GM_DRUM_NAMES[(midi - GM_DRUM_MIN) as usize])
    } else {
        format!("D{}", midi)
    }
}

/// Uppercase an ASCII string (for display purposes)
fn to_upper(s: &str) -> alloc::string::String {
    s.chars().map(|c| if c.is_ascii_lowercase() { (c as u8 - 32) as char } else { c }).collect()
}

// ============ Sub-mode / loop mode labels ============

static SUB_MODE_LABELS: [&str; 6] = ["VEL", "HIT", "TIME", "FLAM", "MOD", "INV"];
static ARP_STYLE_NAMES: [&str; 15] = ["CHD", "UP", "DN", "U/D", "D/U", "C.UP", "C.DN", "C.U/D", "C.D/U", "E1M1", "Z.UP", "Z.DN", "Z.U/D", "Z.D/U", "RND"];
static INTERVAL_NAMES: [&str; 12] = [
    "UNISON", "MIN 2ND", "2ND", "MIN 3RD", "3RD", "4TH",
    "TRITONE", "5TH", "MIN 6TH", "6TH", "MIN 7TH", "7TH",
];

// ============ Note display helper ============

fn get_note_display(row: i16, is_drum: bool, s: &EngineState) -> alloc::string::String {
    if is_drum {
        let midi = row.clamp(0, 127) as i8;
        get_drum_name(midi)
    } else {
        let midi = note_to_midi(row, s);
        if midi >= 0 { midi_note_to_name(midi) } else { alloc::string::String::from("??") }
    }
}

// ============ Drawing helpers ============

/// Draw label (left-aligned, normal weight) + value (right-aligned, bold) on a row
fn draw_row(y: i16, label: &str, value: &str, val_color: u16) {
    gfx_aa_text(PAD_X, y, label, GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text_right(CONTENT_RIGHT, y, value, val_color, &FONT_AA_SMALL_BOLD);
}

/// Draw label + value with ticker scrolling if value overflows.
/// `ticker_slot` identifies which ticker state to use (0–3).
fn draw_row_tickered(y: i16, label: &str, value: &str, val_color: u16, ticker_slot: usize) {
    gfx_aa_text(PAD_X, y, label, GFX_LABEL, &FONT_AA_SMALL);
    let label_w = gfx_aa_text_width(label, &FONT_AA_SMALL);
    let val_w = gfx_aa_text_width(value, &FONT_AA_SMALL_BOLD);
    let gap = 6i16; // min gap between label and value
    let avail = CONTENT_RIGHT - PAD_X - label_w - gap;

    if val_w <= avail {
        // Fits — right-align as normal
        gfx_aa_text_right(CONTENT_RIGHT, y, value, val_color, &FONT_AA_SMALL_BOLD);
    } else {
        // Overflow — wrapping ticker, left-aligned after label
        let val_x = PAD_X + label_w + gap;
        let wrap_dist = val_w + TICKER_WRAP_GAP;
        let offset = ticker_offset(ticker_slot, value, wrap_dist);
        // Draw two copies for seamless wrap
        let x1 = val_x - offset;
        gfx_aa_text_clipped(x1, y, value, val_color, &FONT_AA_SMALL_BOLD, val_x, CONTENT_RIGHT);
        let x2 = x1 + wrap_dist;
        if x2 < CONTENT_RIGHT {
            gfx_aa_text_clipped(x2, y, value, val_color, &FONT_AA_SMALL_BOLD, val_x, CONTENT_RIGHT);
        }
    }
}

/// Draw a two-column row (row 0: CH xx | PAT yy)
fn draw_row_two_col(y: i16, label1: &str, val1: &str, val1_color: u16,
                    label2: &str, val2: &str, val2_color: u16) {
    let col2_x = PAD_X + HALF_W + 6;
    gfx_aa_text(PAD_X, y, label1, GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text_right(PAD_X + HALF_W - 4, y, val1, val1_color, &FONT_AA_SMALL_BOLD);
    gfx_aa_text(col2_x, y, label2, GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text_right(CONTENT_RIGHT, y, val2, val2_color, &FONT_AA_SMALL_BOLD);
}

/// Text segment with color for multi-color right-aligned rendering
struct TextSeg<'a> {
    text: &'a str,
    color: u16,
}

/// Draw text segments right-aligned as a group (each segment can have its own color)
fn draw_segs_right(right_x: i16, y: i16, segs: &[TextSeg], font: &AAFont) {
    let total_w: i16 = segs.iter().map(|seg| gfx_aa_text_width(seg.text, font)).sum();
    let mut x = right_x - total_w;
    for seg in segs {
        gfx_aa_text(x, y, seg.text, seg.color, font);
        x += gfx_aa_text_width(seg.text, font);
    }
}

/// Draw multi-segment value with ticker scrolling within [clip_left, clip_right).
/// Right-aligns if it fits; otherwise wraps with marquee ticker.
#[allow(dead_code)]
fn draw_segs_tickered(y: i16, segs: &[TextSeg], font: &AAFont, clip_left: i16, clip_right: i16, ticker_slot: usize) {
    let total_w: i16 = segs.iter().map(|seg| gfx_aa_text_width(seg.text, font)).sum();
    let avail = clip_right - clip_left;

    if total_w <= avail {
        let mut x = clip_right - total_w;
        for seg in segs {
            gfx_aa_text(x, y, seg.text, seg.color, font);
            x += gfx_aa_text_width(seg.text, font);
        }
    } else {
        let hash_val: u32 = segs.iter().fold(5381u32, |h, seg|
            seg.text.bytes().fold(h, |h, b| h.wrapping_mul(33).wrapping_add(b as u32))
        );
        let wrap_dist = total_w + TICKER_WRAP_GAP;
        let offset = ticker_offset_hash(ticker_slot, hash_val, wrap_dist);

        for copy_off in [0i16, wrap_dist] {
            let mut x = clip_left - offset + copy_off;
            for seg in segs {
                let sw = gfx_aa_text_width(seg.text, font);
                if x + sw > clip_left && x < clip_right {
                    gfx_aa_text_clipped(x, y, seg.text, seg.color, font, clip_left, clip_right);
                }
                x += sw;
            }
        }
    }
}

/// Draw label + multi-segment value with ticker scrolling if it overflows.
#[allow(dead_code)]
fn draw_segs_row_tickered(y: i16, label: &str, segs: &[TextSeg], font: &AAFont, ticker_slot: usize) {
    gfx_aa_text(PAD_X, y, label, GFX_LABEL, &FONT_AA_SMALL);
    let label_w = gfx_aa_text_width(label, &FONT_AA_SMALL);
    let val_x = PAD_X + label_w + 6;
    draw_segs_tickered(y, segs, font, val_x, CONTENT_RIGHT, ticker_slot);
}

/// Draw scale interval visualization (12 squares for chromatic notes)
fn draw_scale_dots(s: &EngineState) {
    let n: i16 = 12;
    let total_w = n * DOT_SIZE + (n - 1) * DOT_GAP;
    let start_x = CONTENT_RIGHT - total_w;
    let idx = (s.scale_id_idx as usize).min(NUM_SCALES - 1);
    let pattern = &SCALE_PATTERNS[idx];

    (0..12).for_each(|i| {
        let x = start_x + i as i16 * (DOT_SIZE + DOT_GAP);
        let color = if pattern[i] != 0 { GFX_VALUE } else { gfx_rgb565(0x20, 0x2E, 0x50) };
        gfx_fill_rect(x, DOT_Y, DOT_SIZE, DOT_SIZE, color);
    });
}

// ============ Circle of fifths visualization ============

/// Circle of fifths: maps semitone index (0=C) to position on circle (0=top/C, clockwise)
static COF_ORDER: [u8; 12] = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/// Draw circle of fifths indicator in the right panel area
fn draw_circle_of_fifths(s: &EngineState, active: bool) {
    // Center of the right panel area (154..256), shifted right to balance padding
    let cx: i16 = (CONTENT_RIGHT + DISPLAY_W) / 2 + 2;
    let cy: i16 = 54; // vertically centered accounting for legend bar
    let r_outer: i16 = 38;
    let r_inner: i16 = 24;
    let thickness: i16 = 2;

    let circle_color = if active { GFX_LABEL } else { gfx_rgb565(0x30, 0x3A, 0x58) };
    let text_color = if active { GFX_RED } else { gfx_rgb565(0x40, 0x4A, 0x68) };

    // Draw outer ring: filled outer disc, then punch out inner disc with background
    let bg = GFX_BLACK;
    gfx_fill_circle(cx, cy, r_outer, circle_color);
    gfx_fill_circle(cx, cy, r_outer - thickness, bg);
    // Draw inner ring: filled disc then punch out center
    gfx_fill_circle(cx, cy, r_inner, circle_color);
    gfx_fill_circle(cx, cy, r_inner - thickness, bg);

    // Find this key's position on the circle of fifths
    let root = (s.scale_root % 12) as usize;
    let cof_pos = COF_ORDER[root];

    // Draw tick mark at the key's position (from outer to inner circle)
    // 0 = top (270° in math coords), going clockwise
    let angle_deg = cof_pos as f32 * 30.0 - 90.0;
    let angle_rad = angle_deg * core::f32::consts::PI / 180.0;
    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    // Tick from outer circle inward
    let tick_outer = r_outer as f32;
    let tick_inner = r_inner as f32;
    let x0 = cx + (cos_a * tick_inner) as i16;
    let y0 = cy + (sin_a * tick_inner) as i16;
    let x1 = cx + (cos_a * tick_outer) as i16;
    let y1 = cy + (sin_a * tick_outer) as i16;

    let tick_color = if active { GFX_RED } else { gfx_rgb565(0x40, 0x4A, 0x68) };

    // Draw thick tick (3px wide perpendicular to radius)
    // Use axis-aligned offsets filtered by perpendicular distance for consistent width
    // Collect (ox, oy) pairs within ~1.2px perpendicular distance of the line
    let mut offsets: [(i16, i16); 9] = [(0, 0); 9];
    let mut n = 0usize;
    (-1i16..=1).for_each(|dx| {
        (-1i16..=1).for_each(|dy| {
            let dist_sq = (dx as f32 * cos_a + dy as f32 * sin_a).powi(2);
            // Keep points within ~1.2px of the line (perpendicular distance)
            if dist_sq <= 1.5 {
                offsets[n] = (dx, dy);
                n += 1;
            }
        });
    });
    (0..n).for_each(|i| {
        let (ox, oy) = offsets[i];
        gfx_line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, tick_color);
    });

    // Draw key name centered in the inner circle
    let root_name = NOTE_NAMES[root];
    let font = &FONT_AA_COF;
    // Get the first char's actual glyph metrics for precise vertical centering
    let ch = root_name.as_bytes()[0];
    let gi = (ch as u16 - font.first) as usize;
    let glyph = &font.glyphs[gi];
    let glyph_top = glyph.y_offset as i16;
    let glyph_bot = glyph_top + glyph.height as i16;
    let text_y = cy - (glyph_top + glyph_bot) / 2;
    gfx_aa_text_center(cx, text_y, root_name, text_color, font);
}

// ============ Bottom bar icons (10x10px) ============

/// Square icon (represents grid button press)
fn draw_icon_grid_button(x: i16, y: i16, color: u16) {
    let s = ICON_SIZE;
    (0..s).for_each(|row| {
        gfx_hline(x, y + row, s, color);
    });
}

/// Up/down carets icon (represents arrow up/down keys)
fn draw_icon_ud_carets(x: i16, y: i16, color: u16) {
    let cx = x + ICON_SIZE / 2;
    // Up caret (top half)
    gfx_pixel(cx, y, color);
    gfx_hline(cx - 1, y + 1, 3, color);
    gfx_hline(cx - 2, y + 2, 5, color);
    gfx_hline(cx - 3, y + 3, 7, color);
    // Down caret (bottom half)
    gfx_hline(cx - 3, y + 6, 7, color);
    gfx_hline(cx - 2, y + 7, 5, color);
    gfx_hline(cx - 1, y + 8, 3, color);
    gfx_pixel(cx, y + 9, color);
}

/// Left/right carets icon (represents arrow left/right keys)
fn draw_icon_lr_carets(x: i16, y: i16, color: u16) {
    let cy = y + ICON_SIZE / 2;
    // Left caret
    gfx_pixel(x, cy, color);
    gfx_vline(x + 1, cy - 1, 3, color);
    gfx_vline(x + 2, cy - 2, 5, color);
    gfx_vline(x + 3, cy - 3, 7, color);
    // Right caret
    gfx_vline(x + 6, cy - 3, 7, color);
    gfx_vline(x + 7, cy - 2, 5, color);
    gfx_vline(x + 8, cy - 1, 3, color);
    gfx_pixel(x + 9, cy, color);
}

/// Compute ticker offset with no initial pause — starts scrolling immediately.
/// Used for legend text that only appears while modifier keys are held.
fn ticker_offset_immediate(slot: usize, text: &str, scroll_dist: i16) -> i16 {
    if scroll_dist <= 0 || slot >= NUM_TICKERS { return 0; }

    let hash = simple_hash(text);
    let frame = unsafe { FRAME_COUNT };
    let tk = unsafe { &mut TICKERS[slot] };

    if tk.text_hash != hash || tk.scroll_dist != scroll_dist {
        tk.text_hash = hash;
        tk.frame_start = frame;
        tk.scroll_dist = scroll_dist;
    }

    let elapsed = frame.wrapping_sub(tk.frame_start);
    let scroll_frames = scroll_dist as u32 * TICKER_PX_FRAMES;
    (elapsed % scroll_frames / TICKER_PX_FRAMES) as i16
}

/// Draw a legend item in the bottom bar with ticker if text overflows column.
/// If label is empty, draw icon in muted color only (no label).
fn draw_legend_item(col: i16, icon_type: u8, label: &str, color: u16) {
    let x = col * LEGEND_COL_W + PAD_X;
    let icon_y = LEGEND_Y + 2; // vertically center icon with text

    let draw_color = if label.is_empty() { GFX_DIM } else { color };

    match icon_type {
        0 => draw_icon_grid_button(x, icon_y, draw_color),
        1 => draw_icon_ud_carets(x, icon_y, draw_color),
        2 => draw_icon_lr_carets(x, icon_y, draw_color),
        _ => {}
    }

    if !label.is_empty() {
        let text_x = x + ICON_SIZE + ICON_LABEL_GAP;
        let text_w = gfx_aa_text_width(label, &FONT_AA_SMALL);
        let clip_right = (col + 1) * LEGEND_COL_W;
        let avail = clip_right - text_x;

        if text_w <= avail {
            gfx_aa_text(text_x, LEGEND_Y, label, color, &FONT_AA_SMALL);
        } else {
            let ticker_slot = 4 + col as usize;
            let wrap_dist = text_w + TICKER_WRAP_GAP;
            let offset = ticker_offset_immediate(ticker_slot, label, wrap_dist);
            let x1 = text_x - offset;
            gfx_aa_text_clipped(x1, LEGEND_Y, label, color, &FONT_AA_SMALL, text_x, clip_right);
            let x2 = x1 + wrap_dist;
            if x2 < clip_right {
                gfx_aa_text_clipped(x2, LEGEND_Y, label, color, &FONT_AA_SMALL, text_x, clip_right);
            }
        }
    }
}


fn draw_icon_horizontal(x: i16, y: i16, color: u16) {
    let cy = y - 5;
    let mx = x + 6;
    gfx_pixel(mx - 6, cy, color);
    gfx_vline(mx - 5, cy - 1, 3, color);
    gfx_vline(mx - 4, cy - 2, 5, color);
    gfx_vline(mx - 3, cy - 3, 7, color);
    gfx_hline(mx - 3, cy, 7, color);
    gfx_vline(mx + 3, cy - 3, 7, color);
    gfx_vline(mx + 4, cy - 2, 5, color);
    gfx_vline(mx + 5, cy - 1, 3, color);
    gfx_pixel(mx + 6, cy, color);
}

fn draw_icon_legend(y: i16, label: &str, value: &str, legend_color: u8) {
    draw_icon_horizontal(PAD_X, y, color_lookup(legend_color));
    let tx = PAD_X + 13 + 4;
    let prefix = format!("{}: ", label);
    gfx_text(tx, y, &prefix, color_lookup(legend_color), &FONT_MAIN);
    if !value.is_empty() {
        let w = gfx_text_width(&prefix, &FONT_MAIN);
        gfx_text(tx + w, y, value, color_lookup(OLED_CYAN), &FONT_MAIN);
    }
}

// ============ Mode renderers ============

fn render_pattern_default(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let is_drum = s.channel_types[ch] == CH_DRUM;
    let p_meta = (mods & MOD_META) != 0;
    let p_alt = (mods & MOD_ALT) != 0;
    let p_shift = (mods & MOD_SHIFT) != 0;

    // ---- Row 0: CH xx | PAT yy (two columns at 50%) ----
    let ch_str = format!("{:02}", ch + 1);
    let pat_str = format!("{:02}", pat + 1);
    draw_row_two_col(ROW_Y[0], "CH", &ch_str, GFX_VALUE, "PAT", &pat_str, GFX_VALUE);

    // ---- Row 1: LOOP x.x-y.y ----
    // Highlight start when Cmd+Alt, highlight end when Alt only
    let loop_data = &s.loops[ch][pat];
    let s_buf = tick_to_beat_display(loop_data.start);
    let e_buf = tick_to_beat_display(loop_data.start + loop_data.length - s.zoom);
    gfx_aa_text(PAD_X, ROW_Y[1], "LOOP", GFX_LABEL, &FONT_AA_SMALL);
    let s_color = if p_alt && p_meta { GFX_RED } else { GFX_VALUE };
    let e_color = if p_alt && !p_meta { GFX_RED } else { GFX_VALUE };
    let loop_val = format!("{}-", s_buf);
    draw_segs_right(CONTENT_RIGHT, ROW_Y[1], &[
        TextSeg { text: &loop_val, color: s_color },
        TextSeg { text: &e_buf, color: e_color },
    ], &FONT_AA_SMALL_BOLD);

    // ---- Row 2: KEY (or TYPE for drums) ----
    // Cmd-only (no alt) highlights key
    let cmd_only = p_meta && !p_alt;
    if is_drum {
        draw_row(ROW_Y[2], "TYPE", "DRUMS", GFX_VALUE);
    } else {
        let scale_root_name = NOTE_NAMES[(s.scale_root % 12) as usize];
        let root_color = if cmd_only { GFX_RED } else { GFX_VALUE };
        draw_row(ROW_Y[2], "KEY", scale_root_name, root_color);
    }

    // ---- Row 3: SCALE (ticker for long names) ----
    if is_drum {
        draw_row(ROW_Y[3], "SCALE", "-", GFX_DIM);
    } else {
        let scale_name = to_upper(engine_get_scale_name_str(s));
        let scale_color = if cmd_only { GFX_YELLOW } else { GFX_VALUE };
        draw_row_tickered(ROW_Y[3], "SCALE", &scale_name, scale_color, 3);
    }

    // ---- Scale interval visualization ----
    draw_scale_dots(s);

    // ---- Circle of fifths (right panel) ----
    if !is_drum {
        draw_circle_of_fifths(s, cmd_only);
    }

    // ---- Bottom legend bar ----
    // Priority: Cmd+Alt+Shift > Cmd+Alt > Cmd only > Alt+Shift > Alt only > Shift only > bare
    if p_meta && p_alt && p_shift {
        // Cmd+Alt+Shift: random note + loop start fine
        draw_legend_item(0, 0, "RANDOM", GFX_BLUE);
        draw_legend_item(1, 1, "", GFX_DIM);
        draw_legend_item(2, 2, "LOOP ST +/-0.1", GFX_RED);
    } else if p_meta && p_alt {
        // Cmd+Alt: loop start editing
        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, "", GFX_DIM);
        draw_legend_item(2, 2, "LOOP ST", GFX_RED);
    } else if p_meta {
        // Cmd only: disable + scale/key editing
        draw_legend_item(0, 0, "DISABLE", GFX_BLUE);
        draw_legend_item(1, 1, "SCALE", GFX_YELLOW);
        draw_legend_item(2, 2, "KEY", GFX_RED);
    } else if p_alt {
        // Alt(+Shift): loop end editing
        let fine = if p_shift { " +/-0.1" } else { "" };
        let label = format!("LOOP END{}", fine);
        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, "", GFX_DIM);
        draw_legend_item(2, 2, &label, GFX_RED);
    } else if p_shift {
        // Shift only: camera scroll octave/beat
        draw_legend_item(0, 0, "ENABLE", GFX_BLUE);
        draw_legend_item(1, 1, "OCTAVE", GFX_YELLOW);
        draw_legend_item(2, 2, "BEAT", GFX_RED);
    } else {
        // No modifiers: grid=ENABLE, arrows=move camera
        draw_legend_item(0, 0, "ENABLE", GFX_BLUE);
        draw_legend_item(1, 1, "CAM", GFX_YELLOW);
        draw_legend_item(2, 2, "CAM", GFX_RED);
    }
}

fn render_pattern_selected(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    if s.selected_event_idx as usize >= s.patterns[ch][pat].event_count as usize { return; }
    let h = s.patterns[ch][pat].event_handles[s.selected_event_idx as usize];
    let ev = &s.event_pool.slots[h as usize];
    let is_drum = s.channel_types[ch] == CH_DRUM;

    let shift = (mods & MOD_SHIFT) != 0;
    let meta = (mods & MOD_META) != 0;
    let alt = (mods & MOD_ALT) != 0;

    let eg = EditGroup::from_mods(meta, alt, shift);
    let em = &EDIT_META[eg as u8 as usize];

    let note_name = get_note_display(ev.row, is_drum, s);
    let col2_x = PAD_X + HALF_W + 6;

    // ---- Row 0: [extended name] (stack name) — ticker for long text ----
    {
        // Build extended name
        let extended = if is_drum && ev.chord_amount > 1 {
            // For drums: list all drum note names
            let mut offsets = [0i8; MAX_CHORD_SIZE];
            let count = engine_ui::get_chord_offsets(s, ev, &mut offsets, 0);
            let mut names = alloc::string::String::new();
            for i in 0..count {
                if i > 0 { names.push_str(", "); }
                let row = ev.row + offsets[i] as i16;
                let midi = row.clamp(0, 127) as i8;
                names.push_str(&get_drum_name(midi));
            }
            names
        } else if ev.chord_amount == 2 {
            let second_row = ev.row + ev.chord_space as i16;
            let midi1 = note_to_midi(ev.row, s);
            let midi2 = note_to_midi(second_row, s);
            let semitones = ((midi2 as i32) - (midi1 as i32)).unsigned_abs() as u8;
            if semitones == 12 {
                alloc::string::String::from("OCTAVE")
            } else if semitones > 12 {
                format!("{} +OCT", INTERVAL_NAMES[(semitones % 12) as usize])
            } else {
                alloc::string::String::from(INTERVAL_NAMES[semitones as usize])
            }
        } else if ev.chord_amount > 2 {
            let chord_name = get_chord_name_str(s, ev);
            if chord_name.is_empty() {
                alloc::string::String::new()
            } else {
                chord_name
            }
        } else if is_drum {
            // Single drum note: show drum name
            let midi = ev.row.clamp(0, 127) as i8;
            get_drum_name(midi)
        } else {
            alloc::string::String::from("SINGLE NOTE")
        };

        // Build stack name (voicing/inversion) — skip for drums and 2-note intervals
        let stack_name = if !is_drum && ev.chord_amount > 2 {
            let inv = ev.chord_inversion;
            if inv != 0 {
                format!("INV{}{}", if inv > 0 { "+" } else { "" }, inv)
            } else {
                let voicing = get_voicing_name(ev.chord_amount, ev.chord_space, ev.chord_voicing);
                if !voicing.is_empty() { to_upper(voicing) } else { alloc::string::String::from("BASE") }
            }
        } else {
            alloc::string::String::new()
        };

        // Combine into ticker row (left-aligned)
        let has_stack = !stack_name.is_empty();
        let display_str = if has_stack {
            format!("{}  ({})", extended, stack_name)
        } else {
            extended
        };
        // Shift up/down = inversion, Alt+Shift up/down = voicing — both affect row 0
        let row0_color = if em.ud_rows & 1 != 0 { GFX_YELLOW } else { GFX_VALUE };
        let text_w = gfx_aa_text_width(&display_str, &FONT_AA_SMALL_BOLD);
        let avail = CONTENT_RIGHT - PAD_X;
        if text_w <= avail {
            gfx_aa_text(PAD_X, ROW_Y5[0], &display_str, row0_color, &FONT_AA_SMALL_BOLD);
        } else {
            let wrap_dist = text_w + TICKER_WRAP_GAP;
            let offset = ticker_offset(0, &display_str, wrap_dist);
            let x1 = PAD_X - offset;
            gfx_aa_text_clipped(x1, ROW_Y5[0], &display_str, row0_color, &FONT_AA_SMALL_BOLD, PAD_X, CONTENT_RIGHT);
            let x2 = x1 + wrap_dist;
            if x2 < CONTENT_RIGHT {
                gfx_aa_text_clipped(x2, ROW_Y5[0], &display_str, row0_color, &FONT_AA_SMALL_BOLD, PAD_X, CONTENT_RIGHT);
            }
        }
    }

    // Color rules: yellow = up/down edits this, red = left/right edits this
    // eg: 0=bare, 1=shift, 2=cmd, 3=cmd+shift, 4=alt, 5=alt+shift
    // bare: up/down=move note, l/r=move position
    // shift: up/down=inversion(row0), l/r=length
    // cmd: up/down=stk amount, l/r=rpt amount
    // cmd+shift: up/down=stk space, l/r=rpt space
    // alt: up/down=arp style, l/r=arp offset
    // alt+shift: up/down=voicing(row0), l/r=arp voices

    // ---- Row 1: NOTE [note]  LEN [length] ----
    let length_str = ticks_to_musical_name(ev.length, s.zoom);
    let note_display = if is_drum {
        format!("{}", ev.row.clamp(0, 127))
    } else {
        note_name
    };
    // Row color helper: yellow if U/D target, red if L/R target, else value
    let row_color = |row: u8| -> u16 {
        if em.ud_rows & (1 << row) != 0 { GFX_YELLOW }
        else if em.lr_rows & (1 << row) != 0 { GFX_RED }
        else { GFX_VALUE }
    };
    // Left/right column colors for rows with two values (U/D edits left, L/R edits right)
    let row_ud_color = |row: u8| -> u16 {
        if em.ud_rows & (1 << row) != 0 { GFX_YELLOW } else { GFX_VALUE }
    };
    let row_lr_color = |row: u8| -> u16 {
        if em.lr_rows & (1 << row) != 0 { GFX_RED } else { GFX_VALUE }
    };

    gfx_aa_text(PAD_X, ROW_Y5[1], "NOTE", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text_right(PAD_X + HALF_W - 4, ROW_Y5[1], &note_display, row_color(1), &FONT_AA_SMALL_BOLD);
    gfx_aa_text(col2_x, ROW_Y5[1], "LEN", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text_right(CONTENT_RIGHT, ROW_Y5[1], &length_str, row_lr_color(1), &FONT_AA_SMALL_BOLD);

    // ---- Row 2: RPT [amount]  SPC [space] ----
    let rpt_amt_str = format!("{}", ev.repeat_amount);
    let rpt_space_str = ticks_to_canonical_name(ev.repeat_space);
    gfx_aa_text(PAD_X, ROW_Y5[2], "RPT", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text_right(PAD_X + HALF_W - 4, ROW_Y5[2], &rpt_amt_str, row_lr_color(2), &FONT_AA_SMALL_BOLD);
    gfx_aa_text(col2_x, ROW_Y5[2], "SPC", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text_right(CONTENT_RIGHT, ROW_Y5[2], &rpt_space_str, row_lr_color(2), &FONT_AA_SMALL_BOLD);

    // ---- Row 3: STK [amount]  SPC [space] ----
    gfx_aa_text(PAD_X, ROW_Y5[3], "STK", GFX_LABEL, &FONT_AA_SMALL);
    if ev.chord_amount > 1 {
        let ca_str = format!("{}", ev.chord_amount);
        let cs_str = format!("{}", ev.chord_space);
        gfx_aa_text_right(PAD_X + HALF_W - 4, ROW_Y5[3], &ca_str, row_ud_color(3), &FONT_AA_SMALL_BOLD);
        gfx_aa_text(col2_x, ROW_Y5[3], "SPC", GFX_LABEL, &FONT_AA_SMALL);
        gfx_aa_text_right(CONTENT_RIGHT, ROW_Y5[3], &cs_str, row_ud_color(3), &FONT_AA_SMALL_BOLD);
    } else {
        gfx_aa_text_right(PAD_X + HALF_W - 4, ROW_Y5[3], "1", row_ud_color(3), &FONT_AA_SMALL_BOLD);
    }

    // ---- Row 4: ARP [style] / [offset] ----
    gfx_aa_text(PAD_X, ROW_Y5[4], "ARP", GFX_LABEL, &FONT_AA_SMALL);
    let style_name = *ARP_STYLE_NAMES.get(ev.arp_style as usize).unwrap_or(&"CHD");
    if eg == EditGroup::Voicing {
        // Alt+Shift: show voices count
        let voices_str = format!("{}", ev.arp_voices);
        draw_segs_right(CONTENT_RIGHT, ROW_Y5[4], &[
            TextSeg { text: style_name, color: row_ud_color(4) },
            TextSeg { text: " / ", color: GFX_VALUE },
            TextSeg { text: &voices_str, color: row_lr_color(4) },
        ], &FONT_AA_SMALL_BOLD);
    } else if ev.arp_offset != 0 {
        let offset_str = format!("{}{}", if ev.arp_offset > 0 { "+" } else { "" }, ev.arp_offset);
        draw_segs_right(CONTENT_RIGHT, ROW_Y5[4], &[
            TextSeg { text: style_name, color: row_ud_color(4) },
            TextSeg { text: " / ", color: GFX_VALUE },
            TextSeg { text: &offset_str, color: row_lr_color(4) },
        ], &FONT_AA_SMALL_BOLD);
    } else {
        gfx_aa_text_right(CONTENT_RIGHT, ROW_Y5[4], style_name, row_ud_color(4), &FONT_AA_SMALL_BOLD);
    }

    // ---- Bottom legend (from EditMeta) ----
    // Override inversion label for single notes
    let ud_label = if eg == EditGroup::Inversion && ev.chord_amount <= 1 { "OCTAVE" } else { em.ud_label };
    draw_legend_item(0, 0, em.grid_label, GFX_BLUE);
    draw_legend_item(1, 1, ud_label, GFX_YELLOW);
    draw_legend_item(2, 2, em.lr_label, GFX_RED);
}

fn render_modify(s: &EngineState, mods: u8) {
    let sub_mode = s.modify_sub_mode as usize;
    let has_sel = s.selected_event_idx >= 0;
    let m_meta = (mods & MOD_META) != 0;

    if has_sel {
        let ch = s.current_channel as usize;
        let pat = s.current_patterns[ch] as usize;
        if s.selected_event_idx as usize >= s.patterns[ch][pat].event_count as usize {
            return;
        }
        let h = s.patterns[ch][pat].event_handles[s.selected_event_idx as usize];
        let ev = &s.event_pool.slots[h as usize];
        let is_drum = s.channel_types[ch] == CH_DRUM;

        let sm_arr = get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sub_mode);
        let loop_mode_val = sm_arr.loop_mode;
        let arr_len = sm_arr.length;
        let stay_val = sm_arr.stay;

        // ---- Row 0: note name + extended name ----
        let note_name = get_note_display(ev.row, is_drum, s);
        let extended = if is_drum {
            if ev.chord_amount > 1 {
                let mut offsets = [0i8; MAX_CHORD_SIZE];
                let count = engine_ui::get_chord_offsets(s, ev, &mut offsets, 0);
                let mut names = alloc::string::String::new();
                for i in 0..count {
                    if i > 0 { names.push_str(", "); }
                    let row = ev.row + offsets[i] as i16;
                    let midi = row.clamp(0, 127) as i8;
                    names.push_str(&get_drum_name(midi));
                }
                names
            } else {
                get_drum_name(ev.row.clamp(0, 127) as i8)
            }
        } else if ev.chord_amount > 1 {
            let chord_name = get_chord_name_str(s, ev);
            if !chord_name.is_empty() { to_upper(&chord_name) }
            else { alloc::string::String::new() }
        } else {
            alloc::string::String::from("SINGLE NOTE")
        };
        let display_str = format!("{} {}", note_name, extended);
        let text_w = gfx_aa_text_width(&display_str, &FONT_AA_SMALL_BOLD);
        let avail = CONTENT_RIGHT - PAD_X;
        if text_w <= avail {
            gfx_aa_text(PAD_X, ROW_Y5[0], &display_str, GFX_VALUE, &FONT_AA_SMALL_BOLD);
        } else {
            let wrap_dist = text_w + TICKER_WRAP_GAP;
            let offset = ticker_offset(0, &display_str, wrap_dist);
            let x1 = PAD_X - offset;
            gfx_aa_text_clipped(x1, ROW_Y5[0], &display_str, GFX_VALUE, &FONT_AA_SMALL_BOLD, PAD_X, CONTENT_RIGHT);
            let x2 = x1 + wrap_dist;
            if x2 < CONTENT_RIGHT {
                gfx_aa_text_clipped(x2, ROW_Y5[0], &display_str, GFX_VALUE, &FONT_AA_SMALL_BOLD, PAD_X, CONTENT_RIGHT);
            }
        }

        // ---- Row 1: MODE label + all sub-mode labels in cycle order ----
        // Cycle order: VEL(0), MOD(4), INV(5), HIT(1), FLAM(3), TIME(2)
        {
            static MODE_DISPLAY_ORDER: [usize; 6] = [0, 4, 5, 1, 3, 2];
            gfx_aa_text(PAD_X, ROW_Y5[1], "MODE", GFX_LABEL, &FONT_AA_SMALL);
            let mut x = PAD_X + gfx_aa_text_width("MODE ", &FONT_AA_SMALL);
            for &i in MODE_DISPLAY_ORDER.iter() {
                let label = SUB_MODE_LABELS.get(i).unwrap_or(&"?");
                let has_data = ev.sub_mode_handles[i] != POOL_HANDLE_NONE;
                let font = if has_data { &FONT_AA_SMALL_BOLD } else { &FONT_AA_SMALL };
                let color = if i == sub_mode {
                    if !m_meta { GFX_YELLOW } else { GFX_VALUE }
                } else {
                    GFX_DIM
                };
                gfx_aa_text(x, ROW_Y5[1], label, color, font);
                x += gfx_aa_text_width(label, font) + 4;
            }
        }

        // ---- Row 2: LOOP [RST/CNT/FIL] — all modes shown, current highlighted ----
        {
            static LOOP_DISPLAY_LABELS: [&str; 3] = ["RST", "CNT", "FIL"];
            gfx_aa_text(PAD_X, ROW_Y5[2], "LOOP", GFX_LABEL, &FONT_AA_SMALL);
            let mut x = PAD_X + gfx_aa_text_width("LOOP ", &FONT_AA_SMALL);
            for (i, &label) in LOOP_DISPLAY_LABELS.iter().enumerate() {
                let color = if i == loop_mode_val as usize {
                    if m_meta { GFX_YELLOW } else { GFX_VALUE }
                } else {
                    GFX_DIM
                };
                gfx_aa_text(x, ROW_Y5[2], label, color, &FONT_AA_SMALL_BOLD);
                x += gfx_aa_text_width(label, &FONT_AA_SMALL_BOLD) + 4;
            }
        }

        // ---- Row 3: LEN [n]  STAY [n] ----
        let len_str = format!("{}", arr_len);
        let len_color = if !m_meta { GFX_RED } else { GFX_VALUE };
        let stay_str = format!("{}", stay_val);
        let stay_color = if m_meta { GFX_RED } else { GFX_VALUE };
        draw_row_two_col(ROW_Y5[3], "LEN", &len_str, len_color, "STAY", &stay_str, stay_color);

        // Legend
        if m_meta {
            draw_legend_item(0, 0, "", GFX_DIM);
            draw_legend_item(1, 1, "LOOP", GFX_YELLOW);
            draw_legend_item(2, 2, "STAY", GFX_RED);
        } else {
            draw_legend_item(0, 0, "", GFX_DIM);
            draw_legend_item(1, 1, "MODE", GFX_YELLOW);
            draw_legend_item(2, 2, "LENGTH", GFX_RED);
        }
    } else {
        // No note selected — show MODE label + sub-mode labels in cycle order
        {
            static MODE_DISPLAY_ORDER: [usize; 6] = [0, 4, 5, 1, 3, 2];
            gfx_aa_text(PAD_X, ROW_Y5[0], "MODE", GFX_LABEL, &FONT_AA_SMALL);
            let mut x = PAD_X + gfx_aa_text_width("MODE ", &FONT_AA_SMALL);
            for &i in MODE_DISPLAY_ORDER.iter() {
                let label = SUB_MODE_LABELS.get(i).unwrap_or(&"?");
                let color = if i == sub_mode {
                    if !m_meta { GFX_YELLOW } else { GFX_VALUE }
                } else {
                    GFX_DIM
                };
                gfx_aa_text(x, ROW_Y5[0], label, color, &FONT_AA_SMALL);
                x += gfx_aa_text_width(label, &FONT_AA_SMALL) + 4;
            }
        }
        gfx_aa_text(PAD_X, ROW_Y5[1], "SELECT A NOTE", GFX_DIM, &FONT_AA_SMALL);

        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, if !m_meta { "MODE" } else { "" }, if !m_meta { GFX_YELLOW } else { GFX_DIM });
        draw_legend_item(2, 2, "", GFX_DIM);
    }
}

fn render_channel(s: &EngineState) {
    let ch = s.current_channel;
    let pat = s.current_patterns[ch as usize];
    let ch_buf = format!("CH {}", ch + 1);
    let pat_buf = format!("{}", pat + 1);

    gfx_aa_text(PAD_X, ROW_Y[0], "MODE", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text(PAD_X + 50, ROW_Y[0], "CHANNEL", GFX_VALUE, &FONT_AA_SMALL_BOLD);
    gfx_aa_text(PAD_X, ROW_Y[1], "SELECT", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text(PAD_X + 64, ROW_Y[1], &ch_buf, GFX_VALUE, &FONT_AA_SMALL_BOLD);
    gfx_aa_text(PAD_X, ROW_Y[2], "PAT", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text(PAD_X + 50, ROW_Y[2], &pat_buf, GFX_VALUE, &FONT_AA_SMALL_BOLD);
}

fn render_loop(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let loop_data = &s.loops[ch][pat];
    let loop_start = loop_data.start;
    let loop_end = loop_data.start + loop_data.length;
    let l_shift = (mods & MOD_SHIFT) != 0;
    let l_meta = (mods & MOD_META) != 0;

    gfx_aa_text(PAD_X, ROW_Y[0], "MODE", GFX_LABEL, &FONT_AA_SMALL);
    gfx_aa_text(PAD_X + 50, ROW_Y[0], "LOOP", GFX_VALUE, &FONT_AA_SMALL_BOLD);

    let s_buf = tick_to_beat_display(loop_start);
    let e_buf = tick_to_beat_display(loop_end - s.zoom);

    let editing_start = l_meta;
    let sx = PAD_X;
    gfx_aa_text(sx, ROW_Y[1], "LOOP ", GFX_LABEL, &FONT_AA_SMALL);
    let lx = sx + gfx_aa_text_width("LOOP ", &FONT_AA_SMALL);
    let s_color = if editing_start { GFX_YELLOW } else { GFX_VALUE };
    let e_color = if !editing_start { GFX_YELLOW } else { GFX_VALUE };
    gfx_aa_text(lx, ROW_Y[1], &s_buf, s_color, &FONT_AA_SMALL_BOLD);
    let sw = gfx_aa_text_width(&s_buf, &FONT_AA_SMALL_BOLD);
    gfx_aa_text(lx + sw, ROW_Y[1], "-", GFX_DIM, &FONT_AA_SMALL_BOLD);
    let dw = gfx_aa_text_width("-", &FONT_AA_SMALL_BOLD);
    gfx_aa_text(lx + sw + dw, ROW_Y[1], &e_buf, e_color, &FONT_AA_SMALL_BOLD);

    let step_str = if l_shift { "+/- 0.1" } else { "+/- 1" };
    if editing_start {
        draw_icon_legend(ROW_Y[2], "START", step_str, OLED_YELLOW);
    } else {
        draw_icon_legend(ROW_Y[2], "END", step_str, OLED_YELLOW);
    }
}

// ============ Chord name (simplified inline version for screen rendering) ============

fn get_chord_name_str(s: &EngineState, ev: &NoteEvent) -> alloc::string::String {
    if ev.chord_amount <= 1 {
        return alloc::string::String::new();
    }

    let mut offsets = [0i8; MAX_CHORD_SIZE];
    let chord_count = engine_ui::get_chord_offsets(s, ev, &mut offsets, 0);

    let mut pitch_classes = [0u8; MAX_CHORD_SIZE];
    let mut pc_count = 0usize;
    let mut lowest_midi: i8 = 127;
    let mut bass_pc: u8 = 0;

    (0..chord_count).for_each(|i| {
        let midi = note_to_midi(ev.row + offsets[i] as i16, s);
        if midi < 0 { return; }
        if midi < lowest_midi { lowest_midi = midi; bass_pc = (midi % 12) as u8; }
        let pc = (midi % 12) as u8;
        if !pitch_classes[..pc_count].contains(&pc) && pc_count < MAX_CHORD_SIZE {
            pitch_classes[pc_count] = pc;
            pc_count += 1;
        }
    });

    if pc_count < 2 { return alloc::string::String::new(); }

    pitch_classes[..pc_count].sort_unstable();

    let bass_idx = pitch_classes[..pc_count].iter().position(|&p| p == bass_pc).unwrap_or(0);

    struct ChordTemplate {
        intervals: [u8; 4],
        count: u8,
        suffix: &'static str,
    }

    static TEMPLATES: &[ChordTemplate] = &[
        ChordTemplate { intervals: [4,7,0,0], count: 2, suffix: "" },
        ChordTemplate { intervals: [3,7,0,0], count: 2, suffix: "M" },
        ChordTemplate { intervals: [3,6,0,0], count: 2, suffix: "DIM" },
        ChordTemplate { intervals: [4,8,0,0], count: 2, suffix: "AUG" },
        ChordTemplate { intervals: [2,7,0,0], count: 2, suffix: "SUS2" },
        ChordTemplate { intervals: [5,7,0,0], count: 2, suffix: "SUS4" },
        ChordTemplate { intervals: [4,7,11,0], count: 3, suffix: "MAJ7" },
        ChordTemplate { intervals: [4,7,10,0], count: 3, suffix: "7" },
        ChordTemplate { intervals: [3,7,10,0], count: 3, suffix: "M7" },
        ChordTemplate { intervals: [3,7,11,0], count: 3, suffix: "MM7" },
        ChordTemplate { intervals: [3,6,10,0], count: 3, suffix: "M7B5" },
        ChordTemplate { intervals: [3,6,9,0], count: 3, suffix: "DIM7" },
        ChordTemplate { intervals: [4,8,10,0], count: 3, suffix: "AUG7" },
        ChordTemplate { intervals: [4,7,9,0], count: 3, suffix: "6" },
        ChordTemplate { intervals: [3,7,9,0], count: 3, suffix: "M6" },
        ChordTemplate { intervals: [5,7,10,0], count: 3, suffix: "7SUS4" },
        ChordTemplate { intervals: [7,0,0,0], count: 1, suffix: "5" },
    ];

    static ROMAN: [&str; 7] = ["I","II","III","IV","V","VI","VII"];
    static NOTE_NAMES_L: [&str; 12] = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

    let mut best_suffix: Option<&str> = None;
    let mut best_root_pc: u8 = 0;
    let mut best_match_count: u8 = 0;

    (0..pc_count).for_each(|r| {
        let rot = if r == 0 { bass_idx } else if r <= bass_idx { r - 1 } else { r };
        let root_pc = pitch_classes[rot];
        let mut intervals = [0u8; MAX_CHORD_SIZE - 1];
        let mut n_intervals = 0usize;

        (0..pc_count).filter(|&i| i != rot).for_each(|i| {
            intervals[n_intervals] = ((pitch_classes[i] as i16 - root_pc as i16 + 12) % 12) as u8;
            n_intervals += 1;
        });
        intervals[..n_intervals].sort_unstable();

        TEMPLATES.iter().for_each(|tmpl| {
            if tmpl.count > n_intervals as u8 || tmpl.count <= best_match_count { return; }
            let all_found = (0..tmpl.count as usize).all(|k| {
                intervals[..n_intervals].contains(&tmpl.intervals[k])
            });
            if all_found {
                best_suffix = Some(tmpl.suffix);
                best_root_pc = root_pc;
                best_match_count = tmpl.count;
            }
        });
    });

    let mut result = alloc::string::String::new();

    if let Some(suffix) = best_suffix {
        result.push_str(NOTE_NAMES_L[best_root_pc as usize]);
        result.push_str(suffix);
        if best_root_pc != bass_pc {
            result.push('/');
            result.push_str(NOTE_NAMES_L[bass_pc as usize]);
        }
    } else {
        let root_pc = pitch_classes[0];
        result.push_str(NOTE_NAMES_L[root_pc as usize]);
        result.push('(');
        (1..pc_count).for_each(|i| {
            if i > 1 { result.push(','); }
            let iv = ((pitch_classes[i] as i16 - root_pc as i16 + 12) % 12) as u8;
            result.push_str(&format!("{}", iv));
        });
        result.push(')');
        best_root_pc = root_pc;
    }

    // Scale degree
    let zi = s.scale_zero_index as usize;
    let octave_size = s.scale_octave_size as usize;
    let degree = (0..octave_size.min(12))
        .find(|&d| zi + d < s.scale_count as usize && s.scale_notes[zi + d] % 12 == best_root_pc)
        .map(|d| d as i8)
        .unwrap_or(-1);

    if degree >= 0 && degree < 7 {
        result.push_str(" (");
        result.push_str(ROMAN[degree as usize]);
        result.push(')');
    }

    result
}

// ============ Public entry point ============

pub fn oled_render(modifiers: u8) {
    unsafe { FRAME_COUNT = FRAME_COUNT.wrapping_add(1); }
    gfx_clear(GFX_BLACK);

    let s = unsafe {
        let ptr = crate::G_STATE_PTR;
        if ptr.is_null() { return; }
        &*ptr
    };

    let mode = s.ui_mode;
    let has_sel = s.selected_event_idx >= 0;

    match mode {
        0 => { // UI_PATTERN
            if has_sel { render_pattern_selected(s, modifiers); }
            else { render_pattern_default(s, modifiers); }
        },
        1 => render_channel(s),             // UI_CHANNEL
        2 => render_loop(s, modifiers),     // UI_LOOP
        3 => render_modify(s, modifiers),   // UI_MODIFY
        _ => render_pattern_default(s, modifiers),
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_note_c4() {
        assert_eq!(midi_note_to_name(60), "C4");
    }

    #[test]
    fn midi_note_a4() {
        assert_eq!(midi_note_to_name(69), "A4");
    }

    #[test]
    fn midi_note_c_neg1() {
        assert_eq!(midi_note_to_name(0), "C-1");
    }

    #[test]
    fn midi_note_g_sharp_5() {
        assert_eq!(midi_note_to_name(80), "G#5");
    }

    #[test]
    fn midi_note_highest() {
        assert_eq!(midi_note_to_name(127), "G9");
    }

    #[test]
    fn midi_note_invalid() {
        assert_eq!(midi_note_to_name(-1), "??");
    }

    #[test]
    fn beat_display_beat_1() {
        assert_eq!(tick_to_beat_display(0), "1");
    }

    #[test]
    fn beat_display_beat_2() {
        assert_eq!(tick_to_beat_display(480), "2");
    }

    #[test]
    fn beat_display_subdivision() {
        assert_eq!(tick_to_beat_display(120), "1.2");
    }

    #[test]
    fn beat_display_third_sixteenth() {
        assert_eq!(tick_to_beat_display(240), "1.3");
    }

    #[test]
    fn musical_name_sixteenth() {
        assert_eq!(ticks_to_musical_name(120, 120), "1/16");
    }

    #[test]
    fn musical_name_eighth() {
        assert_eq!(ticks_to_musical_name(240, 120), "2/16");
    }

    #[test]
    fn musical_name_triplet() {
        assert_eq!(ticks_to_musical_name(160, 120), "1/8T");
    }

    #[test]
    fn musical_name_quarter() {
        assert_eq!(ticks_to_musical_name(480, 120), "4/16");
    }

    #[test]
    fn musical_name_fallback() {
        assert_eq!(ticks_to_musical_name(17, 120), "17t");
    }

    #[test]
    fn canonical_sixteenth() {
        assert_eq!(ticks_to_canonical_name(120), "1/16");
    }

    #[test]
    fn canonical_quarter() {
        assert_eq!(ticks_to_canonical_name(480), "1/4");
    }

    #[test]
    fn canonical_half() {
        assert_eq!(ticks_to_canonical_name(960), "1/2");
    }

    #[test]
    fn canonical_whole() {
        assert_eq!(ticks_to_canonical_name(1920), "1");
    }

    #[test]
    fn canonical_triplet() {
        assert_eq!(ticks_to_canonical_name(160), "1/8T");
    }

    #[test]
    fn canonical_two_quarters() {
        assert_eq!(ticks_to_canonical_name(960), "1/2");
    }

    #[test]
    fn canonical_fallback() {
        assert_eq!(ticks_to_canonical_name(17), "17t");
    }

    #[test]
    fn drum_name_kick() {
        assert_eq!(get_drum_name(36), "KICK");
    }

    #[test]
    fn drum_name_snare() {
        assert_eq!(get_drum_name(38), "SNARE");
    }

    #[test]
    fn drum_name_cl_hh() {
        assert_eq!(get_drum_name(42), "CL HH");
    }

    #[test]
    fn drum_name_out_of_range() {
        assert_eq!(get_drum_name(10), "D10");
    }

    #[test]
    fn drum_name_boundary_low() {
        assert_eq!(get_drum_name(35), "KICK 2");
    }

    #[test]
    fn drum_name_boundary_high() {
        assert_eq!(get_drum_name(81), "OP TRI");
    }
}
