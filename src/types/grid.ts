export interface GridCell {
  row: number;
  col: number;
  active: boolean;
  color: string;
}

// Note value: 0 = no note, positive number = note length in steps
export type NoteValue = number;

export type GridState = NoteValue[][];

export interface TransportState {
  isPlaying: boolean;
  bpm: number;
  currentStep: number;
}
