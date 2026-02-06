import { useMemo } from "react";
import { VISIBLE_ROWS, VISIBLE_COLS } from "../store/sequencerStore";
import {
  BUTTON_OFF,
  BUTTON_COLOR_100,
  FLAG_PLAYHEAD,
  FLAG_C_NOTE,
  FLAG_LOOP_BOUNDARY,
  FLAG_BEAT_MARKER,
  FLAG_SELECTED,
  FLAG_CONTINUATION,
  FLAG_PLAYING,
} from "../components/ButtonGrid";
import { findNoteAtCell, type RenderedNote } from "../types/grid";

interface UseButtonGridValuesProps {
  renderedNotes: RenderedNote[];
  startRow: number;
  startCol: number;
  currentStep: number;
  loopStart: number;
  loopEnd: number;
  selectedNote: { row: number; col: number } | null;
}

/**
 * Compute the 2D array of button values for ButtonGrid
 * This is memoized to prevent recalculation unless inputs change
 */
export function useButtonGridValues({
  renderedNotes,
  startRow,
  startCol,
  currentStep,
  loopStart,
  loopEnd,
  selectedNote,
}: UseButtonGridValuesProps): number[][] {
  return useMemo(() => {
    // Calculate looped step for playhead
    const loopLength = loopEnd - loopStart;
    const loopedStep =
      currentStep >= 0
        ? loopStart + ((((currentStep - loopStart) % loopLength) + loopLength) % loopLength)
        : -1;

    const values: number[][] = [];

    for (let visibleRow = 0; visibleRow < VISIBLE_ROWS; visibleRow++) {
      const row: number[] = [];
      const actualRow = startRow + (VISIBLE_ROWS - 1 - visibleRow);

      for (let visibleCol = 0; visibleCol < VISIBLE_COLS; visibleCol++) {
        const actualCol = startCol + visibleCol;

        let value = BUTTON_OFF;

        // Check for note at this cell
        const noteAtCell = findNoteAtCell(renderedNotes, actualRow, actualCol);

        if (noteAtCell) {
          const isNoteStart = noteAtCell.col === actualCol;
          const noteStartCol = noteAtCell.col;
          const noteEndCol = noteAtCell.col + noteAtCell.length - 1;
          const isNoteCurrentlyPlaying = loopedStep >= noteStartCol && loopedStep <= noteEndCol;

          // Base: note is active
          value = BUTTON_COLOR_100;

          // Flags
          if (!isNoteStart) {
            value |= FLAG_CONTINUATION;
          }

          if (isNoteCurrentlyPlaying) {
            value |= FLAG_PLAYING;
          }

          // Check if selected
          if (selectedNote && selectedNote.row === actualRow && selectedNote.col === noteAtCell.sourceCol) {
            value |= FLAG_SELECTED;
          }
        } else {
          // Empty cell - add grid markers
          const isInLoop = actualCol >= loopStart && actualCol < loopEnd;

          if (isInLoop) {
            // Playhead
            if (actualCol === loopedStep) {
              value |= FLAG_PLAYHEAD;
            }

            // Loop boundary
            if (actualCol === loopStart || actualCol === loopEnd - 1) {
              value |= FLAG_LOOP_BOUNDARY;
            }
            // Beat marker (every 4th column, alternating groups)
            else if (Math.floor(actualCol / 4) % 2 === 0) {
              value |= FLAG_BEAT_MARKER;
            }
          }
        }

        // C note marker (any row where MIDI note % 12 === 0)
        if (actualRow % 12 === 0) {
          value |= FLAG_C_NOTE;
        }

        row.push(value);
      }

      values.push(row);
    }

    return values;
  }, [renderedNotes, startRow, startCol, currentStep, loopStart, loopEnd, selectedNote]);
}
