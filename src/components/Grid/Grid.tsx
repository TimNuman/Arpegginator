import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Box } from "@mui/material";
import { ButtonGrid } from "../ButtonGrid";
import { TouchStrip } from "../TouchStrip";
import { useKeyboard, type KeyboardState } from "../../hooks/useKeyboard";
import { CHANNEL_COLORS } from "./ChannelColors";
import {
  useRenderVersion,
  getIsPlaying,
  markDirty,
} from "../../store/renderStore";
import * as actions from "../../actions";
import { NOTE_NAMES } from "../../types/scales";
import { getDrumName, DRUM_TOTAL_ROWS, DRUM_MIN_ROW } from "../../types/drums";
import type { WasmEngine } from "../../engine/WasmEngine";
import {
  gridOuterContainerStyles,
  gridInnerContainerStyles,
  gridContainerStyles,
  verticalStripContainerStyles,
  horizontalStripContainerStyles,
  modifierKeysContainerStyles,
  modifierKeyStyles,
  modifierKeyActiveStyles,
  debugStyles,
  oledContainerStyles,
  oledColumnStyles,
  oledScreenStyles,
  oledRowStyles,
  oledLabelStyles,
  oledValueStyles,
  oledHighlightStyles,
  rotaryEncoderStyles,
  rotaryKnobStyles,
  arrowButtonContainerStyles,
  arrowButtonRowStyles,
  arrowButtonStyles,
} from "./Grid.styles";
import {
  KEY_MAP,
  DIR_UP,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  ACTION_DESELECT,
  ACTION_ZOOM_IN,
  ACTION_ZOOM_OUT,
  ACTION_DELETE_NOTE,
  UI_MODE_NAMES,
  SUB_MODE_NAMES,
  TICKS_TO_SUBDIVISION,
  SUB_MODE_CONFIG,
  LOOP_MODE_NAMES,
} from "./Grid.config";
import {
  noop,
  midiNoteToName,
  ticksToDisplay,
  ticksToMusicalName,
  tickToBeatDisplay,
  uint32ToHex,
  encodeModifiers,
} from "./Grid.helpers";

// ============ Grid Component ============

interface GridProps {
  wasmEngine: WasmEngine;
}

