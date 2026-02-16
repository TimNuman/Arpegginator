import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
  type UiMode,
} from "../../store/sequencerStore";
import {
  useAllPatternsHaveNotes,
  useChannelsPlayingNow,
  useIsPulseBeat,
  useMutedChannels,
  useSoloedChannels,
  useCurrentPatterns,
  useQueuedPatterns,
} from "../../store/selectors";
import * as actions from "../../actions";
import {
  findEventsInRange,
  findEventById,
  getEventSubModeLoopMode,
  getEventSubModeValueAtRepeat,
  getEventSubModeValueAtRepeatFill,
  getEventSubModeArrayLength,
  TICKS_PER_QUARTER,
  type ModifySubMode,
} from "../../types/event";
import { SCALES, NOTE_NAMES, noteToMidi } from "../../types/scales";
import { getDrumName } from "../../types/drums";

const noop = () => {};

// Mode hint colors (channel, pattern, loop, modify)
const MODE_HINT_COLORS = ["#33CCFF", "#33FF66", "#FFCC33", "#FF6633"] as const;

// Configuration for each modify sub-mode
const SUB_MODE_CONFIG: Record<
  ModifySubMode,
  {
    label: string;
    renderStyle: "bar" | "offset";
    min: number;
    max: number;
    step: number;
  }
> = {
  velocity: { label: "VEL", renderStyle: "bar", min: 7, max: 127, step: 15 },
  hit: { label: "HIT", renderStyle: "bar", min: 12, max: 100, step: 12 },
  timing: { label: "TIME", renderStyle: "offset", min: -50, max: 50, step: 5 },
  flam: { label: "FLAM", renderStyle: "bar", min: 12, max: 100, step: 12 },
  modulate: { label: "MOD", renderStyle: "offset", min: -12, max: 12, step: 1 },
};

// Generate all levels for a sub-mode config (high to low)
function generateLevels(config: {
  renderStyle: string;
  min: number;
  max: number;
  step: number;
}): number[] {
  const levels: number[] = [];
  for (let v = config.max; v >= config.min; v -= config.step) {
    if (config.renderStyle === "offset" && v === 0) continue;
    levels.push(v);
  }
  return levels;
}

// Compute default scroll position (centered on 0 for offset, top for bar)
function getDefaultScroll(allLevels: number[], renderStyle: string): number {
  if (renderStyle !== "offset" || allLevels.length <= VISIBLE_ROWS) return 0;
  const maxScrollOffset = allLevels.length - VISIBLE_ROWS;
  // Center on 0-crossing
  const zeroIndex = allLevels.findIndex((v) => v < 0);
  const defaultIndex = Math.max(
    0,
    Math.min(maxScrollOffset, zeroIndex - Math.floor(VISIBLE_ROWS / 2)),
  );
  return maxScrollOffset > 0 ? defaultIndex / maxScrollOffset : 0;
}

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

// Convert tick value to subdivision-relative display string
const ticksToDisplay = (ticks: number, ticksPerCol: number): string => {
  const cols = ticks / ticksPerCol;
  if (cols === Math.floor(cols)) return `${cols}`;
  return cols.toFixed(1);
};

