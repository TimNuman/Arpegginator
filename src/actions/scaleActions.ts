import { getSequencerStore } from '../store/sequencerStore';
import { SCALE_ORDER, NOTE_NAMES } from '../types/scales';

/**
 * Cycle the scale root note in fifths (circle of fifths).
 * "up" = up a fifth (+7 semitones), "down" = down a fifth (-7 semitones).
 * C → G → D → A → E → B → F# → C# → G# → D# → A# → F → C
 */
export function cycleScaleRoot(direction: "up" | "down"): void {
  const store = getSequencerStore();
  const current = store.scaleRoot;
  const next = direction === "up"
    ? (current + 7) % 12
    : (current + 5) % 12;
  store._setScale(next, store.scaleId);
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
}

/**
 * Get display string for current scale root.
 */
export function getScaleRootName(): string {
  const store = getSequencerStore();
  return NOTE_NAMES[store.scaleRoot];
}
