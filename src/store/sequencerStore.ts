import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ModifySubMode, NoteEvent, PatternData, Subdivision } from "../types/event";
import {
  createEmptyPatternData,
  WHOLE_NOTE,
} from "../types/event";
import type { ChannelType } from "../types/drums";
import { DRUM_TOTAL_ROWS } from "../types/drums";
import { buildScaleMapping, SCALES } from "../types/scales";

// ============ Constants ============
export const NUM_CHANNELS = 8;
const PATTERNS_PER_CHANNEL = 8;
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
  // === Core Sequencer State ===
  patterns: PatternData[][]; // [channel][pattern]
  currentChannel: number;
  currentPatterns: number[]; // Active pattern per channel
  patternLoops: PatternLoop[][]; // [channel][pattern] — tick-based
  queuedPatterns: (number | null)[]; // Queued pattern per channel

  // === Playback State ===
  isPlaying: boolean;
  isExternalPlayback: boolean;
  bpm: number;
  currentTick: number; // Current tick position (-1 when stopped)

  // === Mute/Solo State ===
  mutedChannels: boolean[];
  soloedChannels: boolean[];

  // === Channel Types ===
  channelTypes: ChannelType[];  // "melodic" or "drum" per channel

  // === Scale/Key State ===
  scaleRoot: number;  // Root note as semitone offset (0=C, 1=C#, ..., 11=B)
  scaleId: string;    // Key into SCALES record

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
  _setCurrentTick: (tick: number) => void;
  _setMutedChannels: (muted: boolean[]) => void;
  _setSoloedChannels: (soloed: boolean[]) => void;
  _setChannelTypes: (types: ChannelType[]) => void;
  _setScale: (root: number, scaleId: string) => void;
  _setView: (view: Partial<ViewState>) => void;

  // === Event-Based Pattern Operations ===
  _addEvent: (channel: number, pattern: number, event: NoteEvent) => void;
  _removeEvent: (channel: number, pattern: number, eventId: string) => void;
  _updateEvent: (
    channel: number,
    pattern: number,
    eventId: string,
    updates: Partial<NoteEvent>,
  ) => void;
  _setPatternData: (
    channel: number,
    pattern: number,
    data: PatternData,
  ) => void;
}

export type SequencerStore = SequencerState & SequencerActions;

// ============ Initial State Helpers ============
const createEmptyPatterns = (): PatternData[] =>
  Array.from({ length: PATTERNS_PER_CHANNEL }, () =>
    createEmptyPatternData(DEFAULT_SUBDIVISION, DEFAULT_PATTERN_TICKS),
  );

const createEmptyChannels = (): PatternData[][] => {
  return Array.from({ length: NUM_CHANNELS }, () =>
    createEmptyPatterns(),
  );
};

const createDefaultLoops = (): PatternLoop[][] =>
  Array.from({ length: NUM_CHANNELS }, () =>
    Array.from({ length: PATTERNS_PER_CHANNEL }, () => ({
      start: 0,
      length: DEFAULT_LOOP_TICKS,
    })),
  );

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
    patterns: createEmptyChannels(),
    currentChannel: 0,
    currentPatterns: Array(NUM_CHANNELS).fill(0),
    patternLoops: createDefaultLoops(),
    queuedPatterns: Array(NUM_CHANNELS).fill(null),
    isPlaying: false,
    isExternalPlayback: false,
    bpm: 120,
    currentTick: -1,
    mutedChannels: Array(NUM_CHANNELS).fill(false),
    soloedChannels: Array(NUM_CHANNELS).fill(false),
    channelTypes: ["melodic", "melodic", "melodic", "melodic", "melodic", "melodic", "drum", "drum"] as ChannelType[],
    scaleRoot: 0,          // C
    scaleId: "major",      // C Major
    view: createInitialView(),

    // Basic setters (direct state updates)
    _setCurrentChannel: (channel) => set({ currentChannel: channel }),
    _setCurrentPatterns: (patterns) => set({ currentPatterns: patterns }),
    _setPatternLoops: (loops) => set({ patternLoops: loops }),
    _setQueuedPatterns: (queued) => set({ queuedPatterns: queued }),
    _setIsPlaying: (playing) => set({ isPlaying: playing }),
    _setIsExternalPlayback: (external) => set({ isExternalPlayback: external }),
    _setBpm: (bpm) => set({ bpm }),
    _setCurrentTick: (tick) => set({ currentTick: tick }),
    _setMutedChannels: (muted) => set({ mutedChannels: muted }),
    _setSoloedChannels: (soloed) => set({ soloedChannels: soloed }),
    _setChannelTypes: (types) => set({ channelTypes: types }),
    _setScale: (root, scaleId) => set({ scaleRoot: root, scaleId }),
    _setView: (viewUpdate) =>
      set((state) => {
        Object.assign(state.view, viewUpdate);
      }),

    // Add an event to a pattern
    _addEvent: (channel, pattern, event) =>
      set((state) => {
        state.patterns[channel][pattern].events.push(event);
      }),

    // Remove an event by ID
    _removeEvent: (channel, pattern, eventId) =>
      set((state) => {
        const events = state.patterns[channel][pattern].events;
        const idx = events.findIndex((e) => e.id === eventId);
        if (idx !== -1) {
          events.splice(idx, 1);
        }
      }),

    // Update an event by ID with partial updates
    _updateEvent: (channel, pattern, eventId, updates) =>
      set((state) => {
        const event = state.patterns[channel][pattern].events.find(
          (e) => e.id === eventId,
        );
        if (event) {
          Object.assign(event, updates);
        }
      }),

    // Replace entire pattern data
    _setPatternData: (channel, pattern, data) =>
      set((state) => {
        state.patterns[channel][pattern] = data;
      }),
  })),
);

// ============ Utility to get store outside React ============
export const getSequencerStore = () => useSequencerStore.getState();
