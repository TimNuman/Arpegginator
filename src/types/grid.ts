export interface GridCell {
  row: number;
  col: number;
  active: boolean;
  color: string;
}

export type GridState = boolean[][];

export interface TransportState {
  isPlaying: boolean;
  bpm: number;
  currentStep: number;
}
