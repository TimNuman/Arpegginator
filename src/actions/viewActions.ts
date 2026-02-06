import { getSequencerStore, type UiMode } from '../store/sequencerStore';

const UI_MODES: UiMode[] = ['pattern', 'channel', 'loop'];

/**
 * Set the selected note
 */
export function setSelectedNote(note: { row: number; col: number } | null): void {
  getSequencerStore()._setView({ selectedNote: note });
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
 * Cycle UI mode forward or backward
 */
export function cycleUiMode(direction: 1 | -1): void {
  const store = getSequencerStore();
  const currentIndex = UI_MODES.indexOf(store.view.uiMode);
  const nextIndex = (currentIndex + direction + UI_MODES.length) % UI_MODES.length;
  store._setView({ uiMode: UI_MODES[nextIndex] });
}

/**
 * Set UI mode directly
 */
export function setUiMode(mode: UiMode): void {
  getSequencerStore()._setView({ uiMode: mode });
}
