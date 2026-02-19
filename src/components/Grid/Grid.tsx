import { memo, useCallback, useMemo, useRef } from "react";
import { css } from "@emotion/react";
import { Box } from "@mui/material";
import { ButtonGrid } from "../ButtonGrid";
import { TouchStrip } from "../TouchStrip";
import { useKeyboard, type KeyboardState } from "../../hooks/useKeyboard";
import { CHANNEL_COLORS } from "./ChannelColors";
import { VISIBLE_ROWS, VISIBLE_COLS } from "../../store/sequencerStore";
import { useRenderVersion, getIsPlaying } from "../../store/renderStore";
import * as actions from "../../actions";
import {
  SUBDIVISION_TICKS,
  TICKS_PER_QUARTER,
  type ModifySubMode,
  type Subdivision,
} from "../../types/event";
import {
  SCALES,
  NOTE_NAMES,
  SCALE_ORDER,
  buildScaleMapping,
  noteToMidi,
} from "../../types/scales";
import { getDrumName, DRUM_TOTAL_ROWS, DRUM_MIN_ROW } from "../../types/drums";
import { markDirty } from "../../store/renderStore";
import type { WasmEngine } from "../../engine/WasmEngine";

const noop = () => {};

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

// Modifier flag encoding (must match engine_input.h)
const MOD_CTRL = 1;
const MOD_SHIFT = 2;
const MOD_META = 4;
const MOD_ALT = 8;

// Direction constants (must match engine_input.h)
const DIR_UP = 0;
const DIR_DOWN = 1;
const DIR_LEFT = 2;
const DIR_RIGHT = 3;

// Action IDs (must match engine_input.h)
const ACTION_DESELECT = 1;
const ACTION_ZOOM_IN = 2;
const ACTION_ZOOM_OUT = 3;
const ACTION_DELETE_NOTE = 4;
const ACTION_CLEAR_PATTERN = 5;

// UI mode names (index = C enum value)
const UI_MODE_NAMES = ["pattern", "channel", "loop", "modify"] as const;
type UiMode = (typeof UI_MODE_NAMES)[number];

// Sub-mode names (index = C enum value)
const SUB_MODE_NAMES: ModifySubMode[] = [
  "velocity",
  "hit",
  "timing",
  "flam",
  "modulate",
];

// Subdivision names indexed by ticks-per-col (reverse lookup)
const TICKS_TO_SUBDIVISION: Record<number, Subdivision> = {};
for (const [name, tpc] of Object.entries(SUBDIVISION_TICKS)) {
  TICKS_TO_SUBDIVISION[tpc] = name as Subdivision;
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

// Convert uint32 packed 0xRRGGBB to "#RRGGBB" hex string
function uint32ToHex(val: number): string {
  const r = (val >> 16) & 0xff;
  const g = (val >> 8) & 0xff;
  const b = val & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Encode modifier keys into bit flags
function encodeModifiers(state: {
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  alt: boolean;
}): number {
  let flags = 0;
  if (state.ctrl) flags |= MOD_CTRL;
  if (state.shift) flags |= MOD_SHIFT;
  if (state.meta) flags |= MOD_META;
  if (state.alt) flags |= MOD_ALT;
  return flags;
}

// Sub-mode config for OLED display
const SUB_MODE_CONFIG: Record<ModifySubMode, { label: string }> = {
  velocity: { label: "VEL" },
  hit: { label: "HIT" },
  timing: { label: "TIME" },
  flam: { label: "FLAM" },
  modulate: { label: "MOD" },
};

// Loop mode names (index = C enum value)
const LOOP_MODE_NAMES = ["reset", "continue", "fill"] as const;

// ============ Styles ============

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

// ============ Grid Component ============

interface GridProps {
  onPlayNote?: (note: number, channel: number, lengthTicks?: number) => void;
  wasmEngine: WasmEngine;
}

export const Grid = memo(({ onPlayNote, wasmEngine }: GridProps) => {
  // Subscribe to render version — triggers re-render when markDirty() is called
  const renderVersion = useRenderVersion();

  // ============ Read ALL state from WASM (single source of truth) ============
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
  const scaleIdIdx = wasmEngine.getScaleIdIdx();
  const scaleId = SCALE_ORDER[scaleIdIdx] ?? "major";
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

  // Scale mapping for display
  const scalePattern = useMemo(
    () => SCALES[scaleId]?.pattern ?? SCALES.major.pattern,
    [scaleId],
  );
  const scaleMapping = useMemo(
    () => buildScaleMapping(scaleRoot, scalePattern),
    [scaleRoot, scalePattern],
  );

  const totalRows = isDrumChannel ? DRUM_TOTAL_ROWS : scaleMapping.totalRows;
  const minRow = isDrumChannel ? DRUM_MIN_ROW : scaleMapping.minRow;
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

  // ============ Button Press -> WASM ============
  const handleButtonPressFromInput = useCallback(
    (visibleRow: number, visibleCol: number) => {
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

  const handleScrub = useCallback(
    (value: number) => {
      const scrubTick = Math.round(loopStart + value * (loopLength - 1));
      actions.scrubToTick(scrubTick);
    },
    [loopStart, loopLength],
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
      const chordSize = wasmEngine.getSelChordStackSize();
      const chordShape = wasmEngine.getSelChordShapeIndex();
      const chordInv = wasmEngine.getSelChordInversion();

      const noteName = isDrumChannel
        ? getDrumName(selRow)
        : (() => {
            const m = noteToMidi(selRow, scaleMapping);
            return m >= 0 ? midiNoteToName(m) : "??";
          })();
      const lengthDisplay = ticksToDisplay(selLength, ticksPerCol);
      const repeatSpaceDisplay = ticksToDisplay(repeatSpace, ticksPerCol);
      const highlightLength = keyboard.shift && !keyboard.alt && !keyboard.meta;
      const highlightRepeatAmount = keyboard.meta && !keyboard.shift;
      const highlightRepeatSpace = keyboard.meta && keyboard.shift;
      const highlightChord = keyboard.meta;
      const showChord = keyboard.meta || chordSize > 1;

      return {
        rows: [
          {
            label: "NOTE",
            valueParts: [{ text: noteName }, { text: `  ` }, { text: zoom }],
          },
          showChord
            ? {
                label: "CHORD",
                valueParts: [
                  {
                    text: `${chordSize}`,
                    highlight: highlightChord && !keyboard.shift,
                  },
                  {
                    text: chordSize > 1 ? ` S${chordShape + 1}` : "",
                    highlight: highlightChord && keyboard.shift,
                  },
                  {
                    text:
                      chordInv !== 0
                        ? ` I${chordInv > 0 ? "+" : ""}${chordInv}`
                        : "",
                    highlight: keyboard.shift && !keyboard.meta,
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
              const m = noteToMidi(selRow, scaleMapping);
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
    scaleId,
    scaleMapping,
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
                  const m = noteToMidi(startRow, scaleMapping);
                  return m >= 0 ? midiNoteToName(m) : startRow;
                })()} - ${(() => {
                  const m = noteToMidi(endRow, scaleMapping);
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
