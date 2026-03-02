// oled_screen.c — OLED screen content rendering
// Ports all display logic from Grid.tsx renderOled() to C.

#include "oled_screen.h"
#include "oled_gfx.h"
#include "oled_fonts.h"
#include "oled_display.h"
#include "engine_core.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

// ============ External engine state ============
extern EngineState g_state;

// From engine_wasm.c
extern const char* engine_get_chord_name(void);

// ============ Layout constants ============
static const int16_t ROW_Y[6] = {18, 38, 58, 78, 98, 118};
#define LABEL_X 6
#define VALUE_X 6

// ============ Color lookup (index → RGB565) ============
static const uint16_t COLOR_TABLE[] = {
    GFX_CYAN,    // 0 = OLED_CYAN
    GFX_YELLOW,  // 1 = OLED_YELLOW
    GFX_RED,     // 2 = OLED_RED
    GFX_WHITE,   // 3 = OLED_WHITE
    GFX_DIM,     // 4 = OLED_DIM
};
#define NUM_COLORS 5

static inline uint16_t color_rgb(uint8_t idx) {
    return (idx < NUM_COLORS) ? COLOR_TABLE[idx] : GFX_CYAN;
}

// ============ Font lookup ============
static inline const GFXfont* get_font(uint8_t idx) {
    return (idx == OLED_FONT_SMALL) ? &font_small : &font_main;
}

// ============ String helpers ============

static const char* NOTE_NAMES[12] = {
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
};

// midi_note_to_name: writes "C4", "G#5", etc. into buf (must be >=6 chars)
static void midi_note_to_name(int8_t note, char* buf) {
    if (note < 0 || note > 127) { buf[0] = '?'; buf[1] = '?'; buf[2] = 0; return; }
    int octave = (note / 12) - 1;
    int idx = note % 12;
    sprintf(buf, "%s%d", NOTE_NAMES[idx], octave);
}

// tick_to_beat_display: writes "1", "2.3", etc.
static void tick_to_beat_display(int32_t tick, char* buf) {
    int beat = (int)(tick / TICKS_PER_QUARTER) + 1;
    int sub = (int)(tick % TICKS_PER_QUARTER);
    if (sub == 0) {
        sprintf(buf, "%d", beat);
    } else {
        int sixteenth = (sub / (TICKS_PER_QUARTER / 4)) + 1;
        sprintf(buf, "%d.%d", beat, sixteenth);
    }
}

// Musical name lookup table
typedef struct { int32_t ticks; const char* name; } MusicalName;

static const MusicalName MUSICAL_NAMES[] = {
    {30, "1/64"}, {40, "1/32T"}, {45, "1/64."}, {60, "1/32"}, {80, "1/16T"},
    {90, "1/32."}, {120, "1/16"}, {160, "1/8T"}, {180, "1/16."}, {240, "1/8"},
    {320, "1/4T"}, {360, "1/8."}, {480, "1/4"}, {640, "1/2T"}, {720, "1/4."},
    {960, "1/2"}, {1440, "1/2."}, {1920, "1"},
};
#define NUM_MUSICAL_NAMES (sizeof(MUSICAL_NAMES) / sizeof(MUSICAL_NAMES[0]))

// Triplet lookup
typedef struct { int32_t ticks; const char* name; } TripletName;
static const TripletName TRIPLET_NAMES[] = {
    {40, "1/32T"}, {80, "1/16T"}, {160, "1/8T"}, {320, "1/4T"}, {640, "1/2T"},
};
#define NUM_TRIPLET_NAMES (sizeof(TRIPLET_NAMES) / sizeof(TRIPLET_NAMES[0]))

static const char* lookup_triplet(int32_t ticks) {
    for (int i = 0; i < (int)NUM_TRIPLET_NAMES; i++) {
        if (TRIPLET_NAMES[i].ticks == ticks) return TRIPLET_NAMES[i].name;
    }
    return NULL;
}

static const char* lookup_musical(int32_t ticks) {
    for (int i = 0; i < (int)NUM_MUSICAL_NAMES; i++) {
        if (MUSICAL_NAMES[i].ticks == ticks) return MUSICAL_NAMES[i].name;
    }
    return NULL;
}

