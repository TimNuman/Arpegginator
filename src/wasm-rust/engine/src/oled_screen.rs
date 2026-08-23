// oled_screen.rs — panel content rendering
// Portrait layout on a 240x320 memory LCD, Spleen bitmap fonts

use core::fmt::Write;
use core::sync::atomic::{AtomicU32, Ordering};
use libm::{cosf, sinf};
use crate::cell::Global;
use crate::engine_core::FmtBuf;
use crate::oled_gfx::*;
use crate::oled_display::*;
use crate::engine_core::*;
use crate::engine_ui;

const CH_DRUM: u8 = ChannelType::Drum as u8;

// ============ Layout constants (240×320) ============
//
// The panel is a JDI LPM044M141A: 4.4", 640x480 over 89.66 x 67.25 mm. The UI
// is drawn at half that and blitted as 2x2 blocks, so a UI pixel is 0.28 mm —
// nearly twice the 2.7" part's. Everything is physically larger at the same
// pixel size, which is why labels can drop to a 5x8 face and still read: 5x8
// here is bigger on the glass than 6x12 was there.
//
// The module mounts on its side, so the UI is 240 wide by 320 tall. Nothing is
// reserved sideways any more: the dial stacks under the content instead of
// taking a column, every value well runs the full width, and the three axis
// legends pack 1 + 2 at the foot — the grid across the top, the two encoder
// axes side by side beneath it, which is the shape of the two knobs below.

const DISPLAY_W: i16 = GFX_WIDTH as i16;
const PAD_X: i16 = 8;
// Portrait: nothing is reserved sideways, so content runs the full width and
// every value hangs off the same right edge.
const CONTENT_RIGHT: i16 = DISPLAY_W - PAD_X;
const CONTENT_W: i16 = CONTENT_RIGHT - PAD_X;
const HALF_W: i16 = CONTENT_W / 2;

// Title bar (pinstriped, with a close box and a transport readout)
const TITLE_H: i16 = 22;

// Sunken value wells: the label sits in a fixed gutter, the value in the well.
const LABEL_GUTTER: i16 = 32;
const WELL_H: i16 = 18;

// Row Y positions (top of the text line; 4 data rows + ruler + button bar)
const ROW_Y: [i16; 4] = [32, 59, 86, 113];
// 5-row layout for the screens with no dial — the note view and the sound
// pages. Portrait gives these 231 px between the title and the button bar for
// five rows, so they spread to fill it rather than sitting in a compact block
// with a dead band underneath.
const ROW_Y5: [i16; 5] = [31, 78, 125, 172, 219];

// Scale-degree ruler
const DOT_Y: i16 = 137;
const DOT_SIZE: i16 = 12;
const DOT_GAP: i16 = 2;

// Circle of fifths, now centered under the ruler rather than parked in a side
// column. Slightly tighter than it was, with the root chip scaled to match so
// the ticks keep their air.
const DIAL_CY: i16 = 201;
const DIAL_R: i16 = 40;
const DIAL_CHIP_H: i16 = 28;

// Bottom button bar — the only place structure is allowed color. Three axes,
// packed 1 + 2: the grid takes the full width on top, the two encoder axes
// share the row beneath it, which is the shape of the two knobs below.
const LEGEND_Y: [i16; 2] = [253, 286];
const BTN_H: i16 = 26;
const BTN_MARGIN: i16 = 6;
const BTN_GAP: i16 = 8;
const BTN_SHADOW: i16 = 3;
const BTN_W_FULL: i16 = DISPLAY_W - 2 * BTN_MARGIN - BTN_SHADOW;
const BTN_W_HALF: i16 = (DISPLAY_W - 2 * BTN_MARGIN - BTN_GAP - BTN_SHADOW) / 2;
const ICON_SIZE: i16 = 10;
const ICON_LABEL_GAP: i16 = 6;

/// Where a legend column's slab sits: x, y, width.
const fn legend_box(col: i16) -> (i16, i16, i16) {
    match col {
        0 => (BTN_MARGIN, LEGEND_Y[0], BTN_W_FULL),
        1 => (BTN_MARGIN, LEGEND_Y[1], BTN_W_HALF),
        _ => (BTN_MARGIN + BTN_W_HALF + BTN_GAP, LEGEND_Y[1], BTN_W_HALF),
    }
}

// ============ Ticker animation ============

const TICKER_PAUSE_FRAMES: u32 = 120;  // 2s at 60fps
const TICKER_PX_FRAMES: u32 = 15;     // 0.25s per pixel
const TICKER_WRAP_GAP: i16 = 15;      // pixel gap between looping copies

static FRAME_COUNT: AtomicU32 = AtomicU32::new(0);

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

static TICKERS: Global<[TickerState; NUM_TICKERS]> = Global::new([
    TickerState::new(), TickerState::new(),
    TickerState::new(), TickerState::new(),
    TickerState::new(), TickerState::new(),
    TickerState::new(),
]);

fn simple_hash(s: &str) -> u32 {
    s.bytes().fold(5381u32, |h, b| h.wrapping_mul(33).wrapping_add(b as u32))
}

/// Compute the scroll offset for a wrapping ticker.
/// `scroll_dist` = total_w + TICKER_WRAP_GAP (full wrap distance).
/// The cycle holds still for `pause_frames`, then scrolls one pixel every
/// `TICKER_PX_FRAMES`. Returns 0..scroll_dist; callers draw two copies
/// separated by scroll_dist.
fn ticker_offset(slot: usize, text: &str, scroll_dist: i16, pause_frames: u32) -> i16 {
    if scroll_dist <= 0 || slot >= NUM_TICKERS { return 0; }

    let hash = simple_hash(text);
    let frame = FRAME_COUNT.load(Ordering::Relaxed);
    let tk = &mut TICKERS.get_mut()[slot];

    if tk.text_hash != hash || tk.scroll_dist != scroll_dist {
        tk.text_hash = hash;
        tk.frame_start = frame;
        tk.scroll_dist = scroll_dist;
    }

    let elapsed = frame.wrapping_sub(tk.frame_start);
    let scroll_frames = scroll_dist as u32 * TICKER_PX_FRAMES;
    let phase = elapsed % (pause_frames + scroll_frames);
    (phase.saturating_sub(pause_frames) / TICKER_PX_FRAMES) as i16
}

/// Returns true if any ticker is currently scrolling (needs continuous rendering)
pub fn oled_is_animating() -> bool {
    TICKERS.get().iter().any(|tk| tk.scroll_dist > 0)
}

// ============ Modifier key bitmask ============

const MOD_SHIFT: u8 = 1;
const MOD_META: u8 = 2;
const MOD_ALT: u8 = 4;
#[allow(dead_code)]
const MOD_CTRL: u8 = 8;

// ============ String helpers ============

use crate::chords::NOTE_NAMES;

fn midi_note_to_name(note: i8) -> FmtBuf<8> {
    let mut buf = FmtBuf::<8>::new();
    if note < 0 {
        buf.push_str("??");
    } else {
        let octave = (note as i32 / 12) - 1;
        let idx = (note as usize) % 12;
        let _ = write!(buf, "{}{}", NOTE_NAMES[idx], octave);
    }
    buf
}

