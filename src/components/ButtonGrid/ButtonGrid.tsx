import { memo, useCallback, useRef } from "react";
import { Box } from "@mui/material";
import { rowStyles } from "./ButtonGrid.styles";

// Convert ARGB u32 (0xAARRGGBB) to CSS rgba string
const argbToRgba = (argb: number): string => {
  const a = ((argb >>> 24) & 0xFF) / 255;
  const r = (argb >> 16) & 0xFF;
  const g = (argb >> 8) & 0xFF;
  const b = argb & 0xFF;
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
  const a = ((color >>> 24) & 0xFF) / 255;

  // Simple glow for bright cells
  const boxShadow = a > 0.5
    ? `0 0 ${Math.round(5 * a)}px ${bgColor}, inset 0 0 ${Math.round(3 * a)}px rgba(255, 255, 255, ${(0.15 * a).toFixed(3)})`
    : "inset 0 0 5px rgba(0, 0, 0, 0.5)";

  return (
    <div
      data-grid-row={row}
      data-grid-col={col}
      onMouseDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      onMouseEnter={(e) => {
        if (e.buttons === 1) {
          onDragEnter();
        }
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        onPress();
      }}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: 40,
        height: 40,
        margin: 2,
        borderRadius: 4,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        cursor: "pointer",
        touchAction: "none",
        background: bgColor,
        boxShadow,
      }}
    />
  );
});

GridButtonCell.displayName = "GridButtonCell";

interface ButtonGridProps {
  /** 2D array of ARGB colors [row][col] from Rust */
  gridColors: number[][];
  /** Called when a cell is pressed with (row, col) */
  onPress: (row: number, col: number) => void;
  /** Called when dragging enters a cell with (row, col) */
  onDragEnter: (row: number, col: number) => void;
  /** Called when mouse/touch is released */
  onRelease: () => void;
}

export const ButtonGrid = memo(({ gridColors, onPress, onDragEnter, onRelease }: ButtonGridProps) => {

  // Create stable callbacks for each cell
  const handlePress = useCallback((row: number, col: number) => {
    onPress(row, col);
  }, [onPress]);

  const handleDragEnter = useCallback((row: number, col: number) => {
    onDragEnter(row, col);
  }, [onDragEnter]);

  // Track which cell the touch is currently over to avoid re-firing
  const lastTouchCell = useRef<string | null>(null);

  // Touch drag: touchmove always fires on the *original* element, so we use
  // document.elementFromPoint to find which grid cell the finger is over.
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
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
  }, [onDragEnter]);

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
      {gridColors.map((row, rowIndex) => (
        <Box key={rowIndex} css={rowStyles}>
          {row.map((color, colIndex) => (
            <GridButtonCell
              key={colIndex}
              row={rowIndex}
              col={colIndex}
              color={color}
              onPress={() => handlePress(rowIndex, colIndex)}
              onDragEnter={() => handleDragEnter(rowIndex, colIndex)}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
});

ButtonGrid.displayName = "ButtonGrid";