// ticks_to_musical_name: "1/16", "1/8T", "2/16", "480t", etc.
static void ticks_to_musical_name(int32_t ticks, int32_t zoom, char* buf) {
    const char* trip = lookup_triplet(ticks);
    if (trip) { strcpy(buf, trip); return; }

    if (ticks > 0 && zoom > 0 && (ticks % zoom == 0)) {
        int n = (int)(ticks / zoom);
        int denom = (int)(1920 / zoom);
        sprintf(buf, "%d/%d", n, denom);
        return;
    }

    const char* mus = lookup_musical(ticks);
    if (mus) { strcpy(buf, mus); return; }

    sprintf(buf, "%dt", (int)ticks);
}

// ticks_to_canonical_name: simplified musical name
static void ticks_to_canonical_name(int32_t ticks, char* buf) {
    const char* trip = lookup_triplet(ticks);
    if (trip) { strcpy(buf, trip); return; }

    const char* mus = lookup_musical(ticks);
    if (mus) { strcpy(buf, mus); return; }

    // Multiple of whole note
    if (ticks > 0 && (ticks % 1920 == 0)) {
        sprintf(buf, "%d", (int)(ticks / 1920));
        return;
    }

    // Find simplest denominator
    for (int i = 0; i < (int)NUM_MUSICAL_NAMES; i++) {
        int32_t t = MUSICAL_NAMES[i].ticks;
        if (t > 0 && (ticks % t == 0)) {
            // Extract denominator from name like "1/4" → 4
            const char* name = MUSICAL_NAMES[i].name;
            const char* slash = strchr(name, '/');
            if (slash && name[0] == '1') {
                int denom = atoi(slash + 1);
                if (denom > 0) {
                    sprintf(buf, "%d/%d", (int)(ticks / t), denom);
                    return;
                }
            }
        }
    }

    sprintf(buf, "%dt", (int)ticks);
}

// GM Drum names (MIDI 35-81)
static const char* GM_DRUM_NAMES[] = {
    "Kick 2", "Kick", "Stick", "Snare", "Clap", "E.Snr",       // 35-40
    "Lo Tom", "Cl HH", "Hi Tom", "Ped HH", "Lo Tom", "Op HH",  // 41-46
    "LM Tom", "HM Tom", "Crash", "Hi Tom", "Ride", "China",     // 47-52
    "RideBl", "Tamb", "Splash", "Cowbel", "Crash2", "Vibra",    // 53-58
    "Ride2", "Hi Bon", "Lo Bon", "Mt Con", "Op Con", "Lo Con",  // 59-64
    "Hi Tim", "Lo Tim", "Hi Aga", "Lo Aga", "Cabasa", "Maraca", // 65-70
    "S.Whst", "L.Whst", "S.Guir", "L.Guir", "Claves", "Hi Blk",// 71-76
    "Lo Blk", "Mt Cga", "Op Cga", "Mt Tri", "Op Tri",          // 77-81
};
#define GM_DRUM_MIN 35
#define GM_DRUM_MAX 81

static void get_drum_name(int8_t midi, char* buf) {
    if (midi >= GM_DRUM_MIN && midi <= GM_DRUM_MAX) {
        strcpy(buf, GM_DRUM_NAMES[midi - GM_DRUM_MIN]);
    } else {
        sprintf(buf, "D%d", midi);
    }
}

// ============ Sub-mode / loop mode labels ============

static const char* SUB_MODE_LABELS[5] = { "VEL", "HIT", "TIME", "FLAM", "MOD" };
static const char* LOOP_MODE_LABELS[3] = { "RST", "CNT", "FIL" };
static const char* ARP_STYLE_NAMES[ARP_STYLE_COUNT] = { "CHD", "UP", "DN", "U/D", "D/U", "C.UP", "C.DN", "C.U/D", "C.D/U" };

static const char* INTERVAL_NAMES[12] = {
    "unison", "min 2nd", "2nd", "min 3rd", "3rd", "4th",
    "tritone", "5th", "min 6th", "6th", "min 7th", "7th"
};

// ============ Drawing helpers ============

// Colored text segment
typedef struct { const char* text; uint8_t color; } Segment;

// Draw colored text segments left-to-right, return final x
static int16_t draw_segments(int16_t x, int16_t y, const Segment* segs, int count) {
    int16_t cx = x;
    for (int i = 0; i < count; i++) {
        gfx_text(cx, y, segs[i].text, color_rgb(segs[i].color), &font_main);
        cx += gfx_text_width(segs[i].text, &font_main);
    }
    return cx;
}

