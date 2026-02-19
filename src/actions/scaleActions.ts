import { SCALE_ORDER } from '../types/scales';
import { getWasmEngine } from './playbackActions';
import { markDirty } from '../store/renderStore';

/**
 * Cycle the scale root note in fifths (circle of fifths).
 * "up" = up a fifth (+7 semitones), "down" = down a fifth (-7 semitones).
 */
export function cycleScaleRoot(direction: "up" | "down"): void {
  const engine = getWasmEngine();
  if (!engine?.isReady()) return;

  const oldRoot = engine.getScaleRoot();
  const scaleIdIdx = engine.getScaleIdIdx();
  const scaleId = SCALE_ORDER[scaleIdIdx] ?? "major";
  const newRoot = direction === "up"
    ? (oldRoot + 7) % 12
    : (oldRoot + 5) % 12;
  engine.setScaleRoot(newRoot);
  engine.syncScale(newRoot, scaleId);
  markDirty();
}

/**
 * Cycle through available scales/modes.
 * "up" = next scale in SCALE_ORDER, "down" = previous.
 */
export function cycleScale(direction: "up" | "down"): void {
  const engine = getWasmEngine();
  if (!engine?.isReady()) return;

  const scaleRoot = engine.getScaleRoot();
  const currentIndex = engine.getScaleIdIdx();
  const nextIndex = direction === "up"
    ? (currentIndex + 1) % SCALE_ORDER.length
    : (currentIndex + SCALE_ORDER.length - 1) % SCALE_ORDER.length;

  engine.setScaleIdIdx(nextIndex);
  engine.syncScale(scaleRoot, SCALE_ORDER[nextIndex]);
  markDirty();
}
