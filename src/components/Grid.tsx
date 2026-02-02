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

interface PatternLoop {
  start: number;
  length: number;
}

interface GridProps {
  gridState: GridState;
  currentStep: number;
  onToggleCell: (row: number, col: number) => void;
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
}

export const Grid = memo(
  ({
    gridState,
    currentStep,
    onToggleCell,
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
  }: GridProps) => {
    // Store row offset per channel
    const [rowOffsets, setRowOffsets] = useState<number[]>(() =>
      Array.from({ length: NUM_CHANNELS }, (_, i) => getInitialRowOffset(i)),
    );
    const [colOffset, setColOffset] = useState(0);
    const [shiftPressed, setShiftPressed] = useState(false);
    const [ctrlPressed, setCtrlPressed] = useState(false);
    const [altPressed, setAltPressed] = useState(false);
    const [metaPressed, setMetaPressed] = useState(false);
    const [loopStartClick, setLoopStartClick] = useState<number | null>(null);

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
            if (gridState[row]?.[actualCol]) {
              count++;
            }
          }
        }

        // Check for notes below visible area (lower MIDI notes)
        if (isBottomEdge) {
          for (let row = 0; row < startRow; row++) {
            if (gridState[row]?.[actualCol]) {
              count++;
            }
          }
        }

        // Check for notes to the right of visible area
        if (isRightEdge) {
          for (let col = endCol + 1; col < TOTAL_COLS; col++) {
            if (gridState[actualRow]?.[col]) {
              count++;
            }
          }
        }

        // Check for notes to the left of visible area
        if (isLeftEdge) {
          for (let col = 0; col < startCol; col++) {
            if (gridState[actualRow]?.[col]) {
              count++;
            }
          }
        }

        return count;
      },
      [gridState, startRow, startCol, endRow, endCol],
    );

    // Listen for modifier keys
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Shift") {
          setShiftPressed(true);
        }
        if (e.key === "Control") {
          setCtrlPressed(true);
        }
        if (e.key === "Alt") {
          setAltPressed(true);
        }
        if (e.key === "Meta") {
          setMetaPressed(true);
        }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.key === "Shift") {
          setShiftPressed(false);
        }
        if (e.key === "Control") {
          setCtrlPressed(false);
        }
        if (e.key === "Alt") {
          setAltPressed(false);
          setLoopStartClick(null); // Cancel loop selection when alt is released
        }
        if (e.key === "Meta") {
          setMetaPressed(false);
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);

      return () => {
        window.removeEventListener("keydown", handleKeyDown);
        window.removeEventListener("keyup", handleKeyUp);
      };
    }, []);

    const handleCellMouseDown = useCallback(
      (row: number, col: number, currentActive: boolean) => {
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
      [onToggleCell, onPlayNote, currentChannel, isPlaying],
    );

    const handleCellDragEnter = useCallback(
      (row: number, col: number, currentActive: boolean) => {
        if (dragMode.current === null) return;

        const cellKey = `${row}-${col}`;
        if (visitedCells.current.has(cellKey)) return;

        visitedCells.current.add(cellKey);

        if (currentActive !== dragMode.current) {
          onToggleCell(row, col);
          // Play note when not playing (preview sound)
          if (!isPlaying) {
            onPlayNote(row, currentChannel);
          }
        }
      },
      [onToggleCell, onPlayNote, currentChannel, isPlaying],
    );

    const handleMouseUp = useCallback(() => {
      dragMode.current = null;
      visitedCells.current.clear();
    }, []);

    const handleLoopClick = useCallback(
      (col: number) => {
        if (loopStartClick === null) {
          // First click - set start
          setLoopStartClick(col);
        } else {
          // Second click - set end and create loop
          const start = Math.min(loopStartClick, col);
          const end = Math.max(loopStartClick, col);
          const length = end - start + 1;
          onSetPatternLoop(currentChannel, currentPattern, start, length);
          setLoopStartClick(null);
        }
      },
      [loopStartClick, currentChannel, currentPattern, onSetPatternLoop],
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
                    const patternIndex = visibleCol;
                    const shiftColor = CHANNEL_COLORS[channelIndex];
                    const patternsForChannel =
                      allPatternsHaveNotes[channelIndex];
                    const patternHasNotes =
                      patternsForChannel?.[patternIndex] ?? false;
                    const currentPatternForChannel =
                      currentPatterns[channelIndex];
                    const isSelectedPattern =
                      channelIndex === currentChannel &&
                      patternIndex === currentPatternForChannel;
                    const isActivePattern =
                      patternIndex === currentPatternForChannel;
                    const isQueued =
                      queuedPatterns[channelIndex] === patternIndex;
                    const isPlayingNow =
                      isActivePattern && channelsPlayingNow[channelIndex];
                    const isPulsing = isQueued && isPulseBeat;
                    const patternsWithNotesCount =
                      patternsForChannel?.filter(Boolean).length ?? 0;
                    const nextEmptyIndex = patternsWithNotesCount;
                    const isNextEmpty =
                      patternIndex === nextEmptyIndex &&
                      patternIndex < (patternsForChannel?.length ?? 0);
                    const shouldShowShiftButton =
                      patternHasNotes ||
                      isSelectedPattern ||
                      isQueued ||
                      isNextEmpty;

                    // Normal mode pattern info
                    const isActive =
                      actualRow < gridState.length &&
                      actualCol < (gridState[actualRow]?.length ?? 0) &&
                      gridState[actualRow][actualCol];

                    // C notes are at rows 0, 12, 24, 36 (C2, C3, C4, C5)
                    const isCNote = actualRow % 12 === 0;

                    // Dim pattern buttons when shift is pressed
                    const isDimmed = shiftPressed;

                    // In shift mode with a visible shift button, show that instead
                    if (shiftPressed && shouldShowShiftButton) {
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
                        displayColor = shiftColor + "59";
                        glowIntensity = 0.35;
                      } else {
                        displayColor = shiftColor + "1A";
                        glowIntensity = 0.1;
                      }

                      const handleSelect = () => {
                        onChannelChange(channelIndex);
                        onPatternChange(channelIndex, patternIndex);
                      };

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

                    // Check if this column is a loop boundary (start or end)
                    const loopEnd = currentLoop.start + currentLoop.length;
                    const isLoopStart = actualCol === currentLoop.start;
                    const isLoopEnd = actualCol === loopEnd - 1;
                    const isLoopBoundary = isLoopStart || isLoopEnd;

                    // Beat marker for alternating groups of 4 columns (0-3 on, 4-7 off, 8-11 on, etc.)
                    // Only show within the loop region
                    const isInLoop =
                      actualCol >= currentLoop.start && actualCol < loopEnd;
                    const isBeatMarker =
                      isInLoop && Math.floor(actualCol / 4) % 2 === 0;

                    // Calculate the playhead position within this channel's loop
                    const loopedStep =
                      currentStep >= 0
                        ? currentLoop.start +
                          ((((currentStep - currentLoop.start) %
                            currentLoop.length) +
                            currentLoop.length) %
                            currentLoop.length)
                        : -1;

                    // Check if this is the pending loop start click
                    const isPendingLoopStart =
                      loopStartClick !== null && actualCol === loopStartClick;

                    // Check for off-screen note indicator (only if cell is not already active)
                    const offScreenCount = isActive
                      ? 0
                      : getOffScreenNoteCount(visibleRow, visibleCol);
                    const showOffScreenIndicator = offScreenCount > 0;

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

                    // Handle click - either loop setting (Alt) or normal toggle
                    // Disable when shift is pressed (shift mode shows pattern selector)
                    const handleClick = () => {
                      if (shiftPressed) return; // Don't toggle notes in shift mode
                      if (altPressed) {
                        handleLoopClick(actualCol);
                      } else {
                        handleCellMouseDown(actualRow, actualCol, isActive);
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
                        isLoopBoundary={isLoopBoundary && !isActive}
                        isBeatMarker={
                          isBeatMarker && !isActive && !isLoopBoundary
                        }
                        isPendingLoopStart={isPendingLoopStart}
                        onToggle={handleClick}
                        onDragEnter={() =>
                          !shiftPressed &&
                          !altPressed &&
                          handleCellDragEnter(actualRow, actualCol, isActive)
                        }
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
                css={[
                  modifierKeyStyles,
                  ctrlPressed && modifierKeyActiveStyles,
                ]}
              >
                ctrl
              </Box>
              <Box
                css={[
                  modifierKeyStyles,
                  altPressed && modifierKeyActiveStyles,
                ]}
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
      </Box>
    );
  },
);

Grid.displayName = "Grid";

export { TOTAL_ROWS as ROWS, TOTAL_COLS as COLS, VISIBLE_ROWS, VISIBLE_COLS };