// Draw a labeled row: small dim label + value in color
static void draw_labeled_row(int16_t y, const char* label, const char* value, uint8_t val_color) {
    if (label && label[0]) {
        gfx_text(LABEL_X, y, label, color_rgb(OLED_DIM), &font_small);
        // Measure label + space
        char lbl_sp[32];
        snprintf(lbl_sp, sizeof(lbl_sp), "%s ", label);
        int16_t lw = gfx_text_width(lbl_sp, &font_small);
        gfx_text(LABEL_X + lw, y, value, color_rgb(val_color), &font_main);
    } else {
        gfx_text(VALUE_X, y, value, color_rgb(val_color), &font_main);
    }
}

// Draw legend: "prefix: " in legend_color, then value in OLED_CYAN
static void draw_legend(int16_t y, const char* prefix, const char* value, uint8_t legend_color) {
    gfx_text(VALUE_X, y, prefix, color_rgb(legend_color), &font_main);
    int16_t w = gfx_text_width(prefix, &font_main);
    if (value && value[0]) {
        gfx_text(VALUE_X + w, y, value, color_rgb(OLED_CYAN), &font_main);
    }
}

// ============ Arrow icons (13x13, centered on text baseline) ============

#define ICON_SIZE 13
#define ICON_PAD  4  // space after icon before text

// Vertical arrows icon (up + down)
static void draw_icon_vertical(int16_t x, int16_t y, uint16_t color) {
    int16_t cy = y - 5;  // vertically centered on text glyphs
    int16_t mx = x + 6;  // horizontal center
    // Up arrowhead
    gfx_pixel(mx, cy - 5, color);
    gfx_hline(mx - 1, cy - 4, 3, color);
    gfx_hline(mx - 2, cy - 3, 5, color);
    gfx_hline(mx - 3, cy - 2, 7, color);
    // Shaft
    gfx_vline(mx, cy - 2, 5, color);
    // Down arrowhead
    gfx_hline(mx - 3, cy + 2, 7, color);
    gfx_hline(mx - 2, cy + 3, 5, color);
    gfx_hline(mx - 1, cy + 4, 3, color);
    gfx_pixel(mx, cy + 5, color);
}

// Horizontal arrows icon (left + right)
static void draw_icon_horizontal(int16_t x, int16_t y, uint16_t color) {
    int16_t cy = y - 5;
    int16_t mx = x + 6;
    // Left arrowhead
    gfx_pixel(mx - 6, cy, color);
    gfx_vline(mx - 5, cy - 1, 3, color);
    gfx_vline(mx - 4, cy - 2, 5, color);
    gfx_vline(mx - 3, cy - 3, 7, color);
    // Shaft
    gfx_hline(mx - 3, cy, 7, color);
    // Right arrowhead
    gfx_vline(mx + 3, cy - 3, 7, color);
    gfx_vline(mx + 4, cy - 2, 5, color);
    gfx_vline(mx + 5, cy - 1, 3, color);
    gfx_pixel(mx + 6, cy, color);
}

// All-directions icon (4 arrows)
static void draw_icon_all_dirs(int16_t x, int16_t y, uint16_t color) {
    int16_t cy = y - 5;
    int16_t mx = x + 6;
    // Cross lines
    gfx_hline(mx - 5, cy, 11, color);
    gfx_vline(mx, cy - 5, 11, color);
    // Up arrowhead
    gfx_hline(mx - 1, cy - 4, 3, color);
    gfx_hline(mx - 2, cy - 3, 5, color);
    // Down arrowhead
    gfx_hline(mx - 1, cy + 4, 3, color);
    gfx_hline(mx - 2, cy + 3, 5, color);
    // Left arrowhead
    gfx_vline(mx - 4, cy - 1, 3, color);
    gfx_vline(mx - 3, cy - 2, 5, color);
    // Right arrowhead
    gfx_vline(mx + 3, cy - 2, 5, color);
    gfx_vline(mx + 4, cy - 1, 3, color);
}

typedef enum { ICON_VERTICAL, ICON_HORIZONTAL, ICON_ALL_DIRS } IconType;