fn tick_to_beat_display(tick: i32) -> FmtBuf<8> {
    let mut buf = FmtBuf::<8>::new();
    let beat = (tick / TICKS_PER_QUARTER) + 1;
    let sub = tick % TICKS_PER_QUARTER;
    if sub == 0 {
        let _ = write!(buf, "{}", beat);
    } else {
        let sixteenth = (sub / (TICKS_PER_QUARTER / 4)) + 1;
        let _ = write!(buf, "{}.{}", beat, sixteenth);
    }
    buf
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

fn ticks_to_musical_name(ticks: i32, zoom: i32) -> FmtBuf<16> {
    let mut buf = FmtBuf::<16>::new();
    if let Some(trip) = lookup_triplet(ticks) {
        buf.push_str(trip);
    } else if ticks > 0 && zoom > 0 && (ticks % zoom == 0) {
        let n = ticks / zoom;
        let denom = 1920 / zoom;
        let _ = write!(buf, "{}/{}", n, denom);
    } else if let Some(mus) = lookup_musical(ticks) {
        buf.push_str(mus);
    } else {
        let _ = write!(buf, "{}t", ticks);
    }
    buf
}

pub(crate) fn ticks_to_canonical_name(ticks: i32) -> FmtBuf<16> {
    let mut buf = FmtBuf::<16>::new();
    if let Some(trip) = lookup_triplet(ticks) {
        buf.push_str(trip);
    } else if let Some(mus) = lookup_musical(ticks) {
        buf.push_str(mus);
    } else if ticks > 0 && (ticks % 1920 == 0) {
        let _ = write!(buf, "{}", ticks / 1920);
    } else {
        let found = MUSICAL_NAMES.iter()
            .find(|m| m.ticks > 0 && (ticks % m.ticks == 0) && m.name.starts_with("1/"));
        if let Some(m) = found {
            let denom: i32 = parse_i32(&m.name[2..]);
            if denom > 0 {
                let _ = write!(buf, "{}/{}", ticks / m.ticks, denom);
            } else {
                let _ = write!(buf, "{}t", ticks);
            }
        } else {
            let _ = write!(buf, "{}t", ticks);
        }
    }
    buf
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

fn get_drum_name(midi: i8) -> FmtBuf<8> {
    let mut buf = FmtBuf::<8>::new();
    if (GM_DRUM_MIN..=GM_DRUM_MAX).contains(&midi) {
        buf.push_str(GM_DRUM_NAMES[(midi - GM_DRUM_MIN) as usize]);
    } else {
        let _ = write!(buf, "D{}", midi);
    }
    buf
}

/// Parse a decimal integer from a string (no_std replacement for .parse())
fn parse_i32(s: &str) -> i32 {
    let mut result: i32 = 0;
    for &b in s.as_bytes() {
        if b.is_ascii_digit() {
            result = result * 10 + (b - b'0') as i32;
        } else {
            break;
        }
    }
    result
}

/// Uppercase an ASCII string (for display purposes)
fn to_upper(s: &str) -> FmtBuf<32> {
    let mut buf = FmtBuf::<32>::new();
    buf.push_str(s);
    buf.make_ascii_uppercase();
    buf
}

/// Chord name for an event, uppercased for the OLED.
fn chord_name_upper(s: &EngineState, ev: &NoteEvent) -> FmtBuf<64> {
    let mut name = crate::chords::format_chord_name(s, ev);
    name.make_ascii_uppercase();
    name
}

// ============ Sub-mode / loop mode labels ============

static SUB_MODE_LABELS: [&str; 7] = ["VEL", "HIT", "TIME", "FLAM", "MOD", "INV", "WHL"];
pub(crate) static ARP_STYLE_NAMES: [&str; 15] = ["CHD", "UP", "DN", "U/D", "D/U", "C.UP", "C.DN", "C.U/D", "C.D/U", "E1M1", "Z.UP", "Z.DN", "Z.U/D", "Z.D/U", "RND"];
static INTERVAL_NAMES: [&str; 12] = [
    "UNISON", "MIN 2ND", "2ND", "MIN 3RD", "3RD", "4TH",
    "TRITONE", "5TH", "MIN 6TH", "6TH", "MIN 7TH", "7TH",
];

// ============ Note display helper ============

/// Append comma-separated GM drum names for every note of a (possibly
/// stacked) drum event.
fn push_drum_names(s: &EngineState, ev: &NoteEvent, out: &mut FmtBuf<128>) {
    let mut offsets = [0i8; MAX_CHORD_SIZE];
    let count = engine_ui::get_chord_offsets(s, ev, &mut offsets, 0);
    for (i, &off) in offsets[..count].iter().enumerate() {
        if i > 0 { out.push_str(", "); }
        let row = ev.row + off as i16;
        out.push_str(get_drum_name(row.clamp(0, 127) as i8).as_str());
    }
}

fn get_note_display(row: i16, is_drum: bool, s: &EngineState) -> FmtBuf<8> {
    if is_drum {
        get_drum_name(row.clamp(0, 127) as i8)
    } else {
        midi_note_to_name(note_to_midi(row, s))
    }
}

// ============ Drawing helpers ============

/// Draw `text` left-anchored at `x`. If it overflows `clip_right`, scroll it
/// as a seamless wrapping marquee (two clipped copies) using `ticker_slot`.
/// `pause_frames` is the hold time at the start of each wrap cycle.
#[allow(clippy::too_many_arguments)]
fn draw_marquee(ticker_slot: usize, x: i16, clip_right: i16, y: i16,
                text: &str, color: u16, font: &BitFont, pause_frames: u32) {
    let text_w = gfx_text_width(text, font);
    if text_w <= clip_right - x {
        gfx_text(x, y, text, color, font);
        return;
    }
    let wrap_dist = text_w + TICKER_WRAP_GAP;
    let offset = ticker_offset(ticker_slot, text, wrap_dist, pause_frames);
    let x1 = x - offset;
    gfx_text_clipped(x1, y, text, color, font, x, clip_right);
    let x2 = x1 + wrap_dist;
    if x2 < clip_right {
        gfx_text_clipped(x2, y, text, color, font, x, clip_right);
    }
}

/// Call sites pass an axis color to mean "the held modifier edits this". On a
/// 1-bit panel that cannot be a text color, so it becomes the well fill and the
/// value flips to whichever ink reads on it.
fn fill_for(color: u16) -> u16 {
    match color {
        GFX_AXIS_UD | GFX_AXIS_LR | GFX_AXIS_GRID | GFX_ALERT => color,
        _ => GFX_GROUND,
    }
}

/// Label in its gutter, value right-aligned in a sunken well.
fn draw_field(x: i16, w: i16, y: i16, label: &str, value: &str, val_color: u16) {
    let fill = fill_for(val_color);
    // 6x12 label against a 16px value — nudge it onto the value's optical center
    gfx_text_right(x + LABEL_GUTTER - 8, y + 3, label, GFX_LABEL, &FONT_SMALL);
    let wx = x + LABEL_GUTTER;
    let ww = w - LABEL_GUTTER;
    if fill != GFX_GROUND {
        gfx_fill_rect(wx + 1, y, ww - 2, WELL_H - 2, fill);
    }
    gfx_frame(wx, y - 1, ww, WELL_H, GFX_INK);
    gfx_text_right(x + w - 5, y, value, gfx_ink_on(fill), &FONT_VALUE);
}

/// Full-width headline slab. Selection is inversion; when the up/down axis
/// edits what it names, the slab takes that axis color instead.
fn draw_banner(text: &str, ticker_slot: usize, hint: &str, hint_color: u16) {
    draw_selection_bar(text, ticker_slot, hint, hint_color);
}

/// Pinstriped title bar with a close box and a transport readout — the
/// System 6 window frame, which exists because that display was 1-bit too.
fn draw_titlebar(s: &EngineState, mode: &str) {
    gfx_frame(0, 0, DISPLAY_W, GFX_HEIGHT as i16, GFX_INK);

    let mut y = 5;
    while y <= 17 {
        gfx_hline(3, y, DISPLAY_W - 6, GFX_INK);
        y += 2;
    }
    gfx_hline(1, TITLE_H, DISPLAY_W - 2, GFX_INK);

    // Close box
    gfx_fill_rect(5, 4, 16, 15, GFX_GROUND);
    gfx_frame(7, 6, 12, 12, GFX_INK);
    gfx_frame(9, 8, 8, 8, GFX_INK);

    // Title, knocked out of the stripes
    let tw = gfx_text_width(mode, &FONT_MEDIUM);
    let cx = DISPLAY_W / 2 - tw / 2;
    gfx_fill_rect(cx - 9, 3, tw + 18, 17, GFX_GROUND);
    gfx_text(cx, 3, mode, GFX_INK, &FONT_MEDIUM);

    // Transport readout: play caret + tempo
    let mut bpm = FmtBuf::<12>::new();
    let _ = write!(bpm, "{:.1}", s.bpm);
    let bw = gfx_text_width(&bpm, &FONT_MEDIUM) + 26;
    gfx_fill_rect(DISPLAY_W - bw - 9, 4, bw + 5, 15, GFX_GROUND);
    gfx_frame(DISPLAY_W - bw - 6, 5, bw, 13, GFX_INK);
    gfx_text_right(DISPLAY_W - 11, 3, &bpm, GFX_INK, &FONT_MEDIUM);
    let px = DISPLAY_W - bw - 1;
    gfx_vline(px, 8, 7, GFX_INK);
    gfx_vline(px + 1, 9, 5, GFX_INK);
    gfx_vline(px + 2, 10, 3, GFX_INK);
    gfx_pixel(px + 3, 11, GFX_INK);
}

/// Full-width inverted bar — a list selection, the gesture this panel is
/// best at. An axis color rides as a chip on the right rather than recoloring
/// the text.
fn draw_selection_bar(text: &str, ticker_slot: usize, hint: &str, hint_color: u16) {
    let bar_y = TITLE_H + 5;
    gfx_fill_rect(1, bar_y, DISPLAY_W - 2, 23, GFX_INK);

    let mut clip_right = DISPLAY_W - 8;
    let fill = fill_for(hint_color);
    if fill != GFX_GROUND && !hint.is_empty() {
        let hw = gfx_text_width(hint, &FONT_SMALL) + 12;
        gfx_fill_rect(DISPLAY_W - hw - 7, bar_y + 5, hw, 14, fill);
        gfx_text(DISPLAY_W - hw - 1, bar_y + 6, hint, gfx_ink_on(fill), &FONT_SMALL);
        clip_right = DISPLAY_W - hw - 14;
    }
    draw_marquee(ticker_slot, PAD_X, clip_right, bar_y + 1, text, GFX_GROUND,
                 &FONT_LARGE, TICKER_PAUSE_FRAMES);
}

/// Draw label + value on a full-width row
fn draw_row(y: i16, label: &str, value: &str, val_color: u16) {
    draw_field(PAD_X, CONTENT_W, y, label, value, val_color);
}

/// Draw label + value with ticker scrolling if value overflows.
/// `ticker_slot` identifies which ticker state to use (0–3).
fn draw_row_tickered(y: i16, label: &str, value: &str, val_color: u16, ticker_slot: usize) {
    let val_w = gfx_text_width(value, &FONT_VALUE);
    let well_x = PAD_X + LABEL_GUTTER;
    let avail = CONTENT_RIGHT - well_x - 10;

    if val_w <= avail {
        draw_field(PAD_X, CONTENT_W, y, label, value, val_color);
        return;
    }

    // Overflow — the value scrolls inside its well
    let fill = fill_for(val_color);
    gfx_text_right(PAD_X + LABEL_GUTTER - 8, y + 3, label, GFX_LABEL, &FONT_SMALL);
    if fill != GFX_GROUND {
        gfx_fill_rect(well_x + 1, y - 1, CONTENT_RIGHT - well_x - 2, WELL_H - 2, fill);
    }
    gfx_frame(well_x, y - 2, CONTENT_RIGHT - well_x, WELL_H, GFX_INK);
    draw_marquee(ticker_slot, well_x + 5, CONTENT_RIGHT - 5, y,
                 value, gfx_ink_on(fill), &FONT_VALUE, TICKER_PAUSE_FRAMES);
}

/// Draw a two-column row (row 0: CH xx | PAT yy)
pub(crate) fn draw_row_two_col(y: i16, label1: &str, val1: &str, val1_color: u16,
                    label2: &str, val2: &str, val2_color: u16) {
    let col_w = HALF_W - 5;
    draw_field(PAD_X, col_w, y, label1, val1, val1_color);
    draw_field(PAD_X + HALF_W + 5, col_w, y, label2, val2, val2_color);
}

/// Draw the "MODE" row: every sub-mode label in cycle order, the current one
/// highlighted (yellow when actively editable). With `handles`, sub-modes
/// that have explicit data render bold.
fn draw_mode_row(y: i16, sub_mode: usize, highlight: bool, handles: Option<&[u16; NUM_SUB_MODES]>) {
    // Cycle order: VEL(0), MOD(4), INV(5), HIT(1), FLAM(3), TIME(2), WHL(6)
    static MODE_DISPLAY_ORDER: [usize; 7] = [0, 4, 5, 1, 3, 2, 6];
    gfx_text(PAD_X, y, "MODE", GFX_LABEL, &FONT_SMALL);
    let mut x = PAD_X + gfx_text_width("MODE ", &FONT_SMALL);
    for &i in MODE_DISPLAY_ORDER.iter() {
        let label = SUB_MODE_LABELS.get(i).unwrap_or(&"?");
        let has_data = handles.is_some_and(|h| h[i] != POOL_HANDLE_NONE);
        let font = if has_data { &FONT_VALUE } else { &FONT_SMALL };
        let w = gfx_text_width(label, font);
        let color = if i == sub_mode {
            let fill = if highlight { GFX_AXIS_UD } else { GFX_INK };
            gfx_fill_rect(x - 3, y - 2, w + 6, WELL_H - 4, fill);
            gfx_ink_on(fill)
        } else {
            GFX_INK
        };
        gfx_text(x, y, label, color, font);
        x += w + 8;
    }
}

// Multi-color text runs are gone: on a 1-bit panel a value cannot carry state
// in its own color, so the well fill carries it instead.

/// Draw scale interval visualization (12 squares for chromatic notes)
fn draw_scale_dots(s: &EngineState, highlight: bool) {
    let n: i16 = 12;
    // Right-aligned on the wells above it: every value on this screen hangs off
    // the same edge, and the degree row is a value like any other.
    let total_w = n * DOT_SIZE + (n - 1) * DOT_GAP;
    let start_x = CONTENT_RIGHT - total_w;
    let idx = (s.scale_id_idx as usize).min(NUM_SCALES - 1);
    let pattern = &SCALE_PATTERNS[idx];

    // Twelve checkboxes: the frame is always there, the tick is the degree.
    (0..12).for_each(|i| {
        let x = start_x + i as i16 * (DOT_SIZE + DOT_GAP);
        gfx_fill_rect(x, DOT_Y, DOT_SIZE, DOT_SIZE, GFX_GROUND);
        gfx_frame(x, DOT_Y, DOT_SIZE, DOT_SIZE, GFX_INK);
        if pattern[i] != 0 {
            let fill = if highlight { GFX_AXIS_UD } else { GFX_INK };
            gfx_fill_rect(x + 3, DOT_Y + 3, DOT_SIZE - 6, DOT_SIZE - 6, fill);
        }
    });
}

// ============ Circle of fifths visualization ============

/// Circle of fifths: maps semitone index (0=C) to position on circle (0=top/C, clockwise)
static COF_ORDER: [u8; 12] = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/// Circle of fifths as a 1px ring with twelve ticks and the root inverted.
/// An anti-aliased ring has no 1-bit equivalent, but a hairline circle with
/// hard ticks is exactly what this panel draws well.
fn draw_circle_of_fifths(s: &EngineState, active: bool) {
    let cx: i16 = DISPLAY_W / 2;
    let cy: i16 = DIAL_CY;
    let r: i16 = DIAL_R;

    gfx_circle(cx, cy, r, GFX_INK);

    let root = (s.scale_root % 12) as usize;
    let cof_pos = COF_ORDER[root] as usize;

    (0..12).for_each(|i| {
        let angle = (i as f32 * 30.0 - 90.0) * core::f32::consts::PI / 180.0;
        let (cos_a, sin_a) = (cosf(angle), sinf(angle));
        let is_root = i == cof_pos;
        let inner = (r - if is_root { 12 } else { 6 }) as f32;
        let x0 = cx + (cos_a * inner) as i16;
        let y0 = cy + (sin_a * inner) as i16;
        let x1 = cx + (cos_a * r as f32) as i16;
        let y1 = cy + (sin_a * r as f32) as i16;
        if is_root {
            // 3px wide: step along the perpendicular, not the axes
            let (px, py) = (-sin_a, cos_a);
            (-1i16..=1).for_each(|k| {
                let ox = (px * k as f32) as i16;
                let oy = (py * k as f32) as i16;
                gfx_line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, GFX_INK);
            });
        } else {
            gfx_line(x0, y0, x1, y1, GFX_INK);
        }
    });

    // Root name in an inverted chip at the center
    let root_name = NOTE_NAMES[root];
    // The chip scales with the ring: a letter sized for the old radius crowds
    // the ticks at this one, so the widget shrinks as a whole.
    let font = &FONT_LARGE;
    let kw = gfx_text_width(root_name, font);
    let fill = if active { GFX_AXIS_LR } else { GFX_INK };
    let h = DIAL_CHIP_H;
    gfx_fill_rect(cx - kw / 2 - 6, cy - h / 2, kw + 12, h, fill);
    gfx_text_center(cx, cy - h / 2 + (h - gfx_font_height(font)) / 2, root_name,
                    gfx_ink_on(fill), font);
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

/// Draw a legend item in the bottom bar with ticker if text overflows column.
/// If label is empty, draw icon in muted color only (no label).
fn draw_legend_item(col: i16, icon_type: u8, label: &str, color: u16) {
    // An axis with nothing bound draws no button at all — an empty slab would
    // read as an enabled control.
    if label.is_empty() {
        return;
    }

    let (x, y, w) = legend_box(col);
    let fill = fill_for(color);
    let ink = gfx_ink_on(fill);

    // Hard offset shadow, 1px outline, and a second ring on the grid button —
    // System 6 depth, none of which needs a tone to work.
    gfx_fill_rect(x + BTN_SHADOW, y + BTN_SHADOW, w, BTN_H, GFX_INK);
    gfx_fill_rect(x, y, w, BTN_H, fill);
    gfx_frame(x, y, w, BTN_H, GFX_INK);
    let is_default = icon_type == 0;
    if is_default {
        gfx_frame(x + 3, y + 3, w - 6, BTN_H - 6, ink);
    }

    let icon_x = x + if is_default { 9 } else { 7 };
    let icon_y = y + (BTN_H - ICON_SIZE) / 2;
    match icon_type {
        0 => draw_icon_grid_button(icon_x, icon_y, ink),
        1 => draw_icon_ud_carets(icon_x, icon_y, ink),
        2 => draw_icon_lr_carets(icon_x, icon_y, ink),
        _ => {}
    }

    let text_x = icon_x + ICON_SIZE + ICON_LABEL_GAP;
    let text_y = y + (BTN_H - gfx_font_height(&FONT_MEDIUM)) / 2;
    // No initial pause: button text only appears while modifiers are held.
    draw_marquee(4 + col as usize, text_x, x + w - 5, text_y, label, ink, &FONT_MEDIUM, 0);
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
    let mut prefix = FmtBuf::<16>::new();
    let _ = write!(prefix, "{}: ", label);
    gfx_text(tx, y, &prefix, color_lookup(legend_color), &FONT_SMALL);
    if !value.is_empty() {
        let w = gfx_text_width(&prefix, &FONT_SMALL);
        gfx_text(tx + w, y, value, color_lookup(OLED_CYAN), &FONT_SMALL);
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

    // ---- Row 0: CH | PAT ----
    let alt_only = p_alt && !p_meta && !p_shift;
    let mut ch_str = FmtBuf::<4>::new();
    let _ = write!(ch_str, "{:02}", ch + 1);
    let mut pat_str = FmtBuf::<4>::new();
    let _ = write!(pat_str, "{:02}", pat + 1);
    let ch_color = if alt_only { GFX_AXIS_UD } else { GFX_VALUE };
    let pat_color = if alt_only { GFX_AXIS_LR } else { GFX_VALUE };
    draw_row_two_col(ROW_Y[0], "CH", &ch_str, ch_color, "PAT", &pat_str, pat_color);

    // ---- Row 1: POS | LOOP ----
    let loop_data = &s.loops[ch][pat];
    let loop_len = loop_data.length;
    let raw_tick = if s.resume_tick >= 0 { s.resume_tick } else { s.current_tick };
    let pos_tick = if loop_len > 0 && raw_tick >= 0 {
        ((raw_tick - loop_data.start) % loop_len + loop_len) % loop_len
    } else {
        0
    };
    let pos_buf = tick_to_beat_display(pos_tick);
    let s_buf = tick_to_beat_display(loop_data.start);
    let e_buf = tick_to_beat_display(loop_data.start + loop_data.length - s.zoom);
    // Start and end used to be two colors in one string; a well can only carry
    // one fill, so the pair shares the up/down fill and the buttons name both.
    let mut loop_str = FmtBuf::<16>::new();
    let _ = write!(loop_str, "{}-{}", s_buf.as_str(), e_buf.as_str());
    let loop_color = if p_alt && p_meta { GFX_AXIS_UD } else { GFX_VALUE };
    draw_row_two_col(ROW_Y[1], "POS", pos_buf.as_str(), GFX_VALUE, "LOOP", &loop_str, loop_color);

    // ---- Row 2: KEY (or TYPE for drums) ----
    // Cmd-only (no alt) highlights key
    let cmd_only = p_meta && !p_alt;
    if is_drum {
        draw_row(ROW_Y[2], "TYPE", "DRUMS", GFX_VALUE);
    } else {
        let scale_root_name = NOTE_NAMES[(s.scale_root % 12) as usize];
        let root_color = if cmd_only { GFX_AXIS_LR } else { GFX_VALUE };
        draw_row(ROW_Y[2], "KEY", scale_root_name, root_color);
    }

    // ---- Row 3: SCALE (ticker for long names) ----
    if is_drum {
        draw_row(ROW_Y[3], "SCALE", "-", GFX_DIM);
    } else {
        let scale_name = to_upper(engine_get_scale_name_str(s));
        let scale_color = if cmd_only { GFX_AXIS_UD } else { GFX_VALUE };
        draw_row_tickered(ROW_Y[3], "SCALE", &scale_name, scale_color, 3);
    }

    // ---- Scale interval visualization ----
    draw_scale_dots(s, cmd_only);

    // ---- Circle of fifths (right panel) ----
    if !is_drum {
        draw_circle_of_fifths(s, cmd_only);
    }

    // ---- Bottom legend bar ----
    // Priority: Cmd+Alt+Shift > Cmd+Alt > Cmd only > Alt+Shift > Alt only > Shift only > bare
    if p_meta && p_alt && p_shift {
        // Cmd+Alt+Shift: loop end fine (U/D), loop start fine (L/R)
        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, "LOOP END +/-0.1", GFX_AXIS_UD);
        draw_legend_item(2, 2, "LOOP ST +/-0.1", GFX_AXIS_LR);
    } else if p_meta && p_alt {
        // Cmd+Alt: loop end (U/D), loop start (L/R)
        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, "LOOP END", GFX_AXIS_UD);
        draw_legend_item(2, 2, "LOOP ST", GFX_AXIS_LR);
    } else if p_meta {
        // Cmd only: disable + scale/key editing
        draw_legend_item(0, 0, "DISABLE", GFX_AXIS_GRID);
        draw_legend_item(1, 1, "SCALE", GFX_AXIS_UD);
        draw_legend_item(2, 2, "KEY", GFX_AXIS_LR);
    } else if p_alt && p_shift {
        // Alt+Shift: unused
        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, "", GFX_DIM);
        draw_legend_item(2, 2, "", GFX_DIM);
    } else if p_alt {
        // Alt only: channel cycle (U/D), pattern cycle (L/R)
        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, "CHANNEL", GFX_AXIS_UD);
        draw_legend_item(2, 2, "PATTERN", GFX_AXIS_LR);
    } else if p_shift {
        // Shift only: camera scroll octave/beat
        draw_legend_item(0, 0, "ENABLE", GFX_AXIS_GRID);
        draw_legend_item(1, 1, "OCTAVE", GFX_AXIS_UD);
        draw_legend_item(2, 2, "BEAT", GFX_AXIS_LR);
    } else {
        // No modifiers: grid=ENABLE, arrows=move camera
        draw_legend_item(0, 0, "ENABLE", GFX_AXIS_GRID);
        draw_legend_item(1, 1, "CAM", GFX_AXIS_UD);
        draw_legend_item(2, 2, "CAM", GFX_AXIS_LR);
    }
}

