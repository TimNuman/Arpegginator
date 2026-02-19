import type { NoteEvent, PatternData, VelocityLoopMode, Subdivision } from '../types/event';
import { SUBDIVISION_TICKS } from '../types/event';
import { DEFAULT_PATTERN_TICKS } from '../store/sequencerStore';
import type { StepTriggerExtras } from '../actions/playbackActions';
import { registerWasmActiveNote } from '../actions/playbackActions';
import { buildScaleMapping, SCALES, SCALE_ORDER } from '../types/scales';
import { getSequencerStore, type SequencerState } from '../store/sequencerStore';

// ============ Emscripten Module Types ============

interface EmscriptenModule {
  cwrap: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: number[]) => number;
  HEAPU8: Uint8Array;
}

type WasmFactory = (config?: object) => Promise<EmscriptenModule>;

// Sub-mode order must match C enum: SM_VELOCITY=0, SM_HIT=1, SM_TIMING=2, SM_FLAM=3, SM_MODULATE=4
const SUB_MODE_FIELDS: Array<{
  arrayField: keyof NoteEvent;
  loopModeField: keyof NoteEvent;
}> = [
  { arrayField: 'velocity', loopModeField: 'velocityLoopMode' },
  { arrayField: 'chance', loopModeField: 'chanceLoopMode' },
  { arrayField: 'timingOffset', loopModeField: 'timingLoopMode' },
  { arrayField: 'flamChance', loopModeField: 'flamLoopMode' },
  { arrayField: 'modulate', loopModeField: 'modulateLoopMode' },
];

const LOOP_MODE_MAP: Record<VelocityLoopMode, number> = {
  reset: 0,
  continue: 1,
  fill: 2,
};

// C enum SubModeId: SM_VELOCITY=0, SM_HIT=1, SM_TIMING=2, SM_FLAM=3, SM_MODULATE=4
const SUB_MODE_NAME_TO_ID: Record<string, number> = {
  velocity: 0, hit: 1, timing: 2, flam: 3, modulate: 4,
};

// C enum SubModeId names for preview callback
const SUB_MODE_NAMES = ['velocity', 'hit', 'timing', 'flam', 'modulate'] as const;

/** Load the Emscripten glue script and return the factory function. */
function loadGlueScript(url: string): Promise<WasmFactory> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
      const factory = (window as unknown as Record<string, WasmFactory>).createWasmEngine;
      if (!factory) {
        reject(new Error('createWasmEngine not found on window'));
        return;
      }
      resolve(factory);
    };
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
}

export class WasmEngine {
  private module: EmscriptenModule | null = null;

  // Struct layout info (queried from C at load time)
  private noteEventSize = 0;
  private fieldOffsets: number[] = [];
  private subModeArraySize = 0;

  // Core functions
  private _engineInit!: () => void;
  private _enginePlayInit!: () => void;
  private _engineTick!: () => void;
  private _engineStop!: () => void;
  private _getVersion!: () => number;

  // Buffer accessors
  private _getEventBuffer!: (ch: number, pat: number) => number;
  private _setEventCount!: (ch: number, pat: number, count: number) => void;
  private _setPatternLength!: (ch: number, pat: number, len: number) => void;
  private _getLoopsBuffer!: () => number;
  private _getScaleBuffer!: () => number;
  private _setScaleInfo!: (count: number, zeroIndex: number) => void;
  private _getMutedBuffer!: () => number;
  private _getSoloedBuffer!: () => number;
  private _getChannelTypesBuffer!: () => number;
  private _getCurrentPatternsBuffer!: () => number;
  private _getQueuedPatternsBuffer!: () => number;
  private _setRngSeed!: (seed: number) => void;
  private _getNoteEventSize!: () => number;
  private _getFieldOffset!: (fieldId: number) => number;
  private _getSubModeArraySize!: () => number;
  private _getContinueCounter!: (subMode: number, channel: number, eventIndex: number) => number;
  private _getEventCount!: (ch: number, pat: number) => number;
  private _getPatternLength!: (ch: number, pat: number) => number;

  // UI state setters
  private _setUiMode!: (mode: number) => void;
  private _setModifySubMode!: (sm: number) => void;
  private _setCurrentChannel!: (ch: number) => void;
  private _setZoom!: (tpc: number) => void;
  private _setSelectedEvent!: (idx: number) => void;
  private _setRowOffset!: (ch: number, offset: number) => void;
  private _setColOffset!: (offset: number) => void;
  private _setBpm!: (bpm: number) => void;
  private _setIsPlaying!: (playing: number) => void;
  private _setCtrlHeld!: (held: number) => void;
  private _setChannelColor!: (ch: number, rgb: number) => void;
  private _setScaleRoot!: (root: number) => void;
  private _setScaleIdIdx!: (idx: number) => void;

