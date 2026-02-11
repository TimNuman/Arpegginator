import { useCallback, useRef, useMemo } from "react";
import {
  useSequencerStore,
  ROWS,
  COLS,
  VISIBLE_ROWS,
  VISIBLE_COLS,
} from "../store/sequencerStore";
import { useKeyboard, type KeyboardState } from "./useKeyboard";
import { useGridCommands } from "./useGridCommands";
import {
  useGridState,
  useCurrentLoop,
  useCurrentPattern,
} from "../store/selectors";
import * as actions from "../actions";
import {
  getNoteLength,
  renderNotesToArray,
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

  // Shared command layer
  const commands = useGridCommands({ onPlayNote });

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

  // Use shared helpers from commands
  const { playPreviewNote, followNoteWithCamera } = commands;

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
          commands.deselectNote();
        } else {
          actions.resetPlayhead();
        }
        return true;
      }

      // Ctrl+Z/X/C/V/B: switch UI mode
      if (state.ctrl && !state.meta && !state.alt && !state.shift) {
        if (key === "z") { commands.switchMode("channel"); return true; }
        if (key === "x") { commands.switchMode("pattern"); return true; }
        if (key === "c") { commands.switchMode("loop"); return true; }
        if (key === "v") { commands.switchMode("modify", "velocity"); return true; }
        if (key === "b") { commands.switchMode("modify", "hit"); return true; }
      }

      // Loop mode: Arrow keys adjust loop boundaries
      if (
        uiMode === "loop" &&
        !state.meta &&
        !state.alt &&
        !state.ctrl &&
        (code === "ArrowLeft" || code === "ArrowRight")
      ) {
        const direction = code === "ArrowLeft" ? "left" : "right";
        if (state.shift) {
          commands.adjustLoopStart(direction);
        } else {
          commands.adjustLoopEnd(direction);
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
        commands.cycleModifySubMode(code === "ArrowDown" ? "down" : "up");
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
        commands.toggleSubModeLoopMode();
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
        commands.adjustSubModeArrayLength(code === "ArrowRight" ? "right" : "left");
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
            commands.adjustRepeatSpace(key === "arrowleft" ? "left" : "right");
            return true;
          }

          // Cmd+Arrow: change repeat amount
          if (
            state.meta &&
            !state.shift &&
            (key === "arrowleft" || key === "arrowright")
          ) {
            commands.adjustRepeatAmount(key === "arrowleft" ? "left" : "right");
            return true;
          }

          // Shift+Arrow: resize note
          if (
            state.shift &&
            !state.meta &&
            !state.alt &&
            (key === "arrowleft" || key === "arrowright")
          ) {
            commands.resizeSelectedNote(key === "arrowleft" ? "left" : "right");
            return true;
          }

          // Plain Arrow: move note
          if (
            !state.shift &&
            !state.meta &&
            !state.alt &&
            ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)
          ) {
            const dirMap: Record<string, "up" | "down" | "left" | "right"> = {
              arrowup: "up",
              arrowdown: "down",
              arrowleft: "left",
              arrowright: "right",
            };
            commands.moveSelectedNote(dirMap[key]);
            return true;
          }
        }
      }

      // Shift+key: extend selected note to this column
      if (
        state.shift &&
        !state.meta &&
        !state.ctrl &&
        !state.alt &&
        selectedNote
      ) {
        const gridPos = KEY_MAP[key];
        if (gridPos) {
          const actualRow = startRow + (VISIBLE_ROWS - 1 - gridPos.row);
          const actualCol = startCol + gridPos.col;

          if (actualRow === selectedNote.row) {
            const startColNote = Math.min(selectedNote.col, actualCol);
            const endColNote = Math.max(selectedNote.col, actualCol);
            const newNoteLength = endColNote - startColNote + 1;

            actions.setNote(actualRow, startColNote, newNoteLength);
            actions.setSelectedNote({ row: actualRow, col: startColNote });
            playPreviewNote(actualRow);
          }
          return true;
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
          const actualRow = startRow + (VISIBLE_ROWS - 1 - gridPos.row);
          const actualCol = startCol + gridPos.col;
          commands.handlePatternCellPress(actualRow, actualCol, renderedNotes, { meta: true, shift: false });
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
          const actualRow = startRow + (VISIBLE_ROWS - 1 - gridPos.row);
          const actualCol = startCol + gridPos.col;
          commands.handlePatternCellPress(actualRow, actualCol, renderedNotes, { meta: false, shift: false });
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
      commands,
    ],
  );

  const keyboard = useKeyboard({
    onKeyDown: handleKeyDown,
  });

  // Cell event handlers — delegate to commands
  const handleCellPress = useCallback(
    (row: number, col: number) => {
      commands.handlePatternCellPress(row, col, renderedNotes, {
        meta: keyboard.meta,
        shift: keyboard.shift,
      });
    },
    [keyboard.meta, keyboard.shift, renderedNotes, commands],
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
    // Shared command layer
    commands,

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
  };
}