fn render_pattern_selected(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    if s.selected_event_idx as usize >= s.patterns[ch][pat].event_count as usize { return; }
    let h = s.patterns[ch][pat].event_handles[s.selected_event_idx as usize];
    let ev = &s.event_pool[h];
    let is_drum = s.channel_types[ch] == CH_DRUM;

    let shift = (mods & MOD_SHIFT) != 0;
    let meta = (mods & MOD_META) != 0;
    let alt = (mods & MOD_ALT) != 0;

    let eg = EditGroup::from_mods(meta, alt, shift);
    let em = &EDIT_META[eg as u8 as usize];

    // Every combo that has a figure draws it instead of the field list: a
    // square well, and the two values it edits filling the foot of the panel.
    // Inversion and the Cmd+Alt combos have no figure yet, so they keep the
    // rows.
    match eg {
        EditGroup::Move => {
            let nn = get_note_display(ev.row, is_drum, s);
            let pos = tick_to_beat_display(ev.position);
            let mut posbuf = FmtBuf::<16>::new();
            let _ = write!(posbuf, "BAR {}", pos.as_str());
            let len = ticks_to_canonical_name(ev.length);
            let style = *ARP_STYLE_NAMES.get(ev.arp_style as usize).unwrap_or(&"CHD");
            let mut stk = FmtBuf::<8>::new();
            let _ = write!(stk, "{}", ev.chord_amount);
            let mut rpt = FmtBuf::<8>::new();
            let _ = write!(rpt, "{}", ev.repeat_amount);
            crate::oled_widgets::draw_note_map(
                nn.as_str(), posbuf.as_str(), len.as_str(), style, stk.as_str(), rpt.as_str(),
            );
            return;
        }
        EditGroup::Stack => return crate::oled_widgets::screen_stack(ev),
        EditGroup::Spacing => return crate::oled_widgets::screen_spacing(ev),
        EditGroup::Arp => return crate::oled_widgets::screen_arp(ev),
        EditGroup::Voicing => return crate::oled_widgets::screen_voicing(ev),
        _ => {}
    }

    let note_name = get_note_display(ev.row, is_drum, s);

    // ---- Row 0: [extended name] (stack name) — ticker for long text ----
    {
        // Build display string: extended name + optional stack name
        let mut display_str = FmtBuf::<128>::new();
        if is_drum && ev.chord_amount > 1 {
            push_drum_names(s, ev, &mut display_str);
        } else if ev.chord_amount == 2 {
            let midi1 = note_to_midi(ev.row, s);
            let midi2 = note_to_midi(ev.row + ev.chord_space as i16, s);
            let semitones = ((midi2 as i32) - (midi1 as i32)).unsigned_abs() as u8;
            if semitones == 12 {
                display_str.push_str("OCTAVE");
            } else if semitones > 12 {
                let _ = write!(display_str, "{} +OCT", INTERVAL_NAMES[(semitones % 12) as usize]);
            } else {
                display_str.push_str(INTERVAL_NAMES[semitones as usize]);
            }
        } else if ev.chord_amount > 2 {
            let cn = chord_name_upper(s, ev);
            display_str.push_str(cn.as_str());
        } else if is_drum {
            let dn = get_drum_name(ev.row.clamp(0, 127) as i8);
            display_str.push_str(dn.as_str());
        } else {
            display_str.push_str("SINGLE NOTE");
        }

        // Append stack name (voicing/inversion) for chords > 2
        if !is_drum && ev.chord_amount > 2 {
            let inv = ev.chord_inversion;
            if inv != 0 {
                let _ = write!(display_str, "  (INV{}{})", if inv > 0 { "+" } else { "" }, inv);
            } else {
                let voicing = get_voicing_name(ev.chord_amount, ev.chord_space, ev.chord_voicing);
                if !voicing.is_empty() {
                    let upper = to_upper(voicing);
                    let _ = write!(display_str, "  ({})", upper.as_str());
                } else {
                    display_str.push_str("  (BASE)");
                }
            }
        }
        // Shift up/down = inversion, Alt+Shift up/down = voicing — both affect row 0
        let row0_color = if em.ud_rows & 1 != 0 { GFX_AXIS_UD } else { GFX_VALUE };
        let hint = if em.ud_rows & 1 != 0 { em.ud_label } else { "" };
        draw_banner(&display_str, 0, hint, row0_color);
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
        let mut nb = FmtBuf::<8>::new();
        let _ = write!(nb, "{}", ev.row.clamp(0, 127));
        nb
    } else {
        note_name
    };
    // Left/right column colors for rows with two values (U/D edits left, L/R edits right)
    let row_ud_color = |row: u8| -> u16 {
        if em.ud_rows & (1 << row) != 0 { GFX_AXIS_UD } else { GFX_VALUE }
    };
    let row_lr_color = |row: u8| -> u16 {
        if em.lr_rows & (1 << row) != 0 { GFX_AXIS_LR } else { GFX_VALUE }
    };

    // Highlighted when U/D edits it, incl. Shift+U/D octave move on single notes
    let note_color = if row_ud_color(1) != GFX_VALUE
        || (shift && !meta && !alt && ev.chord_amount <= 1)
    {
        GFX_AXIS_UD
    } else {
        GFX_VALUE
    };
    draw_row_two_col(ROW_Y5[1], "NOTE", &note_display, note_color,
                     "LEN", &length_str, row_lr_color(1));

    // ---- Row 2: RPT [amount]  SPC [space] ----
    // Cmd: L/R edits RPT amount (highlight RPT only)
    // Cmd+Shift: L/R edits RPT space (highlight SPC only)
    let mut rpt_amt_str = FmtBuf::<8>::new();
    let _ = write!(rpt_amt_str, "{}", ev.repeat_amount);
    let rpt_space_str = ticks_to_canonical_name(ev.repeat_space);
    let rpt_color = if eg == EditGroup::Stack { GFX_AXIS_LR } else { GFX_VALUE };
    let spc_color = if eg == EditGroup::Spacing { GFX_AXIS_LR } else { GFX_VALUE };
    draw_row_two_col(ROW_Y5[2], "RPT", &rpt_amt_str, rpt_color,
                     "SPC", &rpt_space_str, spc_color);

    // ---- Row 3: STK [amount]  SPC [space] ----
    if ev.chord_amount > 1 {
        let mut ca_str = FmtBuf::<4>::new();
        let _ = write!(ca_str, "{}", ev.chord_amount);
        let mut cs_str = FmtBuf::<4>::new();
        let _ = write!(cs_str, "{}", ev.chord_space);
        draw_row_two_col(ROW_Y5[3], "STK", &ca_str, row_ud_color(3),
                         "SPC", &cs_str, row_ud_color(3));
    } else {
        draw_field(PAD_X, HALF_W - 5, ROW_Y5[3], "STK", "1", row_ud_color(3));
    }

    // ---- Row 4: ARP [style] / [offset or voices] ----
    let style_name = *ARP_STYLE_NAMES.get(ev.arp_style as usize).unwrap_or(&"CHD");
    let mut arp_str = FmtBuf::<24>::new();
    let arp_color = if eg == EditGroup::Voicing {
        let _ = write!(arp_str, "{} / {}", style_name, ev.arp_voices);
        row_lr_color(4)
    } else if ev.arp_offset != 0 {
        let sign = if ev.arp_offset > 0 { "+" } else { "" };
        let _ = write!(arp_str, "{} / {}{}", style_name, sign, ev.arp_offset);
        row_lr_color(4)
    } else {
        arp_str.push_str(style_name);
        row_ud_color(4)
    };
    draw_field(PAD_X, CONTENT_W, ROW_Y5[4], "ARP", &arp_str, arp_color);

    // ---- Bottom legend (from EditMeta) ----
    // Override inversion label for single notes
    let ud_label = if eg == EditGroup::Inversion && ev.chord_amount <= 1 { "OCTAVE" } else { em.ud_label };
    draw_legend_item(0, 0, em.grid_label, GFX_AXIS_GRID);
    draw_legend_item(1, 1, ud_label, GFX_AXIS_UD);
    draw_legend_item(2, 2, em.lr_label, GFX_AXIS_LR);
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
        let ev = &s.event_pool[h];
        let is_drum = s.channel_types[ch] == CH_DRUM;

        let sm_arr = get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sub_mode);
        let loop_mode_val = sm_arr.loop_mode;
        let arr_len = sm_arr.length;
        let stay_val = sm_arr.stay;

        // ---- Row 0: note name + extended name ----
        let note_name = get_note_display(ev.row, is_drum, s);
        let mut display_str = FmtBuf::<128>::new();
        display_str.push_str(note_name.as_str());
        display_str.push(' ');
        if is_drum {
            // Single-note events get one name (get_chord_offsets yields [0])
            push_drum_names(s, ev, &mut display_str);
        } else if ev.chord_amount > 1 {
            let cn = chord_name_upper(s, ev);
            display_str.push_str(cn.as_str());
        } else {
            display_str.push_str("SINGLE NOTE");
        }
        draw_marquee(0, PAD_X, CONTENT_RIGHT, ROW_Y5[0], &display_str, GFX_VALUE,
                     &FONT_VALUE, TICKER_PAUSE_FRAMES);

        // ---- Row 1: MODE label + all sub-mode labels in cycle order ----
        draw_mode_row(ROW_Y5[1], sub_mode, !m_meta, Some(&ev.sub_mode_handles));

        // ---- Row 2: LOOP [CNT/RST/FIL] — all modes shown, current highlighted ----
        {
            static LOOP_DISPLAY_LABELS: [&str; 3] = ["CNT", "RST", "FIL"];
            gfx_text(PAD_X, ROW_Y5[2], "LOOP", GFX_LABEL, &FONT_SMALL);
            let mut x = PAD_X + gfx_text_width("LOOP ", &FONT_SMALL);
            for (i, &label) in LOOP_DISPLAY_LABELS.iter().enumerate() {
                let color = if i == loop_mode_val as usize {
                    if m_meta { GFX_AXIS_UD } else { GFX_VALUE }
                } else {
                    GFX_DIM
                };
                gfx_text(x, ROW_Y5[2], label, color, &FONT_VALUE);
                x += gfx_text_width(label, &FONT_VALUE) + 4;
            }
        }

        // ---- Row 3: LEN [n]  STAY [n] ----
        let mut len_str = FmtBuf::<4>::new();
        let _ = write!(len_str, "{}", arr_len);
        let len_color = if !m_meta { GFX_AXIS_LR } else { GFX_VALUE };
        let mut stay_str = FmtBuf::<4>::new();
        let _ = write!(stay_str, "{}", stay_val);
        let stay_color = if m_meta { GFX_AXIS_LR } else { GFX_VALUE };
        draw_row_two_col(ROW_Y5[3], "LEN", &len_str, len_color, "STAY", &stay_str, stay_color);

        // Legend
        if m_meta {
            draw_legend_item(0, 0, "", GFX_DIM);
            draw_legend_item(1, 1, "LOOP", GFX_AXIS_UD);
            draw_legend_item(2, 2, "STAY", GFX_AXIS_LR);
        } else {
            draw_legend_item(0, 0, "", GFX_DIM);
            draw_legend_item(1, 1, "MODE", GFX_AXIS_UD);
            draw_legend_item(2, 2, "LENGTH", GFX_AXIS_LR);
        }
    } else {
        // No note selected — show MODE label + sub-mode labels in cycle order
        draw_mode_row(ROW_Y5[0], sub_mode, !m_meta, None);
        gfx_text(PAD_X, ROW_Y5[1], "SELECT A NOTE", GFX_INK, &FONT_MEDIUM);

        draw_legend_item(0, 0, "", GFX_DIM);
        draw_legend_item(1, 1, if !m_meta { "MODE" } else { "" }, if !m_meta { GFX_AXIS_UD } else { GFX_DIM });
        draw_legend_item(2, 2, "", GFX_DIM);
    }
}