  // UI state getters
  private _getUiMode!: () => number;
  private _getModifySubMode!: () => number;
  private _getCurrentChannel!: () => number;
  private _getZoom!: () => number;
  private _getSelectedEvent!: () => number;
  private _getBpm!: () => number;
  private _getIsPlaying!: () => number;

  // Grid output
  private _getButtonValuesBuffer!: () => number;
  private _getColorOverridesBuffer!: () => number;
  private _getPatternsHaveNotesBuffer!: () => number;
  private _getChannelsPlayingNowBuffer!: () => number;
  private _computeGrid!: () => void;

  // Input handling
  private _buttonPress!: (row: number, col: number, modifiers: number) => void;
  private _arrowPress!: (direction: number, modifiers: number) => void;
  private _keyAction!: (actionId: number) => void;

  // Edit operations
  private _toggleEvent!: (row: number, tick: number, lengthTicks: number) => number;
  private _removeEvent!: (eventIdx: number) => void;
  private _moveEvent!: (eventIdx: number, newRow: number, newPos: number) => void;
  private _setEventLength!: (eventIdx: number, length: number) => void;
  private _placeEvent!: (eventIdx: number) => void;
  private _setEventRepeatAmount!: (eventIdx: number, amount: number) => void;
  private _setEventRepeatSpace!: (eventIdx: number, space: number) => void;
  private _setSubModeValue!: (eventIdx: number, sm: number, repeatIdx: number, value: number) => void;
  private _setSubModeLength!: (eventIdx: number, sm: number, length: number) => void;
  private _toggleSubModeLoopMode!: (eventIdx: number, sm: number) => void;
  private _adjustChordStack!: (eventIdx: number, direction: number) => void;
  private _cycleChordShape!: (eventIdx: number, direction: number) => void;
  private _cycleChordInversion!: (eventIdx: number, direction: number) => void;
  private _copyPattern!: (targetPattern: number) => void;
  private _clearPattern!: () => void;
  private _allocEventId!: () => number;

  // Event index mapping: [ch][pat] → Map<UUID, index>
  private eventIndexMaps: Map<string, number>[][] = [];

  // Callbacks
  onStepTrigger: ((channel: number, midiNote: number, tick: number, noteLengthTicks: number, velocity: number, extras?: StepTriggerExtras) => void) | null = null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null = null;
  onPreviewValue: ((subMode: string, channel: number, eventIndex: number, tick: number, value: number) => void) | null = null;
  onPlayPreviewNote: ((channel: number, row: number, lengthTicks: number) => void) | null = null;
  onCycleScale: ((direction: number) => void) | null = null;
  onCycleScaleRoot: ((direction: number) => void) | null = null;
  // Map eventIndex back to UUID for preview
  private eventIndexToId: Map<string, string>[][] = [];