// Convert tick position to beat.subdivision display
const tickToBeatDisplay = (tick: number): string => {
  const beat = Math.floor(tick / TICKS_PER_QUARTER) + 1;
  const subTick = tick % TICKS_PER_QUARTER;
  if (subTick === 0) return `${beat}`;
  const sixteenth = Math.floor(subTick / (TICKS_PER_QUARTER / 4)) + 1;
  return `${beat}.${sixteenth}`;
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
  onPlayNote?: (note: number, channel: number, lengthTicks?: number) => void;
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
  const view = useSequencerStore((s) => s.view);
  const scaleRoot = useSequencerStore((s) => s.scaleRoot);
  const scaleId = useSequencerStore((s) => s.scaleId);

  const {
    commands,
    keyboard,
    uiMode,
    modifySubMode,
    startRow,
    endRow,
    selectedNoteId,
    renderedNotes,
    currentLoop,
    currentTick,
    currentChannel,
    currentPattern,
    patternData,
    zoom,
    ticksPerCol,
    startTick,
    totalCols,
    totalRows,
    scaleMapping,
    isDrumChannel,
    gridPressRef,
    onRowOffsetChange,
    onColOffsetChange,
    onScrub,
    onScrubEnd,
  } = controller;

  const channelColor = CHANNEL_COLORS[currentChannel];
  const rowOffset = view.rowOffsets[currentChannel];

  // Button size for strip calculations
  const buttonSize = 44;
  const gridHeight = VISIBLE_ROWS * buttonSize;

  // Calculate looped tick for playhead display
  const loopEndTick = currentLoop.start + currentLoop.length;
  const loopedTick =
    currentTick >= 0
      ? currentLoop.start +
        ((((currentTick - currentLoop.start) % currentLoop.length) +
          currentLoop.length) %
          currentLoop.length)
      : -1;

  // Resolve selected event from patternData
  const selectedEvent = useMemo(
    () => selectedNoteId ? findEventById(patternData.events, selectedNoteId) ?? null : null,
    [selectedNoteId, patternData.events],
  );

  // Compute all levels for current sub-mode
  const modifyConfig = SUB_MODE_CONFIG[modifySubMode];
  const allLevels = useMemo(() => generateLevels(modifyConfig), [modifyConfig]);

  // Scroll state for modify mode value scrolling
  const [modifyScroll, setModifyScroll] = useState(() =>
    getDefaultScroll(allLevels, modifyConfig.renderStyle),
  );

  // Reset scroll when sub-mode changes
  useEffect(() => {
    setModifyScroll(getDefaultScroll(allLevels, modifyConfig.renderStyle));
  }, [allLevels, modifyConfig.renderStyle]);

  // Compute visible levels based on scroll position
  const needsModifyScroll = allLevels.length > VISIBLE_ROWS;
  const visibleLevels = useMemo(() => {
    if (!needsModifyScroll) return allLevels;
    const maxScrollOffset = allLevels.length - VISIBLE_ROWS;
    const scrollIndex = Math.round(modifyScroll * maxScrollOffset);
    return allLevels.slice(scrollIndex, scrollIndex + VISIBLE_ROWS);
  }, [allLevels, needsModifyScroll, modifyScroll]);

  // Apply modulate preview offsets to rendered notes
  const displayNotes = useMemo(() => {
    const isPlayback = loopedTick >= 0;
    if (!isPlayback) return renderedNotes;
    let changed = false;
    const adjusted = renderedNotes.map((note) => {
      const modPreview = actions.getSubModePreview(
        "modulate",
        currentChannel,
        note.sourceId,
        note.position,
      );
      if (modPreview !== undefined) {
        const minBound = isDrumChannel ? 0 : scaleMapping.minRow;
        const maxBound = isDrumChannel ? 127 : scaleMapping.maxRow;
        const displayRow = Math.max(minBound, Math.min(maxBound, note.sourceRow + modPreview + note.chordOffset));
        if (displayRow !== note.row) {
          changed = true;
          return { ...note, row: displayRow };
        }
      }
      return note;
    });
    return changed ? adjusted : renderedNotes;
  }, [renderedNotes, loopedTick, currentChannel, scaleMapping.minRow, scaleMapping.maxRow, isDrumChannel]);

  // Compute button values and color overrides for all modes
  const { buttonValues, colorOverrides } = useMemo(() => {
    // Modify mode (all sub-modes) with selected note
    if (uiMode === "modify" && selectedEvent) {
      const repeatAmount = selectedEvent.repeatAmount;
      const repeatSpace = selectedEvent.repeatSpace;
      const arrayLength = getEventSubModeArrayLength(selectedEvent, modifySubMode);
      const loopMode = getEventSubModeLoopMode(selectedEvent, modifySubMode);
      const config = SUB_MODE_CONFIG[modifySubMode];
      const { renderStyle } = config;
      const values: number[][] = [];
      const colors: (string | null)[][] = [];

      // Detect center line rows (where sign transitions from + to -)
      const centerRows = new Set<number>();
      if (renderStyle === "offset") {
        for (let i = 0; i < visibleLevels.length - 1; i++) {
          if (visibleLevels[i] > 0 && visibleLevels[i + 1] < 0) {
            centerRows.add(i);
            centerRows.add(i + 1);
          }
        }
      }

      // Value getter with fill-mode support
      const getValueAtIndex = (idx: number): number => {
        return loopMode === "fill"
          ? getEventSubModeValueAtRepeatFill(selectedEvent, modifySubMode, idx)
          : getEventSubModeValueAtRepeat(selectedEvent, modifySubMode, idx);
      };

      // Determine which column to highlight as playing
      let playingCol = -1;
      if (loopedTick >= 0) {
        for (let r = 0; r < repeatAmount; r++) {
          const tickStart = selectedEvent.position + r * repeatSpace;
          const tickEnd = tickStart + selectedEvent.length;
          if (loopedTick >= tickStart && loopedTick < tickEnd) {
            if (loopMode === "continue") {
              const counter = actions.getContinueCounter(
                modifySubMode,
                currentChannel,
                selectedEvent.id,
              );
              const lastUsed = Math.max(0, counter - 1);
              playingCol = lastUsed % arrayLength;
            } else {
              playingCol = r;
            }
            break;
          }
        }
      }

      for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow++) {
        const row: number[] = [];
        const colorRow: (string | null)[] = [];
        const threshold = visibleLevels[visibleRow];

        for (let visibleCol = 0; visibleCol < VISIBLE_COLS; visibleCol++) {
          // Ctrl mode hints on bottom row — always rendered on top
          if (keyboard.ctrl && visibleRow === 7 && visibleCol <= 3) {
            const modes: UiMode[] = ["channel", "pattern", "loop", "modify"];
            const isCurrentMode = uiMode === modes[visibleCol];
            row.push(isCurrentMode ? BUTTON_COLOR_50 : BUTTON_COLOR_100);
            colorRow.push(MODE_HINT_COLORS[visibleCol]);
            continue;
          }

          const isPlayingCol = visibleCol === playingCol;
          const isExplicit = visibleCol < arrayLength;
          const isInRepeatRange = visibleCol < repeatAmount;

          if (!isExplicit && !isInRepeatRange) {
            row.push(isPlayingCol ? FLAG_PLAYHEAD : BUTTON_OFF);
            colorRow.push(null);
            continue;
          }

          const val = getValueAtIndex(visibleCol);

          if (renderStyle === "offset") {
            // Horizontal line mode — single lit cell at the matching row
            const matchRow = val === 0 ? -1 : visibleLevels.indexOf(val);
            const isCenterRow = centerRows.has(visibleRow);
            if (matchRow === visibleRow) {
              let intensity = isExplicit ? BUTTON_COLOR_100 : BUTTON_COLOR_50;
              if (isPlayingCol) intensity |= FLAG_PLAYING;
              row.push(intensity);
            } else if (isCenterRow) {
              let intensity = BUTTON_COLOR_25;
              if (isPlayingCol) intensity |= FLAG_PLAYING;
              row.push(intensity);
            } else {
              row.push(isPlayingCol ? FLAG_PLAYHEAD : BUTTON_OFF);
            }
          } else {
            // Bar graph mode: fill from bottom up
            if (val >= threshold) {
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
            if (r === 7 && c <= 3) continue;
            values[r][c] |= FLAG_DIMMED;
          }
        }
      }

      return { buttonValues: values, colorOverrides: colors };
    }

    const values: number[][] = [];
    const colors: (string | null)[][] = [];
    const anySoloed = soloedChannels.some((s) => s);
    const repeatColor = channelColor;

    for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow++) {
      const row: number[] = [];
      const colorRow: (string | null)[] = [];

      // Always render the note grid as the base layer
      const flippedVisibleRow = VISIBLE_ROWS - 1 - visibleRow;
      const actualRow = startRow + flippedVisibleRow;

      for (let visibleCol = 0; visibleCol < VISIBLE_COLS; visibleCol++) {
        // Ctrl mode hints on bottom row — always rendered on top
        if (keyboard.ctrl && visibleRow === 7 && visibleCol <= 3) {
          const modes: UiMode[] = ["channel", "pattern", "loop", "modify"];
          const isCurrentMode = uiMode === modes[visibleCol];
          row.push(isCurrentMode ? BUTTON_COLOR_50 : BUTTON_COLOR_100);
          colorRow.push(MODE_HINT_COLORS[visibleCol]);
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
            const isMuted = mutedChannels[channelIndex];
            const isSoloed = soloedChannels[channelIndex];
            const isEffectivelyMuted = isMuted || (anySoloed && !isSoloed);
            const isPlayingNow =
              currentPatternForChannel >= 0 && channelsPlayingNow[channelIndex];

            let chValue: number;
            if (isSoloed) {
              chValue = BUTTON_WHITE_25;
            } else if (isEffectivelyMuted) {
              chValue = BUTTON_COLOR_25;
            } else {
              chValue = BUTTON_COLOR_100;
            }
            if (isPlayingNow) chValue |= FLAG_PLAYHEAD;
            colorRow.push(chColor);
            row.push(chValue);
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
            !patternHasNotes && !isQueued;

          if (!isEmptyPattern) {
            const isMuted = mutedChannels[channelIndex];
            const isSoloed = soloedChannels[channelIndex];
            const isEffectivelyMuted = isMuted || (anySoloed && !isSoloed);
            let chValue = BUTTON_COLOR_50;

            if (isSelectedPattern) {
              chValue = BUTTON_COLOR_100;
            } else if (isQueued) {
              chValue = isPulsing ? BUTTON_COLOR_100 : BUTTON_COLOR_50;
            }

            if (isEffectivelyMuted) {
              chValue = BUTTON_COLOR_25;
            } else if (isSoloed && !isSelectedPattern) {
              chValue = BUTTON_WHITE_25;
            }

            if (isPlayingNow || isPulsing) chValue |= FLAG_PLAYHEAD;
            colorRow.push(chColor);
            row.push(chValue);
            continue;
          }
          // Empty pattern slot: fall through to show note grid underneath
        }

        const actualTick = startTick + visibleCol * ticksPerCol;

        let value = BUTTON_OFF;

        // Find all notes overlapping this column's tick range
        const colEndTick = actualTick + ticksPerCol;
        const notesInCol = findEventsInRange(displayNotes, actualRow, actualTick, colEndTick);

        if (notesInCol.length > 0) {
          // Pick the primary note for display: prefer a note that starts in this column
          // over a continuation from a previous column (so hits render as bright, not medium)
          const noteStartingHere = notesInCol.find(
            (n) => n.position >= actualTick && n.position < colEndTick
          );
          const noteAtTick = noteStartingHere ?? notesInCol.reduce((best, n) =>
            n.position < best.position ? n : best
          );
          const isNoteStart = noteAtTick.position >= actualTick && noteAtTick.position < colEndTick;
          const noteStartTick = noteAtTick.position;

          // Check if ANY note in this column is currently playing
          let isNoteCurrentlyPlaying = false;
          for (const n of notesInCol) {
            const nEnd = n.position + n.length;
            if (loopedTick >= n.position && loopedTick < nEnd &&
                actions.isNoteActive(currentChannel, n.sourceId, loopedTick)) {
              isNoteCurrentlyPlaying = true;
              break;
            }
          }

          // Determine brightness from hit chance
          const preview = actions.getHitChancePreview(
            currentChannel,
            noteAtTick.sourceId,
            noteStartTick,
          );
          if (preview !== undefined) {
            // Playing: use pre-computed preview
            value =
              preview >= 75
                ? BUTTON_COLOR_100
                : preview >= 50
                  ? BUTTON_COLOR_50
                  : BUTTON_COLOR_25;
          } else {
            // Not playing: static brightness from event data
            const sourceEvent = findEventById(patternData.events, noteAtTick.sourceId);
            const hitChance = sourceEvent
              ? getEventSubModeValueAtRepeat(sourceEvent, "hit", noteAtTick.repeatIndex)
              : 100;
            value =
              hitChance >= 75
                ? BUTTON_COLOR_100
                : hitChance >= 50
                  ? BUTTON_COLOR_50
                  : BUTTON_COLOR_25;
          }

          if (!isNoteStart) {
            value |= FLAG_CONTINUATION;
          }

          if (isNoteCurrentlyPlaying) {
            value |= FLAG_PLAYING;
          }

          if (selectedNoteId && selectedNoteId === noteAtTick.sourceId) {
            value |= FLAG_SELECTED;
          }

          // Compute velocity-based white mix (use preview if playing, static otherwise)
          const velPreview = actions.getSubModePreview(
            "velocity",
            currentChannel,
            noteAtTick.sourceId,
            noteStartTick,
          );
          let velocity: number;
          if (velPreview !== undefined) {
            velocity = velPreview;
          } else {
            const sourceEvent = findEventById(patternData.events, noteAtTick.sourceId);
            velocity = sourceEvent
              ? getEventSubModeValueAtRepeat(sourceEvent, "velocity", noteAtTick.repeatIndex)
              : 100;
          }
          // Map velocity (7-127) to white mix: 7→0.3, 127→0
          const whiteMix = (1 - (velocity - 7) / 120) * 0.3;
          const baseHex = noteAtTick.isRepeat ? repeatColor : channelColor;
          const rr = parseInt(baseHex.slice(1, 3), 16);
          const gg = parseInt(baseHex.slice(3, 5), 16);
          const bb = parseInt(baseHex.slice(5, 7), 16);
          const toHex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
          const velColor = `#${toHex(rr + (255 - rr) * whiteMix)}${toHex(gg + (255 - gg) * whiteMix)}${toHex(bb + (255 - bb) * whiteMix)}`;

          // Dim all note cells in channel mode (note grid is background layer)
          if (uiMode === "channel") value |= FLAG_DIMMED;

          colorRow.push(velColor);
          row.push(value);
          continue;
        } else {
          // Off-screen note indicators on edge cells
          let offScreen = false;
          let offScreenPlaying = false;
          const isTopEdge = visibleRow === 0;
          const isBottomEdge = visibleRow === VISIBLE_ROWS - 1;
          const isLeftEdge = visibleCol === 0;
          const isRightEdge = visibleCol === VISIBLE_COLS - 1;
          const visibleBottomRow = startRow;
          const visibleTopRow = startRow + VISIBLE_ROWS - 1;
          const endTick = startTick + VISIBLE_COLS * ticksPerCol;

          if (isTopEdge || isBottomEdge || isLeftEdge || isRightEdge) {
            for (const note of displayNotes) {
              const noteEndTick = note.position + note.length;

              // Top edge: notes above visible area at this tick
              if (
                isTopEdge &&
                note.row > visibleTopRow &&
                note.position <= actualTick &&
                noteEndTick > actualTick
              ) {
                offScreen = true;
                if (loopedTick >= note.position && loopedTick < noteEndTick)
                  offScreenPlaying = true;
              }
              // Bottom edge: notes below visible area at this tick
              if (
                isBottomEdge &&
                note.row < visibleBottomRow &&
                note.position <= actualTick &&
                noteEndTick > actualTick
              ) {
                offScreen = true;
                if (loopedTick >= note.position && loopedTick < noteEndTick)
                  offScreenPlaying = true;
              }
              // Right edge: notes to the right on this row
              if (isRightEdge && note.row === actualRow && note.position >= endTick) {
                offScreen = true;
                if (loopedTick >= note.position && loopedTick < noteEndTick)
                  offScreenPlaying = true;
              }
              // Left edge: notes to the left on this row (note ends before visible area)
              if (
                isLeftEdge &&
                note.row === actualRow &&
                noteEndTick <= startTick
              ) {
                offScreen = true;
                if (loopedTick >= note.position && loopedTick < noteEndTick)
                  offScreenPlaying = true;
              }
              if (offScreen && offScreenPlaying) break;
            }
          }

          if (offScreen) {
            value = offScreenPlaying ? BUTTON_COLOR_50 : BUTTON_COLOR_25;
          }

          // Empty cell - add grid markers (tick-based)
          const isInLoop =
            actualTick >= currentLoop.start && actualTick < loopEndTick;

          if (isInLoop) {
            // Playhead: check if loopedTick falls in this column's tick range
            if (loopedTick >= 0 && actualTick <= loopedTick && actualTick + ticksPerCol > loopedTick) {
              value |= FLAG_PLAYHEAD;
            }

            if (actualTick === currentLoop.start || actualTick + ticksPerCol >= loopEndTick && actualTick < loopEndTick) {
              value |= FLAG_LOOP_BOUNDARY;
              if (uiMode === "loop") {
                value |= FLAG_LOOP_BOUNDARY_PULSING;
              }
            } else if (Math.floor(actualTick / TICKS_PER_QUARTER) % 2 === 0) {
              value |= FLAG_BEAT_MARKER;
            }
          }
        }

        // Root note marker: for drums highlight every 7 rows from MIDI 36, for melodic highlight scale root
        if (isDrumChannel) {
          if ((actualRow - 36) % 7 === 0) {
            value |= FLAG_C_NOTE;
          }
        } else {
          const midiForRow = noteToMidi(actualRow, scaleMapping);
          if (midiForRow >= 0 && midiForRow % 12 === scaleRoot) {
            value |= FLAG_C_NOTE;
          }
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
          if (colors[r][c] !== null) continue;
          values[r][c] |= FLAG_DIMMED;
        }
      }
    }

    // Modify mode without selected note: dim the grid (waiting for note selection)
    if (uiMode === "modify" && !selectedNoteId) {
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
          if (r === 7 && c <= 3) continue;
          values[r][c] |= FLAG_DIMMED;
        }
      }
    }

    return { buttonValues: values, colorOverrides: colors };
  }, [
    uiMode,
    modifySubMode,
    displayNotes,
    startRow,
    startTick,
    ticksPerCol,
    loopEndTick,
    loopedTick,
    selectedNoteId,
    selectedEvent,
    keyboard.ctrl,
    channelColor,
    currentChannel,
    patternData.events,
    // Channel mode deps
    allPatternsHaveNotes,
    currentPatterns,
    queuedPatterns,
    channelsPlayingNow,
    isPulseBeat,
    mutedChannels,
    soloedChannels,
    // Modify mode deps
    visibleLevels,
    currentLoop.start,
    currentLoop.length,
    // Scale mapping
    scaleMapping,
    scaleRoot,
    isDrumChannel,
  ]);

  // Handle button press — unified handler for both keyboard and click/touch
  const handleButtonPress = useCallback(
    (visibleRow: number, visibleCol: number, modifiers: { ctrl: boolean; shift: boolean; meta: boolean; alt: boolean }) => {
      // Ctrl+click on bottom row cols 0-3: switch UI mode (works in all modes)
      if (modifiers.ctrl && visibleRow === 7 && visibleCol <= 3) {
        const modes: UiMode[] = ["channel", "pattern", "loop", "modify"];
        commands.switchMode(modes[visibleCol]);
        return;
      }

      if (uiMode === "channel") {
        const channelIndex = visibleRow;

        // Compute whether this pattern slot is empty (for shift-copy logic)
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

        commands.handleChannelCellPress(
          channelIndex,
          visibleCol,
          { shift: modifiers.shift, alt: modifiers.alt },
          isEmptyPattern,
        );
        return;
      }

      // Modify mode (all sub-modes)
      if (uiMode === "modify") {
        if (selectedNoteId) {
          commands.setSubModeValueAtCell(visibleRow, visibleCol, visibleLevels, modifiers.meta);
        } else {
          // No note selected: click to select a note (convert to tick coordinates)
          const flipped = VISIBLE_ROWS - 1 - visibleRow;
          const actualRow = startRow + flipped;
          const actualTick = startTick + visibleCol * ticksPerCol;
          commands.selectNoteAtCell(actualRow, actualTick, renderedNotes);
        }
        return;
      }

      // Loop mode: click sets loop boundaries (tick-based)
      if (uiMode === "loop") {
        const actualTick = startTick + visibleCol * ticksPerCol;
        if (modifiers.shift) {
          commands.setLoopStartAt(actualTick);
        } else {
          commands.setLoopEndAt(actualTick);
        }
        return;
      }

      // Pattern mode: pass visible coords (with row flipped for MIDI note ordering)
      // handlePatternCellPress expects visibleRow where 0 = lowest visible MIDI note
      const flippedVisibleRow = VISIBLE_ROWS - 1 - visibleRow;
      commands.handlePatternCellPress(flippedVisibleRow, visibleCol, renderedNotes, {
        meta: modifiers.meta,
        shift: modifiers.shift,
      });
    },
    [
      uiMode,
      modifySubMode,
      startRow,
      startTick,
      ticksPerCol,
      allPatternsHaveNotes,
      currentPatterns,
      queuedPatterns,
      currentChannel,
      currentPattern,
      currentLoop,
      selectedNoteId,
      renderedNotes,
      visibleLevels,
      commands,
    ],
  );

  // Keep gridPressRef in sync so keyboard can call handleButtonPress
  gridPressRef.current = handleButtonPress;

  // Click/touch wrappers — read keyboard modifiers at call time
  const handleButtonPressFromInput = useCallback(
    (visibleRow: number, visibleCol: number) => {
      handleButtonPress(visibleRow, visibleCol, {
        ctrl: keyboard.ctrl,
        shift: keyboard.shift,
        meta: keyboard.meta,
        alt: keyboard.alt,
      });
    },
    [handleButtonPress, keyboard.ctrl, keyboard.shift, keyboard.meta, keyboard.alt],
  );

  const handleButtonDragEnter = useCallback(
    (visibleRow: number, visibleCol: number) => {
      handleButtonPress(visibleRow, visibleCol, {
        ctrl: keyboard.ctrl,
        shift: keyboard.shift,
        meta: keyboard.meta,
        alt: keyboard.alt,
      });
    },
    [handleButtonPress, keyboard.ctrl, keyboard.shift, keyboard.meta, keyboard.alt],
  );

  // OLED display content
  type OledValuePart = { text: string; highlight?: boolean };
  type OledRow = { label: string; valueParts: OledValuePart[] };

  const getOledContent = useCallback((): { rows: OledRow[] } => {
    // Pattern mode: show note info if a note is selected
    if (uiMode === "pattern" && selectedEvent) {
      const noteName = isDrumChannel
        ? getDrumName(selectedEvent.row)
        : (() => { const m = noteToMidi(selectedEvent.row, scaleMapping); return m >= 0 ? midiNoteToName(m) : "??"; })();
      const lengthDisplay = ticksToDisplay(selectedEvent.length, ticksPerCol);
      const repeatAmount = selectedEvent.repeatAmount;
      const repeatSpaceDisplay = ticksToDisplay(selectedEvent.repeatSpace, ticksPerCol);
      const speed = selectedEvent.speed ?? "1/16";
      const highlightSpeed = keyboard.alt && !keyboard.shift;
      const highlightLength = keyboard.shift && !keyboard.alt && !keyboard.meta;
      const highlightRepeatAmount = keyboard.meta && !keyboard.shift;
      const highlightRepeatSpace = keyboard.meta && keyboard.shift;
      const highlightChord = keyboard.meta;
      const chordSize = selectedEvent.chordStackSize;
      const chordShape = selectedEvent.chordShapeIndex;
      const chordInv = selectedEvent.chordInversion;

      // Show chord row when meta is held, shift+up/down for inversion, or chord is active
      const showChord = keyboard.meta || chordSize > 1;

      return {
        rows: [
          {
            label: "NOTE",
            valueParts: [
              { text: noteName },
              { text: `  ` },
              { text: speed, highlight: highlightSpeed },
            ],
          },
          showChord
            ? {
                label: "CHORD",
                valueParts: [
                  { text: `${chordSize}`, highlight: highlightChord && !keyboard.shift },
                  { text: chordSize > 1 ? ` S${chordShape + 1}` : "", highlight: highlightChord && keyboard.shift },
                  { text: chordInv !== 0 ? ` I${chordInv > 0 ? "+" : ""}${chordInv}` : "", highlight: keyboard.shift && !keyboard.meta },
                ],
              }
            : {
                label: "LENGTH",
                valueParts: [
                  { text: lengthDisplay, highlight: highlightLength },
                ],
              },
          {
            label: "REPEAT",
            valueParts: [
              {
                text: `${repeatAmount}`,
                highlight: highlightRepeatAmount,
              },
              { text: "x" },
              {
                text: repeatSpaceDisplay,
                highlight: highlightRepeatSpace,
              },
            ],
          },
        ],
      };
    }

    if (uiMode === "modify") {
      const subModeLabel = SUB_MODE_CONFIG[modifySubMode].label;
      if (selectedEvent) {
        const noteName = isDrumChannel
          ? getDrumName(selectedEvent.row)
          : (() => { const m = noteToMidi(selectedEvent.row, scaleMapping); return m >= 0 ? midiNoteToName(m) : "??"; })();
        const loopMode = getEventSubModeLoopMode(selectedEvent, modifySubMode);
        const loopModeLabel =
          loopMode === "reset"
            ? "RST"
            : loopMode === "continue"
              ? "CNT"
              : "FIL";
        const arrLen = getEventSubModeArrayLength(selectedEvent, modifySubMode);
        return {
          rows: [
            { label: "NOTE", valueParts: [{ text: noteName }] },
            {
              label: "SUB",
              valueParts: [{ text: subModeLabel, highlight: true }],
            },
            {
              label: "LOOP",
              valueParts: [
                { text: loopModeLabel, highlight: loopMode === "continue" },
                { text: ` L${arrLen}` },
              ],
            },
          ],
        };
      }
      return {
        rows: [
          {
            label: "SUB",
            valueParts: [{ text: subModeLabel, highlight: true }],
          },
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
              { text: tickToBeatDisplay(currentLoop.start), highlight: highlightStart },
            ],
          },
          {
            label: "END",
            valueParts: [{ text: tickToBeatDisplay(loopEndTick), highlight: highlightEnd }],
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
    const scaleDef = SCALES[scaleId];
    const scaleRootName = NOTE_NAMES[scaleRoot];
    const scaleName = scaleDef?.name ?? scaleId;
    const highlightKey = keyboard.alt;

    return {
      rows: [
        {
          label: "CH",
          valueParts: [
            { text: `${currentChannel + 1}` },
            { text: `  PAT ${currentPattern + 1}` },
          ],
        },
        {
          label: "LOOP",
          valueParts: [{ text: `${tickToBeatDisplay(currentLoop.start)}-${tickToBeatDisplay(loopEndTick)}` }],
        },
        isDrumChannel
          ? { label: "TYPE", valueParts: [{ text: "DRUMS" }] }
          : {
              label: "KEY",
              valueParts: [
                { text: scaleRootName, highlight: highlightKey },
                { text: " " },
                { text: scaleName, highlight: highlightKey },
              ],
            },
      ],
    };
  }, [
    uiMode,
    modifySubMode,
    selectedEvent,
    keyboard,
    currentChannel,
    currentPattern,
    currentLoop,
    loopEndTick,
    ticksPerCol,
    zoom,
    scaleRoot,
    scaleId,
    scaleMapping,
    isDrumChannel,
  ]);

  const oledContent = getOledContent();

  // Arrow button handlers — delegate to shared commands
  const handleArrowUp = useCallback(() => {
    commands.moveSelectedNote("up");
  }, [commands]);

  const handleArrowDown = useCallback(() => {
    commands.moveSelectedNote("down");
  }, [commands]);

  const handleArrowLeft = useCallback(() => {
    if (uiMode === "loop") {
      commands.adjustLoopEnd("left");
      return;
    }
    commands.moveSelectedNote("left");
  }, [uiMode, commands]);

  const handleArrowRight = useCallback(() => {
    if (uiMode === "loop") {
      commands.adjustLoopEnd("right");
      return;
    }
    commands.moveSelectedNote("right");
  }, [uiMode, commands]);

  return (
    <Box css={gridOuterContainerStyles}>
      <Box css={verticalStripContainerStyles}>
        {uiMode === "modify" && selectedNoteId && needsModifyScroll ? (
          <TouchStrip
            orientation="vertical"
            value={modifyScroll}
            onChange={setModifyScroll}
            length={gridHeight}
            thickness={24}
            totalItems={allLevels.length}
            visibleItems={VISIBLE_ROWS}
            itemSize={buttonSize}
          />
        ) : (
          <TouchStrip
            orientation="vertical"
            value={rowOffset}
            onChange={onRowOffsetChange}
            length={gridHeight}
            thickness={24}
            totalItems={totalRows}
            visibleItems={VISIBLE_ROWS}
            itemSize={buttonSize}
          />
        )}
      </Box>
      <Box css={gridInnerContainerStyles}>
        <Box css={gridContainerStyles}>
          <ButtonGrid
            values={buttonValues}
            channelColor={channelColor}
            colorOverrides={colorOverrides}
            onPress={handleButtonPressFromInput}
            onDragEnter={handleButtonDragEnter}
            onRelease={noop}
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
            onShiftChange={onScrub}
            onShiftEnd={onScrubEnd}
            length={buttonSize * 8}
            thickness={24}
            totalItems={totalCols}
            visibleItems={VISIBLE_COLS}
            itemSize={buttonSize}
          />
        </Box>
        <Box css={debugStyles}>
          <span>
            Notes: {isDrumChannel
              ? `${getDrumName(startRow)} - ${getDrumName(endRow)}`
              : `${(() => { const m = noteToMidi(startRow, scaleMapping); return m >= 0 ? midiNoteToName(m) : startRow; })()} - ${(() => { const m = noteToMidi(endRow, scaleMapping); return m >= 0 ? midiNoteToName(m) : endRow; })()}`
            }
          </span>
          <span>Zoom: {zoom}</span>
          <span>
            Beats: {tickToBeatDisplay(startTick)} - {tickToBeatDisplay(startTick + VISIBLE_COLS * ticksPerCol)}
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