fn render_sound(s: &EngineState, mods: u8) {
    use crate::engine_sound::*;
    let ch = s.current_channel as usize;
    let page = s.sound_page;
    if s.is_drum_channel(ch) {
        if crate::engine_drumsynth::is_drum_page(page) {
            render_sound_drumsynth(s, mods);
        } else {
            render_sound_sampler(s, mods);
        }
        return;
    }
    let patch_vals = &s.sound_patches[ch];
    let shift = (mods & MOD_SHIFT) != 0;

    // ---- Row 0: SOUND | CH xx TYPE ----
    let mut hdr = FmtBuf::<16>::new();
    let _ = write!(hdr, "CH {} ", ch + 1);
    hdr.push_str(ENGINE_TYPE_LABELS[(patch_vals[arp3_synth::patch::P_ENGINE] as usize)
        .min(ENGINE_TYPE_LABELS.len() - 1)]);
    draw_row(ROW_Y5[0], "SOUND", &hdr, GFX_VALUE);

    // ---- Row 1: PAGE label + all page names in cycle order, current highlighted ----
    {
        let label = SOUND_PAGE_LABELS[(page as usize).min(SOUND_PAGE_LABELS.len() - 1)];
        draw_row(ROW_Y5[1], "PAGE", label, GFX_AXIS_UD);
    }

    // ---- Rows 2-3: params of the current page ----
    let focused = focused_param(s);
    let draw_param = |slot: usize, param: usize| {
        // Two params per row: slots 0/2 left column, 1/3 right column
        let y = ROW_Y5[2 + slot / 2];
        let x = if slot % 2 == 0 { PAD_X } else { PAD_X + HALF_W + 5 };
        let value = format_param_value(param, patch_vals[param]);
        let color = // left/right edits the focused parameter, so it takes that axis
            if focused == Some(param) { GFX_AXIS_LR } else { GFX_VALUE };
        draw_field(x, HALF_W - 5, y, param_label(param), &value, color);
    };

    match page {
        PAGE_PRESET => {
            // Preset name, amber when the patch has local edits
            let preset_idx = (s.sound_presets[ch] as usize).min(arp3_synth::patch::NUM_PRESETS - 1);
            let edited = s.sound_edited[ch] != 0;
            let name_color = if edited { GFX_AXIS_UD } else { GFX_VALUE };
            draw_row(ROW_Y5[2], "PATCH", arp3_synth::patch::PRESETS[preset_idx].name, name_color);
            if edited {
                draw_row(ROW_Y5[3], "STATE", "EDITED", GFX_ALERT);
            }
        }
        PAGE_OSC1 => draw_param(0, arp3_synth::patch::P_WAVE1),
        PAGE_OSC2 => {
            draw_param(0, arp3_synth::patch::P_WAVE2);
            draw_param(1, arp3_synth::patch::P_DETUNE);
        }
        PAGE_ALGO => {
            draw_param(0, arp3_synth::patch::P_ALGO);
            draw_param(1, arp3_synth::patch::P_FB);
        }
        PAGE_WT => {
            draw_param(0, arp3_synth::patch::P_WT_POS);
            draw_param(1, arp3_synth::patch::P_WT_WARP);
        }
        PAGE_WFOLD => {
            draw_param(0, arp3_synth::patch::P_FOLD);
            draw_param(1, arp3_synth::patch::P_WC_SHAPE);
            draw_param(2, arp3_synth::patch::P_WC_SYM);
            draw_param(3, arp3_synth::patch::P_WC_ENV);
        }
        PAGE_HARM => {
            if let Some(param) = focused_param(s) {
                draw_param(0, param);
            }
            draw_param(1, arp3_synth::patch::P_ADD_STRETCH);
        }
        _ => {
            let engine = patch_vals[arp3_synth::patch::P_ENGINE];
            for (i, &param) in page_faders(engine, page).iter().enumerate().take(4) {
                draw_param(i, param);
            }
        }
    }

    // ---- Legend ----
    draw_legend_item(0, 0, "", GFX_DIM);
    draw_legend_item(1, 1, "PAGE", GFX_AXIS_UD);
    draw_legend_item(2, 2, if shift { "FINE" } else { "EDIT" }, GFX_AXIS_LR);
}