static void draw_icon(IconType type, int16_t x, int16_t y, uint16_t color) {
    switch (type) {
        case ICON_VERTICAL:   draw_icon_vertical(x, y, color); break;
        case ICON_HORIZONTAL: draw_icon_horizontal(x, y, color); break;
        case ICON_ALL_DIRS:   draw_icon_all_dirs(x, y, color); break;
    }
}

// Draw icon + label + ": " in legend_color, then value in OLED_CYAN
static void draw_icon_legend(int16_t y, IconType icon, const char* label, const char* value, uint8_t legend_color) {
    draw_icon(icon, VALUE_X, y, color_rgb(legend_color));
    int16_t tx = VALUE_X + ICON_SIZE + ICON_PAD;
    char prefix[32];
    snprintf(prefix, sizeof(prefix), "%s: ", label);
    gfx_text(tx, y, prefix, color_rgb(legend_color), &font_main);
    if (value && value[0]) {
        int16_t w = gfx_text_width(prefix, &font_main);
        gfx_text(tx + w, y, value, color_rgb(OLED_CYAN), &font_main);
    }
}

// Draw icon + text label (no value)
static void draw_icon_text(int16_t y, IconType icon, const char* text, uint8_t color) {
    draw_icon(icon, VALUE_X, y, color_rgb(color));
    int16_t tx = VALUE_X + ICON_SIZE + ICON_PAD;
    gfx_text(tx, y, text, color_rgb(color), &font_main);
}

// ============ Helper to get note display name ============

static void get_note_display(int16_t row, uint8_t is_drum, char* buf) {
    if (is_drum) {
        // For drum channels, the row IS the MIDI note directly
        int8_t midi = (int8_t)(row < 0 ? 0 : (row > 127 ? 127 : row));
        get_drum_name(midi, buf);
    } else {
        int8_t midi = note_to_midi(row, &g_state);
        if (midi >= 0) midi_note_to_name(midi, buf);
        else { buf[0] = '?'; buf[1] = '?'; buf[2] = 0; }
    }
}

// ============ Mode renderers ============

