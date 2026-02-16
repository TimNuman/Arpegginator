import { useCallback, useRef, useMemo } from "react";
import {
  useSequencerStore,
  VISIBLE_ROWS,
  VISIBLE_COLS,
} from "../store/sequencerStore";
import { useKeyboard, type KeyboardState } from "./useKeyboard";
import { useGridCommands } from "./useGridCommands";
import {
  usePatternData,
  useCurrentLoop,
  useCurrentPattern,
  useZoom,
} from "../store/selectors";
import * as actions from "../actions";
import {
  renderEventsToArray,
  SUBDIVISION_TICKS,
  findEventById,
} from "../types/event";
import { SCALES, buildScaleMapping } from "../types/scales";
import { DRUM_TOTAL_ROWS, DRUM_MIN_ROW, DRUM_MAX_ROW } from "../types/drums";

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
  const currentTick = useSequencerStore((s) => s.currentTick);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const selectedNoteId = useSequencerStore((s) => s.view.selectedNoteId);
  const rowOffsets = useSequencerStore((s) => s.view.rowOffsets);
  const colOffset = useSequencerStore((s) => s.view.colOffset);
  const uiMode = useSequencerStore((s) => s.view.uiMode);
  const modifySubMode = useSequencerStore((s) => s.view.modifySubMode);
  const scaleRoot = useSequencerStore((s) => s.scaleRoot);
  const scaleId = useSequencerStore((s) => s.scaleId);
  const channelType = useSequencerStore((s) => s.channelTypes[s.currentChannel]);
  const isDrum = channelType === "drum";
  const currentPattern = useCurrentPattern();
  const currentLoop = useCurrentLoop();
  const patternData = usePatternData();
  const zoom = useZoom();

  // Always-on scale mapping
  const scalePattern = useMemo(
    () => SCALES[scaleId]?.pattern ?? SCALES.major.pattern,
    [scaleId],
  );
  const scaleMapping = useMemo(
    () => buildScaleMapping(scaleRoot, scalePattern),
    [scaleRoot, scalePattern],
  );

  // Tick-based layout
  const ticksPerCol = SUBDIVISION_TICKS[zoom];
  const totalCols = Math.ceil(patternData.lengthTicks / ticksPerCol);

  // Compute rendered notes with useMemo to avoid recreating on every render
  const renderMinRow = isDrum ? DRUM_MIN_ROW : scaleMapping.minRow;
  const renderMaxRow = isDrum ? DRUM_MAX_ROW : scaleMapping.maxRow;
  const renderedNotes = useMemo(
    () => renderEventsToArray(patternData.events, patternData.lengthTicks, renderMinRow, renderMaxRow),
    [patternData.events, patternData.lengthTicks, renderMinRow, renderMaxRow],
  );

  // Ref for unified grid press handler (set by Grid.tsx)
  const gridPressRef = useRef<((visibleRow: number, visibleCol: number, modifiers: { ctrl: boolean; shift: boolean; meta: boolean; alt: boolean }) => void) | null>(null);

  // Playhead follow mode refs
  const manualScrollOverride = useRef(false);
  const prevLoopedTick = useRef(-1);
  const prevIsPlaying = useRef(false);

  // Calculate visible area
  const totalRows = isDrum ? DRUM_TOTAL_ROWS : scaleMapping.totalRows;
  const minRow = isDrum ? DRUM_MIN_ROW : scaleMapping.minRow;
  const maxRowOffset = Math.max(0, totalRows - VISIBLE_ROWS);
  const maxColOffset = totalCols - VISIBLE_COLS;
  const startArrayIndex = maxRowOffset > 0
    ? Math.round((1 - rowOffsets[currentChannel]) * maxRowOffset)
    : 0;
  const startRow = startArrayIndex + minRow;
  const startCol = maxColOffset > 0
    ? Math.round(colOffset * maxColOffset)
    : 0;
  const endRow = startRow + VISIBLE_ROWS - 1;
  const endCol = startCol + VISIBLE_COLS - 1;
  const startTick = startCol * ticksPerCol;

  // Compute looped tick for playhead follow
  const loopEndTick = currentLoop.start + currentLoop.length;
  const loopedTick =
    currentTick >= 0
      ? currentLoop.start +
        ((((currentTick - currentLoop.start) % currentLoop.length) +
          currentLoop.length) %
          currentLoop.length)
      : -1;

  // Convert loop boundaries to columns for follow logic
  const loopStartCol = Math.floor(currentLoop.start / ticksPerCol);
  const loopLengthCols = Math.ceil(currentLoop.length / ticksPerCol);
  const loopEndCol = Math.ceil(loopEndTick / ticksPerCol);

  // Playhead follow mode — inline, no useEffect
  const FOLLOW_COL = 4;

  // Detect play/stop transitions -> clear manual override
  if (isPlaying && !prevIsPlaying.current) {
    manualScrollOverride.current = false;
  }
  if (!isPlaying && prevIsPlaying.current) {
    manualScrollOverride.current = false;
  }
  prevIsPlaying.current = isPlaying;

  // Playhead follow — only while playing
  if (isPlaying) {
    prevLoopedTick.current = loopedTick;

    // Auto-scroll to follow playhead
    if (
      loopedTick >= 0 &&
      loopLengthCols > VISIBLE_COLS &&
      !manualScrollOverride.current &&
      uiMode !== "loop"
    ) {
      const loopedCol = Math.floor((loopedTick - currentLoop.start) / ticksPerCol) + loopStartCol;
      let targetStartCol = loopedCol - FOLLOW_COL;
      targetStartCol = Math.max(targetStartCol, loopStartCol);
      const maxLoopStartCol = loopEndCol - VISIBLE_COLS;
      targetStartCol = Math.min(targetStartCol, maxLoopStartCol);
      targetStartCol = Math.max(
        0,
        Math.min(maxColOffset, targetStartCol),
      );
      const newColOffset = maxColOffset > 0
        ? Math.max(0, Math.min(1, targetStartCol / maxColOffset))
        : 0;
      if (Math.abs(newColOffset - colOffset) > 0.001) {
        actions.setColOffset(newColOffset);
      }
    }
  } else {
    prevLoopedTick.current = -1;
  }

  // Resolve selected event for keyboard handlers that need event data
  const selectedEvent = useMemo(
    () => selectedNoteId ? findEventById(patternData.events, selectedNoteId) ?? null : null,
    [selectedNoteId, patternData.events],
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
        if (selectedNoteId) {
          actions.setSelectedNoteId(null);
        } else {
          actions.resetPlayhead();
        }
        return true;
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
        selectedNoteId &&
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
        selectedNoteId &&
        !state.meta &&
        !state.alt &&
        !state.ctrl &&
        !state.shift &&
        (code === "ArrowLeft" || code === "ArrowRight")
      ) {
        commands.adjustSubModeArrayLength(code === "ArrowRight" ? "right" : "left");
        return true;
      }

      // Alt+Arrow: cycle scale root (left/right) and scale mode (up/down) — melodic pattern mode, no selected note
      if (
        uiMode === "pattern" &&
        !isDrum &&
        !selectedEvent &&
        state.alt &&
        !state.meta &&
        !state.ctrl &&
        !state.shift &&
        (code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft" || code === "ArrowRight")
      ) {
        if (code === "ArrowUp" || code === "ArrowDown") {
          actions.cycleScale(code === "ArrowUp" ? "up" : "down");
        } else {
          actions.cycleScaleRoot(code === "ArrowRight" ? "up" : "down");
        }
        return true;
      }

      // Note-related arrow shortcuts (pattern mode only, require selected note with valid event)
      if (uiMode === "pattern" && selectedEvent && selectedEvent.length > 0) {
        // Opt+Up/Down: cycle note speed (faster/slower)
        if (
          state.alt &&
          !state.shift &&
          !state.meta &&
          (key === "arrowup" || key === "arrowdown")
        ) {
          actions.cycleNoteSpeed(selectedEvent.id, key === "arrowup" ? "faster" : "slower");
          return true;
        }

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

      // Zoom: [ = zoom out (coarser), ] = zoom in (finer)
      if (key === "[") {
        actions.cycleZoom("out");
        return true;
      }
      if (key === "]") {
        actions.cycleZoom("in");
        return true;
      }

      // Grid key: delegate to unified handler (same path as button clicks)
      if (!event.repeat) {
        const gridPos = KEY_MAP[key];
        if (gridPos && gridPressRef.current) {
          gridPressRef.current(gridPos.row, gridPos.col, {
            ctrl: state.ctrl,
            shift: state.shift,
            meta: state.meta,
            alt: state.alt,
          });
          return true;
        }
      }

      return false;
    },
    [
      uiMode,
      selectedNoteId,
      selectedEvent,
      commands,
    ],
  );

  const keyboard = useKeyboard({
    onKeyDown: handleKeyDown,
  });

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

  // Shift-drag on horizontal strip: scrub playhead within the loop
  const handleScrub = useCallback(
    (value: number) => {
      // Map 0-1 to a tick within the current loop
      const scrubTick = Math.round(currentLoop.start + value * (currentLoop.length - 1));
      actions.scrubToTick(scrubTick);
    },
    [currentLoop.start, currentLoop.length],
  );

  const handleScrubEnd = useCallback(() => {
    actions.scrubEnd();
  }, []);

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
    selectedNoteId,
    renderedNotes,
    currentLoop,
    currentTick,
    currentChannel,
    currentPattern,
    patternData,

    // Tick-based layout
    zoom,
    ticksPerCol,
    startTick,
    totalCols,
    totalRows,

    // Scale mapping
    scaleMapping,

    // Drum state
    isDrumChannel: isDrum,

    // Unified grid press ref (set by Grid.tsx)
    gridPressRef,

    // Scroll handlers (memoized)
    onRowOffsetChange: handleRowOffsetChange,
    onColOffsetChange: handleColOffsetChange,
    onScrub: handleScrub,
    onScrubEnd: handleScrubEnd,
  };
}
