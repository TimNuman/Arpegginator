import type { NoteEvent, PatternData, VelocityLoopMode } from '../types/event';
import type { StepTriggerExtras } from '../actions/playbackActions';
import { registerWasmActiveNote } from '../actions/playbackActions';
import { buildScaleMapping, SCALES } from '../types/scales';
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

  // Event index mapping: [ch][pat] → Map<UUID, index>
  private eventIndexMaps: Map<string, number>[][] = [];

  // Callbacks
  onStepTrigger: ((channel: number, midiNote: number, tick: number, noteLengthTicks: number, velocity: number, extras?: StepTriggerExtras) => void) | null = null;
  onNoteOff: ((channel: number, midiNote: number) => void) | null = null;
  onPreviewValue: ((subMode: string, channel: number, eventIndex: number, tick: number, value: number) => void) | null = null;
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
    };
  }

  isReady(): boolean {
    return this.module !== null;
  }

  getVersion(): number {
    return this._getVersion();
  }

  // ============ Core Operations ============

  init(): void {
    this._engineInit();
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
    this.syncLoops(store);
    this.syncMuteSolo(store);
    this.syncScale(store);
    this.syncCurrentPatterns(store);
    this.syncQueuedPatterns(store);
    this.syncChannelTypes(store);
    this._setRngSeed(Math.floor(Math.random() * 0xFFFFFFFF) + 1);
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
}