  async load(): Promise<void> {
    if (this.module) return;

    const factory = await loadGlueScript('/wasm/engine.js');
    this.module = await factory();

    // Wire cwrap bindings
    const cw = (name: string, ret: string | null, args: string[]) =>
      this.module!.cwrap(name, ret, args);

    this._engineInit = cw('engine_init', null, []) as unknown as () => void;
    this._enginePlayInit = cw('engine_play_init', null, []) as unknown as () => void;
    this._engineTick = cw('engine_tick', null, []) as unknown as () => void;
    this._engineStop = cw('engine_stop', null, []) as unknown as () => void;
    this._getVersion = cw('engine_get_version', 'number', []);
    this._getEventBuffer = cw('engine_get_event_buffer', 'number', ['number', 'number']);
    this._setEventCount = cw('engine_set_event_count', null, ['number', 'number', 'number']) as unknown as (ch: number, pat: number, count: number) => void;
    this._setPatternLength = cw('engine_set_pattern_length', null, ['number', 'number', 'number']) as unknown as (ch: number, pat: number, len: number) => void;
    this._getLoopsBuffer = cw('engine_get_loops_buffer', 'number', []);
    this._getScaleBuffer = cw('engine_get_scale_buffer', 'number', []);
    this._setScaleInfo = cw('engine_set_scale_info', null, ['number', 'number']) as unknown as (count: number, zeroIndex: number) => void;
    this._getMutedBuffer = cw('engine_get_muted_buffer', 'number', []);
    this._getSoloedBuffer = cw('engine_get_soloed_buffer', 'number', []);
    this._getChannelTypesBuffer = cw('engine_get_channel_types_buffer', 'number', []);
    this._getCurrentPatternsBuffer = cw('engine_get_current_patterns_buffer', 'number', []);
    this._getQueuedPatternsBuffer = cw('engine_get_queued_patterns_buffer', 'number', []);
    this._setRngSeed = cw('engine_set_rng_seed', null, ['number']) as unknown as (seed: number) => void;
    this._getNoteEventSize = cw('engine_get_note_event_size', 'number', []);
    this._getFieldOffset = cw('engine_get_field_offset', 'number', ['number']);
    this._getSubModeArraySize = cw('engine_get_sub_mode_array_size', 'number', []);
    this._getContinueCounter = cw('engine_get_continue_counter', 'number', ['number', 'number', 'number']);
    this._getEventCount = cw('engine_get_event_count', 'number', ['number', 'number']);
    this._getPatternLength = cw('engine_get_pattern_length', 'number', ['number', 'number']);

    // UI state setters
    this._setUiMode = cw('engine_set_ui_mode', null, ['number']) as unknown as (m: number) => void;
    this._setModifySubMode = cw('engine_set_modify_sub_mode', null, ['number']) as unknown as (m: number) => void;
    this._setCurrentChannel = cw('engine_set_current_channel', null, ['number']) as unknown as (m: number) => void;
    this._setZoom = cw('engine_set_zoom', null, ['number']) as unknown as (m: number) => void;
    this._setSelectedEvent = cw('engine_set_selected_event', null, ['number']) as unknown as (m: number) => void;
    this._setRowOffset = cw('engine_set_row_offset', null, ['number', 'number']) as unknown as (ch: number, o: number) => void;
    this._setColOffset = cw('engine_set_col_offset', null, ['number']) as unknown as (o: number) => void;
    this._setBpm = cw('engine_set_bpm', null, ['number']) as unknown as (b: number) => void;
    this._setIsPlaying = cw('engine_set_is_playing', null, ['number']) as unknown as (p: number) => void;
    this._setCtrlHeld = cw('engine_set_ctrl_held', null, ['number']) as unknown as (h: number) => void;
    this._setChannelColor = cw('engine_set_channel_color', null, ['number', 'number']) as unknown as (ch: number, rgb: number) => void;
    this._setScaleRoot = cw('engine_set_scale_root', null, ['number']) as unknown as (r: number) => void;
    this._setScaleIdIdx = cw('engine_set_scale_id_idx', null, ['number']) as unknown as (i: number) => void;

    // UI state getters
    this._getUiMode = cw('engine_get_ui_mode', 'number', []);
    this._getModifySubMode = cw('engine_get_modify_sub_mode', 'number', []);
    this._getCurrentChannel = cw('engine_get_current_channel', 'number', []);
    this._getZoom = cw('engine_get_zoom', 'number', []);
    this._getSelectedEvent = cw('engine_get_selected_event', 'number', []);
    this._getBpm = cw('engine_get_bpm', 'number', []);
    this._getIsPlaying = cw('engine_get_is_playing', 'number', []);

    // Grid output
    this._getButtonValuesBuffer = cw('engine_get_button_values_buffer', 'number', []);
    this._getColorOverridesBuffer = cw('engine_get_color_overrides_buffer', 'number', []);
    this._getPatternsHaveNotesBuffer = cw('engine_get_patterns_have_notes_buffer', 'number', []);
    this._getChannelsPlayingNowBuffer = cw('engine_get_channels_playing_now_buffer', 'number', []);
    this._computeGrid = cw('engine_compute_grid_export', null, []) as unknown as () => void;

    // Input handling
    this._buttonPress = cw('engine_button_press_export', null, ['number', 'number', 'number']) as unknown as (r: number, c: number, m: number) => void;
    this._arrowPress = cw('engine_arrow_press_export', null, ['number', 'number']) as unknown as (d: number, m: number) => void;
    this._keyAction = cw('engine_key_action_export', null, ['number']) as unknown as (a: number) => void;

    // Edit operations
    this._toggleEvent = cw('engine_toggle_event_export', 'number', ['number', 'number', 'number']);
    this._removeEvent = cw('engine_remove_event_export', null, ['number']) as unknown as (i: number) => void;
    this._moveEvent = cw('engine_move_event_export', null, ['number', 'number', 'number']) as unknown as (i: number, r: number, p: number) => void;
    this._setEventLength = cw('engine_set_event_length_export', null, ['number', 'number']) as unknown as (i: number, l: number) => void;
    this._placeEvent = cw('engine_place_event_export', null, ['number']) as unknown as (i: number) => void;
    this._setEventRepeatAmount = cw('engine_set_event_repeat_amount_export', null, ['number', 'number']) as unknown as (i: number, a: number) => void;
    this._setEventRepeatSpace = cw('engine_set_event_repeat_space_export', null, ['number', 'number']) as unknown as (i: number, s: number) => void;
    this._setSubModeValue = cw('engine_set_sub_mode_value_export', null, ['number', 'number', 'number', 'number']) as unknown as (i: number, sm: number, ri: number, v: number) => void;
    this._setSubModeLength = cw('engine_set_sub_mode_length_export', null, ['number', 'number', 'number']) as unknown as (i: number, sm: number, l: number) => void;
    this._toggleSubModeLoopMode = cw('engine_toggle_sub_mode_loop_mode_export', null, ['number', 'number']) as unknown as (i: number, sm: number) => void;
    this._adjustChordStack = cw('engine_adjust_chord_stack_export', null, ['number', 'number']) as unknown as (i: number, d: number) => void;
    this._cycleChordShape = cw('engine_cycle_chord_shape_export', null, ['number', 'number']) as unknown as (i: number, d: number) => void;
    this._cycleChordInversion = cw('engine_cycle_chord_inversion_export', null, ['number', 'number']) as unknown as (i: number, d: number) => void;
    this._copyPattern = cw('engine_copy_pattern_export', null, ['number']) as unknown as (t: number) => void;
    this._clearPattern = cw('engine_clear_pattern_export', null, []) as unknown as () => void;
    this._allocEventId = cw('engine_alloc_event_id_export', 'number', []);

    // Query struct layout from C
    this.noteEventSize = this._getNoteEventSize();
    this.subModeArraySize = this._getSubModeArraySize();
    for (let i = 0; i <= 10; i++) {
      this.fieldOffsets[i] = this._getFieldOffset(i);
    }

    // Init event index maps
    for (let ch = 0; ch < 8; ch++) {
      this.eventIndexMaps[ch] = [];
      this.eventIndexToId[ch] = [];
      for (let pat = 0; pat < 8; pat++) {
        this.eventIndexMaps[ch][pat] = new Map();
        this.eventIndexToId[ch][pat] = new Map();
      }
    }

    // Register JS callbacks on module
    this.wireCallbacks();

    console.log('WASM engine loaded, version:', this.getVersion(),
      `(NoteEvent_C: ${this.noteEventSize} bytes, SubModeArray: ${this.subModeArraySize} bytes)`);
  }

