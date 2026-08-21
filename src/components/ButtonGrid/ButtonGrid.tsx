import { memo, useCallback, useRef } from "react";
import { Box } from "@mui/material";
import { rowStyles } from "./ButtonGrid.styles";
import { dims } from "../../theme/dimensions";
import { chrome } from "../../theme/chrome";

/** The engine's ARGB at an explicit alpha, for layering light through the cap. */
const argbAt = (argb: number, alpha: number): string =>
  `rgba(${(argb >> 16) & 0xff}, ${(argb >> 8) & 0xff}, ${argb & 0xff}, ${alpha.toFixed(3)})`;

// Where the LED window sits inside the cap: the emitter is 4.7 mm north of
// the switch centre, so its hotspot is about a fifth of the way down.
const LED_TOP = dims.capH / 2 + dims.ledOffsetY - dims.ledH / 2;
const LED_CENTER_PCT = ((dims.capH / 2 + dims.ledOffsetY) / dims.capH) * 100;

const HOUSING_INSET_X = (dims.capW - dims.switchBody) / 2;
const HOUSING_INSET_Y = (dims.capH - dims.switchBody) / 2;

const layer: React.CSSProperties = { position: "absolute", pointerEvents: "none" };

/** The two caps that are actually in the parts box: white transparent, and
    the opaque white PBT. */
export type CapStyle = "clear" | "white";

interface GridButtonCellProps {
  row: number;
  col: number;
  color: number; // ARGB u32 from Rust
  capStyle: CapStyle;
  onPress: () => void;
  onDragEnter: () => void;
}

/**
 * A Kailh Choc v1 White under one of the two caps on the shelf, from above.
 *
 * Under the transparent cap you see the switch itself, so it is all drawn:
 * the 15 mm housing the cap overhangs, the two white stem rails a Choc mounts
 * on, and the SK6812MINI-E in the north LED window. The light is layered the
 * way it actually behaves — a hotspot over the emitter, a wash falling off
 * toward the bottom of the cap, the walls piping light out to the edges, and
 * a bloom onto the keywell floor.
 *
 * Under the opaque white PBT you see none of that. PBT is not a light pipe,
 * so all that comes through is a soft glow where the wall is thinnest, still
 * sitting north of centre because that is where the emitter is, plus what
 * escapes around the cap into the keywell.
 */