static void render_pattern_selected(uint8_t mods) {
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    NoteEvent_C* ev = &g_state.patterns[ch][pat].events[g_state.selected_event_idx];
    uint8_t is_drum = (g_state.channel_types[ch] == CH_DRUM);

    int16_t sel_row = ev->row;
    int32_t sel_length = ev->length;
    uint16_t repeat_amount = ev->repeat_amount;
    int32_t repeat_space = ev->repeat_space;
    uint8_t chord_amount = ev->chord_amount;
    uint8_t chord_space = ev->chord_space;
    uint8_t chord_voicing = ev->chord_voicing;
    uint8_t arp_style = ev->arp_style;
    int8_t arp_offset = ev->arp_offset;
    uint8_t arp_voices = ev->arp_voices;

    uint8_t shift = (mods & MOD_SHIFT) != 0;
    uint8_t meta = (mods & MOD_META) != 0;
    uint8_t alt = (mods & MOD_ALT) != 0;

    // Get note name
    char note_name[16];
    get_note_display(sel_row, is_drum, note_name);

    // Length + repeat displays
    char length_display[16];
    ticks_to_musical_name(sel_length, g_state.zoom, length_display);
    char repeat_space_display[16];
    ticks_to_canonical_name(repeat_space, repeat_space_display);

    // Chord/voicing info
    const char* voicing_name = "";
    const char* raw_chord_name = "";
    if (chord_amount > 1) {
        voicing_name = get_voicing_name(chord_amount, chord_space, chord_voicing);
        raw_chord_name = engine_get_chord_name();
    }

    // Determine edit targets based on modifiers
    // hTarget: 0=none, 1=move, 2=length, 3=rptAmt, 4=rptSpace, 5=arpOffset, 6=arpVoices
    // vTarget: 0=none, 1=move, 2=inversion, 3=chdAmt, 4=chdSpace, 5=arpStyle, 6=voicing
    enum { T_NONE=0, T_MOVE, T_LENGTH, T_RPT_AMT, T_RPT_SPACE, T_ARP_OFFSET, T_ARP_VOICES };
    enum { V_NONE=0, V_MOVE, V_INVERSION, V_CHD_AMT, V_CHD_SPACE, V_ARP_STYLE, V_VOICING };
    int h_target = T_NONE, v_target = V_NONE;

    if (meta && shift) { h_target = T_RPT_SPACE; v_target = V_CHD_SPACE; }
    else if (meta) { h_target = T_RPT_AMT; v_target = V_CHD_AMT; }
    else if (alt && shift) { h_target = T_ARP_VOICES; v_target = V_VOICING; }
    else if (alt) { h_target = T_ARP_OFFSET; v_target = V_ARP_STYLE; }
    else if (shift) { h_target = T_LENGTH; v_target = V_INVERSION; }

    // ---- Row 0: note + chord info ----
    int16_t cx = VALUE_X;
    gfx_text(cx, ROW_Y[0], note_name, color_rgb(OLED_CYAN), &font_main);
    cx += gfx_text_width(note_name, &font_main);

    if (chord_amount > 1 && is_drum) {
        // Drum mode: comma-separated list with overflow count
        // "Kick, Snare, +1" — fits within row width
        int16_t max_x = GFX_WIDTH - VALUE_X;
        uint8_t shown = 1; // first name already drawn
        for (uint8_t i = 1; i < chord_amount; i++) {
            int16_t row_i = sel_row + (int16_t)chord_space * i;
            char name_i[16];
            get_note_display(row_i, 1, name_i);
            // Build ", Name" candidate
            char candidate[24];
            snprintf(candidate, sizeof(candidate), ", %s", name_i);
            int16_t cand_w = gfx_text_width(candidate, &font_main);
            // Check if remaining notes need a "+N" suffix
            uint8_t remaining = chord_amount - i - 1;
            if (remaining > 0) {
                char plus_buf[8];
                snprintf(plus_buf, sizeof(plus_buf), ", +%d", remaining + 1);
                int16_t plus_w = gfx_text_width(plus_buf, &font_main);
                if (cx + cand_w + plus_w > max_x) {
                    // Won't fit with remaining — show +N for all unshown
                    snprintf(plus_buf, sizeof(plus_buf), ", +%d", chord_amount - shown);
                    gfx_text(cx, ROW_Y[0], plus_buf, color_rgb(OLED_CYAN), &font_main);
                    goto drum_row0_done;
                }
            } else {
                // Last note — just check if it fits
                if (cx + cand_w > max_x) {
                    char plus_buf[8];
                    snprintf(plus_buf, sizeof(plus_buf), ", +%d", chord_amount - shown);
                    gfx_text(cx, ROW_Y[0], plus_buf, color_rgb(OLED_CYAN), &font_main);
                    goto drum_row0_done;
                }
            }
            gfx_text(cx, ROW_Y[0], candidate, color_rgb(OLED_CYAN), &font_main);
            cx += cand_w;
            shown++;
        }
        drum_row0_done: ;
    } else if (chord_amount > 1 && chord_space == 1) {
        // Single-spaced chord: show "to TopNote"
        int16_t top_row = sel_row + (chord_amount - 1);
        char top_name[16];
        get_note_display(top_row, is_drum, top_name);
        char buf[32];
        snprintf(buf, sizeof(buf), " to %s", top_name);
        gfx_text(cx, ROW_Y[0], buf, color_rgb(OLED_CYAN), &font_main);
    } else if (chord_amount == 2) {
        // Interval display
        int16_t second_row = sel_row + chord_space;
        char second_name[16];
        get_note_display(second_row, is_drum, second_name);
        int8_t midi1 = note_to_midi(sel_row, &g_state);
        int8_t midi2 = note_to_midi(second_row, &g_state);
        int semitones = abs((int)midi2 - (int)midi1);
        const char* interval_name;
        if (semitones == 12) interval_name = "octave";
        else if (semitones > 12) {
            // Build "Xth +oct" style name
            static char ivl_buf[24];
            snprintf(ivl_buf, sizeof(ivl_buf), "%s +oct", INTERVAL_NAMES[semitones % 12]);
            interval_name = ivl_buf;
        } else if (semitones < 12) {
            interval_name = INTERVAL_NAMES[semitones];
        } else {
            interval_name = "?";
        }
        char buf[48];
        snprintf(buf, sizeof(buf), " - %s (%s)", second_name, interval_name);
        gfx_text(cx, ROW_Y[0], buf, color_rgb(OLED_CYAN), &font_main);
    } else if (chord_amount > 2) {
        gfx_text(cx, ROW_Y[0], " - ", color_rgb(OLED_CYAN), &font_main);
        cx += gfx_text_width(" - ", &font_main);
        // Build chord label
        char chord_label[32];
        if (raw_chord_name[0]) {
            // Check if voicing name has octave suffix like "+oct" or "2oct"
            const char* oct = strstr(voicing_name, "oct");
            if (oct) {
                // Find start of oct suffix (could be "+oct", "2oct", "+2oct")
                const char* p = oct;
                while (p > voicing_name && (p[-1] == '+' || (p[-1] >= '0' && p[-1] <= '9'))) p--;
                snprintf(chord_label, sizeof(chord_label), "%s %s", raw_chord_name, p);
            } else {
                snprintf(chord_label, sizeof(chord_label), "%s", raw_chord_name);
            }
        } else {
            snprintf(chord_label, sizeof(chord_label), "%dx%d", chord_amount, chord_space);
        }
        uint8_t color = (v_target == V_VOICING) ? OLED_RED : OLED_CYAN;
        gfx_text(cx, ROW_Y[0], chord_label, color_rgb(color), &font_main);
    }

    // ---- Row 1: length x amount @ space ----
    char amt_str[8];
    snprintf(amt_str, sizeof(amt_str), "%d", repeat_amount);
    Segment row1[] = {
        { length_display, (h_target == T_LENGTH) ? OLED_YELLOW : OLED_CYAN },
        { " x ", OLED_CYAN },
        { amt_str, (h_target == T_RPT_AMT) ? OLED_YELLOW : OLED_CYAN },
        { " @ ", OLED_CYAN },
        { repeat_space_display, (h_target == T_RPT_SPACE) ? OLED_YELLOW : OLED_CYAN },
    };
    draw_segments(VALUE_X, ROW_Y[1], row1, 5);

    // ---- Row 2+: modifier legends ----
    uint8_t has_modifier = shift || meta || alt;
    if (has_modifier) {
        // Determine labels
        const char* x_label = "Move";
        const char* y_label = "Move";
        if (meta && shift) { x_label = "Repeat space"; y_label = "Stack space"; }
        else if (meta) { x_label = "Repeat amount"; y_label = "Stack size"; }
        else if (alt && shift) { x_label = "Arp voices"; y_label = "Voicing"; }
        else if (alt) { x_label = "Arp offset"; y_label = "Arp style"; }
        else if (shift) {
            x_label = "Length";
            y_label = (chord_amount > 1) ? "Inversion" : "Move octave";
        }

        // Build value strings
        char y_value[32] = "";
        char x_value[32] = "";
        int8_t inv = ev->chord_inversion;
        switch (v_target) {
            case V_INVERSION:
                if (chord_amount > 1) snprintf(y_value, sizeof(y_value), "%s%d", inv >= 0 ? "+" : "", inv);
                break;
            case V_CHD_AMT: snprintf(y_value, sizeof(y_value), "%d", chord_amount); break;
            case V_CHD_SPACE: snprintf(y_value, sizeof(y_value), "%d", chord_space); break;
            case V_ARP_STYLE: snprintf(y_value, sizeof(y_value), "%s", ARP_STYLE_NAMES[arp_style < ARP_STYLE_COUNT ? arp_style : 0]); break;
            case V_VOICING: snprintf(y_value, sizeof(y_value), "%s", (voicing_name && voicing_name[0]) ? voicing_name : "base"); break;
            default: break;
        }
        switch (h_target) {
            case T_LENGTH: strcpy(x_value, length_display); break;
            case T_RPT_AMT: snprintf(x_value, sizeof(x_value), "%d", repeat_amount); break;
            case T_RPT_SPACE: strcpy(x_value, repeat_space_display); break;
            case T_ARP_OFFSET: snprintf(x_value, sizeof(x_value), "%s%d", arp_offset > 0 ? "+" : "", arp_offset); break;
            case T_ARP_VOICES: snprintf(x_value, sizeof(x_value), "%d", arp_voices); break;
            default: break;
        }

        // Vertical legend (row 2)
        draw_icon_legend(ROW_Y[2], ICON_VERTICAL, y_label, y_value, OLED_RED);

        // Horizontal legend (row 3)
        draw_icon_legend(ROW_Y[3], ICON_HORIZONTAL, x_label, x_value, OLED_YELLOW);
    } else {
        draw_icon_text(ROW_Y[2], ICON_ALL_DIRS, "Move", OLED_CYAN);
    }
}

