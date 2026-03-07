// oled_screen.rs — OLED screen content rendering
// Ported from oled_screen.c — reads engine state and draws to framebuffer

extern crate alloc;
use alloc::format;

use crate::oled_gfx::*;
use crate::oled_fonts::{FONT_MAIN, FONT_SMALL};
use crate::oled_display::*;
use crate::engine_core::*;
use crate::engine_ui;

const CH_DRUM: u8 = ChannelType::Drum as u8;

// ============ Layout constants ============

static ROW_Y: [i16; 6] = [18, 38, 58, 78, 98, 118];
const LABEL_X: i16 = 6;
const VALUE_X: i16 = 6;

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
    "Kick 2", "Kick", "Stick", "Snare", "Clap", "E.Snr",       // 35-40
    "Lo Tom", "Cl HH", "Hi Tom", "Ped HH", "Lo Tom", "Op HH",  // 41-46
    "LM Tom", "HM Tom", "Crash", "Hi Tom", "Ride", "China",     // 47-52
    "RideBl", "Tamb", "Splash", "Cowbel", "Crash2", "Vibra",    // 53-58
    "Ride2", "Hi Bon", "Lo Bon", "Mt Con", "Op Con", "Lo Con",  // 59-64
    "Hi Tim", "Lo Tim", "Hi Aga", "Lo Aga", "Cabasa", "Maraca", // 65-70
    "S.Whst", "L.Whst", "S.Guir", "L.Guir", "Claves", "Hi Blk",// 71-76
    "Lo Blk", "Mt Cga", "Op Cga", "Mt Tri", "Op Tri",          // 77-81
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


// ============ Sub-mode / loop mode labels ============

static SUB_MODE_LABELS: [&str; 6] = ["VEL", "HIT", "TIME", "FLAM", "MOD", "INV"];
static LOOP_MODE_LABELS: [&str; 3] = ["RST", "CNT", "FIL"];
static ARP_STYLE_NAMES: [&str; 9] = ["CHD", "UP", "DN", "U/D", "D/U", "C.UP", "C.DN", "C.U/D", "C.D/U"];
static INTERVAL_NAMES: [&str; 12] = [
    "unison", "min 2nd", "2nd", "min 3rd", "3rd", "4th",
    "tritone", "5th", "min 6th", "6th", "min 7th", "7th",
];

// ============ Colored text segment ============

struct Segment<'a> {
    text: &'a str,
    color: u8,
}

fn draw_segments(x: i16, y: i16, segs: &[Segment]) -> i16 {
    segs.iter().fold(x, |cx, seg| {
        gfx_text(cx, y, seg.text, color_lookup(seg.color), &FONT_MAIN);
        cx + gfx_text_width(seg.text, &FONT_MAIN)
    })
}

fn draw_labeled_row(y: i16, label: &str, value: &str, val_color: u8) {
    if !label.is_empty() {
        gfx_text(LABEL_X, y, label, color_lookup(OLED_DIM), &FONT_SMALL);
        let lbl_sp = format!("{} ", label);
        let lw = gfx_text_width(&lbl_sp, &FONT_SMALL);
        gfx_text(LABEL_X + lw, y, value, color_lookup(val_color), &FONT_MAIN);
    } else {
        gfx_text(VALUE_X, y, value, color_lookup(val_color), &FONT_MAIN);
    }
}

#[allow(dead_code)]
fn draw_legend(y: i16, prefix: &str, value: &str, legend_color: u8) {
    gfx_text(VALUE_X, y, prefix, color_lookup(legend_color), &FONT_MAIN);
    let w = gfx_text_width(prefix, &FONT_MAIN);
    if !value.is_empty() {
        gfx_text(VALUE_X + w, y, value, color_lookup(OLED_CYAN), &FONT_MAIN);
    }
}

// ============ Arrow icons (13x13) ============

const ICON_SIZE: i16 = 13;
const ICON_PAD: i16 = 4;

#[derive(Clone, Copy)]
enum IconType {
    Vertical,
    Horizontal,
    AllDirs,
}