export const Grid = memo(({ wasmEngine }: GridProps) => {
  // Subscribe to render version — triggers re-render when markDirty() is called
  const renderVersion = useRenderVersion();

  useEffect(() => {
    console.log('[startup] Grid mounted, wasmEngine version=' + wasmEngine.getVersion());
    return () => console.log('[startup] Grid unmounted');
  }, [wasmEngine]);

  // ============ Read ALL state from WASM (single source of truth) ============
  const VISIBLE_ROWS = wasmEngine.getVisibleRows();
  const VISIBLE_COLS = wasmEngine.getVisibleCols();
  const currentChannel = wasmEngine.getCurrentChannel();
  const currentTick = wasmEngine.getCurrentTick();
  const isPlaying = getIsPlaying(); // JS owns transport
  const selectedEventIdx = wasmEngine.getSelectedEvent();
  const hasSelection = selectedEventIdx >= 0;
  const uiModeIdx = wasmEngine.getUiMode();
  const uiMode = UI_MODE_NAMES[uiModeIdx] ?? "pattern";
  const modifySubModeIdx = wasmEngine.getModifySubMode();
  const modifySubMode = SUB_MODE_NAMES[modifySubModeIdx] ?? "velocity";
  const ticksPerCol = wasmEngine.getZoom();
  const zoom = TICKS_TO_SUBDIVISION[ticksPerCol] ?? "1/16";
  const scaleRoot = wasmEngine.getScaleRoot();
  const isDrumChannel = wasmEngine.getChannelType(currentChannel) === 1;
  const currentPattern = wasmEngine.getCurrentPattern(currentChannel);
  const loopStart = wasmEngine.getCurrentLoopStart();
  const loopLength = wasmEngine.getCurrentLoopLength();
  const loopEndTick = loopStart + loopLength;
  const patternLengthTicks = wasmEngine.getCurrentPatternLengthTicks();
  const rowOffset = wasmEngine.getRowOffset(currentChannel);
  const colOffset = wasmEngine.getColOffset();

  const channelColor = CHANNEL_COLORS[currentChannel];

  // Tick-based layout
  const totalCols = Math.ceil(patternLengthTicks / ticksPerCol);

  const totalRows = isDrumChannel ? DRUM_TOTAL_ROWS : wasmEngine.getScaleCount();
  const minRow = isDrumChannel ? DRUM_MIN_ROW : -wasmEngine.getScaleZeroIndex();
  const maxRowOffset = Math.max(0, totalRows - VISIBLE_ROWS);
  const maxColOffset = Math.max(0, totalCols - VISIBLE_COLS);
  const startArrayIndex =
    maxRowOffset > 0 ? Math.round((1 - rowOffset) * maxRowOffset) : 0;
  const startRow = startArrayIndex + minRow;
  const endRow = startRow + VISIBLE_ROWS - 1;
  const startCol = maxColOffset > 0 ? Math.round(colOffset * maxColOffset) : 0;
  const startTick = startCol * ticksPerCol;

  const buttonSize = 44;
  const gridHeight = VISIBLE_ROWS * buttonSize;

  // ============ Keyboard -> WASM ============
  const keyboardRef = useRef<KeyboardState>({
    pressedKeys: new Set(),
    ctrl: false,
    shift: false,
    meta: false,
    alt: false,
  });

  const handleKeyDown = useCallback(
    (
      key: string,
      code: string,
      event: KeyboardEvent,
      state: KeyboardState,
    ): boolean => {
      // Spacebar: toggle play/stop via JS actions (JS manages transport)
      if (key === " " || code === "Space") {
        actions.togglePlay();
        return true;
      }

      // Backspace: deselect / reset playhead
      if (key === "backspace") {
        wasmEngine.keyAction(ACTION_DESELECT);
        markDirty();
        return true;
      }

      // Delete
      if (key === "delete" || code === "Delete") {
        wasmEngine.keyAction(ACTION_DELETE_NOTE);
        markDirty();
        return true;
      }

      // Zoom: [ = zoom out, ] = zoom in
      if (key === "[") {
        wasmEngine.keyAction(ACTION_ZOOM_OUT);
        markDirty();
        return true;
      }
      if (key === "]") {
        wasmEngine.keyAction(ACTION_ZOOM_IN);
        markDirty();
        return true;
      }

      // Arrow keys -> WASM
      const arrowMap: Record<string, number> = {
        ArrowUp: DIR_UP,
        ArrowDown: DIR_DOWN,
        ArrowLeft: DIR_LEFT,
        ArrowRight: DIR_RIGHT,
      };
      if (code in arrowMap) {
        const mods = encodeModifiers(state);
        wasmEngine.arrowPress(arrowMap[code], mods);
        markDirty();
        return true;
      }

      // Grid key: forward as button press
      if (!event.repeat) {
        const gridPos = KEY_MAP[key];
        if (gridPos) {
          const mods = encodeModifiers(state);
          wasmEngine.buttonPress(gridPos.row, gridPos.col, mods);
          markDirty();
          return true;
        }
      }

      return false;
    },
    [wasmEngine],
  );

  const keyboard = useKeyboard({
    onKeyDown: handleKeyDown,
  });

  // Keep keyboard ref in sync for mouse/touch handlers
  keyboardRef.current = keyboard;

  // ============ Compute Grid via WASM ============
  const { buttonValues, colorOverrides } = useMemo(() => {
    // Set modifier state before computing grid (for Ctrl overlay)
    wasmEngine.setCtrlHeld(keyboard.ctrl);

    // Tell WASM to compute the grid
    wasmEngine.computeGrid();

    // Read buffers from WASM linear memory
    const buffers = wasmEngine.readGridBuffers();

    // Convert uint32 color_overrides to hex strings
    const hexColors: (string | null)[][] = [];
    for (let r = 0; r < VISIBLE_ROWS; r++) {
      const row: (string | null)[] = [];
      for (let c = 0; c < VISIBLE_COLS; c++) {
        const val = buffers.colorOverrides[r][c];
        row.push(val === 0 ? null : uint32ToHex(val));
      }
      hexColors.push(row);
    }

    return { buttonValues: buffers.buttonValues, colorOverrides: hexColors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasmEngine, renderVersion, keyboard.ctrl]);

  // ============ Camera Easing Animation Loop ============
  const animFrameRef = useRef(0);
  useEffect(() => {
    if (!wasmEngine.isAnimating()) return;
    const tick = () => {
      markDirty();
      if (wasmEngine.isAnimating()) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [wasmEngine, renderVersion]);

  // ============ Button Press -> WASM ============
  const handleButtonPressFromInput = useCallback(
    (visibleRow: number, visibleCol: number) => {
      console.log('[grid] buttonPress row=' + visibleRow + ' col=' + visibleCol + ' wasmReady=' + wasmEngine.isReady());
      const mods = encodeModifiers(keyboardRef.current);
      wasmEngine.buttonPress(visibleRow, visibleCol, mods);
      markDirty();
    },
    [wasmEngine],
  );

  const handleButtonDragEnter = useCallback(
    (visibleRow: number, visibleCol: number) => {
      const mods = encodeModifiers(keyboardRef.current);
      wasmEngine.buttonPress(visibleRow, visibleCol, mods);
      markDirty();
    },
    [wasmEngine],
  );

  // ============ Playhead Follow Mode ============
  const manualScrollOverride = useRef(false);
  const prevIsPlaying = useRef(false);

  // Detect play/stop transitions -> clear manual override
  if (isPlaying && !prevIsPlaying.current) {
    manualScrollOverride.current = false;
  }
  if (!isPlaying && prevIsPlaying.current) {
    manualScrollOverride.current = false;
  }
  prevIsPlaying.current = isPlaying;

  // Auto-scroll to follow playhead while playing
  if (
    isPlaying &&
    currentTick >= 0 &&
    !manualScrollOverride.current &&
    uiMode !== "loop"
  ) {
    const loopedTick =
      loopStart +
      ((((currentTick - loopStart) % loopLength) + loopLength) % loopLength);
    const loopStartCol = Math.floor(loopStart / ticksPerCol);
    const loopLengthCols = Math.ceil(loopLength / ticksPerCol);
    const loopEndCol = Math.ceil(loopEndTick / ticksPerCol);

    if (loopLengthCols > VISIBLE_COLS) {
      const FOLLOW_COL = 4;
      const loopedCol =
        Math.floor((loopedTick - loopStart) / ticksPerCol) + loopStartCol;
      let targetStartCol = loopedCol - FOLLOW_COL;
      targetStartCol = Math.max(targetStartCol, loopStartCol);
      const maxLoopStartCol = loopEndCol - VISIBLE_COLS;
      targetStartCol = Math.min(targetStartCol, maxLoopStartCol);
      targetStartCol = Math.max(0, Math.min(maxColOffset, targetStartCol));
      const newColOffset =
        maxColOffset > 0
          ? Math.max(0, Math.min(1, targetStartCol / maxColOffset))
          : 0;
      if (Math.abs(newColOffset - colOffset) > 0.001) {
        wasmEngine.setColOffset(newColOffset);
        markDirty();
      }
    }
  }

  // ============ Scroll Handlers ============
  const handleRowOffsetChange = useCallback(
    (offset: number) => {
      wasmEngine.setRowOffset(currentChannel, offset);
      markDirty();
    },
    [wasmEngine, currentChannel],
  );

  const handleColOffsetChange = useCallback(
    (offset: number) => {
      if (isPlaying) {
        manualScrollOverride.current = true;
      }
      wasmEngine.setColOffset(offset);
      markDirty();
    },
    [wasmEngine, isPlaying],
  );

  const scrubAccumulator = useRef(0);

  const handleScrub = useCallback(
    (deltaItems: number) => {
      if (deltaItems === 0) {
        // Scrub start — reset accumulator
        scrubAccumulator.current = 0;
        return;
      }
      scrubAccumulator.current += deltaItems * ticksPerCol;
      const wholeTicks = Math.trunc(scrubAccumulator.current);
      if (wholeTicks === 0) return;
      scrubAccumulator.current -= wholeTicks;
      const t = wasmEngine.getCurrentTick();
      const base = t >= 0 ? t : loopStart;
      actions.scrubToTick(base + wholeTicks);
    },
    [wasmEngine, ticksPerCol, loopStart],
  );

  const handleScrubEnd = useCallback(() => {
    actions.scrubEnd();
  }, []);

  // ============ Arrow button handlers (on-screen UI) ============
  const handleArrow = useCallback(
    (dir: number) => {
      const mods = encodeModifiers(keyboardRef.current);
      wasmEngine.arrowPress(dir, mods);
      markDirty();
    },
    [wasmEngine],
  );

  // ============ OLED Display ============
  type OledValuePart = { text: string; highlight?: boolean };
  type OledRow = { label: string; valueParts: OledValuePart[] };

  const getOledContent = useCallback((): { rows: OledRow[] } => {
    if (uiMode === "pattern" && hasSelection) {
      const selRow = wasmEngine.getSelRow();
      const selLength = wasmEngine.getSelLength();
      const repeatAmount = wasmEngine.getSelRepeatAmount();
      const repeatSpace = wasmEngine.getSelRepeatSpace();
      const chordAmount = wasmEngine.getSelChordAmount();
      const chordSpace = wasmEngine.getSelChordSpace();
      const chordInv = wasmEngine.getSelChordInversion();
      const arpStyle = wasmEngine.getSelArpStyle();
      const arpOffset = wasmEngine.getSelArpOffset();
      const arpVoices = wasmEngine.getSelArpVoices();
      const ARP_STYLE_NAMES = ['CHD', 'UP', 'DN', 'U/D', 'D/U'];

      const noteName = isDrumChannel
        ? getDrumName(selRow)
        : (() => {
            const m = wasmEngine.noteToMidi(selRow);
            return m >= 0 ? midiNoteToName(m) : "??";
          })();
      const lengthDisplay = ticksToMusicalName(selLength, ticksPerCol);
      const repeatSpaceDisplay = ticksToMusicalName(repeatSpace, ticksPerCol);
      const highlightLength = keyboard.shift && !keyboard.alt && !keyboard.meta;
      const highlightRepeatAmount = keyboard.meta && !keyboard.shift;
      const highlightRepeatSpace = keyboard.meta && keyboard.shift;
      const highlightChordAmount = keyboard.meta && !keyboard.shift;
      const highlightChordSpace = keyboard.meta && keyboard.shift;
      const highlightArpStyle = keyboard.alt && !keyboard.meta && !keyboard.shift;
      const highlightArpVoices = keyboard.alt && keyboard.shift && !keyboard.meta;
      const showChord = keyboard.meta || keyboard.alt || chordAmount > 1;
      const chordName = chordAmount > 1 ? wasmEngine.getChordName() : '';

      return {
        rows: [
          {
            label: "NOTE",
            valueParts: [{ text: noteName }],
          },
          showChord
            ? {
                label: "CHORD",
                valueParts: chordAmount > 1
                  ? [
                      {
                        text: chordName || `${chordAmount}x${chordSpace}`,
                        highlight: highlightChordAmount || highlightChordSpace,
                      },
                      {
                        text: arpStyle > 0 ? ` ${ARP_STYLE_NAMES[arpStyle] ?? 'CHD'}` : '',
                        highlight: highlightArpStyle,
                      },
                      {
                        text: arpStyle > 0 && arpOffset !== 0
                          ? `${arpOffset > 0 ? '+' : ''}${arpOffset}`
                          : '',
                        highlight: highlightArpStyle,
                      },
                      {
                        text: arpStyle > 0 && arpVoices > 1
                          ? ` v${arpVoices}`
                          : '',
                        highlight: highlightArpVoices,
                      },
                    ]
                  : [
                      {
                        text: `${chordAmount}`,
                        highlight: highlightChordAmount,
                      },
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
              { text: `${repeatAmount}`, highlight: highlightRepeatAmount },
              { text: "x" },
              { text: repeatSpaceDisplay, highlight: highlightRepeatSpace },
            ],
          },
        ],
      };
    }

    if (uiMode === "modify") {
      const subModeLabel = SUB_MODE_CONFIG[modifySubMode].label;
      if (hasSelection) {
        const selRow = wasmEngine.getSelRow();
        const noteName = isDrumChannel
          ? getDrumName(selRow)
          : (() => {
              const m = wasmEngine.noteToMidi(selRow);
              return m >= 0 ? midiNoteToName(m) : "??";
            })();
        const loopModeVal = wasmEngine.getSelSubModeLoopMode(modifySubModeIdx);
        const loopMode = LOOP_MODE_NAMES[loopModeVal] ?? "reset";
        const loopModeLabel =
          loopMode === "reset"
            ? "RST"
            : loopMode === "continue"
              ? "CNT"
              : "FIL";
        const arrLen = wasmEngine.getSelSubModeArrayLength(modifySubModeIdx);
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
              { text: tickToBeatDisplay(loopStart), highlight: highlightStart },
            ],
          },
          {
            label: "END",
            valueParts: [
              { text: tickToBeatDisplay(loopEndTick), highlight: highlightEnd },
            ],
          },
        ],
      };
    }

    if (keyboard.shift) {
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "EXTEND" }] },
          { label: "NOTE", valueParts: [{ text: "DRAG" }] },
          { label: "", valueParts: [] },
        ],
      };
    }

    const scaleRootName = NOTE_NAMES[scaleRoot];
    const scaleName = wasmEngine.getScaleName();
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
          valueParts: [
            {
              text: `${tickToBeatDisplay(loopStart)}-${tickToBeatDisplay(loopEndTick)}`,
            },
          ],
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
    modifySubModeIdx,
    hasSelection,
    keyboard,
    currentChannel,
    currentPattern,
    loopStart,
    loopLength,
    loopEndTick,
    ticksPerCol,
    zoom,
    scaleRoot,
    isDrumChannel,
    wasmEngine,
    selectedEventIdx,
  ]);

  const oledContent = getOledContent();

  return (
    <Box css={gridOuterContainerStyles}>
      <Box css={verticalStripContainerStyles}>
        <TouchStrip
          orientation="vertical"
          value={rowOffset}
          onChange={handleRowOffsetChange}
          length={gridHeight}
          thickness={24}
          totalItems={totalRows}
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
                keyboard.shift && modifierKeyActiveStyles,
              ]}
            >
              shift
            </Box>
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
                keyboard.alt && modifierKeyActiveStyles,
              ]}
            >
              opt
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
            value={colOffset}
            onChange={handleColOffsetChange}
            onShiftChange={handleScrub}
            onShiftEnd={handleScrubEnd}
            length={buttonSize * 8}
            thickness={24}
            totalItems={totalCols}
            visibleItems={VISIBLE_COLS}
            itemSize={buttonSize}
          />
        </Box>
        <Box css={debugStyles}>
          <span>
            Notes:{" "}
            {isDrumChannel
              ? `${getDrumName(startRow)} - ${getDrumName(endRow)}`
              : `${(() => {
                  const m = wasmEngine.noteToMidi(startRow);
                  return m >= 0 ? midiNoteToName(m) : startRow;
                })()} - ${(() => {
                  const m = wasmEngine.noteToMidi(endRow);
                  return m >= 0 ? midiNoteToName(m) : endRow;
                })()}`}
          </span>
          <span>Zoom: {zoom}</span>
          <span>
            Beats: {tickToBeatDisplay(startTick)} -{" "}
            {tickToBeatDisplay(startTick + VISIBLE_COLS * ticksPerCol)}
          </span>
        </Box>
      </Box>
      {/* OLED Screen and controls */}
      <Box css={oledContainerStyles}>
        <Box css={oledColumnStyles}>
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
          <Box css={rotaryEncoderStyles}>
            <Box css={rotaryKnobStyles} />
          </Box>
          <Box css={arrowButtonContainerStyles}>
            <Box css={arrowButtonRowStyles}>
              <Box css={arrowButtonStyles} onClick={() => handleArrow(DIR_UP)}>
                &#x25B2;
              </Box>
            </Box>
            <Box css={arrowButtonRowStyles}>
              <Box
                css={arrowButtonStyles}
                onClick={() => handleArrow(DIR_LEFT)}
              >
                &#x25C0;
              </Box>
              <Box
                css={arrowButtonStyles}
                onClick={() => handleArrow(DIR_DOWN)}
              >
                &#x25BC;
              </Box>
              <Box
                css={arrowButtonStyles}
                onClick={() => handleArrow(DIR_RIGHT)}
              >
                &#x25B6;
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
});

Grid.displayName = "Grid";