/// Sound mode on a drum channel: a drum-synth kit page.
fn render_sound_drumsynth(s: &EngineState, mods: u8) {
    use crate::engine_drumsynth::{
        drum_focused_param, drum_kit, drum_page_faders, drum_page_label, drum_param_label,
        KIT_LABELS,
    };
    use crate::engine_sound::*;
    use arp3_synth::drums::{KIT_FM, NUM_KITS};
    let ch = s.current_channel as usize;
    let page = s.sound_page;
    let dp = &s.drum_patches[ch];
    let kit = drum_kit(s, ch);
    let shift = (mods & MOD_SHIFT) != 0;

    // ---- Row 0: SOUND | CH xx <kit> ----
    let mut hdr = FmtBuf::<16>::new();
    let _ = write!(hdr, "CH {} {}", ch + 1, if kit == KIT_FM { "FM KIT" } else { "808 KIT" });
    draw_row(ROW_Y5[0], "SOUND", &hdr, GFX_VALUE);

    // ---- Row 1: instrument (page) name, kit-aware ----
    gfx_text(PAD_X, ROW_Y5[1], "PAGE", GFX_LABEL, &FONT_SMALL);
    gfx_text_right(
        CONTENT_RIGHT,
        ROW_Y5[1],
        drum_page_label(page, kit),
        GFX_AXIS_UD,
        &FONT_VALUE,
    );

    // ---- Rows 2-3 ----
    if page == PAGE_DKIT {
        let name = KIT_LABELS[(kit as usize).min(NUM_KITS - 1)];
        draw_row(ROW_Y5[2], "KIT", name, GFX_AXIS_UD);
    } else if page == PAGE_DFOLD {
        // Focused instrument's fold amount
        if let Some(param) = drum_focused_param(s) {
            let mut fbuf = FmtBuf::<12>::new();
            let _ = write!(fbuf, "{}%", dp[param]);
            draw_row(ROW_Y5[2], drum_param_label(param), &fbuf, GFX_AXIS_UD);
        }
    } else {
        let focused = drum_focused_param(s);
        for (i, &param) in drum_page_faders(page, kit).iter().enumerate().take(4) {
            let y = ROW_Y5[2 + i / 2];
            let x = if i % 2 == 0 { PAD_X } else { PAD_X + HALF_W + 5 };
            let mut val = FmtBuf::<12>::new();
            if param == arp3_synth::drums::DP_BD_TUNE || param == arp3_synth::drums::DPF_BD_TUNE {
                // BD tune reads in Hz, same mapping the DSP uses
                let _ = write!(val, "{}HZ", arp3_synth::drums::bd_freq_hz(dp[param]) as i32);
            } else {
                let _ = write!(val, "{}%", dp[param]);
            }
            let color = // left/right edits the focused parameter, so it takes that axis
            if focused == Some(param) { GFX_AXIS_LR } else { GFX_VALUE };
            draw_field(x, HALF_W - 5, y, drum_param_label(param), &val, color);
        }
    }

    // ---- Legend ----
    draw_legend_item(0, 0, "", GFX_DIM);
    draw_legend_item(1, 1, "PAGE", GFX_AXIS_UD);
    draw_legend_item(2, 2, if shift { "FINE" } else { "EDIT" }, GFX_AXIS_LR);
}