static void render_modify(uint8_t mods) {
    uint8_t sub_mode = g_state.modify_sub_mode;
    const char* sub_label = (sub_mode < 5) ? SUB_MODE_LABELS[sub_mode] : "?";
    uint8_t has_sel = (g_state.selected_event_idx >= 0);
    uint8_t m_meta = (mods & MOD_META) != 0;

    if (has_sel) {
        uint8_t ch = g_state.current_channel;
        uint8_t pat = g_state.current_patterns[ch];
        NoteEvent_C* ev = &g_state.patterns[ch][pat].events[g_state.selected_event_idx];
        uint8_t is_drum = (g_state.channel_types[ch] == CH_DRUM);

        char note_name[16];
        get_note_display(ev->row, is_drum, note_name);

        uint8_t loop_mode_val = ev->sub_modes[sub_mode].loop_mode;
        const char* loop_label = (loop_mode_val < 3) ? LOOP_MODE_LABELS[loop_mode_val] : "RST";
        uint8_t arr_len = ev->sub_modes[sub_mode].length;

        // Row 0: note + sub-mode
        char sub_buf[16];
        snprintf(sub_buf, sizeof(sub_buf), " %s", sub_label);
        Segment row0[] = {
            { note_name, OLED_CYAN },
            { sub_buf, m_meta ? OLED_RED : OLED_CYAN },
        };
        draw_segments(VALUE_X, ROW_Y[0], row0, 2);

        // Row 1: loop mode + length
        char len_buf[8];
        snprintf(len_buf, sizeof(len_buf), " L%d", arr_len);
        Segment row1[] = {
            { loop_label, !m_meta ? OLED_RED : OLED_CYAN },
            { len_buf, !m_meta ? OLED_YELLOW : OLED_CYAN },
        };
        draw_segments(VALUE_X, ROW_Y[1], row1, 2);

        if (m_meta) {
            draw_icon_legend(ROW_Y[2], ICON_VERTICAL, "Sub-mode", sub_label, OLED_RED);
        } else {
            draw_icon_legend(ROW_Y[2], ICON_VERTICAL, "Loop mode", loop_label, OLED_RED);
            char len_str[8];
            snprintf(len_str, sizeof(len_str), "%d", arr_len);
            draw_icon_legend(ROW_Y[3], ICON_HORIZONTAL, "Length", len_str, OLED_YELLOW);
        }
    } else {
        // No selection
        gfx_text(VALUE_X, ROW_Y[0], sub_label, color_rgb(m_meta ? OLED_RED : OLED_CYAN), &font_main);
        gfx_text(VALUE_X, ROW_Y[1], "SELECT A NOTE", color_rgb(OLED_CYAN), &font_main);
        if (m_meta) {
            draw_icon_legend(ROW_Y[2], ICON_VERTICAL, "Sub-mode", sub_label, OLED_RED);
        }
    }
}

