import type { NoteEvent, PatternData, VelocityLoopMode } from '../types/event';
import type { StepTriggerExtras } from '../actions/playbackActions';
import { markDirty } from '../store/renderStore';

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

// C enum SubModeId: SM_VELOCITY=0, SM_HIT=1, SM_TIMING=2, SM_FLAM=3, SM_MODULATE=4
const SUB_MODE_NAME_TO_ID: Record<string, number> = {
  velocity: 0, hit: 1, timing: 2, flam: 3, modulate: 4,
};

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
  private _enginePlayInitFromTick!: (tick: number) => void;
  private _engineTick!: () => void;
  private _engineScrubToTick!: (tick: number) => void;
  private _engineScrubEnd!: () => void;
  private _engineStop!: () => void;
  private _getVersion!: () => number;

  // Buffer accessors
  private _getEventBuffer!: (ch: number, pat: number) => number;
  private _setEventCount!: (ch: number, pat: number, count: number) => void;
  private _setPatternLength!: (ch: number, pat: number, len: number) => void;
  private _getLoopsBuffer!: () => number;
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
  private _getRowOffset!: (ch: number) => number;
  private _setColOffset!: (offset: number) => void;
  private _getColOffset!: () => number;
  private _setBpm!: (bpm: number) => void;
  private _setIsPlaying!: (playing: number) => void;
  private _setCtrlHeld!: (held: number) => void;
  private _setChannelColor!: (ch: number, rgb: number) => void;

  // UI state getters
  private _getUiMode!: () => number;
  private _getModifySubMode!: () => number;
  private _getCurrentChannel!: () => number;
  private _getZoom!: () => number;
  private _getSelectedEvent!: () => number;
  private _getBpm!: () => number;
  private _getIsPlaying!: () => number;

  // Selected event getters (OLED)
  private _getSelRow!: () => number;
  private _getSelLength!: () => number;
  private _getSelRepeatAmount!: () => number;
  private _getSelRepeatSpace!: () => number;
  private _getSelChordAmount!: () => number;
  private _getSelChordSpace!: () => number;
  private _getSelChordInversion!: () => number;
  private _getSelArpStyle!: () => number;
  private _getSelArpOffset!: () => number;
  private _getSelSubModeLoopMode!: (sm: number) => number;
  private _getSelSubModeArrayLength!: (sm: number) => number;

  // Current pattern/loop getters
  private _getCurrentLoopStart!: () => number;
  private _getCurrentLoopLength!: () => number;
  private _getCurrentPatternLengthTicks!: () => number;
  private _getCurrentTick!: () => number;
  private _getCurrentPattern!: (ch: number) => number;
  private _getChannelType!: (ch: number) => number;
  private _getScaleRoot!: () => number;
  private _getScaleIdIdx!: () => number;
  private _noteToMidi!: (row: number) => number;
  private _getScaleName!: () => number;  // returns pointer
  private _getScaleCount!: () => number;
  private _getScaleZeroIndex!: () => number;

  // Grid output
  private _getButtonValuesBuffer!: () => number;
  private _getColorOverridesBuffer!: () => number;
  private _getPatternsHaveNotesBuffer!: () => number;
  private _getChannelsPlayingNowBuffer!: () => number;
  private _computeGrid!: () => void;
  private _isAnimating!: () => number;

  // Input handling
  private _buttonPress!: (row: number, col: number, modifiers: number) => void;
  private _arrowPress!: (direction: number, modifiers: number) => void;
  private _keyAction!: (actionId: number) => void;

  // Grid dimensions and constants (read from WASM — single source of truth)
  private _getVisibleRows!: () => number;
  private _getVisibleCols!: () => number;
  private _getNumChannels!: () => number;

  // Edit operations
  private _clearPattern!: () => void;

  // Event index mapping: [ch][pat] → Map<UUID, index>
  private eventIndexMaps: Map<string, number>[][] = [];

  // Callbacks
  onStepTrigger: ((channel: number, midiNote: number, tick: number, noteLengthTicks: number, velocity: number, extras?: StepTriggerExtras) => void) | null = null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null = null;
  onPlayPreviewNote: ((channel: number, row: number, lengthTicks: number) => void) | null = null;
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
    this._enginePlayInitFromTick = cw('engine_play_init_from_tick', null, ['number']) as unknown as (tick: number) => void;
    this._engineTick = cw('engine_tick', null, []) as unknown as () => void;
    this._engineScrubToTick = cw('engine_scrub_to_tick', null, ['number']) as unknown as (tick: number) => void;
    this._engineScrubEnd = cw('engine_scrub_end', null, []) as unknown as () => void;
    this._engineStop = cw('engine_stop', null, []) as unknown as () => void;
    this._getVersion = cw('engine_get_version', 'number', []);
    this._getEventBuffer = cw('engine_get_event_buffer', 'number', ['number', 'number']);
    this._setEventCount = cw('engine_set_event_count', null, ['number', 'number', 'number']) as unknown as (ch: number, pat: number, count: number) => void;
    this._setPatternLength = cw('engine_set_pattern_length', null, ['number', 'number', 'number']) as unknown as (ch: number, pat: number, len: number) => void;
    this._getLoopsBuffer = cw('engine_get_loops_buffer', 'number', []);
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
    this._getRowOffset = cw('engine_get_row_offset', 'number', ['number']);
    this._setColOffset = cw('engine_set_col_offset', null, ['number']) as unknown as (o: number) => void;
    this._getColOffset = cw('engine_get_col_offset', 'number', []);
    this._setBpm = cw('engine_set_bpm', null, ['number']) as unknown as (b: number) => void;
    this._setIsPlaying = cw('engine_set_is_playing', null, ['number']) as unknown as (p: number) => void;
    this._setCtrlHeld = cw('engine_set_ctrl_held', null, ['number']) as unknown as (h: number) => void;
    this._setChannelColor = cw('engine_set_channel_color', null, ['number', 'number']) as unknown as (ch: number, rgb: number) => void;

    // UI state getters
    this._getUiMode = cw('engine_get_ui_mode', 'number', []);
    this._getModifySubMode = cw('engine_get_modify_sub_mode', 'number', []);
    this._getCurrentChannel = cw('engine_get_current_channel', 'number', []);
    this._getZoom = cw('engine_get_zoom', 'number', []);
    this._getSelectedEvent = cw('engine_get_selected_event', 'number', []);
    this._getBpm = cw('engine_get_bpm', 'number', []);
    this._getIsPlaying = cw('engine_get_is_playing', 'number', []);

    // Selected event getters (OLED)
    this._getSelRow = cw('engine_get_sel_row', 'number', []);
    this._getSelLength = cw('engine_get_sel_length', 'number', []);
    this._getSelRepeatAmount = cw('engine_get_sel_repeat_amount', 'number', []);
    this._getSelRepeatSpace = cw('engine_get_sel_repeat_space', 'number', []);
    this._getSelChordAmount = cw('engine_get_sel_chord_amount', 'number', []);
    this._getSelChordSpace = cw('engine_get_sel_chord_space', 'number', []);
    this._getSelChordInversion = cw('engine_get_sel_chord_inversion', 'number', []);
    this._getSelArpStyle = cw('engine_get_sel_arp_style', 'number', []);
    this._getSelArpOffset = cw('engine_get_sel_arp_offset', 'number', []);
    this._getSelSubModeLoopMode = cw('engine_get_sel_sub_mode_loop_mode', 'number', ['number']);
    this._getSelSubModeArrayLength = cw('engine_get_sel_sub_mode_array_length', 'number', ['number']);

    // Current pattern/loop getters
    this._getCurrentLoopStart = cw('engine_get_current_loop_start', 'number', []);
    this._getCurrentLoopLength = cw('engine_get_current_loop_length', 'number', []);
    this._getCurrentPatternLengthTicks = cw('engine_get_current_pattern_length_ticks', 'number', []);
    this._getCurrentTick = cw('engine_get_current_tick', 'number', []);
    this._getCurrentPattern = cw('engine_get_current_pattern', 'number', ['number']);
    this._getChannelType = cw('engine_get_channel_type', 'number', ['number']);
    this._getScaleRoot = cw('engine_get_scale_root', 'number', []);
    this._getScaleIdIdx = cw('engine_get_scale_id_idx', 'number', []);
    this._noteToMidi = cw('engine_note_to_midi_export', 'number', ['number']);
    this._getScaleName = cw('engine_get_scale_name', 'number', []);
    this._getScaleCount = cw('engine_get_scale_count', 'number', []);
    this._getScaleZeroIndex = cw('engine_get_scale_zero_index', 'number', []);

    // Grid output
    this._getButtonValuesBuffer = cw('engine_get_button_values_buffer', 'number', []);
    this._getColorOverridesBuffer = cw('engine_get_color_overrides_buffer', 'number', []);
    this._getPatternsHaveNotesBuffer = cw('engine_get_patterns_have_notes_buffer', 'number', []);
    this._getChannelsPlayingNowBuffer = cw('engine_get_channels_playing_now_buffer', 'number', []);
    this._computeGrid = cw('engine_compute_grid_export', null, []) as unknown as () => void;
    this._isAnimating = cw('engine_is_animating_export', 'number', []);

    // Input handling
    this._buttonPress = cw('engine_button_press_export', null, ['number', 'number', 'number']) as unknown as (r: number, c: number, m: number) => void;
    this._arrowPress = cw('engine_arrow_press_export', null, ['number', 'number']) as unknown as (d: number, m: number) => void;
    this._keyAction = cw('engine_key_action_export', null, ['number']) as unknown as (a: number) => void;

    // Grid dimensions and constants
    this._getVisibleRows = cw('engine_get_visible_rows', 'number', []);
    this._getVisibleCols = cw('engine_get_visible_cols', 'number', []);
    this._getNumChannels = cw('engine_get_num_channels', 'number', []);

    // Edit operations
    this._clearPattern = cw('engine_clear_pattern_export', null, []) as unknown as () => void;

    // Query struct layout from C
    this.noteEventSize = this._getNoteEventSize();
    this.subModeArraySize = this._getSubModeArraySize();
    for (let i = 0; i <= 12; i++) {
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
      stepTrigger: (ch: number, note: number, tick: number, len: number, vel: number, timing: number, flam: number, _evIdx: number) => {
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
      setCurrentTick: (_tick: number) => {
        // WASM updates tick internally; just trigger re-render
        markDirty();
      },
      setCurrentPatterns: (_patterns: number[]) => {
        // WASM updates current_patterns internally; just trigger re-render
        markDirty();
      },
      clearQueuedPattern: (_ch: number) => {
        // WASM updates queued_patterns internally; just trigger re-render
        markDirty();
      },
      playPreviewNote: (ch: number, row: number, lengthTicks: number) => {
        this.onPlayPreviewNote?.(ch, row, lengthTicks);
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

  /** Playback init from a specific tick (resume after scrub). */
  initFromTick(tick: number): void {
    this._enginePlayInitFromTick(tick);
  }

  tick(): void {
    this._engineTick();
  }

  scrubToTick(tick: number): void {
    this._engineScrubToTick(tick);
  }

  scrubEnd(): void {
    this._engineScrubEnd();
  }

  stop(): void {
    this._engineStop();
  }

  // ============ Sync Operations ============

  /**
   * Seed the RNG for playback. Call before starting playback.
   */
  seedRng(): void {
    this._setRngSeed(Math.floor(Math.random() * 0xFFFFFFFF) + 1);
  }

  /**
   * Read a specific pattern from WASM memory and return it.
   */
  readPatternData(ch: number, pat: number): PatternData {
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
        const lenOffset = this.subModeArraySize - 2;  // length field: after all int16 values
        const len = mod.HEAPU8[arrBase + lenOffset];
        const values: number[] = [];
        for (let j = 0; j < len; j++) {
          values.push(view.getInt16(arrBase + j * 2, true));
        }
        const loopModeVal = mod.HEAPU8[arrBase + lenOffset + 1];
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
        chordAmount: mod.HEAPU8[ptr + this.fieldOffsets[7]],
        chordSpace: mod.HEAPU8[ptr + this.fieldOffsets[8]],
        chordInversion: view.getInt8(ptr + this.fieldOffsets[9]),
        arpStyle: mod.HEAPU8[ptr + this.fieldOffsets[11]],
        arpOffset: view.getInt8(ptr + this.fieldOffsets[12]),
      };

      events.push(event);

      // Update index maps for new events
      if (!eventId) {
        const newId = `wasm-${eventIndex}`;
        this.eventIndexMaps[ch][pat].set(newId, i);
        this.eventIndexToId[ch][pat].set(String(eventIndex), newId);
      }
    }

    return { events, lengthTicks };
  }


  // Loops live in WASM — use readLoop/writeLoop for individual access

  syncMuteSolo(muted: boolean[], soloed: boolean[]): void {
    const mod = this.module!;
    const mutedPtr = this._getMutedBuffer();
    const soloedPtr = this._getSoloedBuffer();
    for (let ch = 0; ch < 8; ch++) {
      mod.HEAPU8[mutedPtr + ch] = muted[ch] ? 1 : 0;
      mod.HEAPU8[soloedPtr + ch] = soloed[ch] ? 1 : 0;
    }
  }

  /** Read mute/solo state from WASM memory. */
  readMuteSolo(): { muted: boolean[]; soloed: boolean[] } {
    const mod = this.module!;
    const mutedPtr = this._getMutedBuffer();
    const soloedPtr = this._getSoloedBuffer();
    const muted: boolean[] = [];
    const soloed: boolean[] = [];
    for (let ch = 0; ch < 8; ch++) {
      muted.push(mod.HEAPU8[mutedPtr + ch] !== 0);
      soloed.push(mod.HEAPU8[soloedPtr + ch] !== 0);
    }
    return { muted, soloed };
  }

  /** Write mute/solo state to WASM memory. */
  writeMuteSolo(muted: boolean[], soloed: boolean[]): void {
    this.syncMuteSolo(muted, soloed);
  }

  /** Read a single loop (start, length) from WASM memory. */
  readLoop(ch: number, pat: number): { start: number; length: number } {
    const mod = this.module!;
    const ptr = this._getLoopsBuffer();
    const view = new DataView(mod.HEAPU8.buffer);
    const offset = (ch * 8 + pat) * 8;
    return {
      start: view.getInt32(ptr + offset, true),
      length: view.getInt32(ptr + offset + 4, true),
    };
  }

  /** Write a single loop to WASM memory. */
  writeLoop(ch: number, pat: number, start: number, length: number): void {
    const mod = this.module!;
    const ptr = this._getLoopsBuffer();
    const view = new DataView(mod.HEAPU8.buffer);
    const offset = (ch * 8 + pat) * 8;
    view.setInt32(ptr + offset, start, true);
    view.setInt32(ptr + offset + 4, length, true);
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
    const patIdx = this._getCurrentPattern(channel);
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

  isAnimating(): boolean {
    return this._isAnimating() !== 0;
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
   * Dimensions come from WASM (single source of truth).
   */
  readGridBuffers(): { buttonValues: number[][]; colorOverrides: number[][] } {
    const mod = this.module!;
    const rows = this._getVisibleRows();
    const cols = this._getVisibleCols();
    const bvPtr = this._getButtonValuesBuffer();
    const coPtr = this._getColorOverridesBuffer();
    const bvView = new Uint16Array(mod.HEAPU8.buffer, bvPtr, rows * cols);
    const coView = new Uint32Array(mod.HEAPU8.buffer, coPtr, rows * cols);

    const buttonValues: number[][] = [];
    const colorOverrides: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const bvRow: number[] = [];
      const coRow: number[] = [];
      for (let c = 0; c < cols; c++) {
        bvRow.push(bvView[r * cols + c]);
        coRow.push(coView[r * cols + c]);
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
  getRowOffset(ch: number): number { return this._getRowOffset(ch); }
  setColOffset(offset: number): void { this._setColOffset(offset); }
  getColOffset(): number { return this._getColOffset(); }
  setBpm(bpm: number): void { this._setBpm(bpm); }
  setIsPlaying(playing: boolean): void { this._setIsPlaying(playing ? 1 : 0); }
  setCtrlHeld(held: boolean): void { this._setCtrlHeld(held ? 1 : 0); }
  setChannelColor(ch: number, rgb: number): void { this._setChannelColor(ch, rgb); }

  getUiMode(): number { return this._getUiMode(); }
  getModifySubMode(): number { return this._getModifySubMode(); }
  getCurrentChannel(): number { return this._getCurrentChannel(); }
  getZoom(): number { return this._getZoom(); }
  getSelectedEvent(): number { return this._getSelectedEvent(); }
  getBpm(): number { return this._getBpm(); }
  getIsPlaying(): boolean { return this._getIsPlaying() !== 0; }

  // Selected event getters (OLED display)
  getSelRow(): number { return this._getSelRow(); }
  getSelLength(): number { return this._getSelLength(); }
  getSelRepeatAmount(): number { return this._getSelRepeatAmount(); }
  getSelRepeatSpace(): number { return this._getSelRepeatSpace(); }
  getSelChordAmount(): number { return this._getSelChordAmount(); }
  getSelChordSpace(): number { return this._getSelChordSpace(); }
  getSelChordInversion(): number { return this._getSelChordInversion(); }
  getSelArpStyle(): number { return this._getSelArpStyle(); }
  getSelArpOffset(): number { return this._getSelArpOffset(); }
  getSelSubModeLoopMode(sm: number): number { return this._getSelSubModeLoopMode(sm); }
  getSelSubModeArrayLength(sm: number): number { return this._getSelSubModeArrayLength(sm); }

  // Current pattern/loop getters
  getCurrentLoopStart(): number { return this._getCurrentLoopStart(); }
  getCurrentLoopLength(): number { return this._getCurrentLoopLength(); }
  getCurrentPatternLengthTicks(): number { return this._getCurrentPatternLengthTicks(); }
  getCurrentTick(): number { return this._getCurrentTick(); }
  getCurrentPattern(ch: number): number { return this._getCurrentPattern(ch); }
  getChannelType(ch: number): number { return this._getChannelType(ch); }
  getScaleRoot(): number { return this._getScaleRoot(); }
  getScaleIdIdx(): number { return this._getScaleIdIdx(); }
  noteToMidi(row: number): number { return this._noteToMidi(row); }
  getScaleName(): string {
    const ptr = this._getScaleName();
    return (this.module as unknown as { UTF8ToString: (ptr: number) => string }).UTF8ToString(ptr);
  }
  getScaleCount(): number { return this._getScaleCount(); }
  getScaleZeroIndex(): number { return this._getScaleZeroIndex(); }

  // Constants from WASM (single source of truth)
  getVisibleRows(): number { return this._getVisibleRows(); }
  getVisibleCols(): number { return this._getVisibleCols(); }
  getNumChannels(): number { return this._getNumChannels(); }

  /** Write channel types to WASM memory. 0 = melodic, 1 = drum. */
  writeChannelTypes(types: number[]): void {
    const mod = this.module!;
    const ptr = this._getChannelTypesBuffer();
    for (let ch = 0; ch < 8; ch++) {
      mod.HEAPU8[ptr + ch] = types[ch] ?? 0;
    }
  }

  /** Read current patterns from WASM memory. */
  readCurrentPatterns(): number[] {
    const mod = this.module!;
    const ptr = this._getCurrentPatternsBuffer();
    const patterns: number[] = [];
    for (let ch = 0; ch < 8; ch++) {
      patterns.push(mod.HEAPU8[ptr + ch]);
    }
    return patterns;
  }

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

  // ============ Edit Operations ============

  clearPattern(): void { this._clearPattern(); }
}
