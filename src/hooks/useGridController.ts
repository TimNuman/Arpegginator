import { useCallback, useRef, useMemo } from "react";
import {
  useSequencerStore,
  ROWS,
  COLS,
  VISIBLE_ROWS,
  VISIBLE_COLS,
} from "../store/sequencerStore";
import { useKeyboard, type KeyboardState } from "./useKeyboard";
import {
  useGridState,
  useCurrentLoop,
  useCurrentPattern,
} from "../store/selectors";
import * as actions from "../actions";
import {
  findNoteAtCell,
  getNoteLength,
  getRepeatAmount,
  getRepeatSpace,
  getSubModeArrayLength,
  isNotePattern,
  renderNotesToArray,
  type ModifySubMode,
} from "../types/grid";

// Keyboard to grid position mapping
const KEY_MAP: Record<string, { row: number; col: number }> = {
  "1": { row: 4, col: 0 },
  "2": { row: 4, col: 1 },
  "3": { row: 4, col: 2 },
  "4": { row: 4, col: 3 },
  "5": { row: 4, col: 4 },
  "6": { row: 4, col: 5 },
  "7": { row: 4, col: 6 },
  "8": { row: 4, col: 7 },
  q: { row: 5, col: 0 },
  w: { row: 5, col: 1 },
  e: { row: 5, col: 2 },
  r: { row: 5, col: 3 },
  t: { row: 5, col: 4 },
  y: { row: 5, col: 5 },
  u: { row: 5, col: 6 },
  i: { row: 5, col: 7 },
  a: { row: 6, col: 0 },
  s: { row: 6, col: 1 },
  d: { row: 6, col: 2 },
  f: { row: 6, col: 3 },
  g: { row: 6, col: 4 },
  h: { row: 6, col: 5 },
  j: { row: 6, col: 6 },
  k: { row: 6, col: 7 },
  z: { row: 7, col: 0 },
  x: { row: 7, col: 1 },
  c: { row: 7, col: 2 },
  v: { row: 7, col: 3 },
  b: { row: 7, col: 4 },
  n: { row: 7, col: 5 },
  m: { row: 7, col: 6 },
  ",": { row: 7, col: 7 },
};

interface UseGridControllerOptions {
  onPlayNote?: (note: number, channel: number, steps?: number) => void;
}