const GridButtonCell = memo(
  ({ row, col, color, capStyle, onPress, onDragEnter }: GridButtonCellProps) => {
    const a = ((color >>> 24) & 0xff) / 255;
    const lit = a > 0.02;

    return (
      <div
        data-grid-row={row}
        data-grid-col={col}
        // Pointer events fire exactly once per press for mouse AND touch.
        // (Separate mousedown+touchstart handlers double-fire on touch devices:
        // React's root touchstart listener is passive, so preventDefault can't
        // suppress the browser's synthesized mousedown after a tap.)
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          e.preventDefault();
          onPress();
        }}
        onMouseEnter={(e) => {
          if (e.buttons === 1) {
            onDragEnter();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: "relative",
          width: dims.capW,
          height: dims.capH,
          margin: `${dims.capMarginY}px ${dims.capMarginX}px`,
          borderRadius: 4,
          cursor: "pointer",
          touchAction: "none",
          overflow: "hidden",
          // Clear plastic over a dark keywell reads as a faint grey pane
          background: "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
          boxShadow: [
            // The cap's own edges catching light, plus what the LED pipes into
            // them — the top edge sits nearest the emitter so it takes the most.
            "inset 0 0 0 1px rgba(255,255,255,0.16)",
            lit ? `inset 0 ${dims.capWall}px ${dims.capWall * 2}px ${argbAt(color, 0.55 * a)}` : "",
            lit ? `inset 0 0 0 1px ${argbAt(color, 0.5 * a)}` : "",
            // Bloom onto the keywell floor
            lit ? `0 0 ${Math.round(10 * a)}px ${argbAt(color, 0.55 * a)}` : "",
            "0 2px 3px rgba(0,0,0,0.5)",
          ]
            .filter(Boolean)
            .join(", "),
        }}
      >
        {capStyle === "white" ? (
          <>
            {/* Opaque white PBT: the switch disappears behind it. Dished top
              face, lit lip, shade closing under the far edge. */}
            <div
              style={{
                ...layer,
                inset: 0,
                background: `linear-gradient(160deg, ${chrome.keycapTop} 0%, ${chrome.keycapMid} 55%, ${chrome.keycapLow} 100%)`,
                boxShadow: [
                  "inset 0 1px 0 rgba(255,255,255,0.85)",
                  "inset 0 -2px 3px rgba(0,0,0,0.16)",
                ].join(", "),
              }}
            />

            {/* What little the plastic passes. PBT is a poor diffuser, so this
              is a soft bloom rather than a lit pad, and it keeps the emitter's
              northward offset instead of pretending to be centred. */}
            {lit && (
              <div
                style={{
                  ...layer,
                  inset: 0,
                  background: `radial-gradient(ellipse 62% 54% at 50% ${LED_CENTER_PCT.toFixed(
                    1,
                  )}%, ${argbAt(color, 0.5 * a)} 0%, ${argbAt(color, 0.28 * a)} 40%, ${argbAt(
                    color,
                    0.1 * a,
                  )} 72%, transparent 100%)`,
                }}
              />
            )}
          </>
        ) : (
          <>
            {/* PG1350 housing — 15 mm square, overhung by the cap on every side */}
            <div
              style={{
                ...layer,
                left: HOUSING_INSET_X,
                top: HOUSING_INSET_Y,
                width: dims.switchBody,
                height: dims.switchBody,
                borderRadius: dims.switchCorner,
                background: "linear-gradient(180deg, #232326, #141416)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)",
              }}
            />

            {/* Keycap mounts on two rails, not a cross stem. These are Choc
          Whites, so the rails are white — the brightest thing under the cap,
          sitting 4.7 mm south of the emitter and taking on its colour. */}
            {[-1, 1].map((side) => (
              <div
                key={side}
                style={{
                  ...layer,
                  left: dims.capW / 2 + (side * dims.stemSpacing) / 2 - dims.stemW / 2,
                  top: dims.capH / 2 - dims.stemH / 2,
                  width: dims.stemW,
                  height: dims.stemH,
                  borderRadius: 1,
                  // White plastic near a driven emitter does not stay white.
                  // The wash tracks how hard that channel is actually driven,
                  // or a barely-lit pad glows as brightly as a full one.
                  background: lit
                    ? `linear-gradient(180deg, ${argbAt(color, 0.85 * a)}, ${argbAt(
                        color,
                        0.4 * a,
                      )}), linear-gradient(180deg, ${chrome.stem}, ${chrome.stemLow})`
                    : `linear-gradient(180deg, ${chrome.stem}, ${chrome.stemLow})`,
                  boxShadow: lit ? `0 0 ${Math.round(5 * a)}px ${argbAt(color, 0.6 * a)}` : "none",
                }}
              />
            ))}

            {/* SK6812MINI-E in the north window: warm phosphor when dark, the
          channel's own color when driven */}
            <div
              style={{
                ...layer,
                left: dims.capW / 2 - dims.ledW / 2,
                top: LED_TOP,
                width: dims.ledW,
                height: dims.ledH,
                borderRadius: 1,
                background: lit
                  ? `linear-gradient(180deg, ${argbAt(color, Math.min(1, 0.55 + a))}, ${argbAt(color, a)})`
                  : // Dark phosphor is dull yellow-grey; anything brighter reads as a
                    // white rectangle stamped on all 128 keys
                    "linear-gradient(180deg, #35342c, #292824)",
                boxShadow: lit ? `0 0 ${Math.round(7 * a)}px ${argbAt(color, 0.9 * a)}` : "none",
              }}
            />
          </>
        )}

        {/* The light itself, spreading down through the cap from the emitter */}
        {lit && capStyle === "clear" && (
          <div
            style={{
              ...layer,
              inset: 0,
              background: `radial-gradient(circle at 50% ${LED_CENTER_PCT.toFixed(1)}%, ${argbAt(
                color,
                0.95 * a,
              )} 0%, ${argbAt(color, 0.6 * a)} 22%, ${argbAt(color, 0.3 * a)} 48%, ${argbAt(
                color,
                0.1 * a,
              )} 74%, transparent 100%)`,
            }}
          />
        )}

        {/* Sheen on the cap's top face, above everything it covers. The
            transparent cap is glossy PC; the PBT is matte and barely catches
            anything, so it gets a fraction of it. */}
        <div
          style={{
            ...layer,
            inset: 0,
            background:
              capStyle === "white"
                ? "linear-gradient(150deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.05) 30%, rgba(255,255,255,0) 58%)"
                : "linear-gradient(150deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 26%, rgba(255,255,255,0) 52%)",
          }}
        />
      </div>
    );
  },
);

