import { memo, useCallback } from "react";
import { css } from "@emotion/react";
import { Box } from "@mui/material";

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
  const loopBoundary = isLoopBoundary(value);
  const beatMarker = isBeatMarker(value);

  // Base brightness from grid markers
  let baseBrightness = 0;
  if (loopBoundary) baseBrightness = 0.2;
  else if (beatMarker) baseBrightness = 0.15;
  else if (level === 0) baseBrightness = 0.1; // In-loop default
  if (cNote) baseBrightness += 0.1;

  // Off state
  if (level === 0) {
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

  const glowColor = channelColor.slice(0, 7); // Strip alpha if present
  const intensity = continuation ? 0.5 : 1;
  const glowSize = Math.round(5 * intensity);

  if (playing && !continuation) {
    return `0 0 8px ${glowColor}, 0 0 15px ${glowColor}, inset 0 0 8px rgba(255, 255, 255, 0.3)`;
  }

  return `0 0 ${glowSize}px ${glowColor}, inset 0 0 ${glowSize}px rgba(255, 255, 255, ${0.2 * intensity})`;
};

const rowStyles = css`
  display: flex;
  flex-direction: row;
`;

interface GridButtonCellProps {
  value: number;
  channelColor: string;
  onPress: () => void;
  onDragEnter: () => void;
}

const GridButtonCell = memo(({ value, channelColor, onPress, onDragEnter }: GridButtonCellProps) => {
  const bgColor = getBackgroundColor(value, channelColor);
  const boxShadow = getBoxShadow(value, channelColor);

  return (
    <div
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
        transition: "all 0.05s ease",
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
  /** 2D array of button values [row][col] */
  values: number[][];
  /** Main channel color (hex) */
  channelColor: string;
  /** Called when a cell is pressed with (row, col) */
  onPress: (row: number, col: number) => void;
  /** Called when dragging enters a cell with (row, col) */
  onDragEnter: (row: number, col: number) => void;
  /** Called when mouse/touch is released */
  onRelease: () => void;
}

export const ButtonGrid = memo(({ values, channelColor, onPress, onDragEnter, onRelease }: ButtonGridProps) => {
  // Create stable callbacks for each cell
  const handlePress = useCallback((row: number, col: number) => {
    onPress(row, col);
  }, [onPress]);

  const handleDragEnter = useCallback((row: number, col: number) => {
    onDragEnter(row, col);
  }, [onDragEnter]);

  return (
    <Box onMouseUp={onRelease} onMouseLeave={onRelease}>
      {values.map((row, rowIndex) => (
        <Box key={rowIndex} css={rowStyles}>
          {row.map((value, colIndex) => (
            <GridButtonCell
              key={colIndex}
              value={value}
              channelColor={channelColor}
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
export const BUTTON_COLOR_75 = 3;
export const BUTTON_COLOR_100 = 4;
export const BUTTON_WHITE_25 = 5;
export const BUTTON_WHITE_50 = 6;
export const BUTTON_WHITE_75 = 7;
export const BUTTON_WHITE_100 = 8;

// Flags
export const FLAG_PLAYHEAD = 16;
export const FLAG_C_NOTE = 32;
export const FLAG_LOOP_BOUNDARY = 64;
export const FLAG_BEAT_MARKER = 128;
export const FLAG_SELECTED = 256;
export const FLAG_CONTINUATION = 512;
export const FLAG_PLAYING = 1024;
