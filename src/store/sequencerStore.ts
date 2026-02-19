import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ModifySubMode, PatternData, Subdivision } from "../types/event";
import {
  createEmptyPatternData,
  WHOLE_NOTE,
} from "../types/event";
import type { ChannelType } from "../types/drums";
import { DRUM_TOTAL_ROWS } from "../types/drums";
import { buildScaleMapping, SCALES } from "../types/scales";

// ============ Constants ============
export const NUM_CHANNELS = 8;
export const VISIBLE_ROWS = 8;
export const VISIBLE_COLS = 16;
export const DEFAULT_PATTERN_TICKS = WHOLE_NOTE * 4; // 4 bars = 7680 ticks
export const DEFAULT_LOOP_TICKS = WHOLE_NOTE;        // 1 bar = 1920 ticks
export const DEFAULT_SUBDIVISION: Subdivision = "1/16";

// ============ Types ============
export type UiMode = "pattern" | "channel" | "loop" | "modify";

export interface PatternLoop {
  start: number;  // in ticks
  length: number; // in ticks
}

interface ViewState {
  rowOffsets: number[]; // Per-channel scroll position (0-1)
  colOffset: number; // Horizontal scroll (0-1)
  selectedNoteId: string | null; // ID of the selected NoteEvent
  uiMode: UiMode;
  modifySubMode: ModifySubMode; // Active sub-mode within modify mode
  zoom: Subdivision; // Current zoom level (determines ticks per visible column)
}

export interface SequencerState {
  // === Core State (React rendering bridge) ===
  currentChannel: number;
  currentPatterns: number[]; // Active pattern per channel
  currentLoop: PatternLoop; // Current channel's current pattern loop (mirror of WASM)
  currentPatternData: PatternData; // Current channel's current pattern (mirror of WASM, for OLED)
  queuedPatterns: (number | null)[]; // Queued pattern per channel

  // === Playback State ===
  isPlaying: boolean;
  isExternalPlayback: boolean;
  bpm: number;
  currentTick: number; // Current tick position (-1 when stopped)

  // === Channel Types ===
  channelTypes: ChannelType[];  // "melodic" or "drum" per channel

  // === Scale/Key State ===
  scaleRoot: number;  // Root note as semitone offset (0=C, 1=C#, ..., 11=B)
  scaleId: string;    // Key into SCALES record

  // === View State ===
  view: ViewState;
}

export interface SequencerActions {
  _setCurrentChannel: (channel: number) => void;
  _setCurrentPatterns: (patterns: number[]) => void;
  _setCurrentLoop: (loop: PatternLoop) => void;
  _setCurrentPatternData: (data: PatternData) => void;
  _setQueuedPatterns: (queued: (number | null)[]) => void;
  _setIsPlaying: (playing: boolean) => void;
  _setIsExternalPlayback: (external: boolean) => void;
  _setBpm: (bpm: number) => void;
  _setCurrentTick: (tick: number) => void;
  _setChannelTypes: (types: ChannelType[]) => void;
  _setScale: (root: number, scaleId: string) => void;
  _setView: (view: Partial<ViewState>) => void;
}

export type SequencerStore = SequencerState & SequencerActions;

// ============ Initial State Helpers ============

const createInitialView = (): ViewState => {
  // Compute melodic offset so row 0 (C4) is at the bottom of the visible area
  const defaultMapping = buildScaleMapping(0, SCALES.major.pattern);
  const melodicMaxRowOffset = Math.max(0, defaultMapping.totalRows - VISIBLE_ROWS);
  const melodicOffset = melodicMaxRowOffset > 0
    ? 1 - defaultMapping.zeroIndex / melodicMaxRowOffset
    : 0.5;

  // Compute drum offset so MIDI 36 (bass drum) is at the bottom of the visible area
  const drumMaxRowOffset = Math.max(0, DRUM_TOTAL_ROWS - VISIBLE_ROWS);
  const drumOffset = drumMaxRowOffset > 0
    ? 1 - 36 / drumMaxRowOffset
    : 0.5;

  return {
    rowOffsets: Array.from({ length: NUM_CHANNELS }, (_, i) => i >= 6 ? drumOffset : melodicOffset),
    colOffset: 0,
    uiMode: "pattern",
    modifySubMode: "velocity",
    selectedNoteId: null,
    zoom: DEFAULT_SUBDIVISION,
  };
};

// ============ Store Definition ============
export const useSequencerStore = create<SequencerStore>()(
  immer((set) => ({
    // Initial state
    currentChannel: 0,
    currentPatterns: Array(NUM_CHANNELS).fill(0),
    currentLoop: { start: 0, length: DEFAULT_LOOP_TICKS },
    currentPatternData: createEmptyPatternData(DEFAULT_SUBDIVISION, DEFAULT_PATTERN_TICKS),
    queuedPatterns: Array(NUM_CHANNELS).fill(null),
    isPlaying: false,
    isExternalPlayback: false,
    bpm: 120,
    currentTick: -1,
    channelTypes: ["melodic", "melodic", "melodic", "melodic", "melodic", "melodic", "drum", "drum"] as ChannelType[],
    scaleRoot: 0,          // C
    scaleId: "major",      // C Major
    view: createInitialView(),

    // Basic setters (direct state updates)
    _setCurrentChannel: (channel) => set({ currentChannel: channel }),
    _setCurrentPatterns: (patterns) => set({ currentPatterns: patterns }),
    _setCurrentLoop: (loop) => set({ currentLoop: loop }),
    _setCurrentPatternData: (data) => set({ currentPatternData: data }),
    _setQueuedPatterns: (queued) => set({ queuedPatterns: queued }),
    _setIsPlaying: (playing) => set({ isPlaying: playing }),
    _setIsExternalPlayback: (external) => set({ isExternalPlayback: external }),
    _setBpm: (bpm) => set({ bpm }),
    _setCurrentTick: (tick) => set({ currentTick: tick }),
    _setChannelTypes: (types) => set({ channelTypes: types }),
    _setScale: (root, scaleId) => set({ scaleRoot: root, scaleId }),
    _setView: (viewUpdate) =>
      set((state) => {
        Object.assign(state.view, viewUpdate);
      }),
  })),
);

// ============ Utility to get store outside React ============
export const getSequencerStore = () => useSequencerStore.getState();