GridButtonCell.displayName = "GridButtonCell";

interface ButtonGridProps {
  /** Flat row-major array of ARGB colors from Rust (length rows*cols) */
  gridColors: Uint32Array;
  /** Number of columns; rows are derived as gridColors.length / cols */
  cols: number;
  /** Called when a cell is pressed with (row, col) */
  onPress: (row: number, col: number) => void;
  /** Called when dragging enters a cell with (row, col) */
  onDragEnter: (row: number, col: number) => void;
  /** Called when mouse/touch is released */
  onRelease: () => void;
  /** Which cap is fitted — white transparent, or opaque white PBT */
  capStyle: CapStyle;
}

export const ButtonGrid = memo(
  ({ gridColors, cols, capStyle, onPress, onDragEnter, onRelease }: ButtonGridProps) => {
    // Track which cell the touch is currently over to avoid re-firing
    const lastTouchCell = useRef<string | null>(null);

    // Create stable callbacks for each cell
    const handlePress = useCallback(
      (row: number, col: number) => {
        // Seed the touch-drag dedupe so a finger wobbling within the pressed cell
        // doesn't immediately re-fire it via touchmove
        lastTouchCell.current = `${row},${col}`;
        onPress(row, col);
      },
      [onPress],
    );

    const handleDragEnter = useCallback(
      (row: number, col: number) => {
        onDragEnter(row, col);
      },
      [onDragEnter],
    );

    // Touch drag: touchmove always fires on the *original* element, so we use
    // document.elementFromPoint to find which grid cell the finger is over.
    const handleTouchMove = useCallback(
      (e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
        if (!el) return;
        const rowAttr = el.getAttribute("data-grid-row");
        const colAttr = el.getAttribute("data-grid-col");
        if (rowAttr == null || colAttr == null) return;
        const key = `${rowAttr},${colAttr}`;
        if (key === lastTouchCell.current) return; // still on the same cell
        lastTouchCell.current = key;
        onDragEnter(Number(rowAttr), Number(colAttr));
      },
      [onDragEnter],
    );

    const handleTouchEnd = useCallback(() => {
      lastTouchCell.current = null;
      onRelease();
    }, [onRelease]);

    return (
      <Box
        onMouseUp={onRelease}
        onMouseLeave={onRelease}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {Array.from({ length: gridColors.length / cols }, (_, rowIndex) => (
          <Box key={rowIndex} css={rowStyles}>
            {Array.from({ length: cols }, (_, colIndex) => (
              <GridButtonCell
                key={colIndex}
                row={rowIndex}
                col={colIndex}
                color={gridColors[rowIndex * cols + colIndex]}
                capStyle={capStyle}
                onPress={() => handlePress(rowIndex, colIndex)}
                onDragEnter={() => handleDragEnter(rowIndex, colIndex)}
              />
            ))}
          </Box>
        ))}
      </Box>
    );
  },
);

ButtonGrid.displayName = "ButtonGrid";