static void render_channel(void) {
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    char ch_buf[8], pat_buf[8];
    snprintf(ch_buf, sizeof(ch_buf), "CH %d", ch + 1);
    snprintf(pat_buf, sizeof(pat_buf), "%d", pat + 1);

    draw_labeled_row(ROW_Y[0], "MODE", "CHANNEL", OLED_CYAN);
    draw_labeled_row(ROW_Y[1], "SELECT", ch_buf, OLED_CYAN);
    draw_labeled_row(ROW_Y[2], "PAT", pat_buf, OLED_CYAN);
}

static void render_loop(uint8_t mods) {
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    PatternLoop_C* loop = &g_state.loops[ch][pat];
    int32_t loop_start = loop->start;
    int32_t loop_end = loop->start + loop->length;
    uint8_t l_shift = (mods & MOD_SHIFT) != 0;

    draw_labeled_row(ROW_Y[0], "MODE", "LOOP", OLED_CYAN);

    char s_buf[16], e_buf[16];
    tick_to_beat_display(loop_start, s_buf);
    tick_to_beat_display(loop_end, e_buf);

    char s_full[24], e_full[24];
    snprintf(s_full, sizeof(s_full), "S %s", s_buf);
    snprintf(e_full, sizeof(e_full), "  E %s", e_buf);

    Segment row1[] = {
        { s_full, l_shift ? OLED_YELLOW : OLED_CYAN },
        { e_full, !l_shift ? OLED_YELLOW : OLED_CYAN },
    };
    draw_segments(VALUE_X, ROW_Y[1], row1, 2);

    if (l_shift) {
        draw_icon_legend(ROW_Y[2], ICON_HORIZONTAL, "Start", s_buf, OLED_YELLOW);
    } else {
        draw_icon_legend(ROW_Y[2], ICON_HORIZONTAL, "End", e_buf, OLED_YELLOW);
    }
}