fn draw_icon_vertical(x: i16, y: i16, color: u16) {
    let cy = y - 5;
    let mx = x + 6;
    gfx_pixel(mx, cy - 5, color);
    gfx_hline(mx - 1, cy - 4, 3, color);
    gfx_hline(mx - 2, cy - 3, 5, color);
    gfx_hline(mx - 3, cy - 2, 7, color);
    gfx_vline(mx, cy - 2, 5, color);
    gfx_hline(mx - 3, cy + 2, 7, color);
    gfx_hline(mx - 2, cy + 3, 5, color);
    gfx_hline(mx - 1, cy + 4, 3, color);
    gfx_pixel(mx, cy + 5, color);
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

fn draw_icon_all_dirs(x: i16, y: i16, color: u16) {
    let cy = y - 5;
    let mx = x + 6;
    gfx_hline(mx - 5, cy, 11, color);
    gfx_vline(mx, cy - 5, 11, color);
    gfx_hline(mx - 1, cy - 4, 3, color);
    gfx_hline(mx - 2, cy - 3, 5, color);
    gfx_hline(mx - 1, cy + 4, 3, color);
    gfx_hline(mx - 2, cy + 3, 5, color);
    gfx_vline(mx - 4, cy - 1, 3, color);
    gfx_vline(mx - 3, cy - 2, 5, color);
    gfx_vline(mx + 3, cy - 2, 5, color);
    gfx_vline(mx + 4, cy - 1, 3, color);
}

fn draw_icon(icon: IconType, x: i16, y: i16, color: u16) {
    match icon {
        IconType::Vertical => draw_icon_vertical(x, y, color),
        IconType::Horizontal => draw_icon_horizontal(x, y, color),
        IconType::AllDirs => draw_icon_all_dirs(x, y, color),
    }
}

fn draw_icon_legend(y: i16, icon: IconType, label: &str, value: &str, legend_color: u8) {
    draw_icon(icon, VALUE_X, y, color_lookup(legend_color));
    let tx = VALUE_X + ICON_SIZE + ICON_PAD;
    let prefix = format!("{}: ", label);
    gfx_text(tx, y, &prefix, color_lookup(legend_color), &FONT_MAIN);
    if !value.is_empty() {
        let w = gfx_text_width(&prefix, &FONT_MAIN);
        gfx_text(tx + w, y, value, color_lookup(OLED_CYAN), &FONT_MAIN);
    }
}

fn draw_icon_text(y: i16, icon: IconType, text: &str, color: u8) {
    draw_icon(icon, VALUE_X, y, color_lookup(color));
    let tx = VALUE_X + ICON_SIZE + ICON_PAD;
    gfx_text(tx, y, text, color_lookup(color), &FONT_MAIN);
}

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

// ============ Mode renderers ============

fn render_pattern_selected(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    if s.selected_event_idx as usize >= s.patterns[ch][pat].event_count as usize { return; }
    let h = s.patterns[ch][pat].event_handles[s.selected_event_idx as usize];
    let ev = &s.event_pool.slots[h as usize];
    let is_drum = s.channel_types[ch] == CH_DRUM;

    let sel_row = ev.row;
    let sel_length = ev.length;
    let repeat_amount = ev.repeat_amount;
    let repeat_space = ev.repeat_space;
    let chord_amount = ev.chord_amount;
    let chord_space = ev.chord_space;
    let chord_voicing = ev.chord_voicing;
    let arp_style = ev.arp_style;
    let arp_offset = ev.arp_offset;
    let arp_voices = ev.arp_voices;

    let shift = (mods & MOD_SHIFT) != 0;
    let meta = (mods & MOD_META) != 0;
    let alt = (mods & MOD_ALT) != 0;

    let note_name = get_note_display(sel_row, is_drum, s);
    let length_display = ticks_to_musical_name(sel_length, s.zoom);
    let repeat_space_display = ticks_to_canonical_name(repeat_space);

    let voicing_name = if chord_amount > 1 {
        get_voicing_name(chord_amount, chord_space, chord_voicing)
    } else {
        ""
    };

    let raw_chord_name = if chord_amount > 1 {
        // Get chord name from the exported function via lib.rs
        // Since we can't call lib.rs from here, compute it inline using the same logic
        get_chord_name_str(s, ev)
    } else {
        alloc::string::String::new()
    };

    // Determine edit targets based on modifiers
    const T_NONE: u8 = 0; const _T_MOVE: u8 = 1; const T_LENGTH: u8 = 2;
    const T_RPT_AMT: u8 = 3; const T_RPT_SPACE: u8 = 4;
    const T_ARP_OFFSET: u8 = 5; const T_ARP_VOICES: u8 = 6;
    const V_NONE: u8 = 0; const _V_MOVE: u8 = 1; const V_INVERSION: u8 = 2;
    const V_CHD_AMT: u8 = 3; const V_CHD_SPACE: u8 = 4;
    const V_ARP_STYLE: u8 = 5; const V_VOICING: u8 = 6;

    let (h_target, v_target) = if meta && shift {
        (T_RPT_SPACE, V_CHD_SPACE)
    } else if meta {
        (T_RPT_AMT, V_CHD_AMT)
    } else if alt && shift {
        (T_ARP_VOICES, V_VOICING)
    } else if alt {
        (T_ARP_OFFSET, V_ARP_STYLE)
    } else if shift {
        (T_LENGTH, V_INVERSION)
    } else {
        (T_NONE, V_NONE)
    };

    // ---- Row 0: note + chord info ----
    let mut cx = VALUE_X;
    gfx_text(cx, ROW_Y[0], &note_name, color_lookup(OLED_CYAN), &FONT_MAIN);
    cx += gfx_text_width(&note_name, &FONT_MAIN);

    if chord_amount > 1 && is_drum {
        // Drum mode: comma-separated list with overflow count
        let max_x = GFX_WIDTH as i16 - VALUE_X;
        let mut shown: u8 = 1;
        let mut done = false;
        (1..chord_amount as usize).for_each(|i| {
            if done { return; }
            let row_i = sel_row + (chord_space as i16) * (i as i16);
            let name_i = get_note_display(row_i, true, s);
            let candidate = format!(", {}", name_i);
            let cand_w = gfx_text_width(&candidate, &FONT_MAIN);
            let remaining = chord_amount as usize - i - 1;
            if remaining > 0 {
                let plus_buf = format!(", +{}", remaining + 1);
                let plus_w = gfx_text_width(&plus_buf, &FONT_MAIN);
                if cx + cand_w + plus_w > max_x {
                    let overflow = format!(", +{}", chord_amount - shown);
                    gfx_text(cx, ROW_Y[0], &overflow, color_lookup(OLED_CYAN), &FONT_MAIN);
                    done = true;
                    return;
                }
            } else if cx + cand_w > max_x {
                let overflow = format!(", +{}", chord_amount - shown);
                gfx_text(cx, ROW_Y[0], &overflow, color_lookup(OLED_CYAN), &FONT_MAIN);
                done = true;
                return;
            }
            gfx_text(cx, ROW_Y[0], &candidate, color_lookup(OLED_CYAN), &FONT_MAIN);
            cx += cand_w;
            shown += 1;
        });
    } else if chord_amount > 1 && chord_space == 1 {
        let top_row = sel_row + (chord_amount as i16 - 1);
        let top_name = get_note_display(top_row, is_drum, s);
        let buf = format!(" to {}", top_name);
        gfx_text(cx, ROW_Y[0], &buf, color_lookup(OLED_CYAN), &FONT_MAIN);
    } else if chord_amount == 2 {
        let second_row = sel_row + chord_space as i16;
        let second_name = get_note_display(second_row, is_drum, s);
        let midi1 = note_to_midi(sel_row, s);
        let midi2 = note_to_midi(second_row, s);
        let semitones = ((midi2 as i32) - (midi1 as i32)).unsigned_abs() as u8;
        let interval_name = if semitones == 12 {
            alloc::string::String::from("octave")
        } else if semitones > 12 {
            format!("{} +oct", INTERVAL_NAMES[(semitones % 12) as usize])
        } else {
            alloc::string::String::from(INTERVAL_NAMES[semitones as usize])
        };
        let buf = format!(" - {} ({})", second_name, interval_name);
        gfx_text(cx, ROW_Y[0], &buf, color_lookup(OLED_CYAN), &FONT_MAIN);
    } else if chord_amount > 2 {
        gfx_text(cx, ROW_Y[0], " - ", color_lookup(OLED_CYAN), &FONT_MAIN);
        cx += gfx_text_width(" - ", &FONT_MAIN);

        let chord_label = if !raw_chord_name.is_empty() {
            let oct_suffix = voicing_name.find("oct").map(|pos| {
                let prefix_start = voicing_name[..pos].rfind(|c: char| c != '+' && !c.is_ascii_digit()).map_or(0, |p| p + 1);
                &voicing_name[prefix_start..]
            });
            oct_suffix.map_or_else(
                || raw_chord_name.clone(),
                |suffix| format!("{} {}", raw_chord_name, suffix),
            )
        } else {
            format!("{}x{}", chord_amount, chord_space)
        };
        let color = if v_target == V_VOICING { OLED_RED } else { OLED_CYAN };
        gfx_text(cx, ROW_Y[0], &chord_label, color_lookup(color), &FONT_MAIN);
    }

    // ---- Row 1: length x amount @ space ----
    let amt_str = format!("{}", repeat_amount);
    let segs = [
        Segment { text: &length_display, color: if h_target == T_LENGTH { OLED_YELLOW } else { OLED_CYAN } },
        Segment { text: " x ", color: OLED_CYAN },
        Segment { text: &amt_str, color: if h_target == T_RPT_AMT { OLED_YELLOW } else { OLED_CYAN } },
        Segment { text: " @ ", color: OLED_CYAN },
        Segment { text: &repeat_space_display, color: if h_target == T_RPT_SPACE { OLED_YELLOW } else { OLED_CYAN } },
    ];
    draw_segments(VALUE_X, ROW_Y[1], &segs);

    // ---- Row 2+: modifier legends ----
    let has_modifier = shift || meta || alt;
    if has_modifier {
        let (x_label, y_label) = if meta && shift {
            ("Repeat space", "Stack space")
        } else if meta {
            ("Repeat amount", "Stack size")
        } else if alt && shift {
            ("Arp voices", "Voicing")
        } else if alt {
            ("Arp offset", "Arp style")
        } else {
            ("Length", if chord_amount > 1 { "Inversion" } else { "Move octave" })
        };

        let y_value = match v_target {
            V_INVERSION if chord_amount > 1 => {
                let inv = ev.chord_inversion;
                format!("{}{}", if inv >= 0 { "+" } else { "" }, inv)
            },
            V_CHD_AMT => format!("{}", chord_amount),
            V_CHD_SPACE => format!("{}", chord_space),
            V_ARP_STYLE => alloc::string::String::from(*ARP_STYLE_NAMES.get(arp_style as usize).unwrap_or(&"CHD")),
            V_VOICING => alloc::string::String::from(if !voicing_name.is_empty() { voicing_name } else { "base" }),
            _ => alloc::string::String::new(),
        };

        let x_value = match h_target {
            T_LENGTH => length_display.clone(),
            T_RPT_AMT => format!("{}", repeat_amount),
            T_RPT_SPACE => repeat_space_display.clone(),
            T_ARP_OFFSET => format!("{}{}", if arp_offset > 0 { "+" } else { "" }, arp_offset),
            T_ARP_VOICES => format!("{}", arp_voices),
            _ => alloc::string::String::new(),
        };

        draw_icon_legend(ROW_Y[2], IconType::Vertical, y_label, &y_value, OLED_RED);
        draw_icon_legend(ROW_Y[3], IconType::Horizontal, x_label, &x_value, OLED_YELLOW);
    } else {
        draw_icon_text(ROW_Y[2], IconType::AllDirs, "Move", OLED_CYAN);
    }
}

fn render_modify(s: &EngineState, mods: u8) {
    let sub_mode = s.modify_sub_mode as usize;
    let sub_label = SUB_MODE_LABELS.get(sub_mode).unwrap_or(&"?");
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

        let note_name = get_note_display(ev.row, is_drum, s);

        let sm_arr = get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sub_mode);
        let loop_mode_val = sm_arr.loop_mode;
        let loop_label = LOOP_MODE_LABELS.get(loop_mode_val as usize).unwrap_or(&"RST");
        let arr_len = sm_arr.length;

        // Row 0: note + sub-mode
        let sub_buf = format!(" {}", sub_label);
        let row0 = [
            Segment { text: &note_name, color: OLED_CYAN },
            Segment { text: &sub_buf, color: if m_meta { OLED_RED } else { OLED_CYAN } },
        ];
        draw_segments(VALUE_X, ROW_Y[0], &row0);

        // Row 1: loop mode + length
        let len_buf = format!(" L{}", arr_len);
        let row1 = [
            Segment { text: loop_label, color: if !m_meta { OLED_RED } else { OLED_CYAN } },
            Segment { text: &len_buf, color: if !m_meta { OLED_YELLOW } else { OLED_CYAN } },
        ];
        draw_segments(VALUE_X, ROW_Y[1], &row1);

        if m_meta {
            draw_icon_legend(ROW_Y[2], IconType::Vertical, "Sub-mode", sub_label, OLED_RED);
        } else {
            draw_icon_legend(ROW_Y[2], IconType::Vertical, "Loop mode", loop_label, OLED_RED);
            let len_str = format!("{}", arr_len);
            draw_icon_legend(ROW_Y[3], IconType::Horizontal, "Length", &len_str, OLED_YELLOW);
        }
    } else {
        gfx_text(VALUE_X, ROW_Y[0], sub_label, color_lookup(if m_meta { OLED_RED } else { OLED_CYAN }), &FONT_MAIN);
        gfx_text(VALUE_X, ROW_Y[1], "SELECT A NOTE", color_lookup(OLED_CYAN), &FONT_MAIN);
        if m_meta {
            draw_icon_legend(ROW_Y[2], IconType::Vertical, "Sub-mode", sub_label, OLED_RED);
        }
    }
}

