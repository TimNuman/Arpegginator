import { memo, useCallback, useRef } from "react";
import { Box } from "@mui/material";
import { rowStyles } from "./ButtonGrid.styles";

/**
 * Button state encoding:
 * 0 = off (dark)
 * 1 = 25% color
 * 2 = 50% color
 * 3 = 75% color
 * 4 = 100% color
 * 5 = 25% white
 * 6 = 50% white
 * 7 = 75% white
 * 8 = 100% white (full bright)
 *
 * Additional flags encoded as bit flags in higher bits:
 * +16 = is playhead
 * +32 = is C note (subtle highlight)
 * +64 = is loop boundary
 * +128 = is beat marker
 * +256 = is selected
 * +512 = is note continuation (dimmer than start)
 * +1024 = is currently playing
 */

// Extract base color level (0-8)
const getColorLevel = (value: number): number => value & 0xF;

// Check flags
const isPlayhead = (value: number): boolean => (value & 16) !== 0;
const isCNote = (value: number): boolean => (value & 32) !== 0;
const isLoopBoundary = (value: number): boolean => (value & 64) !== 0;
const isBeatMarker = (value: number): boolean => (value & 128) !== 0;
const isSelected = (value: number): boolean => (value & 256) !== 0;
const isNoteContinuation = (value: number): boolean => (value & 512) !== 0;
const isCurrentlyPlaying = (value: number): boolean => (value & 1024) !== 0;
const isLoopBoundaryPulsing = (value: number): boolean => (value & 2048) !== 0;
const isDimmed = (value: number): boolean => (value & 4096) !== 0;
const isInScale = (value: number): boolean => (value & 8192) !== 0;
const isGhost = (value: number): boolean => (value & 16384) !== 0;
const isOffscreen = (value: number): boolean => (value & 32768) !== 0;

// Parse hex color to RGB
const parseHex = (hex: string): { r: number; g: number; b: number } => {
  const cleanHex = hex.startsWith("#") ? hex.slice(1) : hex;
  return {
    r: parseInt(cleanHex.slice(0, 2), 16),
    g: parseInt(cleanHex.slice(2, 4), 16),
    b: parseInt(cleanHex.slice(4, 6), 16),
  };
};

// Get background color based on value and channel color
const getBackgroundColor = (value: number, channelColor: string): string => {
  const level = getColorLevel(value);
  const playing = isCurrentlyPlaying(value);
  const continuation = isNoteContinuation(value);
  const selected = isSelected(value);
  const playhead = isPlayhead(value);
  const cNote = isCNote(value);
  const inScale = isInScale(value);
  const loopBoundary = isLoopBoundary(value);
  const beatMarker = isBeatMarker(value);

  // Base brightness from grid markers
  let baseBrightness = 0;
  if (loopBoundary) baseBrightness = 0.2;
  else if (beatMarker) baseBrightness = 0.15;
  else if (level === 0) baseBrightness = 0.1; // In-loop default
  if (cNote) baseBrightness += 0.1;
  else if (inScale) baseBrightness += 0.08;

  // Off state
  if (level === 0) {
    // Ghost / offscreen note overlay
    if (isGhost(value)) {
      const opacity = continuation ? 0.10 : 0.16;
      if (isOffscreen(value)) {
        const { r, g, b } = parseHex(channelColor);
        // Offscreen: channel color tint over grey background
        const base = baseBrightness + opacity;
        const tint = 0.15;
        const wr = Math.round(255 * base + r * tint);
        const wg = Math.round(255 * base + g * tint);
        const wb = Math.round(255 * base + b * tint);
        if (playing) {
          // Playing: add 50% white to the offscreen color
          const pr = Math.min(Math.round(wr + (255 - wr) * 0.5), 255);
          const pg = Math.min(Math.round(wg + (255 - wg) * 0.5), 255);
          const pb = Math.min(Math.round(wb + (255 - wb) * 0.5), 255);
          return `rgb(${pr}, ${pg}, ${pb})`;
        }
        return `rgb(${Math.min(wr, 255)}, ${Math.min(wg, 255)}, ${Math.min(wb, 255)})`;
      }
      return `rgba(255, 255, 255, ${baseBrightness + opacity})`;
    }
    if (playhead) return "rgba(255, 255, 255, 0.3)";
    if (baseBrightness > 0) return `rgba(255, 255, 255, ${baseBrightness})`;
    return "rgba(30, 30, 30, 0.9)";
  }

  const { r, g, b } = parseHex(channelColor);

  // White levels (5-8)
  if (level >= 5) {
    const whiteness = (level - 4) * 0.25; // 0.25, 0.50, 0.75, 1.0
    const nr = Math.round(r + (255 - r) * whiteness);
    const ng = Math.round(g + (255 - g) * whiteness);
    const nb = Math.round(b + (255 - b) * whiteness);
    return `rgb(${nr}, ${ng}, ${nb})`;
  }

  // Color levels (1-4)
  const opacity = level * 0.25; // 0.25, 0.50, 0.75, 1.0

  // Darken unselected notes
  const darken = !selected && !playing ? 0.35 : 0;
  const dr = Math.round(r * (1 - darken));
  const dg = Math.round(g * (1 - darken));
  const db = Math.round(b * (1 - darken));

  // Continuation is always dimmer
  if (continuation && !playing) {
    return `rgba(${dr}, ${dg}, ${db}, ${opacity * 0.5})`;
  }

  if (playing) {
    // Playing notes are bright
    if (!continuation) return "#ffffff";
    // Playing continuation - brighter with white mix
    const whiteMix = 0.2;
    const pr = Math.round(r + (255 - r) * whiteMix);
    const pg = Math.round(g + (255 - g) * whiteMix);
    const pb = Math.round(b + (255 - b) * whiteMix);
    return `rgba(${pr}, ${pg}, ${pb}, 0.7)`;
  }

  return `rgba(${dr}, ${dg}, ${db}, ${opacity})`;
};

