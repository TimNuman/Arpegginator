// ============ Musical Scales & Keys ============

// A scale is defined as a 12-element boolean array representing which
// pitch classes (semitones from root) are included.
// Index 0 = root, 1 = minor 2nd, 2 = major 2nd, ..., 11 = major 7th

export type ScalePattern = readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean];

export interface ScaleDefinition {
  name: string;
  pattern: ScalePattern;
  category: "western" | "pentatonic" | "modal" | "exotic" | "symmetric";
}

// ============ Scale Definitions ============

//                                          1     b2    2     b3    3     4     b5    5     b6    6     b7    7
export const SCALES: Record<string, ScaleDefinition> = {
  // --- Western ---
  major:            { name: "Major",              category: "western",    pattern: [true, false, true, false, true, true, false, true, false, true, false, true] },
  naturalMinor:     { name: "Natural Minor",      category: "western",    pattern: [true, false, true, true, false, true, false, true, true, false, true, false] },
  harmonicMinor:    { name: "Harmonic Minor",     category: "western",    pattern: [true, false, true, true, false, true, false, true, true, false, false, true] },
  melodicMinor:     { name: "Melodic Minor",      category: "western",    pattern: [true, false, true, true, false, true, false, true, false, true, false, true] },

  // --- Modal ---
  dorian:           { name: "Dorian",             category: "modal",      pattern: [true, false, true, true, false, true, false, true, false, true, true, false] },
  phrygian:         { name: "Phrygian",           category: "modal",      pattern: [true, true, false, true, false, true, false, true, true, false, true, false] },
  lydian:           { name: "Lydian",             category: "modal",      pattern: [true, false, true, false, true, false, true, true, false, true, false, true] },
  mixolydian:       { name: "Mixolydian",         category: "modal",      pattern: [true, false, true, false, true, true, false, true, false, true, true, false] },
  aeolian:          { name: "Aeolian",            category: "modal",      pattern: [true, false, true, true, false, true, false, true, true, false, true, false] },
  locrian:          { name: "Locrian",            category: "modal",      pattern: [true, true, false, true, false, true, true, false, true, false, true, false] },

  // --- Pentatonic ---
  majorPentatonic:  { name: "Major Pentatonic",   category: "pentatonic", pattern: [true, false, true, false, true, false, false, true, false, true, false, false] },
  minorPentatonic:  { name: "Minor Pentatonic",   category: "pentatonic", pattern: [true, false, false, true, false, true, false, true, false, false, true, false] },
  blues:            { name: "Blues",              category: "pentatonic", pattern: [true, false, false, true, false, true, true, true, false, false, true, false] },

  // --- Symmetric ---
  wholeTone:        { name: "Whole Tone",         category: "symmetric",  pattern: [true, false, true, false, true, false, true, false, true, false, true, false] },
  chromatic:        { name: "Chromatic",          category: "symmetric",  pattern: [true, true, true, true, true, true, true, true, true, true, true, true] },
  diminished:       { name: "Diminished",         category: "symmetric",  pattern: [true, false, true, true, false, true, true, false, true, true, false, true] },
  augmented:        { name: "Augmented",          category: "symmetric",  pattern: [true, false, false, true, true, false, false, true, true, false, false, true] },

  // --- Exotic ---
  hirajoshi:        { name: "Hirajoshi",          category: "exotic",     pattern: [true, false, true, true, false, false, false, true, true, false, false, false] },
  insen:            { name: "In Sen",             category: "exotic",     pattern: [true, true, false, false, false, true, false, true, false, false, true, false] },
  iwato:            { name: "Iwato",              category: "exotic",     pattern: [true, true, false, false, false, true, true, false, false, false, true, false] },
  kumoi:            { name: "Kumoi",              category: "exotic",     pattern: [true, false, true, true, false, false, false, true, false, true, false, false] },
  pelog:            { name: "Pelog",              category: "exotic",     pattern: [true, true, false, true, false, false, false, true, true, false, false, false] },
  hijaz:            { name: "Hijaz",              category: "exotic",     pattern: [true, true, false, false, true, true, false, true, true, false, false, true] },
  doubleHarmonic:   { name: "Double Harmonic",    category: "exotic",     pattern: [true, true, false, false, true, true, false, true, true, false, false, true] },
  hungarianMinor:   { name: "Hungarian Minor",    category: "exotic",     pattern: [true, false, true, true, false, false, true, true, true, false, false, true] },
  enigmatic:        { name: "Enigmatic",          category: "exotic",     pattern: [true, true, false, false, true, false, true, false, true, false, true, true] },
  prometheus:       { name: "Prometheus",         category: "exotic",     pattern: [true, false, true, false, true, false, true, false, false, true, true, false] },
  persian:          { name: "Persian",            category: "exotic",     pattern: [true, true, false, false, true, true, true, false, true, false, false, true] },
  algerian:         { name: "Algerian",           category: "exotic",     pattern: [true, false, true, true, false, true, true, true, true, false, false, true] },
  gypsy:            { name: "Gypsy",             category: "exotic",     pattern: [true, false, true, true, false, false, true, true, true, false, true, false] },
  neapolitanMinor:  { name: "Neapolitan Minor",   category: "exotic",     pattern: [true, true, false, true, false, true, false, true, true, false, false, true] },
  neapolitanMajor:  { name: "Neapolitan Major",   category: "exotic",     pattern: [true, true, false, true, false, true, false, true, false, true, false, true] },
};

