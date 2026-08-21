import { memo, useCallback, useRef } from "react";
import { Box } from "@mui/material";
import { rowStyles } from "./ButtonGrid.styles";
import { chrome } from "../../theme/chrome";

// Convert ARGB u32 (0xAARRGGBB) to CSS rgba string
const argbToRgba = (argb: number): string => {
  const a = ((argb >>> 24) & 0xff) / 255;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
};

interface GridButtonCellProps {
  row: number;
  col: number;
  color: number; // ARGB u32 from Rust
  onPress: () => void;
  onDragEnter: () => void;
}

const GridButtonCell = memo(({ row, col, color, onPress, onDragEnter }: GridButtonCellProps) => {
  const bgColor = argbToRgba(color);
  const a = ((color >>> 24) & 0xff) / 255;

  // A doubleshot keycap seen head-on: the skirt tapers away from a dished top
  // face, and the RGB LED under it tints the plastic rather than replacing it.
  const skirt = [
    `linear-gradient(${bgColor}, ${bgColor})`,
    `linear-gradient(180deg, ${chrome.capMid} 0%, ${chrome.capSkirt} 55%, ${chrome.capBottom} 100%)`,
  ].join(", ");

  const topFace = [
    `linear-gradient(${bgColor}, ${bgColor})`,
    "radial-gradient(115% 90% at 50% 14%, rgba(255,255,255,0.9), rgba(255,255,255,0) 66%)",
    `linear-gradient(180deg, ${chrome.capTop} 0%, ${chrome.capMid} 62%, ${chrome.capBottom} 100%)`,
  ].join(", ");

  // The cap stands off the keywell floor; a lit one spills onto its neighbours.
  const skirtShadow = [
    "inset 0 1px 0 rgba(255,255,255,0.85)",
    "inset 0 -2px 3px rgba(0,0,0,0.2)",
    "0 2px 2px rgba(0,0,0,0.5)",
    "0 3px 5px rgba(0,0,0,0.35)",
    a > 0.35 ? `0 0 ${Math.round(10 * a)}px ${bgColor}` : "",
  ]
    .filter(Boolean)
    .join(", ");

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
        width: 40,
        height: 40,
        margin: 2,
        borderRadius: 5,
        border: "1px solid rgba(52, 50, 45, 0.42)",
        cursor: "pointer",
        touchAction: "none",
        background: skirt,
        boxShadow: skirtShadow,
        padding: "3px 4px 6px",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 3,
          background: topFace,
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.16)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
});

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
}

export const ButtonGrid = memo(
  ({ gridColors, cols, onPress, onDragEnter, onRelease }: ButtonGridProps) => {
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