// Get box shadow based on value and channel color
const getBoxShadow = (value: number, channelColor: string): string => {
  const level = getColorLevel(value);
  const playing = isCurrentlyPlaying(value);
  const continuation = isNoteContinuation(value);
  const playhead = isPlayhead(value);

  if (level === 0) {
    if (playhead) return "0 0 5px rgba(255, 255, 255, 0.3)";
    return "inset 0 0 5px rgba(0, 0, 0, 0.5)";
  }

  // Scale glow to match button brightness
  const levelScale = level <= 4 ? level * 0.25 : 1; // 0.25, 0.50, 0.75, 1.0 for color levels
  const contScale = continuation ? 0.5 : 1;
  const intensity = levelScale * contScale;
  const glowSize = Math.round(5 * intensity);

  // Use the actual background color for the glow
  const bgColor = getBackgroundColor(value, channelColor);

  if (playing && !continuation) {
    const playGlowSize = Math.round(8 * levelScale);
    const playGlowSize2 = Math.round(15 * levelScale);
    return `0 0 ${playGlowSize}px ${bgColor}, 0 0 ${playGlowSize2}px ${bgColor}, inset 0 0 ${playGlowSize}px rgba(255, 255, 255, ${0.3 * levelScale})`;
  }

  return `0 0 ${glowSize}px ${bgColor}, inset 0 0 ${glowSize}px rgba(255, 255, 255, ${0.2 * intensity})`;
};

interface GridButtonCellProps {
  row: number;
  col: number;
  value: number;
  channelColor: string;
  brightness: number;
  onPress: () => void;
  onDragEnter: () => void;
}

const GridButtonCell = memo(({ row, col, value, channelColor, brightness, onPress, onDragEnter }: GridButtonCellProps) => {
  const bgColor = getBackgroundColor(value, channelColor);
  const boxShadow = getBoxShadow(value, channelColor);
  const pulsing = isLoopBoundaryPulsing(value);
  const dimmed = isDimmed(value);
  const opacity = pulsing ? brightness : 1;

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
        opacity,
        width: 40,
        height: 40,
        margin: 2,
        borderRadius: 4,
        border: "1px solid rgba(255, 255, 255, 0.1)",
        cursor: "pointer",
        touchAction: "none",
        background: dimmed ? `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), ${bgColor}` : bgColor,
        boxShadow: dimmed ? "inset 0 0 5px rgba(0, 0, 0, 0.5)" : boxShadow,
      }}
    />
  );
});

GridButtonCell.displayName = "GridButtonCell";

interface ButtonGridProps {
  /** 2D array of button values [row][col] */
  values: number[][];
  /** Main channel color (hex) */
  channelColor: string;
  /** Optional per-cell color overrides [row][col]. Non-null entries replace channelColor for that cell. */
  colorOverrides?: (string | null)[][];
  /** Called when a cell is pressed with (row, col) */
  onPress: (row: number, col: number) => void;
  /** Called when dragging enters a cell with (row, col) */
  onDragEnter: (row: number, col: number) => void;
  /** Called when mouse/touch is released */
  onRelease: () => void;
  /** Brightness from WASM (0-1), applied to pulsing cells */
  brightness?: number;
}

export const ButtonGrid = memo(({ values, channelColor, colorOverrides, brightness = 1, onPress, onDragEnter, onRelease }: ButtonGridProps) => {

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
      {values.map((row, rowIndex) => (
        <Box key={rowIndex} css={rowStyles}>
          {row.map((value, colIndex) => (
            <GridButtonCell
              key={colIndex}
              row={rowIndex}
              col={colIndex}
              value={value}
              channelColor={colorOverrides?.[rowIndex]?.[colIndex] ?? channelColor}
              brightness={brightness}
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

// Export constants for building values
export const BUTTON_OFF = 0;
export const BUTTON_COLOR_25 = 1;
export const BUTTON_COLOR_50 = 2;
export const BUTTON_COLOR_100 = 4;
export const BUTTON_WHITE_25 = 5;

// Flags
export const FLAG_PLAYHEAD = 16;
export const FLAG_C_NOTE = 32;
export const FLAG_LOOP_BOUNDARY = 64;
export const FLAG_BEAT_MARKER = 128;
export const FLAG_SELECTED = 256;
export const FLAG_CONTINUATION = 512;
export const FLAG_PLAYING = 1024;
export const FLAG_LOOP_BOUNDARY_PULSING = 2048;
export const FLAG_DIMMED = 4096;
export const FLAG_IN_SCALE = 8192;
export const FLAG_GHOST = 16384;
export const FLAG_OFFSCREEN = 32768;