  private wireCallbacks(): void {
    const mod = this.module as unknown as Record<string, unknown>;
    mod._callbacks = {
      stepTrigger: (ch: number, note: number, tick: number, len: number, vel: number, timing: number, flam: number, evIdx: number) => {
        // Register active note for grid highlighting
        const store = getSequencerStore();
        const patIdx = store.currentPatterns[ch];
        const eventId = this.getEventId(ch, patIdx, evIdx);
        if (eventId) {
          registerWasmActiveNote(ch, eventId, tick, len, note);
        }

        if (!this.onStepTrigger) return;
        const extras: StepTriggerExtras = {};
        if (timing !== 0) extras.timingOffsetPercent = timing;
        if (flam > 0) extras.flamCount = flam;
        const hasExtras = extras.timingOffsetPercent !== undefined || extras.flamCount !== undefined;
        this.onStepTrigger(ch, note, tick, len, vel, hasExtras ? extras : undefined);
      },
      noteOff: (ch: number, note: number) => {
        this.onNoteOff?.(ch, note);
      },
      setCurrentTick: (tick: number) => {
        getSequencerStore()._setCurrentTick(tick);
      },
      setCurrentPatterns: (patterns: number[]) => {
        getSequencerStore()._setCurrentPatterns(patterns);
      },
      clearQueuedPattern: (ch: number) => {
        const store = getSequencerStore();
        const queued = [...store.queuedPatterns];
        queued[ch] = null;
        store._setQueuedPatterns(queued);
      },
      previewValue: (sm: number, ch: number, evIdx: number, tick: number, val: number) => {
        if (!this.onPreviewValue) return;
        // Convert event_index back to sub-mode name
        const subModeName = SUB_MODE_NAMES[sm];
        this.onPreviewValue(subModeName, ch, evIdx, tick, val);
      },
      playPreviewNote: (ch: number, row: number, lengthTicks: number) => {
        this.onPlayPreviewNote?.(ch, row, lengthTicks);
      },
      cycleScale: (direction: number) => {
        this.onCycleScale?.(direction);
      },
      cycleScaleRoot: (direction: number) => {
        this.onCycleScaleRoot?.(direction);
      },
    };
  }

  isReady(): boolean {
    return this.module !== null;
  }

  getVersion(): number {
    return this._getVersion();
  }

  // ============ Core Operations ============

  /** Full init — resets everything including UI state. Call once on load. */
  fullInit(): void {
    this._engineInit();
  }

  /** Playback init — resets only playback state (active notes, counters, tick). */
  init(): void {
    this._enginePlayInit();
  }

  tick(): void {
    this._engineTick();
  }

  stop(): void {
    this._engineStop();
  }

  // ============ Sync Operations ============

  syncAll(store: SequencerState): void {
    // Sync all patterns
    for (let ch = 0; ch < 8; ch++) {
      for (let pat = 0; pat < 8; pat++) {
        this.syncPattern(ch, pat, store.patterns[ch][pat]);
      }
    }
    this.syncPlaybackState(store);
    this.syncUiState(store);
  }

