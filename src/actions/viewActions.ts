import { getSequencerStore, type UiMode } from '../store/sequencerStore';
import type { ModifySubMode } from '../types/grid';

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