static void render_pattern_default(uint8_t mods) {
    uint8_t ch = g_state.current_channel;
    uint8_t pat = g_state.current_patterns[ch];
    uint8_t is_drum = (g_state.channel_types[ch] == CH_DRUM);
    uint8_t p_alt = (mods & MOD_ALT) != 0;
    uint8_t p_shift = (mods & MOD_SHIFT) != 0;

    if (p_shift) {
        draw_labeled_row(ROW_Y[0], "MODE", "EXTEND", OLED_CYAN);
        draw_labeled_row(ROW_Y[1], "NOTE", "DRAG", OLED_CYAN);
        return;
    }

    // Row 0: CH x  PAT y
    char ch_str[12], pat_str[12];
    snprintf(ch_str, sizeof(ch_str), "CH %d", ch + 1);
    snprintf(pat_str, sizeof(pat_str), "  PAT %d", pat + 1);
    Segment row0[] = {
        { ch_str, OLED_CYAN },
        { pat_str, OLED_CYAN },
    };
    draw_segments(VALUE_X, ROW_Y[0], row0, 2);

    // Row 1: type or key
    if (is_drum) {
        draw_labeled_row(ROW_Y[1], "TYPE", "DRUMS", OLED_CYAN);
    } else {
        const char* scale_root_name = NOTE_NAMES[g_state.scale_root % 12];
        const char* scale_name = engine_get_scale_name_str(&g_state);

        int16_t lx = LABEL_X;
        gfx_text(lx, ROW_Y[1], "KEY", color_rgb(OLED_DIM), &font_small);
        int16_t kx = lx + gfx_text_width("KEY ", &font_small);
        int16_t cx2 = kx;
        gfx_text(cx2, ROW_Y[1], scale_root_name, color_rgb(p_alt ? OLED_YELLOW : OLED_CYAN), &font_main);

        // Measure root name + space
        char root_sp[8];
        snprintf(root_sp, sizeof(root_sp), "%s ", scale_root_name);
        cx2 += gfx_text_width(root_sp, &font_main);
        gfx_text(cx2, ROW_Y[1], scale_name, color_rgb(p_alt ? OLED_RED : OLED_CYAN), &font_main);
    }

    // Row 2+: scale legends or loop info
    if (p_alt && !is_drum) {
        const char* scale_name = engine_get_scale_name_str(&g_state);
        const char* scale_root_name = NOTE_NAMES[g_state.scale_root % 12];
        draw_icon_legend(ROW_Y[2], ICON_VERTICAL, "Scale", scale_name, OLED_RED);
        draw_icon_legend(ROW_Y[3], ICON_HORIZONTAL, "Root", scale_root_name, OLED_YELLOW);
    } else {
        PatternLoop_C* loop = &g_state.loops[ch][pat];
        char s_buf[16], e_buf[16], loop_str[32];
        tick_to_beat_display(loop->start, s_buf);
        tick_to_beat_display(loop->start + loop->length, e_buf);
        snprintf(loop_str, sizeof(loop_str), "%s-%s", s_buf, e_buf);
        draw_labeled_row(ROW_Y[2], "LOOP", loop_str, OLED_CYAN);
    }
}

// ============ Public entry point ============

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void oled_render(uint8_t modifiers) {
    gfx_clear(GFX_BLACK);

    UiMode mode = (UiMode)g_state.ui_mode;
    uint8_t has_sel = (g_state.selected_event_idx >= 0);

    switch (mode) {
        case UI_PATTERN:
            if (has_sel) render_pattern_selected(modifiers);
            else render_pattern_default(modifiers);
            break;
        case UI_MODIFY:
            render_modify(modifiers);
            break;
        case UI_CHANNEL:
            render_channel();
            break;
        case UI_LOOP:
            render_loop(modifiers);
            break;
        default:
            render_pattern_default(modifiers);
            break;
    }
}