  /**
   * Sync only non-pattern state (loops, mute/solo, scale, etc.) for playback start.
   * Use this instead of syncAll when WASM already owns the pattern data.
   */
  syncPlaybackState(store: SequencerState): void {
    this.syncLoops(store);
    this.syncMuteSolo(store);
    this.syncScale(store);
    this.syncCurrentPatterns(store);
    this.syncQueuedPatterns(store);
    this.syncChannelTypes(store);
    this._setRngSeed(Math.floor(Math.random() * 0xFFFFFFFF) + 1);
  }

  /**
   * Sync UI state (row offsets, col offset, zoom, mode, BPM, etc.) from Zustand to WASM.
   * Call this after syncAll on initial load or when UI state may have drifted.
   */
  syncUiState(store: SequencerState): void {
    const view = store.view;
    // Row offsets
    for (let ch = 0; ch < 8; ch++) {
      this._setRowOffset(ch, view.rowOffsets[ch]);
    }
    // Col offset
    this._setColOffset(view.colOffset);
    // Zoom (subdivision name → ticks per col)
    this._setZoom(SUBDIVISION_TICKS[view.zoom]);
    // UI mode
    const uiModeMap: Record<string, number> = { pattern: 0, channel: 1, loop: 2, modify: 3 };
    this._setUiMode(uiModeMap[view.uiMode] ?? 0);
    // Modify sub-mode
    const smMap: Record<string, number> = { velocity: 0, hit: 1, timing: 2, flam: 3, modulate: 4 };
    this._setModifySubMode(smMap[view.modifySubMode] ?? 0);
    // Current channel
    this._setCurrentChannel(store.currentChannel);
    // BPM
    this._setBpm(store.bpm);
    // Is playing
    this._setIsPlaying(store.isPlaying ? 1 : 0);
    // Scale root and ID
    this._setScaleRoot(store.scaleRoot);
    const scaleIdx = SCALE_ORDER.indexOf(store.scaleId);
    this._setScaleIdIdx(scaleIdx >= 0 ? scaleIdx : 0);
    // Selected event
    if (view.selectedNoteId) {
      const patIdx = store.currentPatterns[store.currentChannel];
      const idx = this.getEventIndex(store.currentChannel, patIdx, view.selectedNoteId);
      this._setSelectedEvent(idx);
    } else {
      this._setSelectedEvent(-1);
    }
  }

  syncPattern(ch: number, pat: number, patternData: PatternData): void {
    const mod = this.module!;
    const bufferPtr = this._getEventBuffer(ch, pat);
    const eventCount = Math.min(patternData.events.length, 128);

    // Rebuild index map
    const idxMap = new Map<string, number>();
    const idToIdx = new Map<string, string>();
    for (let i = 0; i < eventCount; i++) {
      idxMap.set(patternData.events[i].id, i);
      idToIdx.set(String(i), patternData.events[i].id);
    }
    this.eventIndexMaps[ch][pat] = idxMap;
    this.eventIndexToId[ch][pat] = idToIdx;

    // Write each NoteEvent_C into WASM memory
    const view = new DataView(mod.HEAPU8.buffer);
    for (let i = 0; i < eventCount; i++) {
      this.writeNoteEvent(view, bufferPtr, i, patternData.events[i], i);
    }

    this._setEventCount(ch, pat, eventCount);
    this._setPatternLength(ch, pat, patternData.lengthTicks);
  }

  /**
   * Read the current channel's current pattern from WASM memory back into the Zustand store.
   * Call this after any WASM input that may have edited pattern data.
   */
  readCurrentPatternToStore(): void {
    const store = getSequencerStore();
    const ch = store.currentChannel;
    const pat = store.currentPatterns[ch];
    this.readPatternToStore(ch, pat);
  }

