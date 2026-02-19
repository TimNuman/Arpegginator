import { getSequencerStore, NUM_CHANNELS } from '../store/sequencerStore';
import { invalidateLookup, syncWasmScale } from '../store/tickLookupCache';
import { SCALES, SCALE_ORDER, NOTE_NAMES, buildScaleMapping, midiToNoteSnapped, noteToMidi, type ScalePattern } from '../types/scales';

/**
 * Determine the per-note snap direction by comparing old and new scale patterns.
 * When a note's pitch class was in the old scale but not the new, snap toward
 * the pitch class that's new in the target scale (i.e., the replacement note).
 * This avoids collisions at nearby keys AND preserves lossless short round-trips.
 */
function getSnapDirection(midiNote: number, oldRoot: number, oldPattern: ScalePattern, newRoot: number, newPattern: ScalePattern): "up" | "down" {
  const pc = ((midiNote % 12) + 12) % 12;
  const oldInScale = oldPattern[((pc - oldRoot) % 12 + 12) % 12];
  const newInScale = newPattern[((pc - newRoot) % 12 + 12) % 12];

  if (newInScale || !oldInScale) {
    // Note is in the new scale (no snap needed) or wasn't in old scale either.
    // Default doesn't matter since it won't be a tie.
    return "up";
  }

  // This note was in the old scale but not the new. Find the "replacement" pitch class:
  // the one that's in the new scale but not the old scale, nearest to our note.
  // In CoF movement, there's exactly one added and one removed pitch class.
  for (let dist = 1; dist <= 6; dist++) {
    // Check above
    const above = (pc + dist) % 12;
    const aboveInNew = newPattern[((above - newRoot) % 12 + 12) % 12];
    const aboveInOld = oldPattern[((above - oldRoot) % 12 + 12) % 12];
    if (aboveInNew && !aboveInOld) return "up";

    // Check below
    const below = ((pc - dist) % 12 + 12) % 12;
    const belowInNew = newPattern[((below - newRoot) % 12 + 12) % 12];
    const belowInOld = oldPattern[((below - oldRoot) % 12 + 12) % 12];
    if (belowInNew && !belowInOld) return "down";
  }

  return "up"; // fallback
}

/**
 * Remap all melodic channel event rows from their originalMidi anchor.
 * Snap direction is determined per-note by comparing old and new scale patterns,
 * ensuring notes snap toward the replacement accidental. After snapping,
 * originalMidi is updated to the new row's MIDI pitch so that notes always
 * "belong" to the current scale and consecutive key changes stay clean.
 *
 * Trade-off: a full 12-step CoF cycle drifts by ±1 row (Pythagorean comma
 * in diatonic space). Short round-trips (N ups + N downs) are perfectly lossless.
 */
function remapEventsFromMidi(newRoot: number, newScaleId: string, oldRoot: number, oldScaleId: string): void {
  const store = getSequencerStore();
  const oldPattern = SCALES[oldScaleId]?.pattern ?? SCALES.major.pattern;
  const newPattern = SCALES[newScaleId]?.pattern ?? SCALES.major.pattern;
  const newMapping = buildScaleMapping(newRoot, newPattern);

  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    if (store.channelTypes[ch] === "drum") continue;

    for (let pat = 0; pat < store.patterns[ch].length; pat++) {
      const events = store.patterns[ch][pat].events;
      if (events.length === 0) continue;
      let changed = false;

      for (const event of events) {
        if (event.originalMidi < 0) continue;
        const snapDir = getSnapDirection(event.originalMidi, oldRoot, oldPattern, newRoot, newPattern);
        const newRow = midiToNoteSnapped(event.originalMidi, newMapping, snapDir);
        const newMidi = noteToMidi(newRow, newMapping);
        const updates: Record<string, number> = {};
        if (newRow !== event.row) updates.row = newRow;
        if (newMidi >= 0 && newMidi !== event.originalMidi) updates.originalMidi = newMidi;
        if (Object.keys(updates).length > 0) {
          store._updateEvent(ch, pat, event.id, updates);
          changed = true;
        }
      }

      if (changed) {
        invalidateLookup(ch, pat);
      }
    }
  }
}

/**
 * Cycle the scale root note in fifths (circle of fifths).
 * "up" = up a fifth (+7 semitones), "down" = down a fifth (-7 semitones).
 * C → G → D → A → E → B → F# → C# → G# → D# → A# → F → C
 *
 * Each note's snap direction is determined by comparing the old and new scale
 * patterns, ensuring notes snap toward the replacement accidental. After
 * snapping, originalMidi is updated so notes always belong to the current scale.
 */
export function cycleScaleRoot(direction: "up" | "down"): void {
  const store = getSequencerStore();
  const oldRoot = store.scaleRoot;
  const oldScaleId = store.scaleId;
  const newRoot = direction === "up"
    ? (oldRoot + 7) % 12
    : (oldRoot + 5) % 12;
  remapEventsFromMidi(newRoot, oldScaleId, oldRoot, oldScaleId);
  store._setScale(newRoot, oldScaleId);
  syncWasmScale();
}

/**
 * Cycle through available scales/modes.
 * "up" = next scale in SCALE_ORDER, "down" = previous.
 */
export function cycleScale(direction: "up" | "down"): void {
  const store = getSequencerStore();
  const currentIndex = SCALE_ORDER.indexOf(store.scaleId);
  if (currentIndex === -1) return;

  const nextIndex = direction === "up"
    ? (currentIndex + 1) % SCALE_ORDER.length
    : (currentIndex + SCALE_ORDER.length - 1) % SCALE_ORDER.length;

  store._setScale(store.scaleRoot, SCALE_ORDER[nextIndex]);
  syncWasmScale();
}

/**
 * Get display string for current scale root.
 */
export function getScaleRootName(): string {
  const store = getSequencerStore();
  return NOTE_NAMES[store.scaleRoot];
}