fn render_channel(s: &EngineState) {
    let ch = s.current_channel;
    let pat = s.current_patterns[ch as usize];
    let ch_buf = format!("CH {}", ch + 1);
    let pat_buf = format!("{}", pat + 1);

    draw_labeled_row(ROW_Y[0], "MODE", "CHANNEL", OLED_CYAN);
    draw_labeled_row(ROW_Y[1], "SELECT", &ch_buf, OLED_CYAN);
    draw_labeled_row(ROW_Y[2], "PAT", &pat_buf, OLED_CYAN);
}

fn render_loop(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let loop_data = &s.loops[ch][pat];
    let loop_start = loop_data.start;
    let loop_end = loop_data.start + loop_data.length;
    let l_shift = (mods & MOD_SHIFT) != 0;

    draw_labeled_row(ROW_Y[0], "MODE", "LOOP", OLED_CYAN);

    let s_buf = tick_to_beat_display(loop_start);
    let e_buf = tick_to_beat_display(loop_end);

    let s_full = format!("S {}", s_buf);
    let e_full = format!("  E {}", e_buf);

    let row1 = [
        Segment { text: &s_full, color: if l_shift { OLED_YELLOW } else { OLED_CYAN } },
        Segment { text: &e_full, color: if !l_shift { OLED_YELLOW } else { OLED_CYAN } },
    ];
    draw_segments(VALUE_X, ROW_Y[1], &row1);

    if l_shift {
        draw_icon_legend(ROW_Y[2], IconType::Horizontal, "Start", &s_buf, OLED_YELLOW);
    } else {
        draw_icon_legend(ROW_Y[2], IconType::Horizontal, "End", &e_buf, OLED_YELLOW);
    }
}

