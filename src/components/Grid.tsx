import { memo, useState, useRef, useCallback, useEffect } from "react";
import { css } from "@emotion/react";
import { Box } from "@mui/material";
import { GridButton } from "./GridButton";
import { TouchStrip } from "./TouchStrip";
import type { GridState } from "../types/grid";
import { CHANNEL_COLORS } from "../hooks/useSequencer";

// Total grid size (can be larger than visible)
const TOTAL_ROWS = 128; // Full MIDI range (0-127)
const TOTAL_COLS = 64;

// Visible viewport size
const VISIBLE_ROWS = 8;
const VISIBLE_COLS = 16;

// Channels 0-3 are drum tracks, starting at note 36
// Channels 4-7 are melodic, starting at middle C (MIDI 60)
// With inverted display: (1 - offset) * maxRowOffset = startRow
// So offset = 1 - (startRow / maxRowOffset)
const getInitialRowOffset = (channel: number): number => {
  const maxRowOffset = TOTAL_ROWS - VISIBLE_ROWS; // 120
  if (channel < 4) {
    // Drum channels: start at note 36
    return 1 - 36 / maxRowOffset;
  }
  // Melodic channels: start at middle C (60)
  return 1 - 60 / maxRowOffset;
};

const NUM_CHANNELS = 8;

const gridOuterContainerStyles = css`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
`;

const gridInnerContainerStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const gridContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  background: linear-gradient(145deg, #1a1a1a, #0d0d0d);
  border-radius: 12px;
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
`;

const rowStyles = css`
  display: flex;
  flex-direction: row;
`;

const verticalStripContainerStyles = css`
  display: flex;
  align-items: center;
  padding: 20px 0;
`;

const horizontalStripContainerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
`;

const modifierKeysContainerStyles = css`
  display: flex;
  gap: 4px;
`;

const modifierKeyStyles = css`
  width: 40px;
  height: 24px;
  border-radius: 4px;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.1s ease;
`;

const modifierKeyActiveStyles = css`
  background: linear-gradient(145deg, #4a4a4a, #3a3a3a);
  color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
`;

const debugStyles = css`
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-family: monospace;
  padding: 8px 20px;
  display: flex;
  justify-content: space-between;
`;

const oledContainerStyles = css`
  display: flex;
  align-items: flex-start;
  padding: 20px 0;
`;

const oledScreenStyles = css`
  width: calc(4 * 44px - 4px); // 4 buttons wide minus gap
  height: calc(3 * 44px - 4px); // 3 buttons high minus gap
  background: #000;
  border-radius: 4px;
  border: 2px solid #1a1a1a;
  box-shadow:
    inset 0 0 20px rgba(0, 0, 0, 0.8),
    0 2px 8px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  padding: 8px;
  font-family: "SF Mono", "Menlo", "Monaco", monospace;
  color: #0ff;
  font-size: 11px;
  overflow: hidden;
`;

const oledRowStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 33.33%;
`;

const oledLabelStyles = css`
  color: rgba(0, 255, 255, 0.5);
  font-size: 9px;
  text-transform: uppercase;
`;

const oledValueStyles = css`
  color: #0ff;
  font-size: 12px;
  font-weight: 500;
  text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
`;

const rotaryEncoderStyles = css`
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border: 3px solid #333;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.5),
    inset 0 2px 4px rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  cursor: pointer;
  position: relative;

  &::before {
    content: "";
    position: absolute;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(145deg, #222, #181818);
    border: 2px solid #2a2a2a;
  }

  &::after {
    content: "";
    position: absolute;
    width: 4px;
    height: 20px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
    top: 12px;
  }
`;

const rotaryKnobStyles = css`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(145deg, #3a3a3a, #252525);
  border: 1px solid #444;
  z-index: 1;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
`;

interface PatternLoop {
  start: number;
  length: number;
}

interface GridProps {
  gridState: GridState;
  currentStep: number;
  onToggleCell: (row: number, col: number) => void;
  onSetNote: (row: number, col: number, length: number) => void;
  channelColor: string;
  currentChannel: number;
  onChannelChange: (channel: number) => void;
  currentPattern: number;
  currentPatterns: number[];
  onPatternChange: (channel: number, pattern: number) => void;
  queuedPatterns: (number | null)[];
  channelsHaveNotes: boolean[];
  allPatternsHaveNotes: boolean[][];
  currentLoop: PatternLoop; // Loop for current channel's current pattern
  onSetPatternLoop: (
    channel: number,
    pattern: number,
    start: number,
    length: number,
  ) => void;
  onPlayNote: (note: number, channel: number) => void;
  channelsPlayingNow: boolean[]; // Which channels have a note playing at current step
  isPulseBeat: boolean; // True every 4 beats for queued pattern animation
  isPlaying: boolean; // Whether the sequencer is currently playing
  onTogglePlay: () => void; // Toggle play/stop
  onResetPlayhead: () => void; // Reset playhead to beginning
  mutedChannels: boolean[]; // Which channels are muted
  soloedChannels: boolean[]; // Which channels are soloed
  onToggleMute: (channel: number) => void; // Toggle mute for a channel
  onToggleSolo: (channel: number) => void; // Toggle solo for a channel
  onCopyPattern: (targetPattern: number) => void; // Copy current pattern to target
}

export const Grid = memo(
  ({
    gridState,
    currentStep,
    onToggleCell,
    onSetNote,
    channelColor,
    currentChannel,
    onChannelChange,
    currentPattern,
    currentPatterns,
    onPatternChange,
    queuedPatterns,
    allPatternsHaveNotes,
    currentLoop,
    onSetPatternLoop,
    onPlayNote,
    channelsPlayingNow,
    isPulseBeat,
    isPlaying,
    onTogglePlay,
    onResetPlayhead,
    mutedChannels,
    soloedChannels,
    onToggleMute,
    onToggleSolo,
    onCopyPattern,
  }: GridProps) => {
    // Store row offset per channel
    const [rowOffsets, setRowOffsets] = useState<number[]>(() =>
      Array.from({ length: NUM_CHANNELS }, (_, i) => getInitialRowOffset(i)),
    );
    const [colOffset, setColOffset] = useState(0);
    const [shiftPressed, setShiftPressed] = useState(false);
    const [altPressed, setAltPressed] = useState(false);
    const [metaPressed, setMetaPressed] = useState(false);
    // Track loop selection start (persists while Alt is held)
    const [loopSelectionStart, setLoopSelectionStart] = useState<number | null>(
      null,
    );

    // Track held key for note length input: { row, col, key }
    const [heldNote, setHeldNote] = useState<{
      row: number;
      col: number;
      key: string;
    } | null>(null);

    const rowOffset = rowOffsets[currentChannel];
    const setRowOffset = useCallback(
      (value: number) => {
        setRowOffsets((prev) => {
          const next = [...prev];
          next[currentChannel] = value;
          return next;
        });
      },
      [currentChannel],
    );

    // Track drag mode: null = not dragging, true = turning on, false = turning off
    const dragMode = useRef<boolean | null>(null);
    const visitedCells = useRef<Set<string>>(new Set());
    // Track loop drag start position
    const loopDragStart = useRef<number | null>(null);

    // Calculate actual row/col start indices from offset values
    const maxRowOffset = TOTAL_ROWS - VISIBLE_ROWS;
    const maxColOffset = TOTAL_COLS - VISIBLE_COLS;
    // Invert row offset so that scrolling up shows higher notes
    const startRow = Math.round((1 - rowOffset) * maxRowOffset);
    const startCol = Math.round(colOffset * maxColOffset);

    // Calculate grid dimensions for strip length
    const buttonSize = 44; // 40px button + 4px margin
    const gridHeight = VISIBLE_ROWS * buttonSize;
    const gridWidth = VISIBLE_COLS * buttonSize;

    // Calculate visible range (accounting for inverted rows)
    const endRow = startRow + VISIBLE_ROWS - 1;
    const endCol = startCol + VISIBLE_COLS - 1;

    // Check for off-screen notes and create edge indicators
    // Returns the number of off-screen notes for this edge cell
    const getOffScreenNoteCount = useCallback(
      (visibleRow: number, visibleCol: number): number => {
        const isTopEdge = visibleRow === 0;
        const isBottomEdge = visibleRow === VISIBLE_ROWS - 1;
        const isLeftEdge = visibleCol === 0;
        const isRightEdge = visibleCol === VISIBLE_COLS - 1;

        if (!isTopEdge && !isBottomEdge && !isLeftEdge && !isRightEdge) {
          return 0;
        }

        const actualCol = startCol + visibleCol;
        // Remember: visibleRow 0 is top of screen = highest note in visible range
        const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);

        let count = 0;

        // Check for notes above visible area (higher MIDI notes)
        if (isTopEdge) {
          for (let row = endRow + 1; row < TOTAL_ROWS; row++) {
            if (gridState[row]?.[actualCol] > 0) {
              count++;
            }
          }
        }

        // Check for notes below visible area (lower MIDI notes)
        if (isBottomEdge) {
          for (let row = 0; row < startRow; row++) {
            if (gridState[row]?.[actualCol] > 0) {
              count++;
            }
          }
        }

        // Check for notes to the right of visible area
        if (isRightEdge) {
          for (let col = endCol + 1; col < TOTAL_COLS; col++) {
            if (gridState[actualRow]?.[col] > 0) {
              count++;
            }
          }
        }

        // Check for notes to the left of visible area
        if (isLeftEdge) {
          for (let col = 0; col < startCol; col++) {
            if (gridState[actualRow]?.[col] > 0) {
              count++;
            }
          }
        }

        return count;
      },
      [gridState, startRow, startCol, endRow, endCol],
    );

    // Check if any off-screen note is currently playing for this edge cell
    // Takes the current looped step and loop boundaries to determine playback
    const isOffScreenNotePlaying = useCallback(
      (
        visibleRow: number,
        visibleCol: number,
        loopedStep: number,
        loopStart: number,
        loopEnd: number,
      ): boolean => {
        const isTopEdge = visibleRow === 0;
        const isBottomEdge = visibleRow === VISIBLE_ROWS - 1;
        const isLeftEdge = visibleCol === 0;
        const isRightEdge = visibleCol === VISIBLE_COLS - 1;

        if (!isTopEdge && !isBottomEdge && !isLeftEdge && !isRightEdge) {
          return false;
        }

        const actualCol = startCol + visibleCol;
        const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);

        // Helper to check if a note at (row, col) with given length is playing
        const isNotePlaying = (row: number, noteCol: number): boolean => {
          const noteLength = gridState[row]?.[noteCol] ?? 0;
          if (noteLength <= 0) return false;

          const noteEndCol = noteCol + noteLength - 1;
          // Note must start within the loop to be triggered
          const noteStartInLoop = noteCol >= loopStart && noteCol < loopEnd;
          return (
            noteStartInLoop && loopedStep >= noteCol && loopedStep <= noteEndCol
          );
        };

        // Check for playing notes above visible area (higher MIDI notes)
        if (isTopEdge) {
          for (let row = endRow + 1; row < TOTAL_ROWS; row++) {
            if (isNotePlaying(row, actualCol)) return true;
          }
        }

        // Check for playing notes below visible area (lower MIDI notes)
        if (isBottomEdge) {
          for (let row = 0; row < startRow; row++) {
            if (isNotePlaying(row, actualCol)) return true;
          }
        }

        // Check for playing notes to the right of visible area
        if (isRightEdge) {
          for (let col = endCol + 1; col < TOTAL_COLS; col++) {
            if (isNotePlaying(actualRow, col)) return true;
          }
        }

        // Check for playing notes to the left of visible area
        if (isLeftEdge) {
          for (let col = 0; col < startCol; col++) {
            if (isNotePlaying(actualRow, col)) return true;
          }
        }

        return false;
      },
      [gridState, startRow, startCol, endRow, endCol],
    );

    // Keyboard grid mapping: 8 columns x 4 rows (bottom 4 rows of visible grid)
    // Column keys: 1-8 (top row), QWERTYU (second row), ASDFGHJ (third row), ZXCVBNM (fourth row)
    const keyToGridPosition = useCallback(
      (key: string): { row: number; col: number } | null => {
        const keyMap: Record<string, { row: number; col: number }> = {
          // Row 0 (top of keyboard = row 4 of grid, which is visible row 4)
          "1": { row: 4, col: 0 },
          "2": { row: 4, col: 1 },
          "3": { row: 4, col: 2 },
          "4": { row: 4, col: 3 },
          "5": { row: 4, col: 4 },
          "6": { row: 4, col: 5 },
          "7": { row: 4, col: 6 },
          "8": { row: 4, col: 7 },
          // Row 1 (Q row = row 5 of grid)
          q: { row: 5, col: 0 },
          w: { row: 5, col: 1 },
          e: { row: 5, col: 2 },
          r: { row: 5, col: 3 },
          t: { row: 5, col: 4 },
          y: { row: 5, col: 5 },
          u: { row: 5, col: 6 },
          i: { row: 5, col: 7 },
          // Row 2 (A row = row 6 of grid)
          a: { row: 6, col: 0 },
          s: { row: 6, col: 1 },
          d: { row: 6, col: 2 },
          f: { row: 6, col: 3 },
          g: { row: 6, col: 4 },
          h: { row: 6, col: 5 },
          j: { row: 6, col: 6 },
          k: { row: 6, col: 7 },
          // Row 3 (Z row = row 7 of grid, bottom row)
          z: { row: 7, col: 0 },
          x: { row: 7, col: 1 },
          c: { row: 7, col: 2 },
          v: { row: 7, col: 3 },
          b: { row: 7, col: 4 },
          n: { row: 7, col: 5 },
          m: { row: 7, col: 6 },
          ",": { row: 7, col: 7 },
        };
        return keyMap[key.toLowerCase()] || null;
      },
      [],
    );

    // Listen for modifier keys and grid toggle keys
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Shift") {
          setShiftPressed(true);
        }
        if (e.key === "Alt") {
          setAltPressed(true);
        }
        if (e.key === "Meta") {
          setMetaPressed(true);
        }

        // Handle spacebar for play/stop toggle
        if (e.key === " " || e.code === "Space") {
          e.preventDefault();
          onTogglePlay();
          return;
        }

        // Handle backspace for reset playhead
        if (e.key === "Backspace") {
          e.preventDefault();
          onResetPlayhead();
          return;
        }

        // Handle grid toggle keys (only when not in shift mode)
        if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
          const gridPos = keyToGridPosition(e.key);
          if (gridPos) {
            e.preventDefault();
            // Convert visible row/col to actual row/col
            const visibleRow = gridPos.row;
            const visibleCol = gridPos.col;
            const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
            const actualCol = startCol + visibleCol;

            // Check if we already have a held note on the same row
            if (
              heldNote &&
              keyToGridPosition(heldNote.key)?.row === gridPos.row
            ) {
              // Second key on same row - create note with length
              const heldPos = keyToGridPosition(heldNote.key)!;
              const heldCol = startCol + heldPos.col;
              const startColNote = Math.min(heldCol, actualCol);
              const endColNote = Math.max(heldCol, actualCol);
              const noteLength = endColNote - startColNote + 1;

              // Set note at the start position with the calculated length
              onSetNote(actualRow, startColNote, noteLength);

              // Play note when not playing (preview sound)
              if (!isPlaying) {
                onPlayNote(actualRow, currentChannel);
              }

              // Clear held note
              setHeldNote(null);
            } else {
              // First key press - hold this note
              setHeldNote({ row: actualRow, col: actualCol, key: e.key });
            }
          }
        }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === "Shift") {
          setShiftPressed(false);
          // Don't clear shiftNoteStart - allow click without shift to complete the note
        }
        if (e.key === "Alt") {
          setAltPressed(false);
          loopDragStart.current = null; // Cancel loop drag when alt is released
          setLoopSelectionStart(null); // Cancel loop selection when alt is released
        }
        if (e.key === "Meta") {
          setMetaPressed(false);
        }

        // Handle grid key release - if this is the held note and no second key was pressed, toggle it
        const gridPos = keyToGridPosition(e.key);
        if (
          gridPos &&
          heldNote &&
          heldNote.key.toLowerCase() === e.key.toLowerCase()
        ) {
          // Released the held key without pressing a second key - toggle single note
          onToggleCell(heldNote.row, heldNote.col);

          // Play note when not playing (preview sound)
          if (!isPlaying) {
            onPlayNote(heldNote.row, currentChannel);
          }

          setHeldNote(null);
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);

      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
      };
    }, [
      keyToGridPosition,
      startRow,
      startCol,
      gridState,
      onToggleCell,
      onSetNote,
      onPlayNote,
      isPlaying,
      currentChannel,
      onTogglePlay,
      onResetPlayhead,
      heldNote,
    ]);

    const handleCellMouseDown = useCallback(
      (
        row: number,
        col: number,
        currentActive: boolean,
        isShiftClick: boolean,
      ) => {
        if (isShiftClick) {
          // Shift-click: find the first note to the left on this row and extend it
          let foundNoteCol = -1;
          for (let c = col - 1; c >= 0; c--) {
            if (gridState[row]?.[c] > 0) {
              foundNoteCol = c;
              break;
            }
          }
          if (foundNoteCol >= 0) {
            // Extend the found note to the current position
            const noteLength = col - foundNoteCol + 1;
            onSetNote(row, foundNoteCol, noteLength);
            dragMode.current = true;
            visitedCells.current.clear();
            visitedCells.current.add(`${row}-${col}`);
            // Play note when not playing (preview sound)
            if (!isPlaying) {
              onPlayNote(row, currentChannel);
            }
            return;
          }
          // No note found to the left, fall through to normal toggle
        }

        // Normal click - toggle single note
        const turningOn = !currentActive;
        dragMode.current = turningOn;
        visitedCells.current.clear();
        visitedCells.current.add(`${row}-${col}`);
        onToggleCell(row, col);
        // Play note when not playing (preview sound)
        if (!isPlaying) {
          onPlayNote(row, currentChannel);
        }
      },
      [
        onToggleCell,
        onSetNote,
        onPlayNote,
        currentChannel,
        isPlaying,
        gridState,
      ],
    );

    const handleCellDragEnter = useCallback(
      (
        row: number,
        col: number,
        currentActive: boolean,
        isShiftDrag: boolean,
      ) => {
        if (dragMode.current === null) return;

        const cellKey = `${row}-${col}`;
        if (visitedCells.current.has(cellKey)) return;

        visitedCells.current.add(cellKey);

        // Shift-drag: find the first note to the left on this row and extend it, or create one
        if (isShiftDrag) {
          let foundNoteCol = -1;
          for (let c = col - 1; c >= 0; c--) {
            if (gridState[row]?.[c] > 0) {
              foundNoteCol = c;
              break;
            }
          }
          if (foundNoteCol >= 0) {
            // Extend existing note
            const noteLength = col - foundNoteCol + 1;
            onSetNote(row, foundNoteCol, noteLength);
          } else {
            // No note found - create a new single note at this position
            onSetNote(row, col, 1);
            // Play note when not playing (preview sound)
            if (!isPlaying) {
              onPlayNote(row, currentChannel);
            }
          }
          return;
        }

        // Normal drag - toggle cells
        if (currentActive !== dragMode.current) {
          onToggleCell(row, col);
          // Play note when not playing (preview sound)
          if (!isPlaying) {
            onPlayNote(row, currentChannel);
          }
        }
      },
      [
        onToggleCell,
        onSetNote,
        onPlayNote,
        currentChannel,
        isPlaying,
        gridState,
      ],
    );

    const handleMouseUp = useCallback(() => {
      dragMode.current = null;
      loopDragStart.current = null;
      visitedCells.current.clear();
    }, []);

    const handleLoopMouseDown = useCallback(
      (col: number) => {
        if (loopSelectionStart === null) {
          // First click - set the start
          setLoopSelectionStart(col);
          loopDragStart.current = col;
          // Set a single-column loop at this position initially
          onSetPatternLoop(currentChannel, currentPattern, col, 1);
        } else {
          // Subsequent click - set the end (can be before start)
          const start = Math.min(loopSelectionStart, col);
          const end = Math.max(loopSelectionStart, col);
          const length = end - start + 1;
          onSetPatternLoop(currentChannel, currentPattern, start, length);
          // Keep loopSelectionStart set so further clicks continue to adjust
          loopDragStart.current = loopSelectionStart;
        }
      },
      [currentChannel, currentPattern, onSetPatternLoop, loopSelectionStart],
    );

    const handleLoopDragEnter = useCallback(
      (col: number) => {
        if (loopDragStart.current === null) return;

        const start = Math.min(loopDragStart.current, col);
        const end = Math.max(loopDragStart.current, col);
        const length = end - start + 1;
        onSetPatternLoop(currentChannel, currentPattern, start, length);
      },
      [currentChannel, currentPattern, onSetPatternLoop],
    );

    return (
      <Box
        css={gridOuterContainerStyles}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <Box css={verticalStripContainerStyles}>
          <TouchStrip
            orientation="vertical"
            value={rowOffset}
            onChange={setRowOffset}
            length={gridHeight}
            thickness={24}
            totalItems={TOTAL_ROWS}
            visibleItems={VISIBLE_ROWS}
            itemSize={buttonSize}
          />
        </Box>
        <Box css={gridInnerContainerStyles}>
          <Box css={gridContainerStyles}>
            {Array.from({ length: VISIBLE_ROWS }, (_, visibleRow) => {
              // Invert so higher notes are at the top of the grid
              const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
              return (
                <Box key={visibleRow} css={rowStyles}>
                  {Array.from({ length: VISIBLE_COLS }, (_, visibleCol) => {
                    const actualCol = startCol + visibleCol;

                    // Calculate shift mode overlay info (even if not in shift mode, for consistent key)
                    const channelIndex = visibleRow;
                    // Pattern index is offset by 1 because column 0 is mute/solo
                    const patternIndex = visibleCol - 1;
                    const shiftColor = CHANNEL_COLORS[channelIndex];
                    const patternsForChannel =
                      allPatternsHaveNotes[channelIndex];
                    const patternHasNotes =
                      patternIndex >= 0 && (patternsForChannel?.[patternIndex] ?? false);
                    const currentPatternForChannel =
                      currentPatterns[channelIndex];
                    const isSelectedPattern =
                      channelIndex === currentChannel &&
                      patternIndex === currentPatternForChannel;
                    const isActivePattern =
                      patternIndex === currentPatternForChannel;
                    const isQueued =
                      patternIndex >= 0 && queuedPatterns[channelIndex] === patternIndex;
                    const isPlayingNow =
                      isActivePattern && channelsPlayingNow[channelIndex];
                    const isPulsing = isQueued && isPulseBeat;
                    const patternsWithNotesCount =
                      patternsForChannel?.filter(Boolean).length ?? 0;
                    const nextEmptyIndex = patternsWithNotesCount;
                    const isNextEmpty =
                      patternIndex >= 0 &&
                      patternIndex === nextEmptyIndex &&
                      patternIndex < (patternsForChannel?.length ?? 0);
                    const shouldShowShiftButton =
                      patternIndex >= 0 && (
                        patternHasNotes ||
                        isSelectedPattern ||
                        isQueued ||
                        isNextEmpty
                      );

                    // Calculate the playhead position within this channel's loop (needed for note highlight)
                    const loopEnd = currentLoop.start + currentLoop.length;
                    const loopedStep =
                      currentStep >= 0
                        ? currentLoop.start +
                          ((((currentStep - currentLoop.start) %
                            currentLoop.length) +
                            currentLoop.length) %
                            currentLoop.length)
                        : -1;

                    // Normal mode pattern info
                    // Check if note starts at this cell
                    const noteAtCell =
                      actualRow < gridState.length &&
                      actualCol < (gridState[actualRow]?.length ?? 0)
                        ? gridState[actualRow][actualCol]
                        : 0;
                    const isNoteStart = noteAtCell > 0;

                    // Check if this cell is within a previous note's length (note continuation)
                    // Also track the note's start and end for "currently playing" highlight
                    let isNoteContinuation = false;
                    let noteStartCol = isNoteStart ? actualCol : -1;
                    let noteEndCol = isNoteStart
                      ? actualCol + noteAtCell - 1
                      : -1;

                    if (!isNoteStart && actualRow < gridState.length) {
                      for (let c = 0; c < actualCol; c++) {
                        const prevNote = gridState[actualRow]?.[c] ?? 0;
                        if (prevNote > 0 && c + prevNote > actualCol) {
                          isNoteContinuation = true;
                          noteStartCol = c;
                          noteEndCol = c + prevNote - 1;
                          break;
                        }
                      }
                    }

                    const isActive = isNoteStart || isNoteContinuation;

                    // Check if the playhead is currently within this note's duration
                    // Only if the note start is within the loop (note must be triggered to play)
                    const noteStartInLoop =
                      noteStartCol >= currentLoop.start &&
                      noteStartCol < loopEnd;
                    const isNoteCurrentlyPlaying =
                      isActive &&
                      noteStartCol >= 0 &&
                      noteStartInLoop &&
                      loopedStep >= noteStartCol &&
                      loopedStep <= noteEndCol;

                    // C notes are at rows 0, 12, 24, 36 (C2, C3, C4, C5)
                    const isCNote = actualRow % 12 === 0;

                    // Dim pattern buttons when ctrl is pressed
                    const isDimmed = metaPressed;

                    // Check if this column is a loop boundary (start or end)
                    const isLoopStart = actualCol === currentLoop.start;
                    const isLoopEnd = actualCol === loopEnd - 1;
                    const isLoopBoundary = isLoopStart || isLoopEnd;

                    // Beat marker for alternating groups of 4 columns (0-3 on, 4-7 off, 8-11 on, etc.)
                    // Only show within the loop region
                    const isInLoop =
                      actualCol >= currentLoop.start && actualCol < loopEnd;
                    const isBeatMarker =
                      isInLoop && Math.floor(actualCol / 4) % 2 === 0;

                    // For grid styling props, we want to show them for:
                    // - Empty cells (not active)
                    // - Off-screen indicators (showOffScreenIndicator)
                    // But NOT for actual notes on screen (isNoteStart or isNoteContinuation)
                    const showGridStyling = !isNoteStart && !isNoteContinuation;

                    // In meta mode, first column shows mute/solo buttons
                    if (metaPressed && visibleCol === 0) {
                      const isMuted = mutedChannels[channelIndex];
                      const isSoloed = soloedChannels[channelIndex];
                      const anySoloed = soloedChannels.some((s) => s);

                      // Color logic:
                      // - Soloed: full channel color
                      // - Muted: very dim (10% opacity)
                      // - Normal (not muted, not soloed when others are soloed): dimmed (30% opacity)
                      // - Normal (not muted, no solos active): medium (50% opacity)
                      let displayColor: string;
                      let glowIntensity: number;

                      if (isSoloed) {
                        // Soloed - full bright
                        displayColor = shiftColor;
                        glowIntensity = 1;
                      } else if (isMuted) {
                        // Muted - very dim
                        displayColor = shiftColor + "1A"; // 10% opacity
                        glowIntensity = 0.1;
                      } else if (anySoloed) {
                        // Not soloed but others are - dim
                        displayColor = shiftColor + "4D"; // 30% opacity
                        glowIntensity = 0.3;
                      } else {
                        // Normal - medium brightness
                        displayColor = shiftColor + "80"; // 50% opacity
                        glowIntensity = 0.5;
                      }

                      const handleMuteClick = () => {
                        if (altPressed) {
                          // Alt+Cmd+click = toggle solo
                          onToggleSolo(channelIndex);
                        } else {
                          // Cmd+click = toggle mute
                          onToggleMute(channelIndex);
                        }
                      };

                      return (
                        <GridButton
                          key={`${visibleRow}-${visibleCol}`}
                          active={true}
                          isPlayhead={isPlayingNow}
                          rowColor={displayColor}
                          glowIntensity={glowIntensity}
                          onToggle={handleMuteClick}
                          onDragEnter={() => {}}
                        />
                      );
                    }

                    // In meta mode, show pattern buttons for all columns (except col 0 which is mute/solo)
                    // For patterns with notes, selected, or queued: show solid button
                    // For empty patterns: show semi-transparent overlay on top of the normal grid cell
                    if (metaPressed && patternIndex >= 0) {
                      const isEmptyPattern = !patternHasNotes && !isSelectedPattern && !isQueued;

                      let displayColor: string;
                      let glowIntensity: number;

                      if (isSelectedPattern) {
                        displayColor = shiftColor;
                        glowIntensity = 1;
                      } else if (isQueued) {
                        const intensity = isPulsing ? 0.7 : 0.35;
                        const hex = Math.round(intensity * 255)
                          .toString(16)
                          .padStart(2, "0");
                        displayColor = shiftColor + hex;
                        glowIntensity = intensity;
                      } else if (patternHasNotes) {
                        displayColor = shiftColor + "B3"; // 70% opacity - brighter for patterns with notes
                        glowIntensity = 0.7;
                      } else {
                        // Empty pattern - very transparent
                        displayColor = shiftColor + "0D"; // ~5% opacity
                        glowIntensity = 0.05;
                      }

                      const handleSelect = () => {
                        // Shift+Cmd+click on empty pattern = copy current pattern
                        if (shiftPressed && isEmptyPattern && channelIndex === currentChannel) {
                          onCopyPattern(patternIndex);
                          onPatternChange(channelIndex, patternIndex);
                          return;
                        }
                        onChannelChange(channelIndex);
                        onPatternChange(channelIndex, patternIndex);
                      };

                      // For empty patterns, show the underlying note with an overlay
                      if (isEmptyPattern) {
                        return (
                          <GridButton
                            key={`${visibleRow}-${visibleCol}`}
                            active={isActive}
                            isPlayhead={actualCol === loopedStep}
                            rowColor={isActive ? channelColor : displayColor}
                            isCNote={isCNote}
                            dimmed={true}
                            glowIntensity={isActive ? 0.15 : glowIntensity}
                            isLoopBoundary={isLoopBoundary && showGridStyling}
                            isBeatMarker={isBeatMarker && showGridStyling && !isLoopBoundary}
                            isInLoop={isInLoop && showGridStyling && !isLoopBoundary && !isBeatMarker}
                            isNoteStart={isNoteStart}
                            isNoteContinuation={isNoteContinuation}
                            isNoteCurrentlyPlaying={isNoteCurrentlyPlaying}
                            onToggle={handleSelect}
                            onDragEnter={() => {}}
                            metaOverlayColor={displayColor}
                          />
                        );
                      }

                      return (
                        <GridButton
                          key={`${visibleRow}-${visibleCol}`}
                          active={true}
                          isPlayhead={isPlayingNow || isPulsing}
                          rowColor={displayColor}
                          glowIntensity={glowIntensity}
                          onToggle={handleSelect}
                          onDragEnter={() => {}}
                        />
                      );
                    }

                    // Check if this is the loop selection start (for visual feedback)
                    const isPendingLoopStart =
                      loopSelectionStart !== null &&
                      actualCol === loopSelectionStart;

                    // Check for off-screen note indicator (only if cell is not already active)
                    const offScreenCount = isActive
                      ? 0
                      : getOffScreenNoteCount(visibleRow, visibleCol);
                    const showOffScreenIndicator = offScreenCount > 0;

                    // Check if any off-screen note is currently playing
                    const offScreenPlaying = showOffScreenIndicator
                      ? isOffScreenNotePlaying(
                          visibleRow,
                          visibleCol,
                          loopedStep,
                          currentLoop.start,
                          loopEnd,
                        )
                      : false;

                    // Off-screen indicators are shown at 20% opacity of the pattern color
                    const offScreenOpacity = 0.2;
                    const offScreenIntensity = showOffScreenIndicator
                      ? offScreenOpacity
                      : 1;

                    // Convert intensity to hex opacity for color
                    const opacityHex = showOffScreenIndicator
                      ? Math.round(offScreenOpacity * 255)
                          .toString(16)
                          .padStart(2, "0")
                      : "";
                    const displayColor = showOffScreenIndicator
                      ? channelColor + opacityHex
                      : channelColor;

                    // Handle click - either loop setting (Alt), shift note length, or normal toggle
                    // Disable when meta is pressed (meta mode shows pattern selector)
                    const handleClick = () => {
                      if (metaPressed) return; // Don't toggle notes in meta mode
                      if (altPressed) {
                        handleLoopMouseDown(actualCol);
                      } else {
                        handleCellMouseDown(
                          actualRow,
                          actualCol,
                          isActive,
                          shiftPressed,
                        );
                      }
                    };

                    return (
                      <GridButton
                        key={`${visibleRow}-${visibleCol}`}
                        active={isActive || showOffScreenIndicator}
                        isPlayhead={actualCol === loopedStep}
                        rowColor={displayColor}
                        isCNote={isCNote}
                        dimmed={isDimmed}
                        glowIntensity={offScreenIntensity}
                        isLoopBoundary={isLoopBoundary && showGridStyling && !metaPressed}
                        isLoopBoundaryPulsing={
                          isLoopBoundary && showGridStyling && altPressed && !metaPressed
                        }
                        isBeatMarker={
                          isBeatMarker && showGridStyling && !isLoopBoundary && !metaPressed
                        }
                        isInLoop={
                          isInLoop &&
                          showGridStyling &&
                          !isLoopBoundary &&
                          !isBeatMarker &&
                          !metaPressed
                        }
                        isPendingLoopStart={isPendingLoopStart && !metaPressed}
                        isNoteStart={isNoteStart && !metaPressed}
                        isNoteContinuation={isNoteContinuation && !metaPressed}
                        isNoteCurrentlyPlaying={isNoteCurrentlyPlaying && !metaPressed}
                        isOffScreenIndicator={showOffScreenIndicator && !metaPressed}
                        isOffScreenPlaying={offScreenPlaying && !metaPressed}
                        onToggle={handleClick}
                        onDragEnter={() => {
                          if (metaPressed) return;
                          if (altPressed) {
                            handleLoopDragEnter(actualCol);
                          } else {
                            handleCellDragEnter(
                              actualRow,
                              actualCol,
                              isActive,
                              shiftPressed,
                            );
                          }
                        }}
                      />
                    );
                  })}
                </Box>
              );
            })}
          </Box>
          <Box css={horizontalStripContainerStyles}>
            <Box css={modifierKeysContainerStyles}>
              <Box
                css={[
                  modifierKeyStyles,
                  shiftPressed && modifierKeyActiveStyles,
                ]}
              >
                shift
              </Box>
              <Box
                css={[modifierKeyStyles, altPressed && modifierKeyActiveStyles]}
              >
                opt
              </Box>
              <Box
                css={[
                  modifierKeyStyles,
                  metaPressed && modifierKeyActiveStyles,
                ]}
              >
                cmd
              </Box>
            </Box>
            <TouchStrip
              orientation="horizontal"
              value={colOffset}
              onChange={setColOffset}
              length={buttonSize * 8}
              thickness={24}
              totalItems={TOTAL_COLS}
              visibleItems={VISIBLE_COLS}
              itemSize={buttonSize}
            />
          </Box>
          <Box css={debugStyles}>
            <span>
              Notes: {startRow} - {endRow}
            </span>
            <span>
              Beats: {startCol} - {endCol}
            </span>
          </Box>
        </Box>
        {/* OLED Screen and Rotary Encoder */}
        <Box css={oledContainerStyles}>
          <Box
            css={css`
              display: flex;
              flex-direction: column;
              align-items: center;
            `}
          >
            <Box css={oledScreenStyles}>
              <Box css={oledRowStyles}>
                <span css={oledLabelStyles}>CH</span>
                <span css={oledValueStyles}>{currentChannel + 1}</span>
              </Box>
              <Box css={oledRowStyles}>
                <span css={oledLabelStyles}>PAT</span>
                <span css={oledValueStyles}>{currentPattern + 1}</span>
              </Box>
              <Box css={oledRowStyles}>
                <span css={oledLabelStyles}>LOOP</span>
                <span css={oledValueStyles}>
                  {currentLoop.start + 1}-
                  {currentLoop.start + currentLoop.length}
                </span>
              </Box>
            </Box>
            {/* Rotary Encoder */}
            <Box css={rotaryEncoderStyles}>
              <Box css={rotaryKnobStyles} />
            </Box>
          </Box>
        </Box>
      </Box>
    );
  },
);

Grid.displayName = "Grid";

export { TOTAL_ROWS as ROWS, TOTAL_COLS as COLS, VISIBLE_ROWS, VISIBLE_COLS };
