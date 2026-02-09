import { memo, useCallback, useMemo } from "react";
import { css } from "@emotion/react";
import { Box } from "@mui/material";
import {
  ButtonGrid,
  BUTTON_OFF,
  BUTTON_COLOR_100,
  BUTTON_COLOR_50,
  BUTTON_COLOR_25,
  BUTTON_WHITE_25,
  FLAG_PLAYHEAD,
  FLAG_C_NOTE,
  FLAG_LOOP_BOUNDARY,
  FLAG_BEAT_MARKER,
  FLAG_SELECTED,
  FLAG_CONTINUATION,
  FLAG_PLAYING,
  FLAG_LOOP_BOUNDARY_PULSING,
  FLAG_DIMMED,
} from "../ButtonGrid";
import { TouchStrip } from "../TouchStrip";
import { useGridController } from "../../hooks/useGridController";
import { CHANNEL_COLORS } from "./ChannelColors";
import {
  useSequencerStore,
  VISIBLE_ROWS,
  VISIBLE_COLS,
  ROWS,
  COLS,
} from "../../store/sequencerStore";
import {
  useAllPatternsHaveNotes,
  useChannelsPlayingNow,
  useIsPulseBeat,
  useMutedChannels,
  useSoloedChannels,
  useCurrentPatterns,
  useQueuedPatterns,
  useIsPlaying,
} from "../../store/selectors";
import * as actions from "../../actions";
import {
  getNoteLength,
  getRepeatAmount,
  getRepeatSpace,
  getVelocity,
  getVelocityAtRepeat,
  getVelocityAtRepeatFill,
  getVelocityLoopMode,
  getChanceAtRepeat,
  getTimingOffsetAtRepeat,
  getFlamChanceAtRepeat,
  findNoteAtCell,
} from "../../types/grid";

