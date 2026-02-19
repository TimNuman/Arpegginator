import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { css } from "@emotion/react";
import { Box } from "@mui/material";
import { ButtonGrid } from "../ButtonGrid";
import { TouchStrip } from "../TouchStrip";
import { useKeyboard, type KeyboardState } from "../../hooks/useKeyboard";
import { CHANNEL_COLORS } from "./ChannelColors";
import {
  useSequencerStore,
  VISIBLE_ROWS,
  VISIBLE_COLS,
  type UiMode,
} from "../../store/sequencerStore";
import {
  useCurrentLoop,
  useCurrentPattern,
  usePatternData,
  useZoom,
} from "../../store/selectors";
import * as actions from "../../actions";
import {
  findEventById,
  getEventSubModeLoopMode,
  getEventSubModeArrayLength,
  SUBDIVISION_TICKS,
  TICKS_PER_QUARTER,
  type ModifySubMode,
} from "../../types/event";
import { SCALES, NOTE_NAMES, buildScaleMapping, noteToMidi } from "../../types/scales";
import { getDrumName, DRUM_TOTAL_ROWS, DRUM_MIN_ROW } from "../../types/drums";
import type { WasmEngine } from "../../engine/WasmEngine";

const noop = () => {};

// Keyboard to grid position mapping (same as before)
const KEY_MAP: Record<string, { row: number; col: number }> = {
  "1": { row: 4, col: 0 }, "2": { row: 4, col: 1 }, "3": { row: 4, col: 2 }, "4": { row: 4, col: 3 },
  "5": { row: 4, col: 4 }, "6": { row: 4, col: 5 }, "7": { row: 4, col: 6 }, "8": { row: 4, col: 7 },
  q: { row: 5, col: 0 }, w: { row: 5, col: 1 }, e: { row: 5, col: 2 }, r: { row: 5, col: 3 },
  t: { row: 5, col: 4 }, y: { row: 5, col: 5 }, u: { row: 5, col: 6 }, i: { row: 5, col: 7 },
  a: { row: 6, col: 0 }, s: { row: 6, col: 1 }, d: { row: 6, col: 2 }, f: { row: 6, col: 3 },
  g: { row: 6, col: 4 }, h: { row: 6, col: 5 }, j: { row: 6, col: 6 }, k: { row: 6, col: 7 },
  z: { row: 7, col: 0 }, x: { row: 7, col: 1 }, c: { row: 7, col: 2 }, v: { row: 7, col: 3 },
  b: { row: 7, col: 4 }, n: { row: 7, col: 5 }, m: { row: 7, col: 6 }, ",": { row: 7, col: 7 },
};

// Modifier flag encoding (must match engine_input.h)
const MOD_CTRL  = 1;
const MOD_SHIFT = 2;
const MOD_META  = 4;
const MOD_ALT   = 8;

// Direction constants (must match engine_input.h)
const DIR_UP    = 0;
const DIR_DOWN  = 1;
const DIR_LEFT  = 2;
const DIR_RIGHT = 3;

// Action IDs (must match engine_input.h)
const ACTION_DESELECT      = 1;
const ACTION_ZOOM_IN       = 2;
const ACTION_ZOOM_OUT      = 3;
const ACTION_DELETE_NOTE    = 4;
const ACTION_CLEAR_PATTERN  = 5;

// UI mode IDs (must match engine_core.h)
const UI_MODE_PATTERN = 0;
const UI_MODE_CHANNEL = 1;
const UI_MODE_LOOP    = 2;
const UI_MODE_MODIFY  = 3;

const UI_MODE_MAP: Record<UiMode, number> = {
  pattern: UI_MODE_PATTERN,
  channel: UI_MODE_CHANNEL,
  loop: UI_MODE_LOOP,
  modify: UI_MODE_MODIFY,
};

const UI_MODE_NAMES: UiMode[] = ["pattern", "channel", "loop", "modify"];

// Sub-mode IDs (must match engine_core.h)
const SUB_MODE_MAP: Record<ModifySubMode, number> = {
  velocity: 0, hit: 1, timing: 2, flam: 3, modulate: 4,
};

const SUB_MODE_NAMES: ModifySubMode[] = ["velocity", "hit", "timing", "flam", "modulate"];

