import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Box } from "@mui/material";
import { ButtonGrid } from "../ButtonGrid";
import { TouchStrip } from "../TouchStrip";
import { useKeyboard, type KeyboardState } from "../../hooks/useKeyboard";
import { useRenderVersion, markDirty, setAnimatingCheck } from "../../store/renderStore";
import * as actions from "../../actions";
import type { WasmEngine } from "../../engine/WasmEngine";
import { OledRenderer } from "../../engine/OledRenderer";
import {
  gridOuterContainerStyles,
  gridInnerContainerStyles,
  gridContainerStyles,
  verticalStripContainerStyles,
  horizontalStripContainerStyles,
  modifierKeysContainerStyles,
  modifierKeyStyles,
  modifierKeyActiveStyles,
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
  ACTION_DISABLE_NOTE,
} from "./Grid.config";
import { noop, encodeModifiers } from "./Grid.helpers";

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
    // Register animating check so render loop keeps running during inertia/easing
    setAnimatingCheck(() => wasmEngine.isAnimating());
    return () => {
      setAnimatingCheck(null as unknown as () => boolean);
      console.log("[startup] Grid unmounted");
    };
  }, [wasmEngine]);

  // Attach canvas to renderer once
  const oledCanvasAttached = useRef(false);
  useEffect(() => {
    if (
      !oledCanvasAttached.current &&
      oledCanvasRef.current &&
      oledRendererRef.current
    ) {
      oledRendererRef.current.setCanvas(oledCanvasRef.current);
      oledCanvasAttached.current = true;
    }
  });

  // ============ Read ALL state from WASM (single source of truth) ============
  const VISIBLE_ROWS = wasmEngine.getVisibleRows();

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
      // Debug: log all modified keypresses
      if (state.ctrl || state.shift || state.meta || state.alt) {
        const mods = [
          state.ctrl && "Ctrl",
          state.shift && "Shift",
          state.meta && "Cmd",
          state.alt && "Alt",
        ].filter(Boolean).join("+");
        console.log(`[key] ${mods}+${code} (key="${key}")`);
      }

      // Spacebar: toggle play/stop via JS actions (JS manages transport)
      if (key === " " || code === "Space") {
        actions.togglePlay();
        return true;
      }

      // Cmd+Backspace: disable and deselect note
      if (key === "backspace" && state.meta) {
        wasmEngine.keyAction(ACTION_DISABLE_NOTE);
        markDirty();
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

      // Zoom: [ = zoom out, ] = zoom in (only without modifiers to avoid conflicts)
      if (key === "[" && !state.meta && !state.alt) {
        wasmEngine.keyAction(ACTION_ZOOM_OUT);
        markDirty();
        return true;
      }
      if (key === "]" && !state.meta && !state.alt) {
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
  const gridColors = useMemo(() => {
    // Set modifier state before computing grid (for Ctrl overlay + loop pulsing)
    const mods =
      (keyboard.ctrl ? 1 : 0) |
      (keyboard.shift ? 2 : 0) |
      (keyboard.meta ? 4 : 0) |
      (keyboard.alt ? 8 : 0);
    wasmEngine.setModifiersHeld(mods);

    // Tell WASM to compute the grid
    wasmEngine.computeGrid();

    // Read ARGB grid colors from WASM
    const buffers = wasmEngine.readGridBuffers();
    return buffers.gridColors;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasmEngine, renderVersion, keyboard.ctrl, keyboard.meta, keyboard.shift]);

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

  // ============ Arrow button handlers (on-screen UI) ============
  const handleArrow = useCallback(
    (dir: number) => {
      const mods = encodeModifiers(keyboardRef.current);
      wasmEngine.arrowPress(dir, mods);
      markDirty();
    },
    [wasmEngine],
  );

  // ============ OLED Display (rendered entirely in C/WASM) ============
  useEffect(() => {
    const oled = oledRendererRef.current;
    if (!oled) return;
    const mods =
      (keyboard.shift ? 1 : 0) |
      (keyboard.meta ? 2 : 0) |
      (keyboard.alt ? 4 : 0) |
      (keyboard.ctrl ? 8 : 0);
    oled.render(mods);
    oled.blit();
  });

  return (
    <Box css={gridOuterContainerStyles}>
      <Box css={verticalStripContainerStyles}>
        <TouchStrip
          orientation="vertical"
          strip={0}
          wasmEngine={wasmEngine}
          length={gridHeight}
          thickness={24}
        />
      </Box>
      <Box css={gridInnerContainerStyles}>
        <Box css={gridContainerStyles}>
          <ButtonGrid
            gridColors={gridColors}
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
            strip={1}
            wasmEngine={wasmEngine}
            length={buttonSize * 8}
            thickness={24}
          />
        </Box>
      </Box>
      {/* OLED Screen and controls */}
      <Box css={oledContainerStyles}>
        <Box css={oledColumnStyles}>
          <Box css={oledScreenStyles}>
            <canvas
              ref={oledCanvasRef}
              width={256}
              height={128}
              style={{
                width: "100%",
                height: "100%",
                imageRendering: "pixelated",
              }}
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