// ============ Scale Order (for cycling) ============

export const SCALE_ORDER: string[] = Object.keys(SCALES);

// ============ Note Names ============

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type NoteName = typeof NOTE_NAMES[number];

// ============ Helpers ============

/**
 * Check if a MIDI note is in a given scale at a given root.
 * @param midiNote MIDI note number (0-127)
 * @param root Root note as semitone offset (0=C, 1=C#, ..., 11=B)
 * @param pattern The 12-element boolean scale pattern
 */
export function isNoteInScale(midiNote: number, root: number, pattern: ScalePattern): boolean {
  const pitchClass = ((midiNote - root) % 12 + 12) % 12;
  return pattern[pitchClass];
}

/**
 * Get all MIDI notes (0-127) that are in a given scale as a sorted array.
 * Also returns a reverse lookup map (MIDI note -> index in the array).
 */
export function getScaleNotes(root: number, pattern: ScalePattern): {
  notes: number[];
  midiToIndex: Map<number, number>;
} {
  const notes: number[] = [];
  const midiToIndex = new Map<number, number>();
  for (let midi = 0; midi <= 127; midi++) {
    if (isNoteInScale(midi, root, pattern)) {
      midiToIndex.set(midi, notes.length);
      notes.push(midi);
    }
  }
  return { notes, midiToIndex };
}

// ============ Scale Mapping (scale-relative index system) ============

/**
 * Pre-computed mapping between scale-relative indices and MIDI notes.
 * Row 0 = root note at octave 4 (MIDI 60 + root).
 */
export interface ScaleMapping {
  notes: number[];                    // All in-scale MIDI notes 0-127, sorted
  midiToIndex: Map<number, number>;   // MIDI note -> position in notes[]
  zeroIndex: number;                  // Index in notes[] where row 0 maps (root at octave 4)
  totalRows: number;                  // notes.length
  minRow: number;                     // -zeroIndex (most negative valid row)
  maxRow: number;                     // notes.length - 1 - zeroIndex (most positive valid row)
}

/**
 * Build a ScaleMapping for a given root and scale pattern.
 * The zero point (row 0) is the root note at octave 4 (MIDI 60 + root).
 */
export function buildScaleMapping(root: number, pattern: ScalePattern): ScaleMapping {
  const { notes, midiToIndex } = getScaleNotes(root, pattern);
  const zeroMidi = 60 + root;
  const zeroIndex = notes.indexOf(zeroMidi);
  // Root should always be in the scale (pattern[0] is always true), but guard against edge cases
  const safeZeroIndex = zeroIndex >= 0 ? zeroIndex : 0;
  return {
    notes,
    midiToIndex,
    zeroIndex: safeZeroIndex,
    totalRows: notes.length,
    minRow: -safeZeroIndex,
    maxRow: notes.length - 1 - safeZeroIndex,
  };
}

/**
 * Convert a scale-relative index to a MIDI note number.
 * Row 0 = root at octave 4.
 * Returns -1 if the index is out of MIDI range.
 */
export function noteToMidi(row: number, mapping: ScaleMapping): number {
  const idx = mapping.zeroIndex + row;
  if (idx < 0 || idx >= mapping.notes.length) return -1;
  return mapping.notes[idx];
}

/**
 * Convert a MIDI note to a scale-relative index.
 * Returns undefined if the MIDI note is not in the scale.
 */
export function midiToNote(midiNote: number, mapping: ScaleMapping): number | undefined {
  const idx = mapping.midiToIndex.get(midiNote);
  if (idx === undefined) return undefined;
  return idx - mapping.zeroIndex;
}

/**
 * Convert a MIDI note to the nearest scale-relative index.
 * If the note is in the scale, returns the exact row.
 * If not, snaps to the closest in-scale note.
 *
 * @param snapPrefer On ties: "up" prefers the higher note (good when adding sharps),
 *                   "down" prefers the lower note (good when adding flats).
 *                   Default "up".
 */
export function midiToNoteSnapped(midiNote: number, mapping: ScaleMapping, snapPrefer: "up" | "down" = "up"): number {
  // Exact match
  const exact = midiToNote(midiNote, mapping);
  if (exact !== undefined) return exact;

  const notes = mapping.notes;

  // Binary search for insertion point
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid] < midiNote) lo = mid + 1;
    else hi = mid;
  }
  // lo = index of first note > midiNote
  const below = lo > 0 ? lo - 1 : -1;
  const above = lo < notes.length ? lo : -1;

  let bestIdx: number;
  if (below === -1) bestIdx = above === -1 ? 0 : above;
  else if (above === -1) bestIdx = below;
  else {
    const distBelow = midiNote - notes[below];
    const distAbove = notes[above] - midiNote;
    if (distAbove !== distBelow) {
      bestIdx = distAbove < distBelow ? above : below;
    } else {
      // Tie: use snap direction preference
      bestIdx = snapPrefer === "up" ? above : below;
    }
  }

  return bestIdx - mapping.zeroIndex;
}