export function useGridController(options: UseGridControllerOptions = {}) {
  const { onPlayNote } = options;

  // Store state - use individual selectors for stability
  const currentChannel = useSequencerStore((s) => s.currentChannel);
  const currentStep = useSequencerStore((s) => s.currentStep);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const selectedNote = useSequencerStore((s) => s.view.selectedNote);
  const rowOffsets = useSequencerStore((s) => s.view.rowOffsets);
  const colOffset = useSequencerStore((s) => s.view.colOffset);
  const uiMode = useSequencerStore((s) => s.view.uiMode);
  const modifySubMode = useSequencerStore((s) => s.view.modifySubMode);
  const currentPattern = useCurrentPattern();
  const currentLoop = useCurrentLoop();
  const gridState = useGridState();

  // Compute rendered notes with useMemo to avoid recreating on every render
  const renderedNotes = useMemo(
    () => renderNotesToArray(gridState, COLS),
    [gridState],
  );

  // Held note for keyboard input (two-key note length)
  const heldNote = useRef<{ row: number; col: number; key: string } | null>(
    null,
  );

  // Playhead follow mode refs
  const manualScrollOverride = useRef(false);
  const prevLoopedStep = useRef(-1);
  const prevIsPlaying = useRef(false);

  // Calculate visible area
  const maxRowOffset = ROWS - VISIBLE_ROWS;
  const maxColOffset = COLS - VISIBLE_COLS;
  const startRow = Math.round((1 - rowOffsets[currentChannel]) * maxRowOffset);
  const startCol = Math.round(colOffset * maxColOffset);
  const endRow = startRow + VISIBLE_ROWS - 1;
  const endCol = startCol + VISIBLE_COLS - 1;

  // Compute looped step for playhead follow
  const loopEnd = currentLoop.start + currentLoop.length;
  const loopedStep =
    currentStep >= 0
      ? currentLoop.start +
        ((((currentStep - currentLoop.start) % currentLoop.length) +
          currentLoop.length) %
          currentLoop.length)
      : -1;

  // Playhead follow mode — inline, no useEffect
  const FOLLOW_COL = 4;

  // Detect play/stop transitions → clear manual override
  if (isPlaying && !prevIsPlaying.current) {
    manualScrollOverride.current = false;
  }
  if (!isPlaying && prevIsPlaying.current) {
    manualScrollOverride.current = false;
  }
  prevIsPlaying.current = isPlaying;

  // Playhead follow — only while playing
  if (isPlaying) {
    // Detect loop wraparound → clear manual override so camera jumps back
    if (
      loopedStep >= 0 &&
      prevLoopedStep.current >= 0 &&
      loopedStep < prevLoopedStep.current
    ) {
      manualScrollOverride.current = false;
    }
    prevLoopedStep.current = loopedStep;

    // Auto-scroll to follow playhead
    if (
      loopedStep >= 0 &&
      currentLoop.length > VISIBLE_COLS &&
      !manualScrollOverride.current &&
      uiMode !== "loop"
    ) {
      let targetStartCol = loopedStep - FOLLOW_COL;
      targetStartCol = Math.max(targetStartCol, currentLoop.start);
      const maxLoopStartCol = loopEnd - VISIBLE_COLS;
      targetStartCol = Math.min(targetStartCol, maxLoopStartCol);
      targetStartCol = Math.max(
        0,
        Math.min(COLS - VISIBLE_COLS, targetStartCol),
      );
      const newColOffset = Math.max(
        0,
        Math.min(1, targetStartCol / maxColOffset),
      );
      if (Math.abs(newColOffset - colOffset) > 0.001) {
        actions.setColOffset(newColOffset);
      }
    }
  } else {
    prevLoopedStep.current = -1;
  }

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

  // Keyboard handler
  const handleKeyDown = useCallback(
    (
      key: string,
      code: string,
      event: KeyboardEvent,
      state: KeyboardState,
    ): boolean => {
      // Spacebar: toggle play
      if (key === " " || code === "Space") {
        actions.togglePlay();
        return true;
      }

      // Backspace: deselect note, or reset playhead if nothing selected
      if (key === "backspace") {
        if (selectedNote) {
          actions.setSelectedNote(null);
        } else {
          actions.resetPlayhead();
        }
        return true;
      }

      // Ctrl+Z/X/C/V/B: switch UI mode
      if (state.ctrl && !state.meta && !state.alt && !state.shift) {
        if (key === "z") {
          actions.setUiMode("channel");
          return true;
        }
        if (key === "x") {
          actions.setUiMode("pattern");
          return true;
        }
        if (key === "c") {
          actions.setUiMode("loop");
          return true;
        }
        if (key === "v") {
          actions.setUiMode("modify");
          actions.setModifySubMode("velocity");
          return true;
        }
        if (key === "b") {
          actions.setUiMode("modify");
          actions.setModifySubMode("hit");
          return true;
        }
      }

      // Loop mode: Arrow keys adjust loop boundaries
      if (
        uiMode === "loop" &&
        !state.meta &&
        !state.alt &&
        !state.ctrl &&
        (code === "ArrowLeft" || code === "ArrowRight")
      ) {
        if (state.shift) {
          // Shift+Arrow: adjust loop start
          const loopEnd = currentLoop.start + currentLoop.length;
          let newStart = currentLoop.start;
          if (code === "ArrowLeft") {
            newStart = Math.max(0, currentLoop.start - 1);
          } else {
            newStart = Math.min(loopEnd - 1, currentLoop.start + 1);
          }
          if (newStart !== currentLoop.start) {
            const newLength = loopEnd - newStart;
            actions.setPatternLoop(
              currentChannel,
              currentPattern,
              newStart,
              newLength,
            );
            followNoteWithCamera(startRow, newStart);
          }
        } else {
          // Arrow: adjust loop end
          const loopEnd = currentLoop.start + currentLoop.length;
          let newEnd = loopEnd;
          if (code === "ArrowLeft") {
            newEnd = Math.max(currentLoop.start + 1, loopEnd - 1);
          } else {
            newEnd = Math.min(COLS, loopEnd + 1);
          }
          if (newEnd !== loopEnd) {
            const newLength = newEnd - currentLoop.start;
            actions.setPatternLoop(
              currentChannel,
              currentPattern,
              currentLoop.start,
              newLength,
            );
            followNoteWithCamera(startRow, newEnd - 1);
          }
        }
        return true;
      }

      // Modify mode: Cmd+Arrow up/down cycles sub-modes (velocity/hit/timing/flam/modulate)
      if (
        uiMode === "modify" &&
        state.meta &&
        !state.alt &&
        !state.ctrl &&
        !state.shift &&
        (code === "ArrowUp" || code === "ArrowDown")
      ) {
        const modes: ModifySubMode[] = ["velocity", "hit", "timing", "flam", "modulate"];
        const currentIndex = modes.indexOf(modifySubMode);
        const nextIndex = code === "ArrowDown"
          ? (currentIndex + 1) % modes.length
          : (currentIndex - 1 + modes.length) % modes.length;
        actions.setModifySubMode(modes[nextIndex]);
        return true;
      }

      // Modify mode: Arrow up/down toggles loop mode for current sub-mode
      if (
        uiMode === "modify" &&
        selectedNote &&
        !state.meta &&
        !state.alt &&
        !state.ctrl &&
        !state.shift &&
        (code === "ArrowUp" || code === "ArrowDown")
      ) {
        actions.toggleSubModeLoopMode(selectedNote.row, selectedNote.col, modifySubMode);
        return true;
      }

      // Modify mode: Arrow left/right adjusts array length for current sub-mode
      if (
        uiMode === "modify" &&
        selectedNote &&
        !state.meta &&
        !state.alt &&
        !state.ctrl &&
        !state.shift &&
        (code === "ArrowLeft" || code === "ArrowRight")
      ) {
        const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
        if (noteValue) {
          const currentLength = getSubModeArrayLength(noteValue, modifySubMode);
          const newLength = code === "ArrowRight"
            ? currentLength + 1
            : currentLength - 1;
          if (newLength >= 1) {
            actions.setSubModeLength(selectedNote.row, selectedNote.col, modifySubMode, newLength);
          }
        }
        return true;
      }

      // In channel/loop/modify mode, skip note-editing keybindings
      if (uiMode !== "pattern") {
        return false;
      }

      // Note-related keyboard shortcuts (require selected note, pattern mode only)
      if (selectedNote) {
        const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
        const noteLength = getNoteLength(noteValue);

        if (noteLength > 0) {
          // Cmd+Shift+Arrow: change repeat space (auto-enable repeat if needed)
          if (
            state.meta &&
            state.shift &&
            (key === "arrowleft" || key === "arrowright")
          ) {
            const currentRepeatAmount = getRepeatAmount(noteValue);
            if (currentRepeatAmount <= 1 && key === "arrowright") {
              // No repeats yet — enable repeat first by setting amount to 2
              actions.setNoteRepeatAmount(
                selectedNote.row,
                selectedNote.col,
                2,
              );
            } else {
              const currentRepeatSpace = getRepeatSpace(noteValue);
              let newRepeatSpace = currentRepeatSpace;
              if (key === "arrowleft") {
                newRepeatSpace = Math.max(1, currentRepeatSpace - 1);
              } else {
                newRepeatSpace = Math.min(64, currentRepeatSpace + 1);
              }
              if (newRepeatSpace !== currentRepeatSpace) {
                actions.setNoteRepeatSpace(
                  selectedNote.row,
                  selectedNote.col,
                  newRepeatSpace,
                );
              }
            }
            return true;
          }

          // Cmd+Arrow: change repeat amount
          if (
            state.meta &&
            !state.shift &&
            (key === "arrowleft" || key === "arrowright")
          ) {
            const currentRepeatAmount = getRepeatAmount(noteValue);
            let newRepeatAmount = currentRepeatAmount;
            if (key === "arrowleft") {
              newRepeatAmount = Math.max(1, currentRepeatAmount - 1);
            } else {
              newRepeatAmount = Math.min(64, currentRepeatAmount + 1);
            }
            if (newRepeatAmount !== currentRepeatAmount) {
              actions.setNoteRepeatAmount(
                selectedNote.row,
                selectedNote.col,
                newRepeatAmount,
              );
            }
            return true;
          }

          // Shift+Arrow: resize note
          if (
            state.shift &&
            !state.meta &&
            !state.alt &&
            (key === "arrowleft" || key === "arrowright")
          ) {
            let newLength = noteLength;
            if (key === "arrowleft") {
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
            return true;
          }

          // Plain Arrow: move note
          if (
            !state.shift &&
            !state.meta &&
            !state.alt &&
            ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)
          ) {
            let newRow = selectedNote.row;
            let newCol = selectedNote.col;

            switch (key) {
              case "arrowup":
                newRow = Math.min(ROWS - 1, selectedNote.row + 1);
                break;
              case "arrowdown":
                newRow = Math.max(0, selectedNote.row - 1);
                break;
              case "arrowleft":
                newCol = Math.max(0, selectedNote.col - 1);
                break;
              case "arrowright":
                newCol = Math.min(COLS - 1, selectedNote.col + 1);
                break;
            }

            if (newRow !== selectedNote.row || newCol !== selectedNote.col) {
              actions.moveNote(
                selectedNote.row,
                selectedNote.col,
                newRow,
                newCol,
              );
              actions.setSelectedNote({ row: newRow, col: newCol });
              followNoteWithCamera(newRow, newCol);
              playPreviewNote(newRow);
            }
            return true;
          }
        }
      }

      // Cmd+key: toggle enabled at position (enable/disable, preserving pattern)
      if (
        state.meta &&
        !state.shift &&
        !state.ctrl &&
        !state.alt &&
        !event.repeat
      ) {
        const gridPos = KEY_MAP[key];
        if (gridPos) {
          const visibleRow = gridPos.row;
          const visibleCol = gridPos.col;
          const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
          const actualCol = startCol + visibleCol;

          // Check if there's a visible note at this cell
          const note = findNoteAtCell(renderedNotes, actualRow, actualCol);
          if (note) {
            // Visible (enabled) note — disable it
            actions.toggleEnabled(note.sourceRow, note.sourceCol);
            // Deselect if this was selected
            if (
              selectedNote &&
              selectedNote.row === note.sourceRow &&
              selectedNote.col === note.sourceCol
            ) {
              actions.setSelectedNote(null);
            }
          } else {
            // No visible note — check if there's a disabled note in the grid data
            const noteValue = gridState[actualRow]?.[actualCol];
            if (isNotePattern(noteValue) && !noteValue.enabled) {
              // Disabled note — re-enable and select it
              if (selectedNote) {
                actions.placeNote(selectedNote.row, selectedNote.col);
              }
              actions.setSelectedNote({ row: actualRow, col: actualCol });
              actions.toggleEnabled(actualRow, actualCol);
            } else if (noteValue === null || getNoteLength(noteValue) === 0) {
              // Empty — create a new note
              actions.toggleEnabled(actualRow, actualCol);
            }
          }
          return true;
        }
      }

      // Grid key input (no modifiers)
      if (
        !state.shift &&
        !state.ctrl &&
        !state.alt &&
        !state.meta &&
        !event.repeat
      ) {
        const gridPos = KEY_MAP[key];
        if (gridPos) {
          const visibleRow = gridPos.row;
          const visibleCol = gridPos.col;
          const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
          const actualCol = startCol + visibleCol;

          // Check if we already have a held note on the same row
          if (
            heldNote.current &&
            KEY_MAP[heldNote.current.key]?.row === gridPos.row
          ) {
            // Second key on same row - create note with length
            const heldPos = KEY_MAP[heldNote.current.key]!;
            const heldCol = startCol + heldPos.col;
            const startColNote = Math.min(heldCol, actualCol);
            const endColNote = Math.max(heldCol, actualCol);
            const newNoteLength = endColNote - startColNote + 1;

            actions.setNote(actualRow, startColNote, newNoteLength);
            actions.setSelectedNote({ row: actualRow, col: startColNote });
            playPreviewNote(actualRow);
            heldNote.current = null;
          } else {
            // First key press - hold this note
            heldNote.current = { row: actualRow, col: actualCol, key };
          }
          return true;
        }
      }

      return false;
    },
    [
      uiMode,
      modifySubMode,
      selectedNote,
      gridState,
      currentLoop,
      currentChannel,
      currentPattern,
      renderedNotes,
      startRow,
      startCol,
      playPreviewNote,
      followNoteWithCamera,
    ],
  );

  const handleKeyUp = useCallback(
    (
      key: string,
      code: string,
      _event: KeyboardEvent,
      _state: KeyboardState,
    ) => {
      // Handle held note release
      const gridPos = KEY_MAP[key];
      if (gridPos && heldNote.current?.key === key) {
        const { row, col } = heldNote.current;
        const wasActive = getNoteLength(gridState[row]?.[col]) > 0;

        // Place the previously selected note before toggling new one
        // Get current selectedNote from store
        const currentSelectedNote =
          useSequencerStore.getState().view.selectedNote;
        if (
          currentSelectedNote &&
          (currentSelectedNote.row !== row || currentSelectedNote.col !== col)
        ) {
          actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
        }

        actions.toggleCell(row, col);

        if (!wasActive) {
          actions.setSelectedNote({ row, col });
        }

        playPreviewNote(row);
        heldNote.current = null;
      }
    },
    [gridState, playPreviewNote],
  );

  const keyboard = useKeyboard({
    onKeyDown: handleKeyDown,
    onKeyUp: handleKeyUp,
  });

  // Cell event handlers
  const handleCellPress = useCallback(
    (row: number, col: number) => {
      const noteAtCell = findNoteAtCell(renderedNotes, row, col);
      // Get current selectedNote from store for fresh value
      const currentSelectedNote =
        useSequencerStore.getState().view.selectedNote;

      // Cmd+click: toggle enabled (enable/disable, preserving pattern) — skip repeats
      if (keyboard.meta) {
        if (noteAtCell && !noteAtCell.isRepeat) {
          // Visible (enabled) main note — disable its source pattern
          actions.toggleEnabled(noteAtCell.sourceRow, noteAtCell.sourceCol);
          if (
            currentSelectedNote &&
            currentSelectedNote.row === noteAtCell.sourceRow &&
            currentSelectedNote.col === noteAtCell.sourceCol
          ) {
            actions.setSelectedNote(null);
          }
        } else if (!noteAtCell) {
          // No visible note — check for disabled note or create new
          const cellValue = gridState[row]?.[col];
          if (isNotePattern(cellValue) && !cellValue.enabled) {
            // Disabled note — re-enable and select it
            if (currentSelectedNote) {
              actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
            }
            actions.setSelectedNote({ row, col });
          }
          actions.toggleEnabled(row, col);
        }
        return;
      }

      // Shift+click: extend note from left
      if (keyboard.shift && !noteAtCell) {
        for (let c = col - 1; c >= 0; c--) {
          if (getNoteLength(gridState[row]?.[c]) > 0) {
            // Place previously selected note first
            if (
              currentSelectedNote &&
              (currentSelectedNote.row !== row || currentSelectedNote.col !== c)
            ) {
              actions.placeNote(
                currentSelectedNote.row,
                currentSelectedNote.col,
              );
            }
            actions.setNote(row, c, col - c + 1);
            actions.setSelectedNote({ row, col: c });
            playPreviewNote(row);
            return;
          }
        }
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
          // Already selected - deselect and place
          actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
          actions.setSelectedNote(null);
        } else {
          // Place previously selected note first
          if (currentSelectedNote) {
            actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
          }
          actions.setSelectedNote({ row: sourceRow, col: sourceCol });
        }
        playPreviewNote(sourceRow);
        return;
      }

      // Check for disabled note at this cell — enable and select it
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
      // Place previously selected note first
      if (currentSelectedNote) {
        actions.placeNote(currentSelectedNote.row, currentSelectedNote.col);
      }
      actions.toggleCell(row, col);
      actions.setSelectedNote({ row, col });
      playPreviewNote(row);
    },
    [keyboard, gridState, renderedNotes, playPreviewNote],
  );

  const handleCellDragEnter = useCallback((_row: number, _col: number) => {
    // Drag logic removed — to be reimplemented
  }, []);

  const handleCellRelease = useCallback(() => {
    // Drag logic removed — to be reimplemented
  }, []);

  // Memoize scroll handlers to prevent re-renders
  const handleRowOffsetChange = useCallback(
    (offset: number) => {
      actions.setRowOffset(currentChannel, offset);
    },
    [currentChannel],
  );

  const handleColOffsetChange = useCallback(
    (offset: number) => {
      if (isPlaying) {
        manualScrollOverride.current = true;
      }
      actions.setColOffset(offset);
    },
    [isPlaying],
  );

  return {
    // Keyboard state (for display)
    keyboard,
    uiMode,
    modifySubMode,

    // Computed view state
    startRow,
    startCol,
    endRow,
    endCol,
    selectedNote,
    renderedNotes,
    currentLoop,
    currentStep,
    currentChannel,
    currentPattern,
    gridState,

    // Event handlers for Grid
    onCellPress: handleCellPress,
    onCellRelease: handleCellRelease,
    onCellDragEnter: handleCellDragEnter,

    // Scroll handlers (memoized)
    onRowOffsetChange: handleRowOffsetChange,
    onColOffsetChange: handleColOffsetChange,

    // Camera follow helper (for loop editing in Grid.tsx)
    followWithCamera: followNoteWithCamera,
  };
}
