// chords.rs — Chord analysis and naming
//
// Identifies the best-matching chord template over an event's sounding pitch
// classes, picks a root (preferring the bass), annotates unmatched intervals
// as extensions, and appends the scale degree as a roman numeral.
//
// Single source of truth for chord names: the wasm host bridge serves it to
// the web UI verbatim, the OLED renderer uppercases it for display.

use core::fmt::Write;

use crate::engine_core::*;
use crate::engine_ui::get_chord_offsets;

pub static NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

static ROMAN: [&str; 7] = ["I", "II", "III", "IV", "V", "VI", "VII"];

struct ChordTemplate {
    intervals: [u8; 4],
    count: u8,
    suffix: &'static str,
}

static CHORD_TEMPLATES: &[ChordTemplate] = &[
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

/// Scale degree (0-based) whose pitch class is `pc`, or -1 if not in scale.
pub fn find_scale_degree(s: &EngineState, pc: u8) -> i8 {
    let zi = s.scale_zero_index as usize;
    let octave_size = (s.scale_octave_size as usize).min(12);

    (0..octave_size)
        .find(|&d| zi + d < s.scale_count as usize && s.scale_notes[zi + d] % 12 == pc)
        .map(|d| d as i8)
        .or_else(|| {
            (0..octave_size)
                .find(|&d| d + 1 <= zi && s.scale_notes[zi - d - 1] % 12 == pc)
                .map(|d| (octave_size - d - 1) as i8)
        })
        .unwrap_or(-1)
}

fn interval_to_ext(semitones: u8) -> Option<&'static str> {
    match semitones {
        1 => Some("b9"), 2 => Some("9"), 3 => Some("#9"), 5 => Some("11"),
        6 => Some("#11"), 8 => Some("b13"), 9 => Some("13"), 10 => Some("b7"),
        11 => Some("maj7"), _ => None,
    }
}

/// Human-readable name (e.g. "Cm7+9/G (II)") for the chord an event produces.
/// Empty if the event sounds fewer than two distinct pitch classes.
pub fn format_chord_name(s: &EngineState, ev: &NoteEvent) -> FmtBuf<64> {
    let mut result = FmtBuf::<64>::new();
    if ev.chord_amount <= 1 {
        return result;
    }

    let mut offsets = [0i8; MAX_CHORD_SIZE];
    let chord_count = get_chord_offsets(s, ev, &mut offsets, 0);

    // Collect distinct pitch classes; the lowest MIDI note is the bass.
    let mut pitch_classes = [0u8; MAX_CHORD_SIZE];
    let mut pc_count = 0usize;
    let mut lowest_midi: i8 = 127;
    let mut bass_pc: u8 = 0;

    (0..chord_count).for_each(|i| {
        let midi = note_to_midi(ev.row + offsets[i] as i16, s);
        if midi < 0 { return; }
        let pc = (midi % 12) as u8;
        if midi < lowest_midi {
            lowest_midi = midi;
            bass_pc = pc;
        }
        if !pitch_classes[..pc_count].contains(&pc) && pc_count < MAX_CHORD_SIZE {
            pitch_classes[pc_count] = pc;
            pc_count += 1;
        }
    });

    if pc_count < 2 { return result; }

    pitch_classes[..pc_count].sort_unstable();

    let bass_idx = pitch_classes[..pc_count].iter().position(|&p| p == bass_pc).unwrap_or(0);

    // Try every pitch class as root (bass first) against every template;
    // keep the match covering the most intervals.
    let mut best_suffix: Option<&str> = None;
    let mut best_root_pc: u8 = 0;
    let mut best_match_count: u8 = 0;
    let mut best_intervals = [0u8; MAX_CHORD_SIZE - 1];
    let mut best_n_intervals: usize = 0;
    let mut best_matched = [false; MAX_CHORD_SIZE - 1];

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

        CHORD_TEMPLATES.iter().for_each(|tmpl| {
            if tmpl.count > n_intervals as u8 || tmpl.count <= best_match_count { return; }
            let mut matched = [false; MAX_CHORD_SIZE - 1];
            let all_found = (0..tmpl.count as usize).all(|k| {
                (0..n_intervals).find(|&m| intervals[m] == tmpl.intervals[k]).map(|m| matched[m] = true).is_some()
            });
            if all_found {
                best_suffix = Some(tmpl.suffix);
                best_root_pc = root_pc;
                best_match_count = tmpl.count;
                best_n_intervals = n_intervals;
                best_intervals[..n_intervals].copy_from_slice(&intervals[..n_intervals]);
                best_matched[..n_intervals].copy_from_slice(&matched[..n_intervals]);
            }
        });
    });

    if let Some(suffix) = best_suffix {
        result.push_str(NOTE_NAMES[best_root_pc as usize]);
        result.push_str(suffix);
        // Intervals not covered by the template become extensions.
        (0..best_n_intervals)
            .filter(|&i| !best_matched[i])
            .for_each(|i| {
                if let Some(ext) = interval_to_ext(best_intervals[i]) {
                    result.push('+');
                    result.push_str(ext);
                }
            });
        if best_root_pc != bass_pc {
            result.push('/');
            result.push_str(NOTE_NAMES[bass_pc as usize]);
        }
    } else {
        // No template match — list intervals over the lowest pitch class.
        let root_pc = pitch_classes[0];
        result.push_str(NOTE_NAMES[root_pc as usize]);
        result.push('(');
        (1..pc_count).for_each(|i| {
            if i > 1 { result.push(','); }
            let iv = ((pitch_classes[i] as i16 - root_pc as i16 + 12) % 12) as u8;
            let _ = write!(result, "{}", iv);
        });
        result.push(')');
        best_root_pc = root_pc;
    }

    let degree = find_scale_degree(s, best_root_pc);
    if (0..7).contains(&degree) {
        result.push_str(" (");
        result.push_str(ROMAN[degree as usize]);
        result.push(')');
    }

    result
}
