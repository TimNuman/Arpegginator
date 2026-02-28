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
  OledRenderer,
  OLED_CYAN,
  OLED_YELLOW,
  OLED_RED,
  OLED_DIM,
  OLED_FONT_MAIN,
  OLED_FONT_SMALL,
} from "../../engine/OledRenderer";
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
  ticksToCanonicalName,
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
    console.log(
      "[startup] Grid mounted, wasmEngine version=" + wasmEngine.getVersion(),
    );
    // Initialize OLED renderer
    if (!oledRendererRef.current) {
      oledRendererRef.current = wasmEngine.createOledRenderer();
    }
    return () => console.log("[startup] Grid unmounted");
  }, [wasmEngine]);

  // Attach canvas to renderer once
  const oledCanvasAttached = useRef(false);
  useEffect(() => {
    if (!oledCanvasAttached.current && oledCanvasRef.current && oledRendererRef.current) {
      oledRendererRef.current.setCanvas(oledCanvasRef.current);
      oledCanvasAttached.current = true;
    }
  });

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

  const totalRows = isDrumChannel
    ? DRUM_TOTAL_ROWS
    : wasmEngine.getScaleCount();
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
  const oledCanvasRef = useRef<HTMLCanvasElement>(null);
  const oledRendererRef = useRef<OledRenderer | null>(null);

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
      console.log(
        "[grid] buttonPress row=" +
          visibleRow +
          " col=" +
          visibleCol +
          " wasmReady=" +
          wasmEngine.isReady(),
      );
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

  // ============ OLED Display (canvas-rendered via WASM) ============
  // Row Y baselines for font_main (yAdvance=19, ascent~11)
  const ROW_Y = [14, 33, 52, 71, 90, 109];
  const LABEL_X = 2;
  const VALUE_X = 2;

  // Helper: draw a labeled row (label in small dim font, value after)
  const drawLabeledRow = (
    oled: OledRenderer,
    y: number,
    label: string,
    value: string,
    valueColor = OLED_CYAN,
  ) => {
    if (label) {
      oled.drawText(LABEL_X, y, label, OLED_DIM, OLED_FONT_SMALL);
      const labelW = oled.textWidth(label + " ", OLED_FONT_SMALL);
      oled.drawText(LABEL_X + labelW, y, value, valueColor);
    } else {
      oled.drawText(VALUE_X, y, value, valueColor);
    }
  };

  // Helper: draw colored text segments at x, return new x
  const drawSegments = (
    oled: OledRenderer,
    x: number,
    y: number,
    segments: Array<{ text: string; color: number }>,
  ): number => {
    let cx = x;
    for (const seg of segments) {
      oled.drawText(cx, y, seg.text, seg.color);
      cx += oled.textWidth(seg.text);
    }
    return cx;
  };

  const renderOled = useCallback(() => {
    const oled = oledRendererRef.current;
    if (!oled) return;
    oled.clear();

    if (uiMode === "pattern" && hasSelection) {
      const selRow = wasmEngine.getSelRow();
      const selLength = wasmEngine.getSelLength();
      const repeatAmount = wasmEngine.getSelRepeatAmount();
      const repeatSpace = wasmEngine.getSelRepeatSpace();
      const chordAmount = wasmEngine.getSelChordAmount();
      const chordSpace = wasmEngine.getSelChordSpace();
      const arpStyle = wasmEngine.getSelArpStyle();
      const arpOffset = wasmEngine.getSelArpOffset();
      const arpVoices = wasmEngine.getSelArpVoices();
      const ARP_STYLE_NAMES = ["CHD", "UP", "DN", "U/D", "D/U"];

      const noteName = isDrumChannel
        ? getDrumName(selRow)
        : (() => {
            const m = wasmEngine.noteToMidi(selRow);
            return m >= 0 ? midiNoteToName(m) : "??";
          })();
      const lengthDisplay = ticksToMusicalName(selLength, ticksPerCol);
      const repeatSpaceDisplay = ticksToCanonicalName(repeatSpace);
      const chordVoicing =
        chordAmount > 1 ? wasmEngine.getSelChordVoicing() : 0;
      const voicingName =
        chordAmount > 1
          ? wasmEngine.getVoicingName(chordAmount, chordSpace, chordVoicing)
          : "";
      const rawChordName = chordAmount > 1 ? wasmEngine.getChordName() : "";
      const octSuffix =
        voicingName.match(/\+?(\d*oct)/)?.[0]?.replace(/^([^+])/, "+$1") ?? "";
      const chordName = rawChordName
        ? `${rawChordName}${octSuffix ? ` ${octSuffix}` : ""}`
        : "";

      const { shift, meta, alt } = keyboard;
      type HTarget = "none" | "move" | "length" | "rptAmt" | "rptSpace" | "arpOffset" | "arpVoices";
      type VTarget = "none" | "move" | "inversion" | "chdAmt" | "chdSpace" | "arpStyle" | "voicing";
      let hTarget: HTarget = "none";
      let vTarget: VTarget = "none";

      if (meta && shift) { hTarget = "rptSpace"; vTarget = "chdSpace"; }
      else if (meta) { hTarget = "rptAmt"; vTarget = "chdAmt"; }
      else if (alt && shift) { hTarget = "arpVoices"; vTarget = "voicing"; }
      else if (alt) { hTarget = "arpOffset"; vTarget = "arpStyle"; }
      else if (shift) { hTarget = "length"; vTarget = "inversion"; }

      // Row 0: note + chord info
      let cx = VALUE_X;
      oled.drawText(cx, ROW_Y[0], noteName, OLED_CYAN);
      cx += oled.textWidth(noteName);
      if (chordAmount > 1 && chordSpace === 1) {
        const topRow = selRow + (chordAmount - 1);
        const topName = isDrumChannel
          ? getDrumName(topRow)
          : (() => { const m = wasmEngine.noteToMidi(topRow); return m >= 0 ? midiNoteToName(m) : "??"; })();
        oled.drawText(cx, ROW_Y[0], ` to ${topName}`, OLED_CYAN);
      } else if (chordAmount === 2) {
        const secondRow = selRow + chordSpace;
        const secondName = isDrumChannel
          ? getDrumName(secondRow)
          : (() => { const m = wasmEngine.noteToMidi(secondRow); return m >= 0 ? midiNoteToName(m) : "??"; })();
        const INTERVAL_NAMES = ["unison","min 2nd","2nd","min 3rd","3rd","4th","tritone","5th","min 6th","6th","min 7th","7th"];
        const midi1 = wasmEngine.noteToMidi(selRow);
        const midi2 = wasmEngine.noteToMidi(secondRow);
        const semitones = Math.abs(midi2 - midi1);
        const intervalName = semitones === 12 ? "octave"
          : semitones > 12 ? `${INTERVAL_NAMES[semitones % 12]} +oct`
          : INTERVAL_NAMES[semitones] ?? `${semitones}st`;
        oled.drawText(cx, ROW_Y[0], ` - ${secondName} (${intervalName})`, OLED_CYAN);
      } else if (chordAmount > 2) {
        oled.drawText(cx, ROW_Y[0], " - ", OLED_CYAN);
        cx += oled.textWidth(" - ");
        const chordLabel = chordName || `${chordAmount}x${chordSpace}`;
        oled.drawText(cx, ROW_Y[0], chordLabel, vTarget === "voicing" ? OLED_RED : OLED_CYAN);
      }

      // Row 1: length x amount @ space
      drawSegments(oled, VALUE_X, ROW_Y[1], [
        { text: lengthDisplay, color: hTarget === "length" ? OLED_YELLOW : OLED_CYAN },
        { text: " x ", color: OLED_CYAN },
        { text: `${repeatAmount}`, color: hTarget === "rptAmt" ? OLED_YELLOW : OLED_CYAN },
        { text: " @ ", color: OLED_CYAN },
        { text: repeatSpaceDisplay, color: hTarget === "rptSpace" ? OLED_YELLOW : OLED_CYAN },
      ]);

      // Row 2+: modifier legends or default "Move"
      let xLabel = "Move";
      let yLabel = "Move";
      if (meta && shift) { xLabel = "Repeat space"; yLabel = "Stack space"; }
      else if (meta) { xLabel = "Repeat amount"; yLabel = "Stack size"; }
      else if (alt && shift) { xLabel = "Arp voices"; yLabel = "Voicing"; }
      else if (alt) { xLabel = "Arp offset"; yLabel = "Arp style"; }
      else if (shift) { xLabel = "Length"; yLabel = chordAmount > 1 ? "Inversion" : "Move octave"; }

      const hasModifier = shift || meta || alt;
      if (hasModifier) {
        const inv = wasmEngine.getSelChordInversion();
        const yValue: Record<VTarget, string> = {
          none: "", move: "",
          inversion: chordAmount > 1 ? `${inv >= 0 ? "+" : ""}${inv}` : "",
          chdAmt: `${chordAmount}`, chdSpace: `${chordSpace}`,
          arpStyle: ARP_STYLE_NAMES[arpStyle] ?? "CHD", voicing: voicingName || "base",
        };
        const xValue: Record<HTarget, string> = {
          none: "", move: "",
          length: lengthDisplay, rptAmt: `${repeatAmount}`, rptSpace: repeatSpaceDisplay,
          arpOffset: `${arpOffset > 0 ? "+" : ""}${arpOffset}`, arpVoices: `${arpVoices}`,
        };
        // Vertical legend
        const yLegend = `^v ${yLabel}: `;
        oled.drawText(VALUE_X, ROW_Y[2], yLegend, OLED_RED);
        if (yValue[vTarget]) {
          oled.drawText(VALUE_X + oled.textWidth(yLegend), ROW_Y[2], yValue[vTarget], OLED_CYAN);
        }
        // Horizontal legend
        const xLegend = `<> ${xLabel}: `;
        oled.drawText(VALUE_X, ROW_Y[3], xLegend, OLED_YELLOW);
        if (xValue[hTarget]) {
          oled.drawText(VALUE_X + oled.textWidth(xLegend), ROW_Y[3], xValue[hTarget], OLED_CYAN);
        }
      } else {
        oled.drawText(VALUE_X, ROW_Y[2], "<^v> Move", OLED_CYAN);
      }
    } else if (uiMode === "modify") {
      const subModeLabel = SUB_MODE_CONFIG[modifySubMode].label;
      if (hasSelection) {
        const selRow = wasmEngine.getSelRow();
        const noteName = isDrumChannel
          ? getDrumName(selRow)
          : (() => { const m = wasmEngine.noteToMidi(selRow); return m >= 0 ? midiNoteToName(m) : "??"; })();
        const loopModeVal = wasmEngine.getSelSubModeLoopMode(modifySubModeIdx);
        const loopMode = LOOP_MODE_NAMES[loopModeVal] ?? "reset";
        const loopModeLabel = loopMode === "reset" ? "RST" : loopMode === "continue" ? "CNT" : "FIL";
        const arrLen = wasmEngine.getSelSubModeArrayLength(modifySubModeIdx);
        const { meta: mMeta } = keyboard;

        // Row 0: note + sub-mode
        drawSegments(oled, VALUE_X, ROW_Y[0], [
          { text: noteName, color: OLED_CYAN },
          { text: ` ${subModeLabel}`, color: mMeta ? OLED_RED : OLED_CYAN },
        ]);
        // Row 1: loop mode + length
        drawSegments(oled, VALUE_X, ROW_Y[1], [
          { text: loopModeLabel, color: !mMeta ? OLED_RED : OLED_CYAN },
          { text: ` L${arrLen}`, color: !mMeta ? OLED_YELLOW : OLED_CYAN },
        ]);

        if (mMeta) {
          const legend = `^v Sub-mode: `;
          oled.drawText(VALUE_X, ROW_Y[2], legend, OLED_RED);
          oled.drawText(VALUE_X + oled.textWidth(legend), ROW_Y[2], subModeLabel, OLED_CYAN);
        } else {
          const yLeg = `^v Loop mode: `;
          oled.drawText(VALUE_X, ROW_Y[2], yLeg, OLED_RED);
          oled.drawText(VALUE_X + oled.textWidth(yLeg), ROW_Y[2], loopModeLabel, OLED_CYAN);
          const xLeg = `<> Length: `;
          oled.drawText(VALUE_X, ROW_Y[3], xLeg, OLED_YELLOW);
          oled.drawText(VALUE_X + oled.textWidth(xLeg), ROW_Y[3], `${arrLen}`, OLED_CYAN);
        }
      } else {
        const { meta: mMeta } = keyboard;
        oled.drawText(VALUE_X, ROW_Y[0], subModeLabel, mMeta ? OLED_RED : OLED_CYAN);
        oled.drawText(VALUE_X, ROW_Y[1], "SELECT A NOTE", OLED_CYAN);
        if (mMeta) {
          const legend = `^v Sub-mode: `;
          oled.drawText(VALUE_X, ROW_Y[2], legend, OLED_RED);
          oled.drawText(VALUE_X + oled.textWidth(legend), ROW_Y[2], subModeLabel, OLED_CYAN);
        }
      }
    } else if (uiMode === "channel") {
      drawLabeledRow(oled, ROW_Y[0], "MODE", "CHANNEL");
      drawLabeledRow(oled, ROW_Y[1], "SELECT", `CH ${currentChannel + 1}`);
      drawLabeledRow(oled, ROW_Y[2], "PAT", `${currentPattern + 1}`);
    } else if (uiMode === "loop") {
      const lShift = keyboard.shift;
      drawLabeledRow(oled, ROW_Y[0], "MODE", "LOOP");
      drawSegments(oled, VALUE_X, ROW_Y[1], [
        { text: `S ${tickToBeatDisplay(loopStart)}`, color: lShift ? OLED_YELLOW : OLED_CYAN },
        { text: `  E ${tickToBeatDisplay(loopEndTick)}`, color: !lShift ? OLED_YELLOW : OLED_CYAN },
      ]);
      if (lShift) {
        const leg = `<> Start: `;
        oled.drawText(VALUE_X, ROW_Y[2], leg, OLED_YELLOW);
        oled.drawText(VALUE_X + oled.textWidth(leg), ROW_Y[2], tickToBeatDisplay(loopStart), OLED_CYAN);
      } else {
        const leg = `<> End: `;
        oled.drawText(VALUE_X, ROW_Y[2], leg, OLED_YELLOW);
        oled.drawText(VALUE_X + oled.textWidth(leg), ROW_Y[2], tickToBeatDisplay(loopEndTick), OLED_CYAN);
      }
    } else if (keyboard.shift) {
      drawLabeledRow(oled, ROW_Y[0], "MODE", "EXTEND");
      drawLabeledRow(oled, ROW_Y[1], "NOTE", "DRAG");
    } else {
      // Default pattern mode (no selection)
      const scaleRootName = NOTE_NAMES[scaleRoot];
      const scaleName = wasmEngine.getScaleName();
      const pAlt = keyboard.alt;

      drawSegments(oled, VALUE_X, ROW_Y[0], [
        { text: `CH ${currentChannel + 1}`, color: OLED_CYAN },
        { text: `  PAT ${currentPattern + 1}`, color: OLED_CYAN },
      ]);

      if (isDrumChannel) {
        drawLabeledRow(oled, ROW_Y[1], "TYPE", "DRUMS");
      } else {
        const lx = LABEL_X;
        oled.drawText(lx, ROW_Y[1], "KEY", OLED_DIM, OLED_FONT_SMALL);
        const kx = lx + oled.textWidth("KEY ", OLED_FONT_SMALL);
        let cx2 = kx;
        oled.drawText(cx2, ROW_Y[1], scaleRootName, pAlt ? OLED_YELLOW : OLED_CYAN);
        cx2 += oled.textWidth(scaleRootName + " ");
        oled.drawText(cx2, ROW_Y[1], scaleName, pAlt ? OLED_RED : OLED_CYAN);
      }

      if (pAlt && !isDrumChannel) {
        const yLeg = `^v Scale: `;
        oled.drawText(VALUE_X, ROW_Y[2], yLeg, OLED_RED);
        oled.drawText(VALUE_X + oled.textWidth(yLeg), ROW_Y[2], scaleName, OLED_CYAN);
        const xLeg = `<> Root: `;
        oled.drawText(VALUE_X, ROW_Y[3], xLeg, OLED_YELLOW);
        oled.drawText(VALUE_X + oled.textWidth(xLeg), ROW_Y[3], scaleRootName, OLED_CYAN);
      } else {
        drawLabeledRow(oled, ROW_Y[2], "LOOP",
          `${tickToBeatDisplay(loopStart)}-${tickToBeatDisplay(loopEndTick)}`);
      }
    }

    oled.blit();
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

  // Render OLED after every render (runs after canvas attach useEffect)
  useEffect(() => {
    renderOled();
  });

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
              css={[modifierKeyStyles, keyboard.alt && modifierKeyActiveStyles]}
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
            <canvas
              ref={oledCanvasRef}
              width={160}
              height={128}
              style={{ width: '100%', height: '100%', imageRendering: 'pixelated' }}
            />
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