// Convert MIDI note number to note name
const midiNoteToName = (midiNote: number): string => {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
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
  const r = (val >> 16) & 0xFF;
  const g = (val >> 8) & 0xFF;
  const b = val & 0xFF;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Encode modifier keys into bit flags
function encodeModifiers(state: { ctrl: boolean; shift: boolean; meta: boolean; alt: boolean }): number {
  let flags = 0;
  if (state.ctrl)  flags |= MOD_CTRL;
  if (state.shift) flags |= MOD_SHIFT;
  if (state.meta)  flags |= MOD_META;
  if (state.alt)   flags |= MOD_ALT;
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

  // Store subscriptions (minimal — just what we need for OLED, strips, and syncing)
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
  const isDrumChannel = channelType === "drum";
  const currentPattern = useCurrentPattern();
  const currentLoop = useCurrentLoop();
  const patternData = usePatternData();
  const zoom = useZoom();

  const channelColor = CHANNEL_COLORS[currentChannel];
  const rowOffset = rowOffsets[currentChannel];

  // Tick-based layout
  const ticksPerCol = SUBDIVISION_TICKS[zoom];
  const totalCols = Math.ceil(patternData.lengthTicks / ticksPerCol);

  // Scale mapping for OLED display and row calculations
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
  const startArrayIndex = maxRowOffset > 0
    ? Math.round((1 - rowOffsets[currentChannel]) * maxRowOffset)
    : 0;
  const startRow = startArrayIndex + minRow;
  const endRow = startRow + VISIBLE_ROWS - 1;
  const startCol = maxColOffset > 0
    ? Math.round(colOffset * maxColOffset)
    : 0;
  const startTick = startCol * ticksPerCol;

  // Looped tick for OLED display
  const loopEndTick = currentLoop.start + currentLoop.length;

  const buttonSize = 44;
  const gridHeight = VISIBLE_ROWS * buttonSize;

  // ============ Sync WASM UI State from Store ============
  // Keep WASM engine UI state in sync whenever the Zustand store changes
  useEffect(() => {
    wasmEngine.setUiMode(UI_MODE_MAP[uiMode]);
  }, [wasmEngine, uiMode]);

  useEffect(() => {
    wasmEngine.setModifySubMode(SUB_MODE_MAP[modifySubMode]);
  }, [wasmEngine, modifySubMode]);

  useEffect(() => {
    wasmEngine.setCurrentChannel(currentChannel);
  }, [wasmEngine, currentChannel]);

  useEffect(() => {
    wasmEngine.setZoom(ticksPerCol);
  }, [wasmEngine, ticksPerCol]);

  useEffect(() => {
    // Convert selectedNoteId (UUID) to WASM event index
    if (selectedNoteId) {
      const store = useSequencerStore.getState();
      const patIdx = store.currentPatterns[store.currentChannel];
      const idx = wasmEngine.getEventIndex(store.currentChannel, patIdx, selectedNoteId);
      wasmEngine.setSelectedEvent(idx);
    } else {
      wasmEngine.setSelectedEvent(-1);
    }
  }, [wasmEngine, selectedNoteId]);

  useEffect(() => {
    for (let ch = 0; ch < 8; ch++) {
      wasmEngine.setRowOffset(ch, rowOffsets[ch]);
    }
  }, [wasmEngine, rowOffsets]);

  useEffect(() => {
    wasmEngine.setColOffset(colOffset);
  }, [wasmEngine, colOffset]);

  useEffect(() => {
    wasmEngine.setIsPlaying(isPlaying);
  }, [wasmEngine, isPlaying]);

  useEffect(() => {
    wasmEngine.setScaleRoot(scaleRoot);
  }, [wasmEngine, scaleRoot]);

  // Set channel colors once
  useEffect(() => {
    for (let ch = 0; ch < 8; ch++) {
      const hex = CHANNEL_COLORS[ch];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      wasmEngine.setChannelColor(ch, (r << 16) | (g << 8) | b);
    }
  }, [wasmEngine]);

  // ============ Keyboard → WASM ============
  const keyboardRef = useRef<KeyboardState>({
    pressedKeys: new Set(),
    ctrl: false, shift: false, meta: false, alt: false,
  });

  const handleKeyDown = useCallback(
    (key: string, code: string, event: KeyboardEvent, state: KeyboardState): boolean => {
      // Spacebar: toggle play/stop via JS actions (not WASM — JS manages transport)
      if (key === " " || code === "Space") {
        actions.togglePlay();
        return true;
      }

      // Backspace: deselect / reset playhead
      if (key === "backspace") {
        wasmEngine.keyAction(ACTION_DESELECT);
        syncWasmStateBack(wasmEngine);
        return true;
      }

      // Delete
      if (key === "delete" || code === "Delete") {
        wasmEngine.keyAction(ACTION_DELETE_NOTE);
        syncWasmStateBack(wasmEngine);
        return true;
      }

      // Zoom: [ = zoom out, ] = zoom in
      if (key === "[") {
        wasmEngine.keyAction(ACTION_ZOOM_OUT);
        syncWasmStateBack(wasmEngine);
        return true;
      }
      if (key === "]") {
        wasmEngine.keyAction(ACTION_ZOOM_IN);
        syncWasmStateBack(wasmEngine);
        return true;
      }

      // Arrow keys → WASM
      const arrowMap: Record<string, number> = {
        ArrowUp: DIR_UP,
        ArrowDown: DIR_DOWN,
        ArrowLeft: DIR_LEFT,
        ArrowRight: DIR_RIGHT,
      };
      if (code in arrowMap) {
        const mods = encodeModifiers(state);
        wasmEngine.arrowPress(arrowMap[code], mods);
        syncWasmStateBack(wasmEngine);
        return true;
      }

      // Grid key: forward as button press
      if (!event.repeat) {
        const gridPos = KEY_MAP[key];
        if (gridPos) {
          const mods = encodeModifiers(state);
          wasmEngine.buttonPress(gridPos.row, gridPos.col, mods);
          syncWasmStateBack(wasmEngine);
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
  }, [
    wasmEngine,
    // Re-compute when any relevant state changes
    uiMode, modifySubMode, currentChannel, currentTick, isPlaying,
    selectedNoteId, rowOffsets, colOffset, ticksPerCol,
    currentLoop.start, currentLoop.length,
    patternData.events, patternData.lengthTicks,
    scaleRoot, scaleId, isDrumChannel,
    keyboard.ctrl,
  ]);

  // ============ Button Press → WASM ============
  const handleButtonPressFromInput = useCallback(
    (visibleRow: number, visibleCol: number) => {
      const mods = encodeModifiers(keyboardRef.current);
      wasmEngine.buttonPress(visibleRow, visibleCol, mods);
      syncWasmStateBack(wasmEngine);
    },
    [wasmEngine],
  );

  const handleButtonDragEnter = useCallback(
    (visibleRow: number, visibleCol: number) => {
      const mods = encodeModifiers(keyboardRef.current);
      wasmEngine.buttonPress(visibleRow, visibleCol, mods);
      syncWasmStateBack(wasmEngine);
    },
    [wasmEngine],
  );

  // ============ Sync WASM state changes back to Zustand ============
  // After any WASM input, read back state that may have changed
  function syncWasmStateBack(engine: WasmEngine): void {
    const store = useSequencerStore.getState();

    // UI mode
    const wasmUiMode = engine.getUiMode();
    if (UI_MODE_NAMES[wasmUiMode] !== store.view.uiMode) {
      store._setView({ uiMode: UI_MODE_NAMES[wasmUiMode] });
    }

    // Modify sub-mode
    const wasmSubMode = engine.getModifySubMode();
    if (SUB_MODE_NAMES[wasmSubMode] !== store.view.modifySubMode) {
      store._setView({ modifySubMode: SUB_MODE_NAMES[wasmSubMode] });
    }

    // Current channel
    const wasmChannel = engine.getCurrentChannel();
    if (wasmChannel !== store.currentChannel) {
      store._setCurrentChannel(wasmChannel);
    }

    // Zoom (ticks per col → subdivision name)
    const wasmZoom = engine.getZoom();
    const currentTicksPerCol = SUBDIVISION_TICKS[store.view.zoom];
    if (wasmZoom !== currentTicksPerCol) {
      // Find matching subdivision
      for (const [name, tpc] of Object.entries(SUBDIVISION_TICKS)) {
        if (tpc === wasmZoom) {
          store._setView({ zoom: name as typeof store.view.zoom });
          break;
        }
      }
    }

    // Selected event — convert WASM index back to UUID
    const wasmSelected = engine.getSelectedEvent();
    if (wasmSelected < 0) {
      if (store.view.selectedNoteId !== null) {
        store._setView({ selectedNoteId: null });
      }
    } else {
      const patIdx = store.currentPatterns[store.currentChannel];
      const eventId = engine.getEventId(store.currentChannel, patIdx, wasmSelected);
      if (eventId && eventId !== store.view.selectedNoteId) {
        store._setView({ selectedNoteId: eventId });
      }
    }

    // Note: Playing state is managed by JS (actions.togglePlay), not synced from WASM

    // Sync pattern data from WASM → Zustand (for OLED display + syncAll correctness)
    engine.readCurrentPatternToStore();
  }

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
  if (isPlaying && currentTick >= 0 && !manualScrollOverride.current && uiMode !== "loop") {
    const loopedTick =
      currentLoop.start +
      ((((currentTick - currentLoop.start) % currentLoop.length) +
        currentLoop.length) %
        currentLoop.length);
    const loopStartCol = Math.floor(currentLoop.start / ticksPerCol);
    const loopLengthCols = Math.ceil(currentLoop.length / ticksPerCol);
    const loopEndCol = Math.ceil(loopEndTick / ticksPerCol);

    if (loopLengthCols > VISIBLE_COLS) {
      const FOLLOW_COL = 4;
      const loopedCol = Math.floor((loopedTick - currentLoop.start) / ticksPerCol) + loopStartCol;
      let targetStartCol = loopedCol - FOLLOW_COL;
      targetStartCol = Math.max(targetStartCol, loopStartCol);
      const maxLoopStartCol = loopEndCol - VISIBLE_COLS;
      targetStartCol = Math.min(targetStartCol, maxLoopStartCol);
      targetStartCol = Math.max(0, Math.min(maxColOffset, targetStartCol));
      const newColOffset = maxColOffset > 0
        ? Math.max(0, Math.min(1, targetStartCol / maxColOffset))
        : 0;
      if (Math.abs(newColOffset - colOffset) > 0.001) {
        actions.setColOffset(newColOffset);
      }
    }
  }

  // ============ Scroll Handlers ============
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

  const handleScrub = useCallback(
    (value: number) => {
      const scrubTick = Math.round(currentLoop.start + value * (currentLoop.length - 1));
      actions.scrubToTick(scrubTick);
    },
    [currentLoop.start, currentLoop.length],
  );

  const handleScrubEnd = useCallback(() => {
    actions.scrubEnd();
  }, []);

  // ============ Arrow button handlers (on-screen UI) ============
  const handleArrow = useCallback(
    (dir: number) => {
      const mods = encodeModifiers(keyboardRef.current);
      wasmEngine.arrowPress(dir, mods);
      syncWasmStateBack(wasmEngine);
    },
    [wasmEngine],
  );

  // ============ OLED Display ============
  type OledValuePart = { text: string; highlight?: boolean };
  type OledRow = { label: string; valueParts: OledValuePart[] };

  const selectedEvent = useMemo(
    () => selectedNoteId ? findEventById(patternData.events, selectedNoteId) ?? null : null,
    [selectedNoteId, patternData.events],
  );

  const getOledContent = useCallback((): { rows: OledRow[] } => {
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
      if (selectedEvent) {
        const noteName = isDrumChannel
          ? getDrumName(selectedEvent.row)
          : (() => { const m = noteToMidi(selectedEvent.row, scaleMapping); return m >= 0 ? midiNoteToName(m) : "??"; })();
        const loopMode = getEventSubModeLoopMode(selectedEvent, modifySubMode);
        const loopModeLabel = loopMode === "reset" ? "RST" : loopMode === "continue" ? "CNT" : "FIL";
        const arrLen = getEventSubModeArrayLength(selectedEvent, modifySubMode);
        return {
          rows: [
            { label: "NOTE", valueParts: [{ text: noteName }] },
            { label: "SUB", valueParts: [{ text: subModeLabel, highlight: true }] },
            { label: "LOOP", valueParts: [
              { text: loopModeLabel, highlight: loopMode === "continue" },
              { text: ` L${arrLen}` },
            ] },
          ],
        };
      }
      return {
        rows: [
          { label: "SUB", valueParts: [{ text: subModeLabel, highlight: true }] },
          { label: "", valueParts: [{ text: "SELECT" }] },
          { label: "", valueParts: [{ text: "A NOTE" }] },
        ],
      };
    }

    if (uiMode === "channel") {
      return {
        rows: [
          { label: "MODE", valueParts: [{ text: "CHANNEL" }] },
          { label: "SELECT", valueParts: [{ text: `CH ${currentChannel + 1}` }] },
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
          { label: "START", valueParts: [{ text: tickToBeatDisplay(currentLoop.start), highlight: highlightStart }] },
          { label: "END", valueParts: [{ text: tickToBeatDisplay(loopEndTick), highlight: highlightEnd }] },
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
    uiMode, modifySubMode, selectedEvent, keyboard,
    currentChannel, currentPattern, currentLoop, loopEndTick,
    ticksPerCol, zoom, scaleRoot, scaleId, scaleMapping, isDrumChannel,
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
            <Box css={[modifierKeyStyles, keyboard.ctrl && modifierKeyActiveStyles]}>ctrl</Box>
            <Box css={[modifierKeyStyles, keyboard.shift && modifierKeyActiveStyles]}>shift</Box>
            <Box css={[modifierKeyStyles, keyboard.meta && modifierKeyActiveStyles]}>cmd</Box>
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
          <Box css={rotaryEncoderStyles}>
            <Box css={rotaryKnobStyles} />
          </Box>
          <Box css={arrowButtonContainerStyles}>
            <Box css={arrowButtonRowStyles}>
              <Box css={arrowButtonStyles} onClick={() => handleArrow(DIR_UP)}>▲</Box>
            </Box>
            <Box css={arrowButtonRowStyles}>
              <Box css={arrowButtonStyles} onClick={() => handleArrow(DIR_LEFT)}>◀</Box>
              <Box css={arrowButtonStyles} onClick={() => handleArrow(DIR_DOWN)}>▼</Box>
              <Box css={arrowButtonStyles} onClick={() => handleArrow(DIR_RIGHT)}>▶</Box>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
});

Grid.displayName = "Grid";