/// Sound mode on a drum channel: the sampler pages.
fn render_sound_sampler(s: &EngineState, mods: u8) {
    use crate::engine_sound::*;
    use arp3_synth::sampler::*;
    let ch = s.current_channel as usize;
    let page = s.sound_page;
    let slot = (s.sampler_slot[ch] as usize).min(NUM_SLOTS - 1);
    let sp = &s.sampler_params[ch][slot];
    let shift = (mods & MOD_SHIFT) != 0;

    // ---- Row 0: SOUND | CH xx SAMPLER ----
    let mut hdr = FmtBuf::<16>::new();
    let _ = write!(hdr, "CH {} SAMPLER", ch + 1);
    draw_row(ROW_Y5[0], "SOUND", &hdr, GFX_VALUE);

    // ---- Row 1: page name ----
    {
        gfx_text(PAD_X, ROW_Y5[1], "PAGE", GFX_LABEL, &FONT_SMALL);
        let label = SOUND_PAGE_LABELS[(page as usize).min(SOUND_PAGE_LABELS.len() - 1)];
        gfx_text_right(CONTENT_RIGHT, ROW_Y5[1], label, GFX_AXIS_UD, &FONT_VALUE);
    }

    // Two params per row on rows 2-3: slots 0/2 left column, 1/3 right column
    let draw_pair = |slot_idx: usize, label: &str, value: &str, hot: bool| {
        let y = ROW_Y5[2 + slot_idx / 2];
        let x = if slot_idx % 2 == 0 { PAD_X } else { PAD_X + HALF_W + 5 };
        let color = if hot { GFX_AXIS_LR } else { GFX_VALUE };
        draw_field(x, HALF_W - 5, y, label, value, color);
    };

    // Slot param value → display text
    let fmt_slot_param = |param: usize| -> FmtBuf<12> {
        let mut b = FmtBuf::<12>::new();
        let v = sp[param];
        match param {
            SP_SPEED => {
                let pct = (speed_ratio(v) * 100.0 + 0.5) as i32;
                let _ = write!(b, "{}%", pct);
            }
            SP_PITCH => {
                let st = v - 24;
                let _ = write!(b, "{:+}ST", st);
            }
            SP_MODE => b.push_str(match v {
                MODE_LOOP => "LOOP",
                MODE_GATE => "GATE",
                _ => "ONE",
            }),
            SP_TRIM_START | SP_TRIM_END => {
                let _ = write!(b, "{}.{}%", v / 10, v % 10);
            }
            _ => { let _ = write!(b, "{}", v); }
        }
        b
    };

    let focused = crate::engine_sampler::sampler_focused_param(s);
    match page {
        PAGE_SSLOT => {
            let mut sbuf = FmtBuf::<12>::new();
            let _ = write!(sbuf, "{}", slot + 1);
            draw_pair(0, "SLOT", &sbuf, false);
            let loaded = s.sampler_loaded[ch][slot] != 0;
            draw_pair(1, "STATE", if loaded { "LOADED" } else { "EMPTY" }, false);
            const KEYS: [&str; 12] =
                ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            let key = s.sampler_keys[ch][slot];
            let key_txt = if (0..12).contains(&key) { KEYS[key as usize] } else { "--" };
            draw_pair(2, "KEY", key_txt, false);
        }
        PAGE_SREC => {
            use crate::engine_sampler::{REC_ARMED, REC_RECORDING};
            let (txt, hot) = match s.rec_state {
                REC_RECORDING => ("REC", true),
                REC_ARMED => ("ARMED", true),
                _ => ("IDLE", false),
            };
            draw_pair(0, "STATE", txt, hot);
            let mut lbuf = FmtBuf::<12>::new();
            let _ = write!(lbuf, "{}%", (s.rec_level as i32 * 100) / 255);
            draw_pair(1, "LEVEL", &lbuf, false);
            let mut tbuf = FmtBuf::<12>::new();
            let _ = write!(tbuf, "SLOT {}", slot + 1);
            draw_pair(2, "TO", &tbuf, false);
        }
        PAGE_STRIM => {
            let start = fmt_slot_param(SP_TRIM_START);
            let end = fmt_slot_param(SP_TRIM_END);
            draw_pair(0, "START", &start, !shift);
            draw_pair(1, "END", &end, shift);
        }
        _ => {
            let faders = crate::engine_sampler::sampler_page_faders(page);
            for (i, &param) in faders.iter().enumerate().take(4) {
                let val = fmt_slot_param(param);
                draw_pair(i, slot_param_label(param), &val, focused == Some(param));
            }
            if page == PAGE_SPLAY {
                // Faders fill all four value slots; squeeze mode + time engine
                // into the middle of the page row.
                let mut mbuf = FmtBuf::<16>::new();
                let mode = fmt_slot_param(SP_MODE);
                mbuf.push_str(mode.as_str());
                mbuf.push_str(if sp[SP_TAPE] != 0 { " TAPE" } else { " GRAIN" });
                gfx_text(PAD_X + 36, ROW_Y5[1], &mbuf, GFX_DIM, &FONT_SMALL);
            }
        }
    }

    // ---- Legend ----
    draw_legend_item(0, 0, "", GFX_DIM);
    draw_legend_item(1, 1, "PAGE", GFX_AXIS_UD);
    draw_legend_item(2, 2, if shift { "FINE" } else { "EDIT" }, GFX_AXIS_LR);
}

