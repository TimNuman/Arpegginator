import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { ButtonGrid } from "../ButtonGrid";
import { TouchStrip } from "../TouchStrip";
import { RotaryEncoder } from "../RotaryEncoder";
import { useKeyboard, type KeyboardState } from "../../hooks/useKeyboard";
import { useRenderVersion, markDirty, setAnimatingCheck } from "../../store/renderStore";
import * as actions from "../../actions";
import type { Engine } from "../../engine/types";
import { OledRenderer } from "../../engine/OledRenderer";
import { chrome } from "../../theme/chrome";
import {
  gridOuterContainerStyles,
  gridInnerContainerStyles,
  gridContainerStyles,
  verticalStripContainerStyles,
  horizontalStripContainerStyles,
  modifierKeysContainerStyles,
  modifierKeyStyles,
  modifierKeyActiveStyles,
  modifierKeyLatchedStyles,
  modifierKeyFnStyles,
  oledContainerStyles,
  oledColumnStyles,
  oledScreenStyles,
  encoderRowStyles,
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

// ============ Modifier Key ============

/** Max gap between two taps to count as a double tap (latch), in ms */
const DOUBLE_TAP_MS = 300;

interface ModifierKeyProps {
  name: string;
  /** Function hint under the name, same wording as the OLED legend */
  fn: string;
  active: boolean;
  latched: boolean;
  onHold: (held: boolean) => void;
  onLatch: (latched: boolean) => void;
}

/**
 * On-screen modifier key:
 * - press and hold: momentary, released on lift (multi-touch friendly —
 *   each key tracks its own pointer, so several can be held at once)
 * - double tap: latch sticky until tapped again
 */
const ModifierKey = memo(({ name, fn, active, latched, onHold, onLatch }: ModifierKeyProps) => {
  const lastDownAt = useRef(-Infinity);

  return (
    <Box
      css={[
        modifierKeyStyles,
        active && modifierKeyActiveStyles,
        latched && modifierKeyLatchedStyles,
      ]}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const now = performance.now();
        if (latched) {
          onLatch(false);
        } else if (now - lastDownAt.current < DOUBLE_TAP_MS) {
          onLatch(true);
        }
        lastDownAt.current = now;
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span>{name}</span>
      {fn && <span css={modifierKeyFnStyles}>{fn}</span>}
    </Box>
  );
});

ModifierKey.displayName = "ModifierKey";

// ============ Grid Component ============

interface GridProps {
  wasmEngine: Engine;
}

export const Grid = memo(({ wasmEngine }: GridProps) => {
  // Subscribe to render version — triggers re-render when markDirty() is called
  const renderVersion = useRenderVersion();

  useEffect(() => {
    console.log("[startup] Grid mounted, wasmEngine version=" + wasmEngine.getVersion());
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
    if (!oledCanvasAttached.current && oledCanvasRef.current && oledRendererRef.current) {
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
    (key: string, code: string, event: KeyboardEvent, state: KeyboardState): boolean => {
      // Debug: log all modified keypresses
      if (state.ctrl || state.shift || state.meta || state.alt) {
        const mods = [
          state.ctrl && "Ctrl",
          state.shift && "Shift",
          state.meta && "Cmd",
          state.alt && "Alt",
        ]
          .filter(Boolean)
          .join("+");
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

  // Momentary on-screen modifiers: held while the key is pressed, so touch
  // devices without a keyboard can use modified presses (multi-touch friendly)
  const [touchMods, setTouchMods] = useState({
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
  });
  const holdTouchMod = useCallback((key: "shift" | "ctrl" | "alt" | "meta", held: boolean) => {
    setTouchMods((m) => (m[key] === held ? m : { ...m, [key]: held }));
  }, []);

  // Double-tapped (sticky) modifiers: stay on until the key is tapped again
  const [latchedMods, setLatchedMods] = useState({
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
  });
  const latchMod = useCallback((key: "shift" | "ctrl" | "alt" | "meta", latched: boolean) => {
    setLatchedMods((m) => (m[key] === latched ? m : { ...m, [key]: latched }));
  }, []);

  // Effective modifiers: physical keyboard OR on-screen hold OR latch
  const mods = {
    shift: keyboard.shift || touchMods.shift || latchedMods.shift,
    ctrl: keyboard.ctrl || touchMods.ctrl || latchedMods.ctrl,
    alt: keyboard.alt || touchMods.alt || latchedMods.alt,
    meta: keyboard.meta || touchMods.meta || latchedMods.meta,
  };

  // Keep refs in sync for mouse/touch handlers
  keyboardRef.current = keyboard;
  const modsRef = useRef(mods);
  modsRef.current = mods;

  // OLED-encoded modifier bits (shift=1, meta=2, alt=4, ctrl=8)
  const oledMods =
    (mods.shift ? 1 : 0) | (mods.meta ? 2 : 0) | (mods.alt ? 4 : 0) | (mods.ctrl ? 8 : 0);

  // Live function hints for the on-screen modifier keys, mirroring the OLED
  // legend for the current mode/selection and the held combo
  const modHints = useMemo(
    () => ({
      shift: wasmEngine.getModifierHint(1, oledMods),
      meta: wasmEngine.getModifierHint(2, oledMods),
      alt: wasmEngine.getModifierHint(4, oledMods),
      ctrl: wasmEngine.getModifierHint(8, oledMods),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wasmEngine, renderVersion, oledMods],
  );

  // ============ Compute Grid via WASM ============
  const gridColors = useMemo(() => {
    // Set modifier state before computing grid (for Ctrl overlay + loop pulsing)
    const modBits =
      (mods.ctrl ? 1 : 0) | (mods.shift ? 2 : 0) | (mods.meta ? 4 : 0) | (mods.alt ? 8 : 0);
    wasmEngine.setModifiersHeld(modBits);

    // Tell WASM to compute the grid
    wasmEngine.computeGrid();

    // Copy ARGB grid colors out of WASM memory into a stable array.
    // (getGridColors returns a live view; snapshot it so React/ButtonGrid can
    // hold it across renders without risk of the heap detaching underneath.)
    return Uint32Array.from(wasmEngine.getGridColors());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasmEngine, renderVersion, mods.ctrl, mods.meta, mods.shift, mods.alt]);

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
      const modBits = encodeModifiers(modsRef.current);
      wasmEngine.buttonPress(visibleRow, visibleCol, modBits);
      markDirty();
    },
    [wasmEngine],
  );

  const handleButtonDragEnter = useCallback(
    (visibleRow: number, visibleCol: number) => {
      const modBits = encodeModifiers(modsRef.current);
      wasmEngine.buttonPress(visibleRow, visibleCol, modBits);
      markDirty();
    },
    [wasmEngine],
  );

  // ============ Arrow button handlers (on-screen UI) ============
  const handleArrow = useCallback(
    (dir: number) => {
      console.log("[grid] arrowPress dir=" + dir);
      const modBits = encodeModifiers(modsRef.current);
      wasmEngine.arrowPress(dir, modBits);
      markDirty();
    },
    [wasmEngine],
  );

  // ============ Rotary encoders -> arrow presses ============
  // Clockwise (or upward mouse drag) = right / up; steps repeat while dragging
  const handleEncoderLR = useCallback(
    (step: 1 | -1) => handleArrow(step > 0 ? DIR_RIGHT : DIR_LEFT),
    [handleArrow],
  );
  const handleEncoderUD = useCallback(
    (step: 1 | -1) => handleArrow(step > 0 ? DIR_UP : DIR_DOWN),
    [handleArrow],
  );

  // ============ OLED Display (rendered entirely in C/WASM) ============
  useEffect(() => {
    const oled = oledRendererRef.current;
    if (!oled) return;
    oled.render(oledMods);
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
            cols={wasmEngine.getVisibleCols()}
            onPress={handleButtonPressFromInput}
            onDragEnter={handleButtonDragEnter}
            onRelease={noop}
          />
        </Box>
        <Box css={horizontalStripContainerStyles}>
          <Box css={modifierKeysContainerStyles}>
            {/* Hold-to-apply (double-tap to latch); live hints from the OLED legend */}
            <ModifierKey
              name="shift"
              fn={modHints.shift}
              active={mods.shift}
              latched={latchedMods.shift}
              onHold={(held) => holdTouchMod("shift", held)}
              onLatch={(latched) => latchMod("shift", latched)}
            />
            <ModifierKey
              name="ctrl"
              fn={modHints.ctrl}
              active={mods.ctrl}
              latched={latchedMods.ctrl}
              onHold={(held) => holdTouchMod("ctrl", held)}
              onLatch={(latched) => latchMod("ctrl", latched)}
            />
            <ModifierKey
              name="opt"
              fn={modHints.alt}
              active={mods.alt}
              latched={latchedMods.alt}
              onHold={(held) => holdTouchMod("alt", held)}
              onLatch={(latched) => latchMod("alt", latched)}
            />
            <ModifierKey
              name="cmd"
              fn={modHints.meta}
              active={mods.meta}
              latched={latchedMods.meta}
              onHold={(held) => holdTouchMod("meta", held)}
              onLatch={(latched) => latchMod("meta", latched)}
            />
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
          <Box css={encoderRowStyles}>
            {/* Cap colors are the panel's own axis colors: up/down is the
                yellow the display fills a field with, left/right the red. */}
            <RotaryEncoder
              onStep={handleEncoderUD}
              label="&#x25B2; &#x25BC;"
              tint={chrome.panel.yellow}
            />
            <RotaryEncoder
              onStep={handleEncoderLR}
              label="&#x25C0; &#x25B6;"
              tint={chrome.panel.magenta}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
});

Grid.displayName = "Grid";