  /**
   * Read a specific pattern from WASM memory into the Zustand store.
   */
  readPatternToStore(ch: number, pat: number): void {
    const mod = this.module!;
    const bufferPtr = this._getEventBuffer(ch, pat);
    const eventCount = this._getEventCount(ch, pat);
    const lengthTicks = this._getPatternLength(ch, pat);
    const view = new DataView(mod.HEAPU8.buffer);

    const events: NoteEvent[] = [];
    const LOOP_MODE_REVERSE: VelocityLoopMode[] = ['reset', 'continue', 'fill'];

    for (let i = 0; i < eventCount; i++) {
      const ptr = bufferPtr + i * this.noteEventSize;

      // Read sub-mode arrays
      const subModesBase = ptr + this.fieldOffsets[6];
      const subModeArrays: { values: number[]; loopMode: VelocityLoopMode }[] = [];
      for (let sm = 0; sm < 5; sm++) {
        const arrBase = subModesBase + sm * this.subModeArraySize;
        const len = mod.HEAPU8[arrBase + 64];
        const values: number[] = [];
        for (let j = 0; j < len; j++) {
          values.push(view.getInt16(arrBase + j * 2, true));
        }
        const loopModeVal = mod.HEAPU8[arrBase + 65];
        subModeArrays.push({
          values,
          loopMode: LOOP_MODE_REVERSE[loopModeVal] ?? 'reset',
        });
      }

      const eventIndex = view.getUint16(ptr + this.fieldOffsets[10], true);
      // Look up UUID from event index
      const eventId = this.eventIndexToId[ch]?.[pat]?.get(String(eventIndex));

      const event: NoteEvent = {
        id: eventId ?? `wasm-${eventIndex}`,
        row: view.getInt16(ptr + this.fieldOffsets[0], true),
        position: view.getInt32(ptr + this.fieldOffsets[1], true),
        length: view.getInt32(ptr + this.fieldOffsets[2], true),
        enabled: mod.HEAPU8[ptr + this.fieldOffsets[3]] !== 0,
        repeatAmount: view.getUint16(ptr + this.fieldOffsets[4], true),
        repeatSpace: view.getInt32(ptr + this.fieldOffsets[5], true),
        velocity: subModeArrays[0].values,
        velocityLoopMode: subModeArrays[0].loopMode,
        chance: subModeArrays[1].values,
        chanceLoopMode: subModeArrays[1].loopMode,
        timingOffset: subModeArrays[2].values,
        timingLoopMode: subModeArrays[2].loopMode,
        flamChance: subModeArrays[3].values,
        flamLoopMode: subModeArrays[3].loopMode,
        modulate: subModeArrays[4].values,
        modulateLoopMode: subModeArrays[4].loopMode,
        chordStackSize: mod.HEAPU8[ptr + this.fieldOffsets[7]],
        chordShapeIndex: view.getInt8(ptr + this.fieldOffsets[8]),
        chordInversion: view.getInt8(ptr + this.fieldOffsets[9]),
      };

      events.push(event);

      // Update index maps for new events
      if (!eventId) {
        const newId = `wasm-${eventIndex}`;
        this.eventIndexMaps[ch][pat].set(newId, i);
        this.eventIndexToId[ch][pat].set(String(eventIndex), newId);
      }
    }

    const patternData: PatternData = {
      events,
      lengthTicks,
    };

    getSequencerStore()._setPatternData(ch, pat, patternData);
  }

  private writeNoteEvent(
    view: DataView,
    basePtr: number,
    slot: number,
    event: NoteEvent,
    eventIndex: number,
  ): void {
    const ptr = basePtr + slot * this.noteEventSize;

    // Field offsets (queried from C):
    // 0=row, 1=position, 2=length, 3=enabled, 4=repeat_amount,
    // 5=repeat_space, 6=sub_modes, 7=chord_stack_size,
    // 8=chord_shape_index, 9=chord_inversion, 10=event_index
    view.setInt16(ptr + this.fieldOffsets[0], event.row, true);
    view.setInt32(ptr + this.fieldOffsets[1], event.position, true);
    view.setInt32(ptr + this.fieldOffsets[2], event.length, true);
    view.setUint8(ptr + this.fieldOffsets[3], event.enabled ? 1 : 0);
    view.setUint16(ptr + this.fieldOffsets[4], event.repeatAmount, true);
    view.setInt32(ptr + this.fieldOffsets[5], event.repeatSpace, true);

    // Write 5 sub-mode arrays
    const subModesBase = ptr + this.fieldOffsets[6];
    for (let sm = 0; sm < 5; sm++) {
      const arrBase = subModesBase + sm * this.subModeArraySize;
      const { arrayField, loopModeField } = SUB_MODE_FIELDS[sm];
      const arr = event[arrayField] as number[];
      const loopMode = event[loopModeField] as VelocityLoopMode;
      const len = Math.min(arr.length, 32);

      for (let j = 0; j < len; j++) {
        view.setInt16(arrBase + j * 2, arr[j], true);
      }
      // length field is at offset 64 (32 × int16)
      view.setUint8(arrBase + 64, len);
      // loop_mode field at offset 65
      view.setUint8(arrBase + 65, LOOP_MODE_MAP[loopMode]);
    }

    view.setUint8(ptr + this.fieldOffsets[7], event.chordStackSize);
    view.setInt8(ptr + this.fieldOffsets[8], event.chordShapeIndex);
    view.setInt8(ptr + this.fieldOffsets[9], event.chordInversion);
    view.setUint16(ptr + this.fieldOffsets[10], eventIndex, true);
  }