fn slot_param_label(param: usize) -> &'static str {
    use arp3_synth::sampler::*;
    match param {
        SP_TRIM_START => "START",
        SP_TRIM_END => "END",
        SP_SPEED => "SPEED",
        SP_PITCH => "PITCH",
        SP_LEVEL => "LEVEL",
        SP_DECAY => "DECAY",
        SP_MODE => "MODE",
        SP_CUT => "CUT",
        SP_RES => "RES",
        SP_DRIVE => "DRIVE",
        SP_TAPE => "TIME",
        _ => "?",
    }
}

fn render_channel(s: &EngineState) {
    let ch = s.current_channel;
    let pat = s.current_patterns[ch as usize];
    let mut ch_buf = FmtBuf::<8>::new();
    let _ = write!(ch_buf, "CH {}", ch + 1);
    let mut pat_buf = FmtBuf::<4>::new();
    let _ = write!(pat_buf, "{}", pat + 1);

    draw_row(ROW_Y[0], "MODE", "CHANNEL", GFX_VALUE);
    draw_row(ROW_Y[1], "SELECT", &ch_buf, GFX_VALUE);
    draw_row(ROW_Y[2], "PAT", &pat_buf, GFX_VALUE);
}

fn render_loop(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let loop_data = &s.loops[ch][pat];
    let loop_start = loop_data.start;
    let loop_end = loop_data.start + loop_data.length;
    let l_shift = (mods & MOD_SHIFT) != 0;
    let l_meta = (mods & MOD_META) != 0;

    draw_row(ROW_Y[0], "MODE", "LOOP", GFX_VALUE);

    let s_buf = tick_to_beat_display(loop_start);
    let e_buf = tick_to_beat_display(loop_end - s.zoom);

    // Start and end each get their own well so the live one can be filled
    let editing_start = l_meta;
    let col_w = HALF_W - 5;
    let start_color = if editing_start { GFX_AXIS_UD } else { GFX_VALUE };
    let end_color = if editing_start { GFX_VALUE } else { GFX_AXIS_UD };
    draw_field(PAD_X, col_w, ROW_Y[1], "FROM", s_buf.as_str(), start_color);
    draw_field(PAD_X + HALF_W + 5, col_w, ROW_Y[1], "TO", e_buf.as_str(), end_color);

    let step_str = if l_shift { "+/- 0.1" } else { "+/- 1" };
    if editing_start {
        draw_icon_legend(ROW_Y[2], "START", step_str, OLED_YELLOW);
    } else {
        draw_icon_legend(ROW_Y[2], "END", step_str, OLED_YELLOW);
    }
}