// Shift a hex color's hue by a given amount (in degrees)
const shiftHue = (hex: string, degrees: number): string => {
  // Parse hex
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  // Shift hue
  h = (((h * 360 + degrees) % 360) + 360) % 360;

  // HSL to RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let rr: number, gg: number, bb: number;
  if (s === 0) {
    rr = gg = bb = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rr = hue2rgb(p, q, h / 360 + 1 / 3);
    gg = hue2rgb(p, q, h / 360);
    bb = hue2rgb(p, q, h / 360 - 1 / 3);
  }

  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`;
};

// Mode hint colors (channel, pattern, loop, volume, chance)
const MODE_HINT_COLORS = ["#33CCFF", "#33FF66", "#FFCC33", "#FF66CC", "#FF6633"] as const;

// Velocity levels for volume mode (8 rows, top to bottom: 127 → 5)
const VELOCITY_LEVELS = [127, 110, 92, 75, 57, 40, 22, 5] as const;

// Chance levels for chance mode (8 rows, top to bottom: 100% → 12%)
const CHANCE_LEVELS = [100, 87, 75, 62, 50, 37, 25, 12] as const;

// Timing offset levels (8 rows, top to bottom: +20% → -20% of step, signed)
const TIMING_LEVELS = [20, 15, 10, 5, -5, -10, -15, -20] as const;

// Flam chance levels (8 rows, top to bottom: probability 100% → 12%)
const FLAM_LEVELS = [100, 87, 75, 62, 50, 37, 25, 12] as const;

// Convert MIDI note number to note name
const midiNoteToName = (midiNote: number): string => {
  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
};

// Styles
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
  width: calc(4 * 44px - 4px);
  height: calc(3 * 44px - 4px);
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

interface GridProps {
  onPlayNote?: (note: number, channel: number, steps?: number) => void;
}

export const Grid = memo(({ onPlayNote }: GridProps) => {
  const controller = useGridController({ onPlayNote });

  // Additional store state for channel mode
  const currentPatterns = useCurrentPatterns();
  const queuedPatterns = useQueuedPatterns();
  const allPatternsHaveNotes = useAllPatternsHaveNotes();
  const channelsPlayingNow = useChannelsPlayingNow();
  const isPulseBeat = useIsPulseBeat();
  const mutedChannels = useMutedChannels();
  const soloedChannels = useSoloedChannels();
  const isPlaying = useIsPlaying();
  const view = useSequencerStore((s) => s.view);

  const {
    keyboard,
    uiMode,
    chanceSubMode,
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
    onCellPress,
    onCellRelease,
    onCellDragEnter,
    onRowOffsetChange,
    onColOffsetChange,
    followWithCamera,
  } = controller;

  const channelColor = CHANNEL_COLORS[currentChannel];
  const rowOffset = view.rowOffsets[currentChannel];

  // Button size for strip calculations
  const buttonSize = 44;
  const gridHeight = VISIBLE_ROWS * buttonSize;

  // Calculate looped step for playhead display
  const loopEnd = currentLoop.start + currentLoop.length;
  const loopedStep =
    currentStep >= 0
      ? currentLoop.start +
        ((((currentStep - currentLoop.start) % currentLoop.length) +
          currentLoop.length) %
          currentLoop.length)
      : -1;

  // Compute button values and color overrides for all modes
  const { buttonValues, colorOverrides } = useMemo(() => {
    // Volume mode with selected note: completely custom grid
    if (uiMode === "volume" && selectedNote) {
      const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
      const repeatAmount = noteValue ? getRepeatAmount(noteValue) : 0;
      const repeatSpace = noteValue ? getRepeatSpace(noteValue) : 1;
      const velocityArrayLength = noteValue ? getVelocity(noteValue).length : 1;
      const velLoopMode = noteValue ? getVelocityLoopMode(noteValue) : "reset";
      const values: number[][] = [];
      const colors: (string | null)[][] = [];

      // Determine which repeat index is currently playing, and which velocity column to highlight
      let playingRepeatIndex = -1;
      let playingVelocityCol = -1;
      if (loopedStep >= 0 && noteValue) {
        for (let r = 0; r < repeatAmount; r++) {
          const stepStart = selectedNote.col + r * repeatSpace;
          const stepEnd = stepStart + getNoteLength(noteValue);
          if (loopedStep >= stepStart && loopedStep < stepEnd) {
            playingRepeatIndex = r;
            if (velLoopMode === "continue") {
              // Continue mode: highlight the velocity array position being read
              const counter = actions.getVelocityContinueCounter(currentChannel, selectedNote.row, selectedNote.col);
              const lastUsed = Math.max(0, counter - 1);
              playingVelocityCol = lastUsed % velocityArrayLength;
            } else {
              // Reset and fill mode: highlight the repeat column that's playing
              playingVelocityCol = r;
            }
            break;
          }
        }
      }

      for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow++) {
        const row: number[] = [];
        const colorRow: (string | null)[] = [];
        const velocityThreshold = VELOCITY_LEVELS[visibleRow];

        for (let visibleCol = 0; visibleCol < VISIBLE_COLS; visibleCol++) {
          // Ctrl mode hints
          if (keyboard.ctrl && visibleRow === 7 && visibleCol <= 4) {
            row.push(BUTTON_COLOR_100);
            colorRow.push(MODE_HINT_COLORS[visibleCol]);
            continue;
          }

          const isPlayingCol = visibleCol === playingVelocityCol;
          const isExplicit = visibleCol < velocityArrayLength;
          const isInRepeatRange = visibleCol < repeatAmount;

          if (!isExplicit && !isInRepeatRange) {
            // Beyond both velocity array and repeat range — dark
            row.push(isPlayingCol ? FLAG_PLAYHEAD : BUTTON_OFF);
          } else {
            const vel = noteValue
              ? (velLoopMode === "fill" ? getVelocityAtRepeatFill(noteValue, visibleCol) : getVelocityAtRepeat(noteValue, visibleCol))
              : 100;
            if (vel >= velocityThreshold) {
              // Explicit = full brightness, looped within repeat range = 50%
              let intensity = isExplicit ? BUTTON_COLOR_100 : BUTTON_COLOR_50;
              if (isPlayingCol) intensity |= FLAG_PLAYING;
              row.push(intensity);
            } else {
              row.push(isPlayingCol ? FLAG_PLAYHEAD : BUTTON_OFF);
            }
          }
          colorRow.push(null);
        }
        values.push(row);
        colors.push(colorRow);
      }

      // Ctrl held: dim everything except mode hints
      if (keyboard.ctrl) {
        for (let r = 0; r < VISIBLE_ROWS; r++) {
          for (let c = 0; c < VISIBLE_COLS; c++) {
            if (r === 7 && c <= 4) continue;
            values[r][c] |= FLAG_DIMMED;
          }
        }
      }

      return { buttonValues: values, colorOverrides: colors };
    }

    // Chance mode with selected note: custom grid (sub-mode aware bar graph)
    if (uiMode === "chance" && selectedNote) {
      const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
      const repeatAmount = noteValue ? getRepeatAmount(noteValue) : 0;
      const repeatSpace = noteValue ? getRepeatSpace(noteValue) : 1;
      const values: number[][] = [];
      const colors: (string | null)[][] = [];

      // Select thresholds and getter based on active sub-mode
      const levels = chanceSubMode === "hit" ? CHANCE_LEVELS
        : chanceSubMode === "timing" ? TIMING_LEVELS
        : FLAM_LEVELS;
      const getValueAtRepeat = chanceSubMode === "hit"
        ? (nv: typeof noteValue, idx: number) => (nv ? getChanceAtRepeat(nv, idx) : 100)
        : chanceSubMode === "timing"
        ? (nv: typeof noteValue, idx: number) => (nv ? getTimingOffsetAtRepeat(nv, idx) : 0)
        : (nv: typeof noteValue, idx: number) => (nv ? getFlamChanceAtRepeat(nv, idx) : 0);

      // Determine which column to highlight as playing
      let playingCol = -1;
      if (loopedStep >= 0 && noteValue) {
        for (let r = 0; r < repeatAmount; r++) {
          const stepStart = selectedNote.col + r * repeatSpace;
          const stepEnd = stepStart + getNoteLength(noteValue);
          if (loopedStep >= stepStart && loopedStep < stepEnd) {
            playingCol = r;
            break;
          }
        }
      }

      for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow++) {
        const row: number[] = [];
        const colorRow: (string | null)[] = [];
        const threshold = levels[visibleRow];

        for (let visibleCol = 0; visibleCol < VISIBLE_COLS; visibleCol++) {
          // Ctrl mode hints
          if (keyboard.ctrl && visibleRow === 7 && visibleCol <= 4) {
            row.push(BUTTON_COLOR_100);
            colorRow.push(MODE_HINT_COLORS[visibleCol]);
            continue;
          }

          if (visibleCol >= repeatAmount) {
            row.push(BUTTON_OFF);
            colorRow.push(null);
            continue;
          }

          const isPlayingColumn = visibleCol === playingCol;
          const val = getValueAtRepeat(noteValue, visibleCol);

          if (chanceSubMode === "timing") {
            // Timing mode: horizontal line — single lit cell at the matching row
            // Find which row this value maps to (exact match or nearest)
            const matchRow = val === 0
              ? -1 // No dot for 0ms (centered, between rows 3 and 4)
              : TIMING_LEVELS.indexOf(val as typeof TIMING_LEVELS[number]);
            // If value matches this row, light it up; also show a dim center line at rows 3-4 boundary
            const isCenterRow = visibleRow === 3 || visibleRow === 4;
            if (matchRow === visibleRow) {
              let intensity = BUTTON_COLOR_100;
              if (isPlayingColumn) intensity |= FLAG_PLAYING;
              row.push(intensity);
            } else if (val === 0 && isCenterRow) {
              // For 0ms offset, show dim dots at center rows to indicate "center"
              let intensity = BUTTON_COLOR_25;
              if (isPlayingColumn) intensity |= FLAG_PLAYING;
              row.push(intensity);
            } else {
              row.push(isPlayingColumn ? FLAG_PLAYHEAD : BUTTON_OFF);
            }
          } else {
            // Bar graph mode (hit, velocity, flam): fill from bottom up
            if (val >= threshold) {
              let intensity = BUTTON_COLOR_100;
              if (isPlayingColumn) intensity |= FLAG_PLAYING;
              row.push(intensity);
            } else {
              row.push(isPlayingColumn ? FLAG_PLAYHEAD : BUTTON_OFF);
            }
          }
          colorRow.push(null);
        }
        values.push(row);
        colors.push(colorRow);
      }

      // Ctrl held: dim everything except mode hints
      if (keyboard.ctrl) {
        for (let r = 0; r < VISIBLE_ROWS; r++) {
          for (let c = 0; c < VISIBLE_COLS; c++) {
            if (r === 7 && c <= 4) continue;
            values[r][c] |= FLAG_DIMMED;
          }
        }
      }

      return { buttonValues: values, colorOverrides: colors };
    }

    const values: number[][] = [];
    const colors: (string | null)[][] = [];
    const anySoloed = soloedChannels.some((s) => s);
    const repeatColor = shiftHue(channelColor, -30);

    for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow++) {
      const row: number[] = [];
      const colorRow: (string | null)[] = [];

      // Always render the note grid as the base layer
      const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);

      for (let visibleCol = 0; visibleCol < VISIBLE_COLS; visibleCol++) {
        const actualCol = startCol + visibleCol;

        let value = BUTTON_OFF;

        // Check for note at this cell
        const noteAtCell = findNoteAtCell(renderedNotes, actualRow, actualCol);

        if (noteAtCell) {
          const isNoteStart = noteAtCell.col === actualCol;
          const noteStartCol = noteAtCell.col;
          const noteEndCol = noteAtCell.col + noteAtCell.length - 1;
          const isNoteCurrentlyPlaying =
            loopedStep >= noteStartCol && loopedStep <= noteEndCol;

          value = BUTTON_COLOR_100;

          if (!isNoteStart) {
            value |= FLAG_CONTINUATION;
          }

          if (isNoteCurrentlyPlaying) {
            value |= FLAG_PLAYING;
          }

          if (
            selectedNote &&
            selectedNote.row === actualRow &&
            selectedNote.col === noteAtCell.sourceCol
          ) {
            value |= FLAG_SELECTED;
          }

          // Repeat notes get a hue-shifted tint (dimmed in channel mode like other note cells)
          if (noteAtCell.isRepeat) {
            colorRow.push(repeatColor);
            if (uiMode === "channel") value |= FLAG_DIMMED;
            row.push(value);
            continue;
          }
        } else {
          // Off-screen note indicators on edge cells
          let offScreen = false;
          let offScreenPlaying = false;
          const isTopEdge = visibleRow === 0;
          const isBottomEdge = visibleRow === VISIBLE_ROWS - 1;
          const isLeftEdge = visibleCol === 0;
          const isRightEdge = visibleCol === VISIBLE_COLS - 1;

          if (isTopEdge || isBottomEdge || isLeftEdge || isRightEdge) {
            for (const note of renderedNotes) {
              // Top edge: notes above visible area at this column
              if (
                isTopEdge &&
                note.row > endRow &&
                note.col <= actualCol &&
                note.col + note.length > actualCol
              ) {
                offScreen = true;
                if (
                  loopedStep >= note.col &&
                  loopedStep < note.col + note.length
                )
                  offScreenPlaying = true;
              }
              // Bottom edge: notes below visible area at this column
              if (
                isBottomEdge &&
                note.row < startRow &&
                note.col <= actualCol &&
                note.col + note.length > actualCol
              ) {
                offScreen = true;
                if (
                  loopedStep >= note.col &&
                  loopedStep < note.col + note.length
                )
                  offScreenPlaying = true;
              }
              // Right edge: notes to the right on this row
              if (isRightEdge && note.row === actualRow && note.col > endCol) {
                offScreen = true;
                if (
                  loopedStep >= note.col &&
                  loopedStep < note.col + note.length
                )
                  offScreenPlaying = true;
              }
              // Left edge: notes to the left on this row (note ends before visible area)
              if (
                isLeftEdge &&
                note.row === actualRow &&
                note.col + note.length <= startCol
              ) {
                offScreen = true;
                if (
                  loopedStep >= note.col &&
                  loopedStep < note.col + note.length
                )
                  offScreenPlaying = true;
              }
              if (offScreen && offScreenPlaying) break; // No need to keep searching
            }
          }

          if (offScreen) {
            value = offScreenPlaying ? BUTTON_COLOR_50 : BUTTON_COLOR_25;
          }

          // Empty cell - add grid markers
          const isInLoop =
            actualCol >= currentLoop.start && actualCol < loopEnd;

          if (isInLoop) {
            if (actualCol === loopedStep) {
              value |= FLAG_PLAYHEAD;
            }

            if (actualCol === currentLoop.start || actualCol === loopEnd - 1) {
              value |= FLAG_LOOP_BOUNDARY;
              if (uiMode === "loop") {
                value |= FLAG_LOOP_BOUNDARY_PULSING;
              }
            } else if (Math.floor(actualCol / 4) % 2 === 0) {
              value |= FLAG_BEAT_MARKER;
            }
          }
        }

        // C note marker
        if (actualRow % 12 === 0) {
          value |= FLAG_C_NOTE;
        }

        // Mode hint on bottom row (Z/X/C/V keys) — only while ctrl is held
        if (keyboard.ctrl && visibleRow === 7 && visibleCol <= 4) {
          value = BUTTON_COLOR_100;
          colorRow.push(MODE_HINT_COLORS[visibleCol]);
          row.push(value);
          continue;
        }

        // Channel mode: overlay channel selector on top of note grid
        if (uiMode === "channel") {
          const channelIndex = visibleRow;
          const chColor = CHANNEL_COLORS[channelIndex];
          const patternsForChannel = allPatternsHaveNotes[channelIndex];
          const currentPatternForChannel = currentPatterns[channelIndex];

          if (visibleCol === 0) {
            // Column 0: mute/solo indicator
            // Soloed = lighter, muted (or non-soloed when solo exists) = darker, normal = standard
            const isMuted = mutedChannels[channelIndex];
            const isSoloed = soloedChannels[channelIndex];
            const isEffectivelyMuted = isMuted || (anySoloed && !isSoloed);
            const isPlayingNow =
              currentPatternForChannel >= 0 && channelsPlayingNow[channelIndex];

            if (isSoloed) {
              value = BUTTON_WHITE_25;
            } else if (isEffectivelyMuted) {
              value = BUTTON_COLOR_25;
            } else {
              value = BUTTON_COLOR_100;
            }
            if (isPlayingNow) value |= FLAG_PLAYHEAD;
            colorRow.push(chColor);
            row.push(value);
            continue;
          }

          const patternIndex = visibleCol - 1;
          const patternHasNotes =
            patternIndex >= 0 && (patternsForChannel?.[patternIndex] ?? false);
          const isSelectedPattern =
            channelIndex === currentChannel &&
            patternIndex === currentPatternForChannel;
          const isActivePattern = patternIndex === currentPatternForChannel;
          const isQueued =
            patternIndex >= 0 && queuedPatterns[channelIndex] === patternIndex;
          const isPlayingNow =
            isActivePattern && channelsPlayingNow[channelIndex];
          const isPulsing = isQueued && isPulseBeat;
          const isEmptyPattern =
            !patternHasNotes && !isSelectedPattern && !isQueued;

          if (!isEmptyPattern) {
            // Non-empty pattern: overlay channel button on top
            const isMuted = mutedChannels[channelIndex];
            const isSoloed = soloedChannels[channelIndex];
            const isEffectivelyMuted = isMuted || (anySoloed && !isSoloed);
            value = BUTTON_COLOR_50;

            if (isSelectedPattern) {
              value = BUTTON_COLOR_100;
            } else if (isQueued) {
              value = isPulsing ? BUTTON_COLOR_100 : BUTTON_COLOR_50;
            }

            // Muted/effectively-muted channels get darker, soloed get lighter
            if (isEffectivelyMuted) {
              value = BUTTON_COLOR_25;
            } else if (isSoloed && !isSelectedPattern) {
              value = BUTTON_WHITE_25;
            }

            if (isPlayingNow || isPulsing) value |= FLAG_PLAYHEAD;
            colorRow.push(chColor);
            row.push(value);
            continue;
          }
          // Empty pattern slot: fall through to show note grid underneath
        }

        colorRow.push(null);
        row.push(value);
      }

      values.push(row);
      colors.push(colorRow);
    }

    // Channel mode: dim cells without channel overlay (note grid base layer)
    if (uiMode === "channel") {
      for (let r = 0; r < VISIBLE_ROWS; r++) {
        for (let c = 0; c < VISIBLE_COLS; c++) {
          if (colors[r][c] !== null) continue; // Has channel overlay, skip
          values[r][c] |= FLAG_DIMMED;
        }
      }
    }

    // Volume/chance mode without selected note: dim the grid (waiting for note selection)
    if ((uiMode === "volume" || uiMode === "chance") && !selectedNote) {
      for (let r = 0; r < VISIBLE_ROWS; r++) {
        for (let c = 0; c < VISIBLE_COLS; c++) {
          values[r][c] |= FLAG_DIMMED;
        }
      }
    }

    // Ctrl held (mode selection): dim everything except mode hint buttons
    if (keyboard.ctrl) {
      for (let r = 0; r < VISIBLE_ROWS; r++) {
        for (let c = 0; c < VISIBLE_COLS; c++) {
          if (r === 7 && c <= 4) continue; // Skip mode hint buttons
          values[r][c] |= FLAG_DIMMED;
        }
      }
    }

    return { buttonValues: values, colorOverrides: colors };
  }, [
    uiMode,
    chanceSubMode,
    renderedNotes,
    startRow,
    startCol,
    endRow,
    endCol,
    currentLoop.start,
    loopEnd,
    loopedStep,
    selectedNote,
    keyboard.ctrl,
    channelColor,
    // Channel mode deps
    allPatternsHaveNotes,
    currentPatterns,
    queuedPatterns,
    channelsPlayingNow,
    isPulseBeat,
    mutedChannels,
    soloedChannels,
    currentChannel,
    // Volume mode deps
    gridState,
  ]);

  // Handle button press from ButtonGrid
  const handleButtonPress = useCallback(
    (visibleRow: number, visibleCol: number) => {
      // Ctrl+click on bottom row cols 0-4: switch UI mode (works in all modes)
      if (keyboard.ctrl && visibleRow === 7 && visibleCol <= 4) {
        const modes: Array<"channel" | "pattern" | "loop" | "volume" | "chance"> = [
          "channel",
          "pattern",
          "loop",
          "volume",
          "chance",
        ];
        actions.setUiMode(modes[visibleCol]);
        return;
      }

      if (uiMode === "channel") {
        const channelIndex = visibleRow;

        if (visibleCol === 0) {
          // Click = toggle mute, Alt+click = toggle solo
          if (keyboard.alt) {
            actions.toggleSolo(channelIndex);
          } else {
            actions.toggleMute(channelIndex);
          }
          return;
        }

        // Pattern selection (cols 1-7)
        const patternIndex = visibleCol - 1;
        const patternsForChannel = allPatternsHaveNotes[channelIndex];
        const currentPatternForChannel = currentPatterns[channelIndex];
        const patternHasNotes =
          patternIndex >= 0 && (patternsForChannel?.[patternIndex] ?? false);
        const isSelectedPattern =
          channelIndex === currentChannel &&
          patternIndex === currentPatternForChannel;
        const isQueued =
          patternIndex >= 0 && queuedPatterns[channelIndex] === patternIndex;
        const isEmptyPattern =
          !patternHasNotes && !isSelectedPattern && !isQueued;

        if (
          keyboard.shift &&
          isEmptyPattern &&
          channelIndex === currentChannel
        ) {
          actions.copyPatternTo(patternIndex);
          actions.setChannelPattern(channelIndex, patternIndex);
        } else {
          actions.setCurrentChannel(channelIndex);
          actions.setChannelPattern(channelIndex, patternIndex);
        }
        actions.setUiMode("pattern");
        return;
      }

      // Volume mode
      if (uiMode === "volume") {
        if (selectedNote) {
          // In velocity editor: click any column to set velocity (expands array if needed)
          const velocity = keyboard.meta ? 0 : VELOCITY_LEVELS[visibleRow];
          actions.setNoteVelocity(selectedNote.row, selectedNote.col, visibleCol, velocity);
        } else {
          // No note selected: click to select a note, then stay in volume mode
          const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
          const actualCol = startCol + visibleCol;
          const noteAtCell = findNoteAtCell(renderedNotes, actualRow, actualCol);
          if (noteAtCell) {
            actions.setSelectedNote({ row: actualRow, col: noteAtCell.sourceCol });
          }
        }
        return;
      }

      // Chance mode (sub-mode aware)
      if (uiMode === "chance") {
        if (selectedNote) {
          const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
          const repeatAmount = noteValue ? getRepeatAmount(noteValue) : 0;
          if (visibleCol < repeatAmount) {
            if (keyboard.meta) {
              // Cmd+click: set to 0
              if (chanceSubMode === "hit") {
                actions.setNoteChance(selectedNote.row, selectedNote.col, visibleCol, 0);
              } else if (chanceSubMode === "timing") {
                actions.setNoteTimingOffset(selectedNote.row, selectedNote.col, visibleCol, 0);
              } else {
                actions.setNoteFlamChance(selectedNote.row, selectedNote.col, visibleCol, 0);
              }
            } else {
              if (chanceSubMode === "hit") {
                actions.setNoteChance(selectedNote.row, selectedNote.col, visibleCol, CHANCE_LEVELS[visibleRow]);
              } else if (chanceSubMode === "timing") {
                actions.setNoteTimingOffset(selectedNote.row, selectedNote.col, visibleCol, TIMING_LEVELS[visibleRow]);
              } else {
                actions.setNoteFlamChance(selectedNote.row, selectedNote.col, visibleCol, FLAM_LEVELS[visibleRow]);
              }
            }
          }
        } else {
          // No note selected: click to select a note
          const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
          const actualCol = startCol + visibleCol;
          const noteAtCell = findNoteAtCell(renderedNotes, actualRow, actualCol);
          if (noteAtCell) {
            actions.setSelectedNote({ row: actualRow, col: noteAtCell.sourceCol });
          }
        }
        return;
      }

      // Loop mode: click sets loop boundaries, no note editing
      if (uiMode === "loop") {
        const actualCol = startCol + visibleCol;
        const loopEndCol = currentLoop.start + currentLoop.length;
        // Shift+click sets loop start, plain click sets loop end
        if (keyboard.shift) {
          const newStart = Math.min(actualCol, loopEndCol - 1);
          const newLength = loopEndCol - newStart;
          actions.setPatternLoop(currentChannel, currentPattern, newStart, newLength);
        } else {
          const newEnd = Math.max(actualCol + 1, currentLoop.start + 1);
          const newLength = newEnd - currentLoop.start;
          actions.setPatternLoop(currentChannel, currentPattern, currentLoop.start, newLength);
        }
        return;
      }

      // Pattern mode: delegate to grid controller
      const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
      const actualCol = startCol + visibleCol;
      onCellPress(actualRow, actualCol);
    },
    [
      keyboard.ctrl,
      keyboard.alt,
      keyboard.shift,
      keyboard.meta,
      uiMode,
      chanceSubMode,
      startRow,
      startCol,
      onCellPress,
      allPatternsHaveNotes,
      currentPatterns,
      queuedPatterns,
      currentChannel,
      currentPattern,
      currentLoop,
      selectedNote,
      gridState,
      renderedNotes,
    ],
  );

  // Handle button drag enter from ButtonGrid
  const handleButtonDragEnter = useCallback(
    (visibleRow: number, visibleCol: number) => {
      if (uiMode === "channel" || uiMode === "volume" || uiMode === "chance") return; // No drag in channel/volume/chance mode
      const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
      const actualCol = startCol + visibleCol;
      onCellDragEnter(actualRow, actualCol);
    },
    [uiMode, startRow, startCol, onCellDragEnter],
  );

  // OLED display content
  type OledValuePart = { text: string; highlight?: boolean };
  type OledRow = { label: string; valueParts: OledValuePart[] };

  const getOledContent = useCallback((): { rows: OledRow[] } => {
    // Pattern mode: show note info if a note is selected
    if (uiMode === "pattern" && selectedNote) {
      const selectedNoteValue = gridState[selectedNote.row]?.[selectedNote.col];
      const selectedNoteLength = selectedNoteValue
        ? getNoteLength(selectedNoteValue)
        : 0;

      if (selectedNoteLength > 0) {
        const noteName = midiNoteToName(selectedNote.row);
        const selectedRepeatAmount = getRepeatAmount(selectedNoteValue);
        const selectedRepeatSpace = getRepeatSpace(selectedNoteValue);
        const highlightLength = keyboard.shift && !keyboard.meta;
        const highlightRepeatAmount = keyboard.meta && !keyboard.shift;
        const highlightRepeatSpace = keyboard.meta && keyboard.shift;

        return {
          rows: [
            { label: "NOTE", valueParts: [{ text: noteName }] },
            {
              label: "LENGTH",
              valueParts: [
                { text: `${selectedNoteLength}`, highlight: highlightLength },
              ],
            },
            {
              label: "REPEAT",
              valueParts: [
                {
                  text: `${selectedRepeatAmount}`,
                  highlight: highlightRepeatAmount,
                },
                { text: "x" },
                {
                  text: `${selectedRepeatSpace}`,
                  highlight: highlightRepeatSpace,
                },
              ],
            },
          ],
        };
      }
    }

    if (uiMode === "volume") {
      if (selectedNote) {
        const noteValue = gridState[selectedNote.row]?.[selectedNote.col];
        const noteName = midiNoteToName(selectedNote.row);
        const loopMode = noteValue ? getVelocityLoopMode(noteValue) : "reset";
        const loopModeLabel = loopMode === "reset" ? "RST" : loopMode === "continue" ? "CNT" : "FIL";
        return {
          rows: [
            { label: "NOTE", valueParts: [{ text: noteName }] },
            { label: "VLOOP", valueParts: [{ text: loopModeLabel, highlight: loopMode === "continue" }] },
            { label: "LEN", valueParts: [{ text: `${noteValue ? getVelocity(noteValue).length : 1}` }] },
          ],
        };
      }
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "VOLUME" }] },
          { label: "", valueParts: [{ text: "SELECT" }] },
          { label: "", valueParts: [{ text: "A NOTE" }] },
        ],
      };
    }

    if (uiMode === "chance") {
      const subModeLabel = chanceSubMode === "hit" ? "HIT"
        : chanceSubMode === "timing" ? "TIME"
        : "FLAM";
      if (selectedNote) {
        const noteName = midiNoteToName(selectedNote.row);
        return {
          rows: [
            { label: "NOTE", valueParts: [{ text: noteName }] },
            { label: "CHANCE", valueParts: [{ text: subModeLabel, highlight: true }] },
            { label: "", valueParts: [{ text: "\u25B2\u25BC to change" }] },
          ],
        };
      }
      return {
        rows: [
          { label: "CHANCE", valueParts: [{ text: subModeLabel, highlight: true }] },
          { label: "", valueParts: [{ text: "SELECT" }] },
          { label: "", valueParts: [{ text: "A NOTE" }] },
        ],
      };
    }

    if (uiMode === "channel") {
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "CHANNEL" }] },
          {
            label: "SELECT",
            valueParts: [{ text: `CH ${currentChannel + 1}` }],
          },
          { label: "PAT", valueParts: [{ text: `${currentPattern + 1}` }] },
        ],
      };
    }

    if (uiMode === "loop") {
      const highlightStart = keyboard.shift;
      const highlightEnd = !keyboard.shift;
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "LOOP" }] },
          {
            label: "START",
            valueParts: [
              { text: `${currentLoop.start + 1}`, highlight: highlightStart },
            ],
          },
          {
            label: "END",
            valueParts: [{ text: `${loopEnd}`, highlight: highlightEnd }],
          },
        ],
      };
    }

    // Pattern mode with shift held
    if (keyboard.shift) {
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "EXTEND" }] },
          { label: "NOTE", valueParts: [{ text: "DRAG" }] },
          { label: "", valueParts: [] },
        ],
      };
    }

    // Default: pattern mode summary
    return {
      rows: [
        { label: "CH", valueParts: [{ text: `${currentChannel + 1}` }] },
        { label: "PAT", valueParts: [{ text: `${currentPattern + 1}` }] },
        {
          label: "LOOP",
          valueParts: [{ text: `${currentLoop.start + 1}-${loopEnd}` }],
        },
      ],
    };
  }, [
    uiMode,
    chanceSubMode,
    selectedNote,
    gridState,
    keyboard,
    currentChannel,
    currentPattern,
    currentLoop,
    loopEnd,
  ]);

  const oledContent = getOledContent();

  // Arrow button handlers
  const handleArrowUp = useCallback(() => {
    if (selectedNote) {
      const noteLength = getNoteLength(
        gridState[selectedNote.row]?.[selectedNote.col],
      );
      if (noteLength > 0) {
        const newRow = Math.min(ROWS - 1, selectedNote.row + 1);
        if (newRow !== selectedNote.row) {
          actions.moveNote(
            selectedNote.row,
            selectedNote.col,
            newRow,
            selectedNote.col,
          );
          actions.setSelectedNote({ row: newRow, col: selectedNote.col });
          if (!isPlaying && onPlayNote) onPlayNote(newRow, currentChannel);
        }
      }
    }
  }, [selectedNote, gridState, isPlaying, onPlayNote, currentChannel]);

  const handleArrowDown = useCallback(() => {
    if (selectedNote) {
      const noteLength = getNoteLength(
        gridState[selectedNote.row]?.[selectedNote.col],
      );
      if (noteLength > 0) {
        const newRow = Math.max(0, selectedNote.row - 1);
        if (newRow !== selectedNote.row) {
          actions.moveNote(
            selectedNote.row,
            selectedNote.col,
            newRow,
            selectedNote.col,
          );
          actions.setSelectedNote({ row: newRow, col: selectedNote.col });
          if (!isPlaying && onPlayNote) onPlayNote(newRow, currentChannel);
        }
      }
    }
  }, [selectedNote, gridState, isPlaying, onPlayNote, currentChannel]);

  const handleArrowLeft = useCallback(() => {
    if (uiMode === "loop") {
      const loopEndVal = currentLoop.start + currentLoop.length;
      const newEnd = Math.max(currentLoop.start + 1, loopEndVal - 1);
      if (newEnd !== loopEndVal) {
        actions.setPatternLoop(
          currentChannel,
          currentPattern,
          currentLoop.start,
          newEnd - currentLoop.start,
        );
        followWithCamera(startRow, newEnd - 1);
      }
      return;
    }
    if (selectedNote) {
      const noteLength = getNoteLength(
        gridState[selectedNote.row]?.[selectedNote.col],
      );
      if (noteLength > 0) {
        const newCol = Math.max(0, selectedNote.col - 1);
        if (newCol !== selectedNote.col) {
          actions.moveNote(
            selectedNote.row,
            selectedNote.col,
            selectedNote.row,
            newCol,
          );
          actions.setSelectedNote({ row: selectedNote.row, col: newCol });
          if (!isPlaying && onPlayNote)
            onPlayNote(selectedNote.row, currentChannel);
        }
      }
    }
  }, [
    uiMode,
    selectedNote,
    gridState,
    isPlaying,
    onPlayNote,
    currentChannel,
    currentLoop,
    currentPattern,
    startRow,
    followWithCamera,
  ]);

  const handleArrowRight = useCallback(() => {
    if (uiMode === "loop") {
      const loopEndVal = currentLoop.start + currentLoop.length;
      const newEnd = Math.min(COLS, loopEndVal + 1);
      if (newEnd !== loopEndVal) {
        actions.setPatternLoop(
          currentChannel,
          currentPattern,
          currentLoop.start,
          newEnd - currentLoop.start,
        );
        followWithCamera(startRow, newEnd - 1);
      }
      return;
    }
    if (selectedNote) {
      const noteLength = getNoteLength(
        gridState[selectedNote.row]?.[selectedNote.col],
      );
      if (noteLength > 0) {
        const newCol = Math.min(COLS - 1, selectedNote.col + 1);
        if (newCol !== selectedNote.col) {
          actions.moveNote(
            selectedNote.row,
            selectedNote.col,
            selectedNote.row,
            newCol,
          );
          actions.setSelectedNote({ row: selectedNote.row, col: newCol });
          if (!isPlaying && onPlayNote)
            onPlayNote(selectedNote.row, currentChannel);
        }
      }
    }
  }, [
    uiMode,
    selectedNote,
    gridState,
    isPlaying,
    onPlayNote,
    currentChannel,
    currentLoop,
    currentPattern,
    startRow,
    followWithCamera,
  ]);

  return (
    <Box css={gridOuterContainerStyles}>
      <Box css={verticalStripContainerStyles}>
        <TouchStrip
          orientation="vertical"
          value={rowOffset}
          onChange={onRowOffsetChange}
          length={gridHeight}
          thickness={24}
          totalItems={ROWS}
          visibleItems={VISIBLE_ROWS}
          itemSize={buttonSize}
        />
      </Box>
      <Box css={gridInnerContainerStyles}>
        <Box css={gridContainerStyles}>
          <ButtonGrid
            values={buttonValues}
            channelColor={channelColor}
            colorOverrides={colorOverrides}
            onPress={handleButtonPress}
            onDragEnter={handleButtonDragEnter}
            onRelease={onCellRelease}
          />
        </Box>
        <Box css={horizontalStripContainerStyles}>
          <Box css={modifierKeysContainerStyles}>
            <Box
              css={[
                modifierKeyStyles,
                keyboard.ctrl && modifierKeyActiveStyles,
              ]}
            >
              ctrl
            </Box>
            <Box
              css={[
                modifierKeyStyles,
                keyboard.shift && modifierKeyActiveStyles,
              ]}
            >
              shift
            </Box>
            <Box
              css={[
                modifierKeyStyles,
                keyboard.meta && modifierKeyActiveStyles,
              ]}
            >
              cmd
            </Box>
          </Box>
          <TouchStrip
            orientation="horizontal"
            value={view.colOffset}
            onChange={onColOffsetChange}
            length={buttonSize * 8}
            thickness={24}
            totalItems={COLS}
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
      {/* OLED Screen and controls */}
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
                      css={
                        part.highlight ? oledHighlightStyles : oledValueStyles
                      }
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
              <Box css={arrowButtonStyles} onClick={handleArrowUp}>
                ▲
              </Box>
            </Box>
            <Box css={arrowButtonRowStyles}>
              <Box css={arrowButtonStyles} onClick={handleArrowLeft}>
                ◀
              </Box>
              <Box css={arrowButtonStyles} onClick={handleArrowDown}>
                ▼
              </Box>
              <Box css={arrowButtonStyles} onClick={handleArrowRight}>
                ▶
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
});

Grid.displayName = "Grid";