  syncLoops(store: SequencerState): void {
    const mod = this.module!;
    const ptr = this._getLoopsBuffer();
    const view = new DataView(mod.HEAPU8.buffer);
    // PatternLoop_C is {int32_t start, int32_t length} = 8 bytes
    for (let ch = 0; ch < 8; ch++) {
      for (let pat = 0; pat < 8; pat++) {
        const loop = store.patternLoops[ch][pat];
        const offset = (ch * 8 + pat) * 8;
        view.setInt32(ptr + offset, loop.start, true);
        view.setInt32(ptr + offset + 4, loop.length, true);
      }
    }
  }

  syncMuteSolo(store: SequencerState): void {
    const mod = this.module!;
    const mutedPtr = this._getMutedBuffer();
    const soloedPtr = this._getSoloedBuffer();
    for (let ch = 0; ch < 8; ch++) {
      mod.HEAPU8[mutedPtr + ch] = store.mutedChannels[ch] ? 1 : 0;
      mod.HEAPU8[soloedPtr + ch] = store.soloedChannels[ch] ? 1 : 0;
    }
  }

  syncScale(store: SequencerState): void {
    const mod = this.module!;
    const pattern = SCALES[store.scaleId]?.pattern ?? SCALES.major.pattern;
    const mapping = buildScaleMapping(store.scaleRoot, pattern);
    const ptr = this._getScaleBuffer();
    for (let i = 0; i < mapping.notes.length; i++) {
      mod.HEAPU8[ptr + i] = mapping.notes[i];
    }
    this._setScaleInfo(mapping.notes.length, mapping.zeroIndex);
  }

  syncCurrentPatterns(store: SequencerState): void {
    const mod = this.module!;
    const ptr = this._getCurrentPatternsBuffer();
    for (let ch = 0; ch < 8; ch++) {
      mod.HEAPU8[ptr + ch] = store.currentPatterns[ch];
    }
  }

  syncQueuedPatterns(store: SequencerState): void {
    const mod = this.module!;
    const ptr = this._getQueuedPatternsBuffer();
    for (let ch = 0; ch < 8; ch++) {
      // int8_t: -1 = no queue
      mod.HEAPU8[ptr + ch] = store.queuedPatterns[ch] ?? 0xFF; // 0xFF = -1 as uint8
    }
    // Actually need to write as signed int8
    const view = new DataView(mod.HEAPU8.buffer);
    for (let ch = 0; ch < 8; ch++) {
      view.setInt8(ptr + ch, store.queuedPatterns[ch] ?? -1);
    }
  }

  syncChannelTypes(store: SequencerState): void {
    const mod = this.module!;
    const ptr = this._getChannelTypesBuffer();
    for (let ch = 0; ch < 8; ch++) {
      mod.HEAPU8[ptr + ch] = store.channelTypes[ch] === 'drum' ? 1 : 0;
    }
  }

  // ============ Event Index Lookup ============

  getEventIndex(ch: number, pat: number, eventId: string): number {
    return this.eventIndexMaps[ch]?.[pat]?.get(eventId) ?? -1;
  }

  getEventId(ch: number, pat: number, eventIndex: number): string | undefined {
    return this.eventIndexToId[ch]?.[pat]?.get(String(eventIndex));
  }

  /**
   * Get the current continue counter for a sub-mode/channel/event from the C engine.
   */
  getContinueCounter(subModeName: string, channel: number, eventId: string): number {
    const store = getSequencerStore();
    const patIdx = store.currentPatterns[channel];
    const eventIndex = this.getEventIndex(channel, patIdx, eventId);
    if (eventIndex < 0) return 0;
    const smId = SUB_MODE_NAME_TO_ID[subModeName];
    if (smId === undefined) return 0;
    return this._getContinueCounter(smId, channel, eventIndex);
  }

  // ============ Grid Rendering ============

  computeGrid(): void {
    this._computeGrid();
  }

  /** Read which patterns have notes (8×8 boolean grid). */
  readPatternsHaveNotes(): boolean[][] {
    const mod = this.module!;
    const ptr = this._getPatternsHaveNotesBuffer();
    const result: boolean[][] = [];
    for (let ch = 0; ch < 8; ch++) {
      const row: boolean[] = [];
      for (let pat = 0; pat < 8; pat++) {
        row.push(mod.HEAPU8[ptr + ch * 8 + pat] !== 0);
      }
      result.push(row);
    }
    return result;
  }

  /** Read which channels are currently playing. */
  readChannelsPlayingNow(): boolean[] {
    const mod = this.module!;
    const ptr = this._getChannelsPlayingNowBuffer();
    const result: boolean[] = [];
    for (let ch = 0; ch < 8; ch++) {
      result.push(mod.HEAPU8[ptr + ch] !== 0);
    }
    return result;
  }

