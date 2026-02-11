import { useCallback } from "react";
import {
  useSequencerStore,
  ROWS,
  COLS,
  VISIBLE_ROWS,
  VISIBLE_COLS,
} from "../store/sequencerStore";
import { useCurrentLoop, useCurrentPattern } from "../store/selectors";
import * as actions from "../actions";
import {
  findNoteAtCell,
  getNoteLength,
  getRepeatAmount,
  getRepeatSpace,
  getSubModeArrayLength,
  isNotePattern,
  type ModifySubMode,
  type RenderedNote,
} from "../types/grid";

import type { UiMode } from "../store/sequencerStore";

interface UseGridCommandsOptions {
  onPlayNote?: (note: number, channel: number, steps?: number) => void;
}

export function useGridCommands(options: UseGridCommandsOptions = {}) {
  const { onPlayNote } = options;

  const currentChannel = useSequencerStore((s) => s.currentChannel);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const selectedNote = useSequencerStore((s) => s.view.selectedNote);
  const rowOffsets = useSequencerStore((s) => s.view.rowOffsets);
  const colOffset = useSequencerStore((s) => s.view.colOffset);
  const uiMode = useSequencerStore((s) => s.view.uiMode);
  const modifySubMode = useSequencerStore((s) => s.view.modifySubMode);
  const currentLoop = useCurrentLoop();
  const currentPattern = useCurrentPattern();

  // Calculate visible area
  const maxRowOffset = ROWS - VISIBLE_ROWS;
  const maxColOffset = COLS - VISIBLE_COLS;
  const startRow = Math.round((1 - rowOffsets[currentChannel]) * maxRowOffset);
  const startCol = Math.round(colOffset * maxColOffset);

  // Helper to play a preview note
  const playPreviewNote = useCallback(
    (row: number, steps?: number) => {
      if (!isPlaying && onPlayNote) {
        onPlayNote(row, currentChannel, steps);
      }
    },
    [isPlaying, onPlayNote, currentChannel],
  );

  // Helper to follow note with camera
  const followNoteWithCamera = useCallback(
    (row: number, col: number) => {
      // Row: check if row is outside visible area
      if (row < startRow) {
        const newRowOffset = 1 - row / maxRowOffset;
        actions.setRowOffset(
          currentChannel,
          Math.max(0, Math.min(1, newRowOffset)),
        );
      } else if (row > startRow + VISIBLE_ROWS - 1) {
        const newRowOffset = 1 - (row - VISIBLE_ROWS + 1) / maxRowOffset;
        actions.setRowOffset(
          currentChannel,
          Math.max(0, Math.min(1, newRowOffset)),
        );
      }

      // Column: check if col is outside visible area
      if (col < startCol) {
        const newColOffset = col / maxColOffset;
        actions.setColOffset(Math.max(0, Math.min(1, newColOffset)));
      } else if (col > startCol + VISIBLE_COLS - 1) {
        const newColOffset = (col - VISIBLE_COLS + 1) / maxColOffset;
        actions.setColOffset(Math.max(0, Math.min(1, newColOffset)));
      }
    },
    [currentChannel, startRow, startCol, maxRowOffset, maxColOffset],
  );

  // Move selected note in a direction
  const moveSelectedNote = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (!selectedNote) return;

      // Read gridState directly from store for fresh value
      const gridState = getGridState();

      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
      if (noteLength <= 0) return;

      let newRow = selectedNote.row;
      let newCol = selectedNote.col;

      switch (direction) {
        case "up":
          newRow = Math.min(ROWS - 1, selectedNote.row + 1);
          break;
        case "down":
          newRow = Math.max(0, selectedNote.row - 1);
          break;
        case "left":
          newCol = Math.max(0, selectedNote.col - 1);
          break;
        case "right":
          newCol = Math.min(COLS - 1, selectedNote.col + 1);
          break;
      }

      if (newRow !== selectedNote.row || newCol !== selectedNote.col) {
        actions.moveNote(selectedNote.row, selectedNote.col, newRow, newCol);
        actions.setSelectedNote({ row: newRow, col: newCol });
        followNoteWithCamera(newRow, newCol);
        playPreviewNote(newRow);
      }
    },
    [selectedNote, followNoteWithCamera, playPreviewNote],
  );

  // Adjust loop end boundary
  const adjustLoopEnd = useCallback(
    (direction: "left" | "right") => {
      const loopEnd = currentLoop.start + currentLoop.length;
      let newEnd = loopEnd;
      if (direction === "left") {
        newEnd = Math.max(currentLoop.start + 1, loopEnd - 1);
      } else {
        newEnd = Math.min(COLS, loopEnd + 1);
      }
      if (newEnd !== loopEnd) {
        const newLength = newEnd - currentLoop.start;
        actions.setPatternLoop(currentChannel, currentPattern, currentLoop.start, newLength);
        followNoteWithCamera(startRow, newEnd - 1);
      }
    },
    [currentLoop, currentChannel, currentPattern, startRow, followNoteWithCamera],
  );

  // Adjust loop start boundary
  const adjustLoopStart = useCallback(
    (direction: "left" | "right") => {
      const loopEnd = currentLoop.start + currentLoop.length;
      let newStart = currentLoop.start;
      if (direction === "left") {
        newStart = Math.max(0, currentLoop.start - 1);
      } else {
        newStart = Math.min(loopEnd - 1, currentLoop.start + 1);
      }
      if (newStart !== currentLoop.start) {
        const newLength = loopEnd - newStart;
        actions.setPatternLoop(currentChannel, currentPattern, newStart, newLength);
        followNoteWithCamera(startRow, newStart);
      }
    },
    [currentLoop, currentChannel, currentPattern, startRow, followNoteWithCamera],
  );

  // Set loop start at absolute column (for click-based positioning)
  const setLoopStartAt = useCallback(
    (col: number) => {
      const loopEnd = currentLoop.start + currentLoop.length;
      const newStart = Math.min(col, loopEnd - 1);
      const newLength = loopEnd - newStart;
      actions.setPatternLoop(currentChannel, currentPattern, newStart, newLength);
    },
    [currentLoop, currentChannel, currentPattern],
  );

  // Set loop end at absolute column (for click-based positioning)
  const setLoopEndAt = useCallback(
    (col: number) => {
      const newEnd = Math.max(col + 1, currentLoop.start + 1);
      const newLength = newEnd - currentLoop.start;
      actions.setPatternLoop(currentChannel, currentPattern, currentLoop.start, newLength);
    },
    [currentLoop, currentChannel, currentPattern],
  );

  // Switch UI mode, optionally setting a modify sub-mode
  const switchMode = useCallback(
    (mode: UiMode, subMode?: ModifySubMode) => {
      actions.setUiMode(mode);
      if (subMode !== undefined) {
        actions.setModifySubMode(subMode);
      }
    },
    [],
  );

  // Cycle through modify sub-modes
  const cycleModifySubMode = useCallback(
    (direction: "up" | "down") => {
      const modes: ModifySubMode[] = ["velocity", "hit", "timing", "flam", "modulate"];
      const currentIndex = modes.indexOf(modifySubMode);
      const nextIndex = direction === "down"
        ? (currentIndex + 1) % modes.length
        : (currentIndex - 1 + modes.length) % modes.length;
      actions.setModifySubMode(modes[nextIndex]);
    },
    [modifySubMode],
  );

  // Toggle loop mode for the current sub-mode on selected note
  const toggleSubModeLoopMode = useCallback(
    () => {
      if (!selectedNote) return;
      actions.toggleSubModeLoopMode(selectedNote.row, selectedNote.col, modifySubMode);
    },
    [selectedNote, modifySubMode],
  );

  // Adjust sub-mode array length for selected note
  const adjustSubModeArrayLength = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNote) return;
      const gridState = getGridState();
      const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
      if (!noteValue) return;
      const currentLength = getSubModeArrayLength(noteValue, modifySubMode);
      const newLength = direction === "right" ? currentLength + 1 : currentLength - 1;
      if (newLength >= 1) {
        actions.setSubModeLength(selectedNote.row, selectedNote.col, modifySubMode, newLength);
      }
    },
    [selectedNote, modifySubMode],
  );

  // Set sub-mode value at a specific cell in the modify grid
  const setSubModeValueAtCell = useCallback(
    (visibleRow: number, visibleCol: number, visibleLevels: number[], resetToDefault: boolean) => {
      if (!selectedNote) return;
      const value = resetToDefault ? 0 : visibleLevels[visibleRow];
      actions.setSubModeValue(selectedNote.row, selectedNote.col, visibleCol, value, modifySubMode);
    },
    [selectedNote, modifySubMode],
  );

  // Helper to get fresh gridState from store (always reads latest state)
  const getGridState = () => {
    const s = useSequencerStore.getState();
    return s.channels[s.currentChannel][s.currentPatterns[s.currentChannel]];
  };

  // Resize selected note
  const resizeSelectedNote = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNote) return;
      const gridState = getGridState();
      const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
      const noteLength = getNoteLength(noteValue);
      if (noteLength <= 0) return;

      let newLength = noteLength;
      if (direction === "left") {
        newLength = Math.max(1, noteLength - 1);
      } else {
        const repeatAmount = getRepeatAmount(noteValue);
        let maxLength = COLS - selectedNote.col;
        if (repeatAmount > 1) {
          maxLength = Math.min(maxLength, getRepeatSpace(noteValue));
        }
        newLength = Math.min(maxLength, noteLength + 1);
      }
      if (newLength !== noteLength) {
        actions.setNote(selectedNote.row, selectedNote.col, newLength);
        playPreviewNote(selectedNote.row, newLength);
      }
    },
    [selectedNote, playPreviewNote],
  );

  // Adjust repeat amount for selected note
  const adjustRepeatAmount = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNote) return;
      const gridState = getGridState();
      const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
      if (getNoteLength(noteValue) <= 0) return;

      const currentRepeatAmount = getRepeatAmount(noteValue);
      let newRepeatAmount = currentRepeatAmount;
      if (direction === "left") {
        newRepeatAmount = Math.max(1, currentRepeatAmount - 1);
      } else {
        newRepeatAmount = Math.min(64, currentRepeatAmount + 1);
      }
      if (newRepeatAmount !== currentRepeatAmount) {
        actions.setNoteRepeatAmount(selectedNote.row, selectedNote.col, newRepeatAmount);
      }
    },
    [selectedNote],
  );

  // Adjust repeat space for selected note (auto-enables repeat if needed)
  const adjustRepeatSpace = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNote) return;
      const gridState = getGridState();
      const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
      if (getNoteLength(noteValue) <= 0) return;

      const currentRepeatAmount = getRepeatAmount(noteValue);
      if (currentRepeatAmount <= 1 && direction === "right") {
        // No repeats yet — enable repeat first by setting amount to 2
        actions.setNoteRepeatAmount(selectedNote.row, selectedNote.col, 2);
      } else {
        const currentRepeatSpace = getRepeatSpace(noteValue);
        let newRepeatSpace = currentRepeatSpace;
        if (direction === "left") {
          newRepeatSpace = Math.max(1, currentRepeatSpace - 1);
        } else {
          newRepeatSpace = Math.min(64, currentRepeatSpace + 1);
        }
        if (newRepeatSpace !== currentRepeatSpace) {
          actions.setNoteRepeatSpace(selectedNote.row, selectedNote.col, newRepeatSpace);
        }
      }
    },
    [selectedNote],
  );

  // Deselect note — always clears displaced notes stash
  const deselectNote = useCallback(
    () => {
      actions.clearDisplacedNotes();
      actions.setSelectedNote(null);
    },
    [],
  );

  // Select note at a grid cell (finds note via rendered notes)
  const selectNoteAtCell = useCallback(
    (row: number, col: number, renderedNotes: RenderedNote[]) => {
      const noteAtCell = findNoteAtCell(renderedNotes, row, col);
      if (noteAtCell) {
        // Place previously selected note first
        const currentSelectedNote = useSequencerStore.getState().view.selectedNote;
        if (currentSelectedNote) {
          actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
        }
        actions.setSelectedNote({ row: noteAtCell.sourceRow, col: noteAtCell.sourceCol });
        return true;
      }
      return false;
    },
    [],
  );

  // Full pattern-mode cell press logic
  const handlePatternCellPress = useCallback(
    (
      row: number,
      col: number,
      renderedNotes: RenderedNote[],
      modifiers: { meta: boolean; shift: boolean },
    ) => {
      const gridState = getGridState();
      const noteAtCell = findNoteAtCell(renderedNotes, row, col);
      const currentSelectedNote = useSequencerStore.getState().view.selectedNote;

      // Cmd+click: toggle enabled (enable/disable, preserving pattern) — skip repeats
      if (modifiers.meta) {
        if (noteAtCell && !noteAtCell.isRepeat) {
          actions.toggleEnabled(noteAtCell.sourceRow, noteAtCell.sourceCol);
          if (
            currentSelectedNote &&
            currentSelectedNote.row === noteAtCell.sourceRow &&
            currentSelectedNote.col === noteAtCell.sourceCol
          ) {
            actions.clearDisplacedNotes();
            actions.setSelectedNote(null);
          }
        } else if (!noteAtCell) {
          const cellValue = gridState[row]?.[col];
          if (isNotePattern(cellValue) && !cellValue.enabled) {
            if (currentSelectedNote) {
              actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
            }
            actions.setSelectedNote({ row, col });
          }
          actions.toggleEnabled(row, col);
        }
        return;
      }

      // Shift+click: resize selected note to this column
      if (modifiers.shift && currentSelectedNote && currentSelectedNote.row === row) {
        const startColNote = Math.min(currentSelectedNote.col, col);
        const endColNote = Math.max(currentSelectedNote.col, col);
        const newNoteLength = endColNote - startColNote + 1;

        actions.setNote(row, startColNote, newNoteLength);
        actions.setSelectedNote({ row, col: startColNote });
        playPreviewNote(row);
        return;
      }

      // Click on note: select/deselect
      if (noteAtCell) {
        const sourceRow = noteAtCell.sourceRow;
        const sourceCol = noteAtCell.sourceCol;
        if (
          currentSelectedNote &&
          currentSelectedNote.row === sourceRow &&
          currentSelectedNote.col === sourceCol
        ) {
          actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
          actions.setSelectedNote(null);
        } else {
          if (currentSelectedNote) {
            actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
          }
          actions.setSelectedNote({ row: sourceRow, col: sourceCol });
        }
        playPreviewNote(sourceRow);
        return;
      }

      // Check for disabled note — enable and select it
      const cellValue = gridState[row]?.[col];
      if (isNotePattern(cellValue) && !cellValue.enabled) {
        if (currentSelectedNote) {
          actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
        }
        actions.setSelectedNote({ row, col });
        actions.toggleEnabled(row, col);
        playPreviewNote(row);
        return;
      }

      // Click on empty: create note
      if (currentSelectedNote) {
        actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
      }
      actions.toggleCell(row, col);
      actions.setSelectedNote({ row, col });
      playPreviewNote(row);
    },
    [playPreviewNote],
  );

  // Channel mode cell press logic
  const handleChannelCellPress = useCallback(
    (
      channelIndex: number,
      visibleCol: number,
      modifiers: { shift: boolean; alt: boolean },
      isEmptyPattern: boolean,
    ) => {
      if (visibleCol === 0) {
        if (modifiers.alt) {
          actions.toggleSolo(channelIndex);
        } else {
          actions.toggleMute(channelIndex);
        }
        return;
      }

      const patternIndex = visibleCol - 1;
      if (modifiers.shift && isEmptyPattern && channelIndex === currentChannel) {
        actions.copyPatternTo(patternIndex);
        actions.setChannelPattern(channelIndex, patternIndex);
      } else {
        actions.setCurrentChannel(channelIndex);
        actions.setChannelPattern(channelIndex, patternIndex);
      }
      actions.setUiMode("pattern");
    },
    [currentChannel],
  );

  return {
    // Note movement
    moveSelectedNote,

    // Loop boundary commands
    adjustLoopEnd,
    adjustLoopStart,
    setLoopStartAt,
    setLoopEndAt,

    // Mode switching
    switchMode,
    cycleModifySubMode,

    // Modify commands
    toggleSubModeLoopMode,
    adjustSubModeArrayLength,
    setSubModeValueAtCell,

    // Note editing commands
    resizeSelectedNote,
    adjustRepeatAmount,
    adjustRepeatSpace,

    // Cell press / selection commands
    deselectNote,
    selectNoteAtCell,
    handlePatternCellPress,
    handleChannelCellPress,

    // Helpers (exposed for use by useGridController's remaining logic)
    playPreviewNote,
    followNoteWithCamera,
  };
}