fn render_pattern_default(s: &EngineState, mods: u8) {
    let ch = s.current_channel as usize;
    let pat = s.current_patterns[ch] as usize;
    let is_drum = s.channel_types[ch] == CH_DRUM;
    let p_alt = (mods & MOD_ALT) != 0;
    let p_shift = (mods & MOD_SHIFT) != 0;

    if p_shift {
        draw_labeled_row(ROW_Y[0], "MODE", "EXTEND", OLED_CYAN);
        draw_labeled_row(ROW_Y[1], "NOTE", "DRAG", OLED_CYAN);
        return;
    }

    // Row 0: CH x  PAT y
    let ch_str = format!("CH {}", ch + 1);
    let pat_str = format!("  PAT {}", pat + 1);
    let row0 = [
        Segment { text: &ch_str, color: OLED_CYAN },
        Segment { text: &pat_str, color: OLED_CYAN },
    ];
    draw_segments(VALUE_X, ROW_Y[0], &row0);

    // Row 1: type or key
    if is_drum {
        draw_labeled_row(ROW_Y[1], "TYPE", "DRUMS", OLED_CYAN);
    } else {
        let scale_root_name = NOTE_NAMES[(s.scale_root % 12) as usize];
        let scale_name = engine_get_scale_name_str(s);

        let lx = LABEL_X;
        gfx_text(lx, ROW_Y[1], "KEY", color_lookup(OLED_DIM), &FONT_SMALL);
        let kx = lx + gfx_text_width("KEY ", &FONT_SMALL);
        gfx_text(kx, ROW_Y[1], scale_root_name, color_lookup(if p_alt { OLED_YELLOW } else { OLED_CYAN }), &FONT_MAIN);

        let root_sp = format!("{} ", scale_root_name);
        let cx2 = kx + gfx_text_width(&root_sp, &FONT_MAIN);
        gfx_text(cx2, ROW_Y[1], scale_name, color_lookup(if p_alt { OLED_RED } else { OLED_CYAN }), &FONT_MAIN);
    }

    // Row 2+
    if p_alt && !is_drum {
        let scale_name = engine_get_scale_name_str(s);
        let scale_root_name = NOTE_NAMES[(s.scale_root % 12) as usize];
        draw_icon_legend(ROW_Y[2], IconType::Vertical, "Scale", scale_name, OLED_RED);
        draw_icon_legend(ROW_Y[3], IconType::Horizontal, "Root", scale_root_name, OLED_YELLOW);
    } else {
        let loop_data = &s.loops[ch][pat];
        let s_buf = tick_to_beat_display(loop_data.start);
        let e_buf = tick_to_beat_display(loop_data.start + loop_data.length);
        let loop_str = format!("{}-{}", s_buf, e_buf);
        draw_labeled_row(ROW_Y[2], "LOOP", &loop_str, OLED_CYAN);
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
        ChordTemplate { intervals: [3,7,0,0], count: 2, suffix: "m" },
        ChordTemplate { intervals: [3,6,0,0], count: 2, suffix: "dim" },
        ChordTemplate { intervals: [4,8,0,0], count: 2, suffix: "aug" },
        ChordTemplate { intervals: [2,7,0,0], count: 2, suffix: "sus2" },
        ChordTemplate { intervals: [5,7,0,0], count: 2, suffix: "sus4" },
        ChordTemplate { intervals: [4,7,11,0], count: 3, suffix: "maj7" },
        ChordTemplate { intervals: [4,7,10,0], count: 3, suffix: "7" },
        ChordTemplate { intervals: [3,7,10,0], count: 3, suffix: "m7" },
        ChordTemplate { intervals: [3,7,11,0], count: 3, suffix: "mM7" },
        ChordTemplate { intervals: [3,6,10,0], count: 3, suffix: "m7b5" },
        ChordTemplate { intervals: [3,6,9,0], count: 3, suffix: "dim7" },
        ChordTemplate { intervals: [4,8,10,0], count: 3, suffix: "aug7" },
        ChordTemplate { intervals: [4,7,9,0], count: 3, suffix: "6" },
        ChordTemplate { intervals: [3,7,9,0], count: 3, suffix: "m6" },
        ChordTemplate { intervals: [5,7,10,0], count: 3, suffix: "7sus4" },
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
// Mirrors src/wasm/tests/test_oled.c

#[cfg(test)]
mod tests {
    use super::*;

    // ============ midi_note_to_name ============

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

    // ============ tick_to_beat_display ============

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

    // ============ ticks_to_musical_name ============

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

    // ============ ticks_to_canonical_name ============

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
        // 960 ticks = 1/2 note
        assert_eq!(ticks_to_canonical_name(960), "1/2");
    }

    #[test]
    fn canonical_fallback() {
        assert_eq!(ticks_to_canonical_name(17), "17t");
    }

    // ============ get_drum_name ============

    #[test]
    fn drum_name_kick() {
        assert_eq!(get_drum_name(36), "Kick");
    }

    #[test]
    fn drum_name_snare() {
        assert_eq!(get_drum_name(38), "Snare");
    }

    #[test]
    fn drum_name_cl_hh() {
        assert_eq!(get_drum_name(42), "Cl HH");
    }

    #[test]
    fn drum_name_out_of_range() {
        assert_eq!(get_drum_name(10), "D10");
    }

    #[test]
    fn drum_name_boundary_low() {
        assert_eq!(get_drum_name(35), "Kick 2");
    }

    #[test]
    fn drum_name_boundary_high() {
        assert_eq!(get_drum_name(81), "Op Tri");
    }
}
