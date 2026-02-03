import { memo } from 'react';

// Parse hex color to RGB, handling both #RRGGBB and #RRGGBBAA formats
const parseHexColor = (hex: string): { r: number; g: number; b: number; a: number } => {
  const cleanHex = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  const a = cleanHex.length === 8 ? parseInt(cleanHex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
};

// Blend a semi-transparent color over a white/grey background
// The color at X% opacity over Y% white should result in a lighter tinted color
const blendColorOverWhite = (color: { r: number; g: number; b: number; a: number }, whiteBrightness: number): string => {
  // Background is white at whiteBrightness level (e.g., 0.2 = 20% white = rgb(51,51,51) on black)
  const bgValue = Math.round(255 * whiteBrightness);

  // Blend the color over the background using standard alpha compositing
  // result = foreground * alpha + background * (1 - alpha)
  const alpha = color.a;
  const r = Math.round(color.r * alpha + bgValue * (1 - alpha));
  const g = Math.round(color.g * alpha + bgValue * (1 - alpha));
  const b = Math.round(color.b * alpha + bgValue * (1 - alpha));

  // The combined alpha should be higher than either alone
  const finalAlpha = Math.min(1, alpha + whiteBrightness * (1 - alpha));

  return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
};

interface GridButtonProps {
  active: boolean;
  isPlayhead: boolean;
  rowColor: string;
  isCNote?: boolean;
  dimmed?: boolean;
  glowIntensity?: number; // 0-1, controls glow strength
  isLoopBoundary?: boolean; // First or last column of loop (20% white)
  isBeatMarker?: boolean; // Every 4th column (10% white)
  isPendingLoopStart?: boolean; // First click of loop selection
  isNoteStart?: boolean; // True if this is the start of a note
  isNoteContinuation?: boolean; // True if this is a continuation of a note (within note length)
  isNoteCurrentlyPlaying?: boolean; // True if the playhead is within this note's duration
  onToggle: () => void;
  onDragEnter: () => void;
}

export const GridButton = memo(({ active, isPlayhead, rowColor, isCNote = false, dimmed = false, glowIntensity = 1, isLoopBoundary = false, isBeatMarker = false, isPendingLoopStart = false, isNoteStart = false, isNoteContinuation = false, isNoteCurrentlyPlaying = false, onToggle, onDragEnter }: GridButtonProps) => {
  const glowColor = rowColor.length === 7 ? rowColor : rowColor.slice(0, 7); // Strip alpha for glow
  const isPlaying = active && isPlayhead; // Note is playing right now

  // Calculate base brightness from loop boundaries, beat markers, and C notes
  // Priority: loop boundary (20%) > beat marker (10%) > C note (+10%)
  let baseBrightness = 0;
  if (isLoopBoundary) {
    baseBrightness = 0.2;
  } else if (isBeatMarker) {
    baseBrightness = 0.1;
  }
  if (isCNote) {
    baseBrightness += 0.1;
  }

  const parsedColor = parseHexColor(rowColor);

  // Note continuations use 50% opacity when not playing
  const continuationOpacity = 0.5;

  let bgColor: string;
  if (isNoteStart && isNoteCurrentlyPlaying) {
    // Note start while playing - bright white
    bgColor = '#ffffff';
  } else if (isNoteContinuation && isNoteCurrentlyPlaying) {
    // Continuation while playing - brighter channel color with white mixed in
    const whiteMix = 0.2; // 20% white mixed in
    const r = Math.round(parsedColor.r + (255 - parsedColor.r) * whiteMix);
    const g = Math.round(parsedColor.g + (255 - parsedColor.g) * whiteMix);
    const b = Math.round(parsedColor.b + (255 - parsedColor.b) * whiteMix);
    bgColor = `rgba(${r}, ${g}, ${b}, 0.7)`;
  } else if (isNoteStart && active) {
    // Note start (not playing) - full channel color
    if (parsedColor.a < 1 && baseBrightness > 0) {
      bgColor = blendColorOverWhite(parsedColor, baseBrightness);
    } else {
      bgColor = rowColor;
    }
  } else if (isNoteContinuation && active) {
    // Note continuation (not playing) - dimmer channel color
    bgColor = `rgba(${parsedColor.r}, ${parsedColor.g}, ${parsedColor.b}, ${continuationOpacity})`;
  } else if (active) {
    // Other active states (off-screen indicators, etc.)
    if (parsedColor.a < 1 && baseBrightness > 0) {
      bgColor = blendColorOverWhite(parsedColor, baseBrightness);
    } else {
      bgColor = rowColor;
    }
  } else if (isPendingLoopStart) {
    bgColor = 'rgba(255, 255, 255, 0.4)';
  } else if (isPlayhead) {
    bgColor = 'rgba(255, 255, 255, 0.15)';
  } else if (baseBrightness > 0) {
    bgColor = `rgba(255, 255, 255, ${baseBrightness})`;
  } else {
    bgColor = 'rgba(30, 30, 30, 0.9)';
  }

  // Glow is directly tied to color/opacity
  // Continuations always have reduced glow to match their reduced opacity
  const effectiveGlowIntensity = isNoteContinuation ? continuationOpacity * glowIntensity : glowIntensity;
  const glowSize1 = Math.round(5 * effectiveGlowIntensity);
  const glowSize2 = Math.round(5 * effectiveGlowIntensity);
  const playingGlow1 = Math.round(8 * glowIntensity);
  const playingGlow2 = Math.round(15 * glowIntensity);

  let boxShadow: string;
  if (isNoteStart && isNoteCurrentlyPlaying) {
    // Note start playing - full glow
    boxShadow = `0 0 ${playingGlow1}px ${glowColor}, 0 0 ${playingGlow2}px ${glowColor}, inset 0 0 8px rgba(255, 255, 255, 0.3)`;
  } else if (active) {
    boxShadow = glowIntensity > 0
      ? `0 0 ${glowSize1}px ${glowColor}, inset 0 0 ${glowSize2}px rgba(255, 255, 255, ${0.2 * glowIntensity})`
      : 'inset 0 0 5px rgba(0, 0, 0, 0.5)';
  } else if (isPlayhead) {
    boxShadow = '0 0 5px rgba(255, 255, 255, 0.3)';
  } else {
    boxShadow = 'inset 0 0 5px rgba(0, 0, 0, 0.5)';
  }

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        onToggle();
      }}
      onMouseEnter={(e) => {
        if (e.buttons === 1) {
          onDragEnter();
        }
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        onToggle();
      }}
      style={{
        width: 40,
        height: 40,
        margin: 2,
        borderRadius: 4,
        transition: 'all 0.05s ease',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        cursor: 'pointer',
        touchAction: 'none',
        background: bgColor,
        boxShadow,
        opacity: dimmed ? 0.25 : 1,
      }}
    />
  );
});

GridButton.displayName = 'GridButton';