// ============ Modifier key hints ============

/// Short function hint for an on-screen modifier key, using the same words as
/// the OLED legend above. `held` is the full OLED-encoded modifier set
/// currently held; the hint describes what `key` does combined with the
/// *other* held modifiers, so hints update live as combos build up.
/// Returns "" when the combo has no function in the current mode.
pub fn modifier_hint(s: &EngineState, held: u8, key: u8) -> &'static str {
    // Ctrl always summons the channel/pattern overlay on the grid
    if key == MOD_CTRL {
        return "ch/pat";
    }
    let mods = held | key;
    let meta = (mods & MOD_META) != 0;
    let alt = (mods & MOD_ALT) != 0;
    let shift = (mods & MOD_SHIFT) != 0;

    match UiMode::from_u8(s.ui_mode) {
        UiMode::Pattern if s.selected_event_idx >= 0 => {
            match EditGroup::from_mods(meta, alt, shift) {
                EditGroup::Move => "move",
                EditGroup::Inversion => {
                    // Same override as the legend: single notes move by octave
                    let ch = s.current_channel as usize;
                    let pat = s.current_patterns[ch] as usize;
                    let idx = s.selected_event_idx as usize;
                    if idx < s.patterns[ch][pat].event_count as usize
                        && s.event_pool[s.patterns[ch][pat].event_handles[idx]].chord_amount <= 1
                    {
                        "octave/length"
                    } else {
                        "invert/length"
                    }
                }
                EditGroup::Stack => "stack/repeat",
                EditGroup::Spacing => "spacing",
                EditGroup::Arp => "arp/offset",
                EditGroup::Voicing => "voicing/voices",
                EditGroup::None => "random",
            }
        }
        UiMode::Pattern => {
            if meta && alt {
                if shift { "loop fine" } else { "loop st/end" }
            } else if meta {
                "scale/key"
            } else if alt && shift {
                ""
            } else if alt {
                "chan/pattern"
            } else if shift {
                "octave/beat"
            } else {
                ""
            }
        }
        UiMode::Channel => "",
        UiMode::Loop => {
            if key == MOD_META {
                "start/end"
            } else if key == MOD_SHIFT {
                "fine"
            } else {
                ""
            }
        }
        UiMode::Modify => {
            if key == MOD_META { "loop/stay" } else { "" }
        }
        UiMode::Sound => {
            if key == MOD_SHIFT { "fine" } else { "" }
        }
    }
}

// ============ Public entry point ============

pub fn oled_render(s: &EngineState, modifiers: u8) {
    FRAME_COUNT.fetch_add(1, Ordering::Relaxed);
    gfx_clear(GFX_GROUND);

    let mode = UiMode::from_u8(s.ui_mode);
    draw_titlebar(s, match mode {
        UiMode::Pattern if s.selected_event_idx >= 0 => "NOTE",
        UiMode::Pattern => "PATTERN",
        UiMode::Channel => "CHANNEL",
        UiMode::Loop => "LOOP",
        UiMode::Modify => "MODIFY",
        UiMode::Sound => "SOUND",
    });

    match mode {
        UiMode::Pattern if s.selected_event_idx >= 0 => render_pattern_selected(s, modifiers),
        UiMode::Pattern => render_pattern_default(s, modifiers),
        UiMode::Channel => render_channel(s),
        UiMode::Loop => render_loop(s, modifiers),
        UiMode::Modify => render_modify(s, modifiers),
        UiMode::Sound => render_sound(s, modifiers),
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
