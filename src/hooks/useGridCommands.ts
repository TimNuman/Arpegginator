import { useCallback, useMemo } from "react";
import {
  useSequencerStore,
  VISIBLE_ROWS,
  VISIBLE_COLS,
} from "../store/sequencerStore";
import { useCurrentLoop, useCurrentPattern, usePatternData, useZoom } from "../store/selectors";
import * as actions from "../actions";
import {
  findEventAtTick,
  findEventById,
  getEventSubModeArrayLength,
  SUBDIVISION_TICKS,
  type ModifySubMode,
  type RenderedNoteT,
} from "../types/event";
import type { UiMode } from "../store/sequencerStore";
import { SCALES, buildScaleMapping, noteToMidi } from "../types/scales";
import { DRUM_TOTAL_ROWS, DRUM_MIN_ROW, DRUM_MAX_ROW } from "../types/drums";

interface UseGridCommandsOptions {
  onPlayNote?: (note: number, channel: number, lengthTicks?: number) => void;
}

export function useGridCommands(options: UseGridCommandsOptions = {}) {
  const { onPlayNote } = options;

  const currentChannel = useSequencerStore((s) => s.currentChannel);
  const channelType = useSequencerStore((s) => s.channelTypes[s.currentChannel]);
  const isDrum = channelType === "drum";
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const selectedNoteId = useSequencerStore((s) => s.view.selectedNoteId);
  const rowOffsets = useSequencerStore((s) => s.view.rowOffsets);
  const colOffset = useSequencerStore((s) => s.view.colOffset);
  const modifySubMode = useSequencerStore((s) => s.view.modifySubMode);
  const scaleRoot = useSequencerStore((s) => s.scaleRoot);
  const scaleId = useSequencerStore((s) => s.scaleId);
  const currentLoop = useCurrentLoop();
  const currentPattern = useCurrentPattern();
  const patternData = usePatternData();
  const zoom = useZoom();

  // Scale pattern for mapping
  const scalePattern = useMemo(
    () => SCALES[scaleId]?.pattern ?? SCALES.major.pattern,
    [scaleId],
  );

  // Always-on scale mapping
  const scaleMapping = useMemo(
    () => buildScaleMapping(scaleRoot, scalePattern),
    [scaleRoot, scalePattern],
  );

  // Tick-based grid calculations
  const ticksPerCol = SUBDIVISION_TICKS[zoom];
  const totalCols = Math.ceil(patternData.lengthTicks / ticksPerCol);
  const totalRows = isDrum ? DRUM_TOTAL_ROWS : scaleMapping.totalRows;
  const minRow = isDrum ? DRUM_MIN_ROW : scaleMapping.minRow;
  const maxRowOffset = Math.max(0, totalRows - VISIBLE_ROWS);
  const maxColOffset = Math.max(0, totalCols - VISIBLE_COLS);
  const startArrayIndex = maxRowOffset > 0
    ? Math.round((1 - rowOffsets[currentChannel]) * maxRowOffset)
    : 0;
  const startRow = startArrayIndex + minRow;
  const startCol = maxColOffset > 0
    ? Math.round(colOffset * maxColOffset)
    : 0;
  const startTick = startCol * ticksPerCol;

  /** Map a visible row index (0 = lowest) to a scale-relative index */
  const visibleRowToScaleIndex = useCallback(
    (visibleRow: number): number => {
      return startRow + visibleRow;
    },
    [startRow],
  );

  // Helper to get fresh pattern data from store (always reads latest state)
  const getPatternData = () => {
    const s = useSequencerStore.getState();
    return s.patterns[s.currentChannel][s.currentPatterns[s.currentChannel]];
  };

  // Helper to play a preview note (converts scale index to MIDI, or uses raw MIDI for drums)
  const playPreviewNote = useCallback(
    (row: number, lengthTicks?: number) => {
      if (!isPlaying && onPlayNote) {
        const midiNote = isDrum
          ? Math.max(0, Math.min(127, row))
          : noteToMidi(row, scaleMapping);
        if (midiNote >= 0) {
          onPlayNote(midiNote, currentChannel, lengthTicks);
        }
      }
    },
    [isPlaying, onPlayNote, currentChannel, scaleMapping, isDrum],
  );

  // Helper to follow note with camera (tick-based)
  const followNoteWithCamera = useCallback(
    (row: number, tick: number) => {
      // Row: convert to array position, check if outside visible area
      const arrayPos = row - minRow;
      if (maxRowOffset > 0) {
        if (arrayPos < startArrayIndex) {
          const newRowOffset = 1 - arrayPos / maxRowOffset;
          actions.setRowOffset(currentChannel, Math.max(0, Math.min(1, newRowOffset)));
        } else if (arrayPos > startArrayIndex + VISIBLE_ROWS - 1) {
          const newRowOffset = 1 - (arrayPos - VISIBLE_ROWS + 1) / maxRowOffset;
          actions.setRowOffset(currentChannel, Math.max(0, Math.min(1, newRowOffset)));
        }
      }

      // Column: convert tick to column index, then check visible area
      const col = Math.floor(tick / ticksPerCol);
      if (maxColOffset > 0) {
        if (col < startCol) {
          const newColOffset = col / maxColOffset;
          actions.setColOffset(Math.max(0, Math.min(1, newColOffset)));
        } else if (col > startCol + VISIBLE_COLS - 1) {
          const newColOffset = (col - VISIBLE_COLS + 1) / maxColOffset;
          actions.setColOffset(Math.max(0, Math.min(1, newColOffset)));
        }
      }
    },
    [currentChannel, startArrayIndex, startCol, maxRowOffset, maxColOffset, ticksPerCol, minRow],
  );

  // Move selected note in a direction
  const moveSelectedNote = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (!selectedNoteId) return;

      const pd = getPatternData();
      const event = findEventById(pd.events, selectedNoteId);
      if (!event || event.length <= 0) return;

      let newRow = event.row;
      let newPosition = event.position;

      switch (direction) {
        case "up": {
          const candidateRow = event.row + 1;
          if (isDrum ? candidateRow <= DRUM_MAX_ROW : noteToMidi(candidateRow, scaleMapping) >= 0) {
            newRow = candidateRow;
          }
          break;
        }
        case "down": {
          const candidateRow = event.row - 1;
          if (isDrum ? candidateRow >= DRUM_MIN_ROW : noteToMidi(candidateRow, scaleMapping) >= 0) {
            newRow = candidateRow;
          }
          break;
        }
        case "left":
          newPosition = Math.max(0, event.position - ticksPerCol);
          break;
        case "right":
          newPosition = Math.min(pd.lengthTicks - ticksPerCol, event.position + ticksPerCol);
          break;
      }

      if (newRow !== event.row || newPosition !== event.position) {
        actions.moveEvent(selectedNoteId, newRow, newPosition);
        followNoteWithCamera(newRow, newPosition);
        playPreviewNote(newRow);
      }
    },
    [selectedNoteId, ticksPerCol, followNoteWithCamera, playPreviewNote, scaleMapping, isDrum],
  );

  // Adjust loop end boundary
  const adjustLoopEnd = useCallback(
    (direction: "left" | "right") => {
      const loopEnd = currentLoop.start + currentLoop.length;
      let newEnd = loopEnd;
      if (direction === "left") {
        newEnd = Math.max(currentLoop.start + ticksPerCol, loopEnd - ticksPerCol);
      } else {
        newEnd = Math.min(patternData.lengthTicks, loopEnd + ticksPerCol);
      }
      if (newEnd !== loopEnd) {
        const newLength = newEnd - currentLoop.start;
        actions.setPatternLoop(currentChannel, currentPattern, currentLoop.start, newLength);
        followNoteWithCamera(startRow, newEnd - ticksPerCol);
      }
    },
    [currentLoop, currentChannel, currentPattern, patternData.lengthTicks, ticksPerCol, startRow, followNoteWithCamera],
  );

  // Adjust loop start boundary
  const adjustLoopStart = useCallback(
    (direction: "left" | "right") => {
      const loopEnd = currentLoop.start + currentLoop.length;
      let newStart = currentLoop.start;
      if (direction === "left") {
        newStart = Math.max(0, currentLoop.start - ticksPerCol);
      } else {
        newStart = Math.min(loopEnd - ticksPerCol, currentLoop.start + ticksPerCol);
      }
      if (newStart !== currentLoop.start) {
        const newLength = loopEnd - newStart;
        actions.setPatternLoop(currentChannel, currentPattern, newStart, newLength);
        followNoteWithCamera(startRow, newStart);
      }
    },
    [currentLoop, currentChannel, currentPattern, ticksPerCol, startRow, followNoteWithCamera],
  );

  // Set loop start at absolute tick (for click-based positioning)
  const setLoopStartAt = useCallback(
    (tick: number) => {
      const loopEnd = currentLoop.start + currentLoop.length;
      const newStart = Math.min(tick, loopEnd - ticksPerCol);
      const newLength = loopEnd - newStart;
      actions.setPatternLoop(currentChannel, currentPattern, newStart, newLength);
    },
    [currentLoop, currentChannel, currentPattern, ticksPerCol],
  );

  // Set loop end at absolute tick (for click-based positioning)
  const setLoopEndAt = useCallback(
    (tick: number) => {
      const newEnd = Math.max(tick + ticksPerCol, currentLoop.start + ticksPerCol);
      const newLength = newEnd - currentLoop.start;
      actions.setPatternLoop(currentChannel, currentPattern, currentLoop.start, newLength);
    },
    [currentLoop, currentChannel, currentPattern, ticksPerCol],
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
      const modes: ModifySubMode[] = ["velocity", "modulate", "hit", "flam", "timing"];
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
      if (!selectedNoteId) return;
      actions.toggleSubModeLoopMode(selectedNoteId, modifySubMode);
    },
    [selectedNoteId, modifySubMode],
  );

  // Adjust sub-mode array length for selected note
  const adjustSubModeArrayLength = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNoteId) return;
      const pd = getPatternData();
      const event = findEventById(pd.events, selectedNoteId);
      if (!event) return;
      const currentLength = getEventSubModeArrayLength(event, modifySubMode);
      const newLength = direction === "right" ? currentLength + 1 : currentLength - 1;
      if (newLength >= 1) {
        actions.setSubModeLength(selectedNoteId, modifySubMode, newLength);
      }
    },
    [selectedNoteId, modifySubMode],
  );

  // Set sub-mode value at a specific cell in the modify grid
  const setSubModeValueAtCell = useCallback(
    (visibleRow: number, visibleCol: number, visibleLevels: number[], resetToDefault: boolean) => {
      if (!selectedNoteId) return;
      const value = resetToDefault ? 0 : visibleLevels[visibleRow];
      actions.setSubModeValue(selectedNoteId, visibleCol, value, modifySubMode);
    },
    [selectedNoteId, modifySubMode],
  );

  // Resize selected note
  const resizeSelectedNote = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNoteId) return;
      const pd = getPatternData();
      const event = findEventById(pd.events, selectedNoteId);
      if (!event || event.length <= 0) return;

      let newLength = event.length;
      if (direction === "left") {
        newLength = Math.max(ticksPerCol, event.length - ticksPerCol);
      } else {
        let maxLength = pd.lengthTicks - event.position;
        if (event.repeatAmount > 1) {
          maxLength = Math.min(maxLength, event.repeatSpace);
        }
        newLength = Math.min(maxLength, event.length + ticksPerCol);
      }
      if (newLength !== event.length) {
        actions.setEventLength(selectedNoteId, newLength);
        playPreviewNote(event.row, newLength);
      }
    },
    [selectedNoteId, ticksPerCol, playPreviewNote],
  );

  // Adjust repeat amount for selected note
  const adjustRepeatAmount = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNoteId) return;
      const pd = getPatternData();
      const event = findEventById(pd.events, selectedNoteId);
      if (!event || event.length <= 0) return;

      const currentRepeatAmount = event.repeatAmount;
      let newRepeatAmount = currentRepeatAmount;
      if (direction === "left") {
        newRepeatAmount = Math.max(1, currentRepeatAmount - 1);
      } else {
        newRepeatAmount = Math.min(64, currentRepeatAmount + 1);
      }
      if (newRepeatAmount !== currentRepeatAmount) {
        actions.setEventRepeatAmount(selectedNoteId, newRepeatAmount);
      }
    },
    [selectedNoteId],
  );

  // Adjust repeat space for selected note (auto-enables repeat if needed)
  const adjustRepeatSpace = useCallback(
    (direction: "left" | "right") => {
      if (!selectedNoteId) return;
      const pd = getPatternData();
      const event = findEventById(pd.events, selectedNoteId);
      if (!event || event.length <= 0) return;

      if (event.repeatAmount <= 1 && direction === "right") {
        // No repeats yet -- enable repeat first by setting amount to 2
        actions.setEventRepeatAmount(selectedNoteId, 2);
      } else {
        const currentRepeatSpace = event.repeatSpace;
        let newRepeatSpace = currentRepeatSpace;
        if (direction === "left") {
          newRepeatSpace = Math.max(ticksPerCol, currentRepeatSpace - ticksPerCol);
        } else {
          newRepeatSpace = Math.min(64 * ticksPerCol, currentRepeatSpace + ticksPerCol);
        }
        if (newRepeatSpace !== currentRepeatSpace) {
          actions.setEventRepeatSpace(selectedNoteId, newRepeatSpace);
        }
      }
    },
    [selectedNoteId, ticksPerCol],
  );

  // Deselect note -- always clears displaced events stash
  const deselectNote = useCallback(
    () => {
      actions.clearDisplacedEvents();
      actions.setSelectedNoteId(null);
    },
    [],
  );

  // Select note at a grid cell (finds note via rendered notes)
  const selectNoteAtCell = useCallback(
    (row: number, tick: number, renderedNotes: RenderedNoteT[]) => {
      const noteAtTick = findEventAtTick(renderedNotes, row, tick);
      if (noteAtTick) {
        // Place previously selected event first
        const currentSelectedId = useSequencerStore.getState().view.selectedNoteId;
        if (currentSelectedId) {
          actions.placeEvent(currentSelectedId);
        }
        actions.setSelectedNoteId(noteAtTick.sourceId);
        return true;
      }
      return false;
    },
    [],
  );

  // Full pattern-mode cell press logic
  const handlePatternCellPress = useCallback(
    (
      visibleRow: number,
      visibleCol: number,
      renderedNotes: RenderedNoteT[],
      modifiers: { meta: boolean; shift: boolean },
    ) => {
      const row = visibleRowToScaleIndex(visibleRow);
      const tick = startTick + visibleCol * ticksPerCol;
      const pd = getPatternData();
      const noteAtTick = findEventAtTick(renderedNotes, row, tick);
      const currentSelectedId = useSequencerStore.getState().view.selectedNoteId;

      // Cmd+click: always disable (turn off) — skip repeats and already-disabled notes
      if (modifiers.meta) {
        if (noteAtTick && !noteAtTick.isRepeat) {
          actions.toggleEventEnabled(noteAtTick.sourceId);
          if (currentSelectedId && currentSelectedId === noteAtTick.sourceId) {
            actions.clearDisplacedEvents();
            actions.setSelectedNoteId(null);
          }
        }
        return;
      }

      // Shift+click: resize selected note to this tick
      if (modifiers.shift && currentSelectedId) {
        const selectedEvent = findEventById(pd.events, currentSelectedId);
        if (selectedEvent && selectedEvent.row === row) {
          const startPos = Math.min(selectedEvent.position, tick);
          const endPos = Math.max(selectedEvent.position, tick);
          const newLength = endPos - startPos + ticksPerCol;

          if (startPos !== selectedEvent.position) {
            actions.moveEvent(currentSelectedId, row, startPos);
          }
          actions.setEventLength(currentSelectedId, newLength);
          actions.setSelectedNoteId(currentSelectedId);
          playPreviewNote(row);
          return;
        }
      }

      // Click on note: select/deselect
      if (noteAtTick) {
        const sourceId = noteAtTick.sourceId;
        if (currentSelectedId && currentSelectedId === sourceId) {
          actions.placeEvent(currentSelectedId);
          actions.setSelectedNoteId(null);
        } else {
          if (currentSelectedId) {
            actions.placeEvent(currentSelectedId);
          }
          actions.setSelectedNoteId(sourceId);
        }
        playPreviewNote(noteAtTick.sourceRow);
        return;
      }

      // Check for disabled event at this position -- enable and select it
      const disabledEvent = pd.events.find(
        (e) => e.row === row && e.position === tick && !e.enabled,
      );
      if (disabledEvent) {
        if (currentSelectedId) {
          actions.placeEvent(currentSelectedId);
        }
        actions.setSelectedNoteId(disabledEvent.id);
        actions.toggleEventEnabled(disabledEvent.id);
        playPreviewNote(row);
        return;
      }

      // Click on empty: create note
      if (currentSelectedId) {
        actions.placeEvent(currentSelectedId);
      }
      actions.toggleEvent(row, tick, ticksPerCol);
      // Select the newly created event
      const updatedPd = getPatternData();
      const newEvent = updatedPd.events.find(
        (e) => e.row === row && e.position === tick,
      );
      if (newEvent) {
        actions.setSelectedNoteId(newEvent.id);
      }
      playPreviewNote(row);
    },
    [visibleRowToScaleIndex, startTick, ticksPerCol, playPreviewNote],
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

    // Drum state
    isDrum,

    // Helpers (exposed for use by useGridController's remaining logic)
    playPreviewNote,
    followNoteWithCamera,
  };
}
