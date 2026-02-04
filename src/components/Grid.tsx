import { memo, useState, useRef, useCallback, useEffect, useMemo } from "react";
import { css } from "@emotion/react";
import { Box } from "@mui/material";
import { GridButton } from "./GridButton";
import { TouchStrip } from "./TouchStrip";
import type { GridState, RenderedNote } from "../types/grid";
import { getNoteLength, getRepeatAmount, getRepeatSpace, renderNotesToArray, findNoteAtCell } from "../types/grid";
import { CHANNEL_COLORS } from "../hooks/useSequencer";
import { renderScrollingText, getMessageWidth } from "../utils/pixelFont";

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

const oledHighlightStyles = css`
  color: #ff0;
  font-size: 12px;
  font-weight: 500;
  text-shadow: 0 0 8px rgba(255, 255, 0, 0.5);
`;

// Convert MIDI note number to note name (e.g., 60 -> "C4")
const midiNoteToName = (midiNote: number): string => {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
};

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

const arrowButtonContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 12px;
  gap: 2px;
`;

const arrowButtonRowStyles = css`
  display: flex;
  gap: 2px;
`;

const arrowButtonStyles = css`
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
  border: 1px solid #333;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.1s ease;
  user-select: none;

  &:hover {
    background: linear-gradient(145deg, #3a3a3a, #2a2a2a);
    color: rgba(255, 255, 255, 0.8);
  }

  &:active {
    background: linear-gradient(145deg, #4a4a4a, #3a3a3a);
    color: rgba(255, 255, 255, 1);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
  }
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
  onPlayNote: (note: number, channel: number, steps?: number) => void;
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
  onMoveNote: (fromRow: number, fromCol: number, toRow: number, toCol: number) => void; // Move a note from one position to another
  onPlaceNote: (row: number, col: number) => void; // Place a note (truncate overlapping notes) when deselected
  onSetNoteRepeatAmount: (row: number, col: number, repeatAmount: number) => void; // Update repeat amount
  onSetNoteRepeatSpace: (row: number, col: number, repeatSpace: number) => void; // Update repeat space
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
    onMoveNote,
    onPlaceNote,
    onSetNoteRepeatAmount,
    onSetNoteRepeatSpace,
  }: GridProps) => {
    // Store row offset per channel
    const [rowOffsets, setRowOffsets] = useState<number[]>(() =>
      Array.from({ length: NUM_CHANNELS }, (_, i) => getInitialRowOffset(i)),
    );
    const [colOffset, setColOffset] = useState(0);
    const [shiftPressed, setShiftPressed] = useState(false);
    const [altPressed, setAltPressed] = useState(false);
    const [ctrlPressed, setCtrlPressed] = useState(false);
    const [metaPressed, setMetaPressed] = useState(false);
    // Scrolling text state
    const [scrollOffset, setScrollOffset] = useState(0);
    const [scrollingTextMessage, setScrollingTextMessage] = useState<string | null>(null);
    const scrollingTextColor = "#00ffff"; // Cyan color for text
    // Selected note state (row, col) - for arrow key movement
    const [selectedNote, setSelectedNote] = useState<{ row: number; col: number } | null>(null);

    // Helper to select a new note - places the old note first (truncates overlapping notes)
    const selectNote = useCallback((newSelection: { row: number; col: number } | null) => {
      setSelectedNote((prevSelection) => {
        // If there was a previously selected note and we're selecting a different note,
        // place the old note (truncate overlapping notes)
        if (prevSelection && (!newSelection ||
            prevSelection.row !== newSelection.row ||
            prevSelection.col !== newSelection.col)) {
          onPlaceNote(prevSelection.row, prevSelection.col);
        }
        return newSelection;
      });
    }, [onPlaceNote]);
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
    // const gridWidth = VISIBLE_COLS * buttonSize;

    // Calculate visible range (accounting for inverted rows)
    const endRow = startRow + VISIBLE_ROWS - 1;
    const endCol = startCol + VISIBLE_COLS - 1;

    // Render all NotePatterns to a flat array of notes (including repeats)
    // Notes are visible everywhere, not just within the loop
    const renderedNotes = useMemo(() => {
      return renderNotesToArray(gridState, TOTAL_COLS);
    }, [gridState]);

    // Check for off-screen notes (using renderedNotes which includes repeats)
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
          for (const note of renderedNotes) {
            if (note.row > endRow && note.col <= actualCol && note.col + note.length > actualCol) {
              count++;
            }
          }
        }

        // Check for notes below visible area (lower MIDI notes)
        if (isBottomEdge) {
          for (const note of renderedNotes) {
            if (note.row < startRow && note.col <= actualCol && note.col + note.length > actualCol) {
              count++;
            }
          }
        }

        // Check for notes to the right of visible area
        if (isRightEdge) {
          for (const note of renderedNotes) {
            if (note.row === actualRow && note.col > endCol) {
              count++;
            }
          }
        }

        // Check for notes to the left of visible area
        if (isLeftEdge) {
          for (const note of renderedNotes) {
            if (note.row === actualRow && note.col + note.length <= startCol) {
              count++;
            }
          }
        }

        return count;
      },
      [renderedNotes, startRow, startCol, endRow, endCol],
    );

    // Check if any off-screen note is currently playing for this edge cell
    // Uses renderedNotes which already includes all repeats
    const isOffScreenNotePlaying = useCallback(
      (
        visibleRow: number,
        visibleCol: number,
        loopedStep: number,
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

        // Helper to check if a rendered note is currently playing
        const isNotePlaying = (note: RenderedNote): boolean => {
          return loopedStep >= note.col && loopedStep < note.col + note.length;
        };

        // Check for playing notes above visible area (higher MIDI notes)
        if (isTopEdge) {
          for (const note of renderedNotes) {
            if (note.row > endRow && note.col <= actualCol && note.col + note.length > actualCol) {
              if (isNotePlaying(note)) return true;
            }
          }
        }

        // Check for playing notes below visible area (lower MIDI notes)
        if (isBottomEdge) {
          for (const note of renderedNotes) {
            if (note.row < startRow && note.col <= actualCol && note.col + note.length > actualCol) {
              if (isNotePlaying(note)) return true;
            }
          }
        }

        // Check for playing notes to the right of visible area
        if (isRightEdge) {
          for (const note of renderedNotes) {
            if (note.row === actualRow && note.col > endCol) {
              if (isNotePlaying(note)) return true;
            }
          }
        }

        // Check for playing notes to the left of visible area
        if (isLeftEdge) {
          for (const note of renderedNotes) {
            if (note.row === actualRow && note.col + note.length <= startCol) {
              if (isNotePlaying(note)) return true;
            }
          }
        }

        return false;
      },
      [renderedNotes, startRow, startCol, endRow, endCol],
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
        if (e.key === "Control") {
          setCtrlPressed(true);
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

        // Handle Cmd+Shift+arrow left/right for changing repeat space
        if (selectedNote && e.metaKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
          const noteLength = getNoteLength(noteValue);
          if (noteLength > 0) {
            const currentRepeatSpace = getRepeatSpace(noteValue);
            let newRepeatSpace = currentRepeatSpace;
            if (e.key === "ArrowLeft") {
              // Decrease repeat space (minimum 1)
              newRepeatSpace = Math.max(1, currentRepeatSpace - 1);
            } else {
              // Increase repeat space (no max, but reasonable limit)
              newRepeatSpace = Math.min(16, currentRepeatSpace + 1);
            }
            if (newRepeatSpace !== currentRepeatSpace) {
              onSetNoteRepeatSpace(selectedNote.row, selectedNote.col, newRepeatSpace);
            }
          }
          return;
        }

        // Handle Cmd+arrow left/right for changing repeat amount
        if (selectedNote && e.metaKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
          const noteLength = getNoteLength(noteValue);
          if (noteLength > 0) {
            const currentRepeatAmount = getRepeatAmount(noteValue);
            let newRepeatAmount = currentRepeatAmount;
            if (e.key === "ArrowLeft") {
              // Decrease repeat amount (minimum 1)
              newRepeatAmount = Math.max(1, currentRepeatAmount - 1);
            } else {
              // Increase repeat amount (reasonable limit)
              newRepeatAmount = Math.min(16, currentRepeatAmount + 1);
            }
            if (newRepeatAmount !== currentRepeatAmount) {
              onSetNoteRepeatAmount(selectedNote.row, selectedNote.col, newRepeatAmount);
            }
          }
          return;
        }

        // Handle shift+arrow left/right for resizing selected note
        if (selectedNote && e.shiftKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
          const noteLength = getNoteLength(noteValue);
          if (noteLength > 0) {
            let newLength = noteLength;
            if (e.key === "ArrowLeft") {
              // Shrink note (minimum length 1)
              newLength = Math.max(1, noteLength - 1);
            } else {
              // Extend note (don't exceed grid bounds, or repeatSpace if repeating)
              const repeatAmount = getRepeatAmount(noteValue);
              let maxLength = TOTAL_COLS - selectedNote.col;
              if (repeatAmount > 1) {
                maxLength = Math.min(maxLength, getRepeatSpace(noteValue));
              }
              newLength = Math.min(maxLength, noteLength + 1);
            }
            if (newLength !== noteLength) {
              onSetNote(selectedNote.row, selectedNote.col, newLength);
              // Preview sound with the new length when not playing
              if (!isPlaying) {
                onPlayNote(selectedNote.row, currentChannel, newLength);
              }
            }
          }
          return;
        }

        // Handle arrow keys for moving selected note (without shift)
        if (selectedNote && !e.shiftKey && !e.metaKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
          if (noteLength > 0) {
            let newRow = selectedNote.row;
            let newCol = selectedNote.col;

            switch (e.key) {
              case "ArrowUp":
                newRow = Math.min(TOTAL_ROWS - 1, selectedNote.row + 1);
                break;
              case "ArrowDown":
                newRow = Math.max(0, selectedNote.row - 1);
                break;
              case "ArrowLeft":
                newCol = Math.max(0, selectedNote.col - 1);
                break;
              case "ArrowRight":
                newCol = Math.min(TOTAL_COLS - 1, selectedNote.col + 1);
                break;
            }

            if (newRow !== selectedNote.row || newCol !== selectedNote.col) {
              onMoveNote(selectedNote.row, selectedNote.col, newRow, newCol);
              setSelectedNote({ row: newRow, col: newCol });

              // Follow the note with the camera if it moves outside visible area
              // Row: check if newRow is outside [startRow, startRow + VISIBLE_ROWS - 1]
              if (newRow < startRow) {
                // Note moved below visible area - scroll down
                const newRowOffset = 1 - (newRow / maxRowOffset);
                setRowOffset(Math.max(0, Math.min(1, newRowOffset)));
              } else if (newRow > startRow + VISIBLE_ROWS - 1) {
                // Note moved above visible area - scroll up
                const newRowOffset = 1 - ((newRow - VISIBLE_ROWS + 1) / maxRowOffset);
                setRowOffset(Math.max(0, Math.min(1, newRowOffset)));
              }

              // Column: check if newCol is outside [startCol, startCol + VISIBLE_COLS - 1]
              if (newCol < startCol) {
                // Note moved left of visible area - scroll left
                const newColOffset = newCol / maxColOffset;
                setColOffset(Math.max(0, Math.min(1, newColOffset)));
              } else if (newCol > startCol + VISIBLE_COLS - 1) {
                // Note moved right of visible area - scroll right
                const newColOffset = (newCol - VISIBLE_COLS + 1) / maxColOffset;
                setColOffset(Math.max(0, Math.min(1, newColOffset)));
              }

              // Play note when moving (preview sound)
              if (!isPlaying) {
                onPlayNote(newRow, currentChannel);
              }
            }
          }
          return;
        }

        // Handle Cmd+key to select note at that position
        if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.repeat) {
          const gridPos = keyToGridPosition(e.key);
          if (gridPos) {
            e.preventDefault();
            const visibleRow = gridPos.row;
            const visibleCol = gridPos.col;
            const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
            const actualCol = startCol + visibleCol;

            // Check if there's a note at this position (using renderedNotes which includes repeats)
            const note = findNoteAtCell(renderedNotes, actualRow, actualCol);
            if (note) {
              // Cmd+key on a note: turn off the NotePattern
              onToggleCell(actualRow, note.sourceCol);
              // Deselect if this was selected
              if (selectedNote && selectedNote.row === actualRow && selectedNote.col === note.sourceCol) {
                setSelectedNote(null);
              }
            }
            return;
          }
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
              // Auto-select the new note (places old note first)
              selectNote({ row: actualRow, col: startColNote });

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
        if (e.key === "Control") {
          setCtrlPressed(false);
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
          const wasActive = getNoteLength(gridState[heldNote.row]?.[heldNote.col]) > 0;
          onToggleCell(heldNote.row, heldNote.col);

          // Auto-select the new note if we just created it (places old note first)
          if (!wasActive) {
            selectNote({ row: heldNote.row, col: heldNote.col });
          }

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
      selectedNote,
      onMoveNote,
      selectNote,
      maxRowOffset,
      maxColOffset,
      setRowOffset,
      setColOffset,
      onSetNoteRepeatAmount,
      onSetNoteRepeatSpace,
      renderedNotes,
    ]);

    // Scrolling text animation when a message is set
    useEffect(() => {
      if (!scrollingTextMessage) return;

      // Start with text off-screen to the right
      setScrollOffset(-VISIBLE_COLS);

      const messageWidth = getMessageWidth(scrollingTextMessage);

      const interval = setInterval(() => {
        setScrollOffset((prev) => {
          const next = prev + 1;
          // Clear message when it has fully scrolled off the left
          if (next >= messageWidth) {
            setScrollingTextMessage(null);
            return 0;
          }
          return next;
        });
      }, 30);

      return () => clearInterval(interval);
    }, [scrollingTextMessage]);

    // Compute scrolling text grid when a message is active
    const scrollingTextGrid = scrollingTextMessage
      ? renderScrollingText(
          scrollingTextMessage,
          scrollOffset,
          VISIBLE_COLS,
          VISIBLE_ROWS,
        )
      : null;

    const handleCellMouseDown = useCallback(
      (
        row: number,
        col: number,
        _currentActive: boolean, // No longer used, kept for interface compatibility
        isShiftClick: boolean,
        isMetaClick: boolean,
      ) => {
        // Find if there's a note at this cell (includes repeats and continuations)
        const noteAtCell = findNoteAtCell(renderedNotes, row, col);

        // Cmd+click on a note: turn off the NotePattern
        if (isMetaClick && noteAtCell) {
          // Delete the source NotePattern
          onToggleCell(row, noteAtCell.sourceCol);
          // Deselect if this was selected
          if (selectedNote && selectedNote.row === row && selectedNote.col === noteAtCell.sourceCol) {
            setSelectedNote(null);
          }
          return;
        }

        // Shift-click: find the first note to the left on this row and extend it
        if (isShiftClick) {
          let foundNoteCol = -1;
          for (let c = col - 1; c >= 0; c--) {
            if (getNoteLength(gridState[row]?.[c]) > 0) {
              foundNoteCol = c;
              break;
            }
          }
          if (foundNoteCol >= 0) {
            // Extend the found note to the current position
            const noteLength = col - foundNoteCol + 1;
            onSetNote(row, foundNoteCol, noteLength);
            selectNote({ row, col: foundNoteCol }); // Auto-select extended note (places old note first)
            dragMode.current = true;
            visitedCells.current.clear();
            visitedCells.current.add(`${row}-${col}`);
            // Play note when not playing (preview sound)
            if (!isPlaying) {
              onPlayNote(row, currentChannel);
            }
            return;
          }
          // No note found to the left, fall through to normal behavior
        }

        // Click on a note (including continuations/repeats): select/deselect
        if (noteAtCell) {
          const sourceCol = noteAtCell.sourceCol;
          // Toggle selection
          if (selectedNote && selectedNote.row === row && selectedNote.col === sourceCol) {
            // Already selected - deselect
            selectNote(null);
          } else {
            // Select this note's source NotePattern
            selectNote({ row, col: sourceCol });
          }
          // Play note when not playing (preview sound)
          if (!isPlaying) {
            onPlayNote(row, currentChannel);
          }
          return;
        }

        // Click on empty space: create a new NotePattern
        dragMode.current = true;
        visitedCells.current.clear();
        visitedCells.current.add(`${row}-${col}`);
        onToggleCell(row, col);
        // Auto-select the new note
        selectNote({ row, col });
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
        selectNote,
        renderedNotes,
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
            if (getNoteLength(gridState[row]?.[c]) > 0) {
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

    // Compute OLED display content based on current state
    // Each value can be an array of parts with individual highlighting
    type OledValuePart = { text: string; highlight?: boolean };
    type OledRow = { label: string; valueParts: OledValuePart[] };

    const getOledContent = (): { rows: OledRow[] } => {
      // Get selected note info if available
      const selectedNoteValue = selectedNote
        ? gridState[selectedNote.row]?.[selectedNote.col]
        : null;
      const selectedNoteLength = selectedNoteValue ? getNoteLength(selectedNoteValue) : 0;
      const selectedRepeatAmount = selectedNoteValue ? getRepeatAmount(selectedNoteValue) : 1;
      const selectedRepeatSpace = selectedNoteValue ? getRepeatSpace(selectedNoteValue) : 4;

      // Modifier key combinations determine the action being shown
      if (selectedNote && selectedNoteLength > 0) {
        // A note is selected - always show Note, Length, Repeat
        // Highlight the specific value being changed based on modifier keys
        const noteName = midiNoteToName(selectedNote.row);

        const highlightLength = shiftPressed && !metaPressed;
        const highlightRepeatAmount = metaPressed && !shiftPressed;
        const highlightRepeatSpace = metaPressed && shiftPressed;

        return {
          rows: [
            { label: "NOTE", valueParts: [{ text: noteName }] },
            { label: "LENGTH", valueParts: [{ text: `${selectedNoteLength}`, highlight: highlightLength }] },
            { label: "REPEAT", valueParts: [
              { text: `${selectedRepeatAmount}`, highlight: highlightRepeatAmount },
              { text: "x" },
              { text: `${selectedRepeatSpace}`, highlight: highlightRepeatSpace },
            ]},
          ],
        };
      }

      // No note selected - show modifier actions or default info
      if (ctrlPressed && altPressed) {
        return {
          rows: [
            { label: "MODE", valueParts: [{ text: "MUTE/SOLO" }] },
            { label: "CH", valueParts: [{ text: `${currentChannel + 1}` }] },
            { label: "", valueParts: [] },
          ],
        };
      } else if (ctrlPressed) {
        return {
          rows: [
            { label: "MODE", valueParts: [{ text: "CHANNEL" }] },
            { label: "SELECT", valueParts: [{ text: `CH ${currentChannel + 1}` }] },
            { label: "", valueParts: [] },
          ],
        };
      } else if (altPressed) {
        return {
          rows: [
            { label: "MODE", valueParts: [{ text: "LOOP" }] },
            { label: "RANGE", valueParts: [{ text: `${currentLoop.start + 1}-${currentLoop.start + currentLoop.length}` }] },
            { label: "", valueParts: [] },
          ],
        };
      } else if (shiftPressed) {
        return {
          rows: [
            { label: "MODE", valueParts: [{ text: "EXTEND" }] },
            { label: "NOTE", valueParts: [{ text: "DRAG" }] },
            { label: "", valueParts: [] },
          ],
        };
      }

      // Default: show channel/pattern/loop info
      return {
        rows: [
          { label: "CH", valueParts: [{ text: `${currentChannel + 1}` }] },
          { label: "PAT", valueParts: [{ text: `${currentPattern + 1}` }] },
          { label: "LOOP", valueParts: [{ text: `${currentLoop.start + 1}-${currentLoop.start + currentLoop.length}` }] },
        ],
      };
    };

    const oledContent = getOledContent();

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
                      patternIndex >= 0 &&
                      (patternsForChannel?.[patternIndex] ?? false);
                    const currentPatternForChannel =
                      currentPatterns[channelIndex];
                    const isSelectedPattern =
                      channelIndex === currentChannel &&
                      patternIndex === currentPatternForChannel;
                    const isActivePattern =
                      patternIndex === currentPatternForChannel;
                    const isQueued =
                      patternIndex >= 0 &&
                      queuedPatterns[channelIndex] === patternIndex;
                    const isPlayingNow =
                      isActivePattern && channelsPlayingNow[channelIndex];
                    const isPulsing = isQueued && isPulseBeat;

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
                    // Find if there's a rendered note at this cell (includes repeats)
                    const noteAtCell = findNoteAtCell(renderedNotes, actualRow, actualCol);
                    const isActive = noteAtCell !== null;
                    const isNoteStart = noteAtCell !== null && noteAtCell.col === actualCol;
                    const isNoteContinuation = noteAtCell !== null && noteAtCell.col < actualCol;
                    const isRepeatNote = noteAtCell !== null && noteAtCell.isRepeat;
                    const sourceNoteCol = noteAtCell?.sourceCol ?? -1;
                    const noteStartCol = noteAtCell?.col ?? -1;
                    const noteEndCol = noteAtCell ? noteAtCell.col + noteAtCell.length - 1 : -1;

                    // Check if the playhead is currently within this note's duration
                    const isNoteCurrentlyPlaying =
                      isActive &&
                      loopedStep >= noteStartCol &&
                      loopedStep <= noteEndCol;

                    // C notes are at rows 0, 12, 24, 36 (C2, C3, C4, C5)
                    const isCNote = actualRow % 12 === 0;

                    // Dim pattern buttons when ctrl is pressed
                    const isDimmed = ctrlPressed;

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
                    // But NOT for actual notes on screen (isNoteStart, isNoteContinuation, or isRepeatNote)
                    const showGridStyling = !isNoteStart && !isNoteContinuation && !isRepeatNote;

                    // Check if this cell is part of the selected note
                    // For repeats, check if the source note (parent NotePattern) is selected
                    const isCellSelected = selectedNote !== null &&
                      selectedNote.row === actualRow &&
                      noteAtCell !== null &&
                      selectedNote.col === sourceNoteCol;

                    // Scrolling text mode - takes priority over everything
                    if (scrollingTextGrid) {
                      const isTextPixel =
                        scrollingTextGrid[visibleRow]?.[visibleCol] ?? false;
                      return (
                        <GridButton
                          key={`${visibleRow}-${visibleCol}`}
                          active={isTextPixel}
                          isPlayhead={false}
                          rowColor={scrollingTextColor}
                          glowIntensity={isTextPixel ? 1 : 0}
                          disableTransition
                          onToggle={() => {}}
                          onDragEnter={() => {}}
                        />
                      );
                    }

                    // In meta mode, first column shows mute/solo buttons
                    if (ctrlPressed && visibleCol === 0) {
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
                    if (ctrlPressed && patternIndex >= 0) {
                      const isEmptyPattern =
                        !patternHasNotes && !isSelectedPattern && !isQueued;

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
                        if (
                          shiftPressed &&
                          isEmptyPattern &&
                          channelIndex === currentChannel
                        ) {
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
                            isBeatMarker={
                              isBeatMarker && showGridStyling && !isLoopBoundary
                            }
                            isInLoop={
                              isInLoop &&
                              showGridStyling &&
                              !isLoopBoundary &&
                              !isBeatMarker
                            }
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
                      if (ctrlPressed) return; // Don't toggle notes in ctrl mode
                      if (altPressed) {
                        handleLoopMouseDown(actualCol);
                      } else {
                        handleCellMouseDown(
                          actualRow,
                          actualCol,
                          isActive,
                          shiftPressed,
                          metaPressed,
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
                        isLoopBoundary={
                          isLoopBoundary && showGridStyling && !ctrlPressed
                        }
                        isLoopBoundaryPulsing={
                          isLoopBoundary &&
                          showGridStyling &&
                          altPressed &&
                          !ctrlPressed
                        }
                        isBeatMarker={
                          isBeatMarker &&
                          showGridStyling &&
                          !isLoopBoundary &&
                          !ctrlPressed
                        }
                        isInLoop={
                          isInLoop &&
                          showGridStyling &&
                          !isLoopBoundary &&
                          !isBeatMarker &&
                          !ctrlPressed
                        }
                        isPendingLoopStart={isPendingLoopStart && !ctrlPressed}
                        isNoteStart={isNoteStart && !ctrlPressed}
                        isNoteContinuation={isNoteContinuation && !ctrlPressed}
                        isNoteCurrentlyPlaying={
                          isNoteCurrentlyPlaying && !ctrlPressed
                        }
                        isOffScreenIndicator={
                          showOffScreenIndicator && !ctrlPressed
                        }
                        isOffScreenPlaying={offScreenPlaying && !ctrlPressed}
                        isSelected={isCellSelected && !ctrlPressed}
                        onToggle={handleClick}
                        onDragEnter={() => {
                          if (ctrlPressed) return;
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
                css={[
                  modifierKeyStyles,
                  ctrlPressed && modifierKeyActiveStyles,
                ]}
              >
                ctrl
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
              {oledContent.rows.map((row, index) => (
                <Box key={index} css={oledRowStyles}>
                  <span css={oledLabelStyles}>{row.label}</span>
                  <span>
                    {row.valueParts.map((part, partIndex) => (
                      <span
                        key={partIndex}
                        css={part.highlight ? oledHighlightStyles : oledValueStyles}
                      >
                        {part.text}
                      </span>
                    ))}
                  </span>
                </Box>
              ))}
            </Box>
            {/* Rotary Encoder */}
            <Box css={rotaryEncoderStyles}>
              <Box css={rotaryKnobStyles} />
            </Box>
            {/* Arrow Keys */}
            <Box css={arrowButtonContainerStyles}>
              <Box css={arrowButtonRowStyles}>
                <Box
                  css={arrowButtonStyles}
                  onClick={() => {
                    if (selectedNote) {
                      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
                      if (noteLength > 0) {
                        const newRow = Math.min(TOTAL_ROWS - 1, selectedNote.row + 1);
                        if (newRow !== selectedNote.row) {
                          onMoveNote(selectedNote.row, selectedNote.col, newRow, selectedNote.col);
                          setSelectedNote({ row: newRow, col: selectedNote.col });
                          if (!isPlaying) onPlayNote(newRow, currentChannel);
                        }
                      }
                    }
                  }}
                >
                  ▲
                </Box>
              </Box>
              <Box css={arrowButtonRowStyles}>
                <Box
                  css={arrowButtonStyles}
                  onClick={() => {
                    if (selectedNote) {
                      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
                      if (noteLength > 0) {
                        const newCol = Math.max(0, selectedNote.col - 1);
                        if (newCol !== selectedNote.col) {
                          onMoveNote(selectedNote.row, selectedNote.col, selectedNote.row, newCol);
                          setSelectedNote({ row: selectedNote.row, col: newCol });
                          if (!isPlaying) onPlayNote(selectedNote.row, currentChannel);
                        }
                      }
                    }
                  }}
                >
                  ◀
                </Box>
                <Box
                  css={arrowButtonStyles}
                  onClick={() => {
                    if (selectedNote) {
                      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
                      if (noteLength > 0) {
                        const newRow = Math.max(0, selectedNote.row - 1);
                        if (newRow !== selectedNote.row) {
                          onMoveNote(selectedNote.row, selectedNote.col, newRow, selectedNote.col);
                          setSelectedNote({ row: newRow, col: selectedNote.col });
                          if (!isPlaying) onPlayNote(newRow, currentChannel);
                        }
                      }
                    }
                  }}
                >
                  ▼
                </Box>
                <Box
                  css={arrowButtonStyles}
                  onClick={() => {
                    if (selectedNote) {
                      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
                      if (noteLength > 0) {
                        const newCol = Math.min(TOTAL_COLS - 1, selectedNote.col + 1);
                        if (newCol !== selectedNote.col) {
                          onMoveNote(selectedNote.row, selectedNote.col, selectedNote.row, newCol);
                          setSelectedNote({ row: selectedNote.row, col: newCol });
                          if (!isPlaying) onPlayNote(selectedNote.row, currentChannel);
                        }
                      }
                    }
                  }}
                >
                  ▶
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  },
);

Grid.displayName = "Grid";

export { TOTAL_ROWS as ROWS, TOTAL_COLS as COLS, VISIBLE_ROWS, VISIBLE_COLS };
