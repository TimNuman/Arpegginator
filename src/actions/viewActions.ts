import { getSequencerStore, type UiMode } from '../store/sequencerStore';
import { SUBDIVISION_ORDER, type ModifySubMode, type Subdivision } from '../types/event';

/**
 * Set the selected note by event ID
 */
export function setSelectedNoteId(noteId: string | null): void {
  getSequencerStore()._setView({ selectedNoteId: noteId });
}

/**
 * Set row offset for a specific channel
 */
export function setRowOffset(channel: number, offset: number): void {
  const store = getSequencerStore();
  const newOffsets = [...store.view.rowOffsets];
  newOffsets[channel] = offset;
  store._setView({ rowOffsets: newOffsets });
}

/**
 * Set column offset
 */
export function setColOffset(offset: number): void {
  getSequencerStore()._setView({ colOffset: offset });
}

/**
 * Set UI mode directly
 */
export function setUiMode(mode: UiMode): void {
  getSequencerStore()._setView({ uiMode: mode });
}

/**
 * Set modify sub-mode (velocity, hit, timing, flam, modulate)
 */
export function setModifySubMode(mode: ModifySubMode): void {
  getSequencerStore()._setView({ modifySubMode: mode });
}

/**
 * Set zoom level (subdivision)
 */
export function setZoom(zoom: Subdivision): void {
  getSequencerStore()._setView({ zoom });
}

/**
 * Cycle zoom level in/out through SUBDIVISION_ORDER
 * "in" = finer resolution (towards 1/32), "out" = coarser (towards 1/4)
 */
export function cycleZoom(direction: "in" | "out"): void {
  const store = getSequencerStore();
  const currentZoom = store.view.zoom;
  const currentIndex = SUBDIVISION_ORDER.indexOf(currentZoom);
  if (currentIndex === -1) return;

  const nextIndex = direction === "in"
    ? Math.min(SUBDIVISION_ORDER.length - 1, currentIndex + 1)
    : Math.max(0, currentIndex - 1);

  if (nextIndex !== currentIndex) {
    store._setView({ zoom: SUBDIVISION_ORDER[nextIndex] });
  }
}
