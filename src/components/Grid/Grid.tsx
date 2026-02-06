import { memo, useCallback, useMemo } from "react";
import { css } from "@emotion/react";
import { Box } from "@mui/material";
import { GridButton } from "../GridButton";
import { ButtonGrid, BUTTON_OFF, BUTTON_COLOR_100, FLAG_PLAYHEAD, FLAG_C_NOTE, FLAG_LOOP_BOUNDARY, FLAG_BEAT_MARKER, FLAG_SELECTED, FLAG_CONTINUATION, FLAG_PLAYING } from "../ButtonGrid";
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
  findNoteAtCell,
} from "../../types/grid";

// Convert MIDI note number to note name
const midiNoteToName = (midiNote: number): string => {
  const noteNames = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
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

  // Additional store state for ctrl mode
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

  // Compute button values for ButtonGrid (normal mode)
  const buttonValues = useMemo(() => {
    const values: number[][] = [];

    for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow++) {
      const row: number[] = [];
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
          const isNoteCurrentlyPlaying = loopedStep >= noteStartCol && loopedStep <= noteEndCol;

          // Base: note is active
          value = BUTTON_COLOR_100;

          // Flags
          if (!isNoteStart) {
            value |= FLAG_CONTINUATION;
          }

          if (isNoteCurrentlyPlaying) {
            value |= FLAG_PLAYING;
          }

          // Check if selected
          if (selectedNote && selectedNote.row === actualRow && selectedNote.col === noteAtCell.sourceCol) {
            value |= FLAG_SELECTED;
          }
        } else {
          // Empty cell - add grid markers
          const isInLoop = actualCol >= currentLoop.start && actualCol < loopEnd;

          if (isInLoop) {
            // Playhead
            if (actualCol === loopedStep) {
              value |= FLAG_PLAYHEAD;
            }

            // Loop boundary
            if (actualCol === currentLoop.start || actualCol === loopEnd - 1) {
              value |= FLAG_LOOP_BOUNDARY;
            }
            // Beat marker (every 4th column, alternating groups)
            else if (Math.floor(actualCol / 4) % 2 === 0) {
              value |= FLAG_BEAT_MARKER;
            }
          }
        }

        // C note marker (any row where MIDI note % 12 === 0)
        if (actualRow % 12 === 0) {
          value |= FLAG_C_NOTE;
        }

        row.push(value);
      }

      values.push(row);
    }

    return values;
  }, [renderedNotes, startRow, startCol, currentLoop.start, loopEnd, loopedStep, selectedNote]);

  // Handle button press from ButtonGrid
  const handleButtonPress = useCallback((visibleRow: number, visibleCol: number) => {
    const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
    const actualCol = startCol + visibleCol;
    onCellPress(actualRow, actualCol);
  }, [startRow, startCol, onCellPress]);

  // Handle button drag enter from ButtonGrid
  const handleButtonDragEnter = useCallback((visibleRow: number, visibleCol: number) => {
    const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);
    const actualCol = startCol + visibleCol;
    onCellDragEnter(actualRow, actualCol);
  }, [startRow, startCol, onCellDragEnter]);

  // OLED display content
  type OledValuePart = { text: string; highlight?: boolean };
  type OledRow = { label: string; valueParts: OledValuePart[] };

  const getOledContent = useCallback((): { rows: OledRow[] } => {
    const selectedNoteValue = selectedNote
      ? gridState[selectedNote.row]?.[selectedNote.col]
      : null;
    const selectedNoteLength = selectedNoteValue
      ? getNoteLength(selectedNoteValue)
      : 0;
    const selectedRepeatAmount = selectedNoteValue
      ? getRepeatAmount(selectedNoteValue)
      : 1;
    const selectedRepeatSpace = selectedNoteValue
      ? getRepeatSpace(selectedNoteValue)
      : 4;

    if (selectedNote && selectedNoteLength > 0) {
      const noteName = midiNoteToName(selectedNote.row);
      const highlightLength = keyboard.shift && !keyboard.meta;
      const highlightRepeatAmount = keyboard.meta && !keyboard.shift;
      const highlightRepeatSpace = keyboard.meta && keyboard.shift;

      return {
        rows: [
          { label: "NOTE", valueParts: [{ text: noteName }] },
          {
            label: "LENGTH",
            valueParts: [{ text: `${selectedNoteLength}`, highlight: highlightLength }],
          },
          {
            label: "REPEAT",
            valueParts: [
              { text: `${selectedRepeatAmount}`, highlight: highlightRepeatAmount },
              { text: "x" },
              { text: `${selectedRepeatSpace}`, highlight: highlightRepeatSpace },
            ],
          },
        ],
      };
    }

    if (keyboard.ctrl && keyboard.alt) {
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "MUTE/SOLO" }] },
          { label: "CH", valueParts: [{ text: `${currentChannel + 1}` }] },
          { label: "", valueParts: [] },
        ],
      };
    } else if (keyboard.ctrl) {
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "CHANNEL" }] },
          { label: "SELECT", valueParts: [{ text: `CH ${currentChannel + 1}` }] },
          { label: "", valueParts: [] },
        ],
      };
    } else if (keyboard.alt) {
      const highlightStart = keyboard.shift;
      const highlightEnd = !keyboard.shift;
      return {
        rows: [
          { label: "LOOP", valueParts: [{ text: "" }] },
          {
            label: "START",
            valueParts: [{ text: `${currentLoop.start + 1}`, highlight: highlightStart }],
          },
          {
            label: "END",
            valueParts: [{ text: `${loopEnd}`, highlight: highlightEnd }],
          },
        ],
      };
    } else if (keyboard.shift) {
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "EXTEND" }] },
          { label: "NOTE", valueParts: [{ text: "DRAG" }] },
          { label: "", valueParts: [] },
        ],
      };
    }

    return {
      rows: [
        { label: "CH", valueParts: [{ text: `${currentChannel + 1}` }] },
        { label: "PAT", valueParts: [{ text: `${currentPattern + 1}` }] },
        { label: "LOOP", valueParts: [{ text: `${currentLoop.start + 1}-${loopEnd}` }] },
      ],
    };
  }, [selectedNote, gridState, keyboard, currentChannel, currentPattern, currentLoop, loopEnd]);

  const oledContent = getOledContent();

  // Arrow button handlers
  const handleArrowUp = useCallback(() => {
    if (selectedNote) {
      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
      if (noteLength > 0) {
        const newRow = Math.min(ROWS - 1, selectedNote.row + 1);
        if (newRow !== selectedNote.row) {
          actions.moveNote(selectedNote.row, selectedNote.col, newRow, selectedNote.col);
          actions.setSelectedNote({ row: newRow, col: selectedNote.col });
          if (!isPlaying && onPlayNote) onPlayNote(newRow, currentChannel);
        }
      }
    }
  }, [selectedNote, gridState, isPlaying, onPlayNote, currentChannel]);

  const handleArrowDown = useCallback(() => {
    if (selectedNote) {
      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
      if (noteLength > 0) {
        const newRow = Math.max(0, selectedNote.row - 1);
        if (newRow !== selectedNote.row) {
          actions.moveNote(selectedNote.row, selectedNote.col, newRow, selectedNote.col);
          actions.setSelectedNote({ row: newRow, col: selectedNote.col });
          if (!isPlaying && onPlayNote) onPlayNote(newRow, currentChannel);
        }
      }
    }
  }, [selectedNote, gridState, isPlaying, onPlayNote, currentChannel]);

  const handleArrowLeft = useCallback(() => {
    if (selectedNote) {
      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
      if (noteLength > 0) {
        const newCol = Math.max(0, selectedNote.col - 1);
        if (newCol !== selectedNote.col) {
          actions.moveNote(selectedNote.row, selectedNote.col, selectedNote.row, newCol);
          actions.setSelectedNote({ row: selectedNote.row, col: newCol });
          if (!isPlaying && onPlayNote) onPlayNote(selectedNote.row, currentChannel);
        }
      }
    }
  }, [selectedNote, gridState, isPlaying, onPlayNote, currentChannel]);

  const handleArrowRight = useCallback(() => {
    if (selectedNote) {
      const noteLength = getNoteLength(gridState[selectedNote.row]?.[selectedNote.col]);
      if (noteLength > 0) {
        const newCol = Math.min(COLS - 1, selectedNote.col + 1);
        if (newCol !== selectedNote.col) {
          actions.moveNote(selectedNote.row, selectedNote.col, selectedNote.row, newCol);
          actions.setSelectedNote({ row: selectedNote.row, col: newCol });
          if (!isPlaying && onPlayNote) onPlayNote(selectedNote.row, currentChannel);
        }
      }
    }
  }, [selectedNote, gridState, isPlaying, onPlayNote, currentChannel]);

  // Render Ctrl mode grid (channel/pattern selector)
  const renderCtrlModeGrid = () => (
    <>
      {Array.from({ length: VISIBLE_ROWS }, (_, visibleRow) => {
        const channelIndex = visibleRow;
        const shiftColor = CHANNEL_COLORS[channelIndex];
        const patternsForChannel = allPatternsHaveNotes[channelIndex];
        const currentPatternForChannel = currentPatterns[channelIndex];
        const anySoloed = soloedChannels.some((s) => s);

        return (
          <Box key={visibleRow} css={rowStyles}>
            {Array.from({ length: VISIBLE_COLS }, (_, visibleCol) => {
              const patternIndex = visibleCol - 1;

              // Column 0: mute/solo buttons
              if (visibleCol === 0) {
                const isMuted = mutedChannels[channelIndex];
                const isSoloed = soloedChannels[channelIndex];
                const isPlayingNow = currentPatternForChannel >= 0 && channelsPlayingNow[channelIndex];

                let displayColor: string;
                let glowIntensity: number;

                if (isSoloed) {
                  displayColor = shiftColor;
                  glowIntensity = 1;
                } else if (isMuted) {
                  displayColor = shiftColor + "1A";
                  glowIntensity = 0.1;
                } else if (anySoloed) {
                  displayColor = shiftColor + "4D";
                  glowIntensity = 0.3;
                } else {
                  displayColor = shiftColor + "80";
                  glowIntensity = 0.5;
                }

                const handleMuteClick = () => {
                  if (keyboard.alt) {
                    actions.toggleSolo(channelIndex);
                  } else {
                    actions.toggleMute(channelIndex);
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

              // Pattern buttons
              const patternHasNotes = patternIndex >= 0 && (patternsForChannel?.[patternIndex] ?? false);
              const isSelectedPattern = channelIndex === currentChannel && patternIndex === currentPatternForChannel;
              const isActivePattern = patternIndex === currentPatternForChannel;
              const isQueued = patternIndex >= 0 && queuedPatterns[channelIndex] === patternIndex;
              const isPlayingNow = isActivePattern && channelsPlayingNow[channelIndex];
              const isPulsing = isQueued && isPulseBeat;
              const isEmptyPattern = !patternHasNotes && !isSelectedPattern && !isQueued;

              let displayColor: string;
              let glowIntensity: number;

              if (isSelectedPattern) {
                displayColor = shiftColor;
                glowIntensity = 1;
              } else if (isQueued) {
                const intensity = isPulsing ? 0.7 : 0.35;
                const hex = Math.round(intensity * 255).toString(16).padStart(2, "0");
                displayColor = shiftColor + hex;
                glowIntensity = intensity;
              } else if (patternHasNotes) {
                displayColor = shiftColor + "B3";
                glowIntensity = 0.7;
              } else {
                displayColor = shiftColor + "0D";
                glowIntensity = 0.05;
              }

              const handleSelect = () => {
                if (keyboard.shift && isEmptyPattern && channelIndex === currentChannel) {
                  actions.copyPatternTo(patternIndex);
                  actions.setChannelPattern(channelIndex, patternIndex);
                  return;
                }
                actions.setCurrentChannel(channelIndex);
                actions.setChannelPattern(channelIndex, patternIndex);
              };

              if (isEmptyPattern) {
                return (
                  <GridButton
                    key={`${visibleRow}-${visibleCol}`}
                    active={false}
                    isPlayhead={false}
                    rowColor={displayColor}
                    dimmed={true}
                    glowIntensity={glowIntensity}
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
            })}
          </Box>
        );
      })}
    </>
  );

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
          {keyboard.ctrl ? (
            renderCtrlModeGrid()
          ) : (
            <ButtonGrid
              values={buttonValues}
              channelColor={channelColor}
              onPress={handleButtonPress}
              onDragEnter={handleButtonDragEnter}
              onRelease={onCellRelease}
            />
          )}
        </Box>
        <Box css={horizontalStripContainerStyles}>
          <Box css={modifierKeysContainerStyles}>
            <Box css={[modifierKeyStyles, keyboard.shift && modifierKeyActiveStyles]}>
              shift
            </Box>
            <Box css={[modifierKeyStyles, keyboard.ctrl && modifierKeyActiveStyles]}>
              ctrl
            </Box>
            <Box css={[modifierKeyStyles, keyboard.alt && modifierKeyActiveStyles]}>
              opt
            </Box>
            <Box css={[modifierKeyStyles, keyboard.meta && modifierKeyActiveStyles]}>
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
          <span>Notes: {startRow} - {endRow}</span>
          <span>Beats: {startCol} - {endCol}</span>
        </Box>
      </Box>
      {/* OLED Screen and controls */}
      <Box css={oledContainerStyles}>
        <Box css={css`display: flex; flex-direction: column; align-items: center;`}>
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
              <Box css={arrowButtonStyles} onClick={handleArrowUp}>▲</Box>
            </Box>
            <Box css={arrowButtonRowStyles}>
              <Box css={arrowButtonStyles} onClick={handleArrowLeft}>◀</Box>
              <Box css={arrowButtonStyles} onClick={handleArrowDown}>▼</Box>
              <Box css={arrowButtonStyles} onClick={handleArrowRight}>▶</Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
});

Grid.displayName = "Grid";