  /**
   * Read the grid output buffers from WASM memory.
   * Returns button_values[8][16] as uint16 and color_overrides[8][16] as uint32.
   */
  readGridBuffers(): { buttonValues: number[][]; colorOverrides: number[][] } {
    const mod = this.module!;
    const bvPtr = this._getButtonValuesBuffer();
    const coPtr = this._getColorOverridesBuffer();
    const bvView = new Uint16Array(mod.HEAPU8.buffer, bvPtr, 8 * 16);
    const coView = new Uint32Array(mod.HEAPU8.buffer, coPtr, 8 * 16);

    const buttonValues: number[][] = [];
    const colorOverrides: number[][] = [];
    for (let r = 0; r < 8; r++) {
      const bvRow: number[] = [];
      const coRow: number[] = [];
      for (let c = 0; c < 16; c++) {
        bvRow.push(bvView[r * 16 + c]);
        coRow.push(coView[r * 16 + c]);
      }
      buttonValues.push(bvRow);
      colorOverrides.push(coRow);
    }
    return { buttonValues, colorOverrides };
  }

  // ============ UI State ============

  setUiMode(mode: number): void { this._setUiMode(mode); }
  setModifySubMode(sm: number): void { this._setModifySubMode(sm); }
  setCurrentChannel(ch: number): void { this._setCurrentChannel(ch); }
  setZoom(ticksPerCol: number): void { this._setZoom(ticksPerCol); }
  setSelectedEvent(idx: number): void { this._setSelectedEvent(idx); }
  setRowOffset(ch: number, offset: number): void { this._setRowOffset(ch, offset); }
  setColOffset(offset: number): void { this._setColOffset(offset); }
  setBpm(bpm: number): void { this._setBpm(bpm); }
  setIsPlaying(playing: boolean): void { this._setIsPlaying(playing ? 1 : 0); }
  setCtrlHeld(held: boolean): void { this._setCtrlHeld(held ? 1 : 0); }
  setChannelColor(ch: number, rgb: number): void { this._setChannelColor(ch, rgb); }
  setScaleRoot(root: number): void { this._setScaleRoot(root); }
  setScaleIdIdx(idx: number): void { this._setScaleIdIdx(idx); }

  getUiMode(): number { return this._getUiMode(); }
  getModifySubMode(): number { return this._getModifySubMode(); }
  getCurrentChannel(): number { return this._getCurrentChannel(); }
  getZoom(): number { return this._getZoom(); }
  getSelectedEvent(): number { return this._getSelectedEvent(); }
  getBpm(): number { return this._getBpm(); }
  getIsPlaying(): boolean { return this._getIsPlaying() !== 0; }

  // ============ Input Handling ============

  /** Press a grid button. row/col: 0-indexed visible coords. */
  buttonPress(row: number, col: number, modifiers: number): void {
    this._buttonPress(row, col, modifiers);
  }

  /** Press an arrow key. direction: 0=up, 1=down, 2=left, 3=right. */
  arrowPress(direction: number, modifiers: number): void {
    this._arrowPress(direction, modifiers);
  }

  /** Execute a key action (spacebar, backspace, zoom, etc.). */
  keyAction(actionId: number): void {
    this._keyAction(actionId);
  }

  // ============ Edit Operations (direct access) ============

  toggleEvent(row: number, tick: number, lengthTicks: number): number {
    return this._toggleEvent(row, tick, lengthTicks);
  }

  removeEvent(eventIdx: number): void { this._removeEvent(eventIdx); }
  moveEvent(eventIdx: number, newRow: number, newPos: number): void { this._moveEvent(eventIdx, newRow, newPos); }
  setEventLength(eventIdx: number, length: number): void { this._setEventLength(eventIdx, length); }
  placeEvent(eventIdx: number): void { this._placeEvent(eventIdx); }
  setEventRepeatAmount(eventIdx: number, amount: number): void { this._setEventRepeatAmount(eventIdx, amount); }
  setEventRepeatSpace(eventIdx: number, space: number): void { this._setEventRepeatSpace(eventIdx, space); }
  setSubModeValue(eventIdx: number, sm: number, repeatIdx: number, value: number): void { this._setSubModeValue(eventIdx, sm, repeatIdx, value); }
  setSubModeLength(eventIdx: number, sm: number, length: number): void { this._setSubModeLength(eventIdx, sm, length); }
  toggleSubModeLoopMode(eventIdx: number, sm: number): void { this._toggleSubModeLoopMode(eventIdx, sm); }
  adjustChordStack(eventIdx: number, direction: number): void { this._adjustChordStack(eventIdx, direction); }
  cycleChordShape(eventIdx: number, direction: number): void { this._cycleChordShape(eventIdx, direction); }
  cycleChordInversion(eventIdx: number, direction: number): void { this._cycleChordInversion(eventIdx, direction); }
  copyPatternTo(targetPattern: number): void { this._copyPattern(targetPattern); }
  clearPattern(): void { this._clearPattern(); }
  allocEventId(): number { return this._allocEventId(); }
}
