import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { GridState, NoteValue, ModifySubMode } from "../types/grid";
import { createNotePattern } from "../types/grid";

// ============ Constants ============
export const ROWS = 128;
export const COLS = 64;
export const NUM_CHANNELS = 8;
const PATTERNS_PER_CHANNEL = 8;
export const VISIBLE_ROWS = 8;
export const VISIBLE_COLS = 16;
export const DEFAULT_LOOP_START = 0;
export const DEFAULT_LOOP_LENGTH = 16;

// ============ Types ============
export type UiMode = "pattern" | "channel" | "loop" | "modify";

export interface PatternLoop {
  start: number;
  length: number;
}

interface ViewState {
  rowOffsets: number[]; // Per-channel scroll position (0-1)
  colOffset: number; // Horizontal scroll (0-1)
  selectedNote: { row: number; col: number } | null;
  uiMode: UiMode;
  modifySubMode: ModifySubMode; // Active sub-mode within modify mode
}

export interface SequencerState {
  // === Core Sequencer State ===
  channels: GridState[][]; // [channel][pattern][row][col]
  currentChannel: number;
  currentPatterns: number[]; // Active pattern per channel
  patternLoops: PatternLoop[][]; // [channel][pattern]
  queuedPatterns: (number | null)[]; // Queued pattern per channel

  // === Playback State ===
  isPlaying: boolean;
  isExternalPlayback: boolean;
  bpm: number;
  currentStep: number;

  // === Mute/Solo State ===
  mutedChannels: boolean[];
  soloedChannels: boolean[];

  // === View State ===
  view: ViewState;
}

export interface SequencerActions {
  // === Basic Setters (minimal logic) ===
  _setCurrentChannel: (channel: number) => void;
  _setCurrentPatterns: (patterns: number[]) => void;
  _setPatternLoops: (loops: PatternLoop[][]) => void;
  _setQueuedPatterns: (queued: (number | null)[]) => void;
  _setIsPlaying: (playing: boolean) => void;
  _setIsExternalPlayback: (external: boolean) => void;
  _setBpm: (bpm: number) => void;
  _setCurrentStep: (step: number) => void;
  _setMutedChannels: (muted: boolean[]) => void;
  _setSoloedChannels: (soloed: boolean[]) => void;
  _setView: (view: Partial<ViewState>) => void;

  // === Atomic Pattern Updates (used by actions) ===
  _updateCell: (
    channel: number,
    pattern: number,
    row: number,
    col: number,
    value: NoteValue,
  ) => void;
  _updatePattern: (channel: number, pattern: number, grid: GridState) => void;
  _updateRow: (
    channel: number,
    pattern: number,
    row: number,
    rowData: NoteValue[],
  ) => void;
}

export type SequencerStore = SequencerState & SequencerActions;

// ============ Initial State Helpers ============
const createEmptyGrid = (): GridState =>
  Array.from({ length: ROWS }, () => Array(COLS).fill(null));

const createEmptyPatterns = (): GridState[] =>
  Array.from({ length: PATTERNS_PER_CHANNEL }, () => createEmptyGrid());

const createEmptyChannels = (): GridState[][] => {
  const channels = Array.from({ length: NUM_CHANNELS }, () =>
    createEmptyPatterns(),
  );
  // Seed channel 1 pattern 0 with a basic drumbeat for testing
  const drums = channels[0][0];
  drums[36][0] = createNotePattern(1, 4, 4); // kick
  drums[40][4] = createNotePattern(1, 2, 8); // snare
  drums[42][0] = createNotePattern(1, 16, 1); // closed hat
  return channels;
};

const createDefaultLoops = (): PatternLoop[][] =>
  Array.from({ length: NUM_CHANNELS }, () =>
    Array.from({ length: PATTERNS_PER_CHANNEL }, () => ({
      start: DEFAULT_LOOP_START,
      length: DEFAULT_LOOP_LENGTH,
    })),
  );

const getInitialRowOffset = (channel: number): number => {
  const maxRowOffset = ROWS - VISIBLE_ROWS;
  return channel < 4
    ? 1 - 36 / maxRowOffset // Drums: MIDI note 36
    : 1 - 60 / maxRowOffset; // Melodic: middle C (60)
};

const createInitialView = (): ViewState => ({
  rowOffsets: Array.from({ length: NUM_CHANNELS }, (_, i) =>
    getInitialRowOffset(i),
  ),
  colOffset: 0,
  uiMode: "pattern",
  modifySubMode: "velocity",
  selectedNote: null,
});

// ============ Store Definition ============
export const useSequencerStore = create<SequencerStore>()(
  immer((set) => ({
    // Initial state
    channels: createEmptyChannels(),
    currentChannel: 0,
    currentPatterns: Array(NUM_CHANNELS).fill(0),
    patternLoops: createDefaultLoops(),
    queuedPatterns: Array(NUM_CHANNELS).fill(null),
    isPlaying: false,
    isExternalPlayback: false,
    bpm: 120,
    currentStep: -1,
    mutedChannels: Array(NUM_CHANNELS).fill(false),
    soloedChannels: Array(NUM_CHANNELS).fill(false),
    view: createInitialView(),

    // Basic setters (direct state updates)
    _setCurrentChannel: (channel) => set({ currentChannel: channel }),
    _setCurrentPatterns: (patterns) => set({ currentPatterns: patterns }),
    _setPatternLoops: (loops) => set({ patternLoops: loops }),
    _setQueuedPatterns: (queued) => set({ queuedPatterns: queued }),
    _setIsPlaying: (playing) => set({ isPlaying: playing }),
    _setIsExternalPlayback: (external) => set({ isExternalPlayback: external }),
    _setBpm: (bpm) => set({ bpm }),
    _setCurrentStep: (step) => set({ currentStep: step }),
    _setMutedChannels: (muted) => set({ mutedChannels: muted }),
    _setSoloedChannels: (soloed) => set({ soloedChannels: soloed }),
    _setView: (viewUpdate) =>
      set((state) => {
        Object.assign(state.view, viewUpdate);
      }),

    // Atomic cell update (immer handles immutability)
    _updateCell: (channel, pattern, row, col, value) =>
      set((state) => {
        state.channels[channel][pattern][row][col] = value;
      }),

    // Atomic pattern update
    _updatePattern: (channel, pattern, grid) =>
      set((state) => {
        state.channels[channel][pattern] = grid;
      }),

    // Atomic row update
    _updateRow: (channel, pattern, row, rowData) =>
      set((state) => {
        state.channels[channel][pattern][row] = rowData;
      }),
  })),
);

// ============ Utility to get store outside React ============
export const getSequencerStore = () => useSequencerStore.getState();
