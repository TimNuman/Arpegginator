// engine_core.rs — Core types, constants, state, scales, arpeggios, voicings, playback

extern crate alloc;

// ============ Constants ============

pub const NUM_CHANNELS: usize = 8;
pub const NUM_PATTERNS: usize = 8;
pub const MAX_EVENTS: usize = 128;
pub const MAX_SUB_MODE_LEN: usize = 32;
pub const NUM_SUB_MODES: usize = 6;
pub const MAX_CHORD_SIZE: usize = 8;
pub const MAX_SCALE_NOTES: usize = 128;
pub const NUM_SCALES: usize = 32;
pub const MAX_ACTIVE_NOTES: usize = 256;
pub const DIATONIC_OCTAVE: u8 = 7;
pub const VISIBLE_ROWS: usize = 8;
pub const VISIBLE_COLS: usize = 16;
pub const TICKS_PER_QUARTER: i32 = 480;
pub const MAX_RENDERED_NOTES: usize = 1024;

pub const POOL_CAPACITY: usize = 512;
pub const EVENT_POOL_CAPACITY: usize = 512;
pub const POOL_HANDLE_NONE: u16 = 0xFFFF;

pub const DEFAULT_PATTERN_TICKS: i32 = TICKS_PER_QUARTER * 4 * 4; // 4 bars of 4/4 = 7680
pub const DEFAULT_LOOP_TICKS: i32 = TICKS_PER_QUARTER * 4;        // 1 bar = 1920

// ============ Button Value Constants ============

pub const BTN_OFF: u16 = 0;
pub const BTN_COLOR_25: u16 = 1;
pub const BTN_COLOR_50: u16 = 2;
pub const BTN_COLOR_75: u16 = 3;
pub const BTN_COLOR_100: u16 = 4;
pub const BTN_WHITE_25: u16 = 5;
pub const BTN_WHITE_50: u16 = 6;
pub const BTN_WHITE_75: u16 = 7;
pub const BTN_WHITE_100: u16 = 8;

pub const FLAG_PLAYHEAD: u16 = 16;
pub const FLAG_C_NOTE: u16 = 32;
pub const FLAG_LOOP_BOUNDARY: u16 = 64;
pub const FLAG_BEAT_MARKER: u16 = 128;
pub const FLAG_SELECTED: u16 = 256;
pub const FLAG_CONTINUATION: u16 = 512;
pub const FLAG_PLAYING: u16 = 1024;
pub const FLAG_LOOP_BOUNDARY_PULSING: u16 = 2048;
pub const FLAG_DIMMED: u16 = 4096;
pub const FLAG_IN_SCALE: u16 = 8192;

// ============ Enums ============

#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum LoopMode {
    #[default]
    Reset = 0,
    Continue = 1,
    Fill = 2,
}

impl LoopMode {
    pub fn cycle(self) -> Self {
        match self {
            Self::Reset => Self::Continue,
            Self::Continue => Self::Fill,
            Self::Fill => Self::Reset,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ChannelType {
    #[default]
    Melodic = 0,
    Drum = 1,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum SubModeId {
    #[default]
    Velocity = 0,
    Hit = 1,
    Timing = 2,
    Flam = 3,
    Modulate = 4,
    Inversion = 5,
}

impl SubModeId {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Velocity,
            1 => Self::Hit,
            2 => Self::Timing,
            3 => Self::Flam,
            4 => Self::Modulate,
            5 => Self::Inversion,
            _ => Self::Velocity,
        }
    }
}

pub const ARP_CHORD: u8 = 0;
pub const ARP_UP: u8 = 1;
pub const ARP_DOWN: u8 = 2;
pub const ARP_UP_DOWN: u8 = 3;
pub const ARP_DOWN_UP: u8 = 4;
pub const ARP_CHORD_UP: u8 = 5;
pub const ARP_CHORD_DOWN: u8 = 6;
pub const ARP_CHORD_UP_DOWN: u8 = 7;
pub const ARP_CHORD_DOWN_UP: u8 = 8;
pub const ARP_STYLE_COUNT: u8 = 9;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum UiMode {
    #[default]
    Pattern = 0,
    Channel = 1,
    Loop = 2,
    Modify = 3,
}

impl UiMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Pattern,
            1 => Self::Channel,
            2 => Self::Loop,
            3 => Self::Modify,
            _ => Self::Pattern,
        }
    }
}

// ============ Data Structures ============

#[derive(Clone, Copy)]
#[repr(C)]
pub struct SubModeArray {
    pub values: [i16; MAX_SUB_MODE_LEN],
    pub length: u8,
    pub loop_mode: u8, // LoopMode as u8
}

impl Default for SubModeArray {
    fn default() -> Self {
        Self {
            values: [0; MAX_SUB_MODE_LEN],
            length: 1,
            loop_mode: LoopMode::Reset as u8,
        }
    }
}

impl SubModeArray {
    pub fn mode(&self) -> LoopMode {
        match self.loop_mode {
            0 => LoopMode::Reset,
            1 => LoopMode::Continue,
            2 => LoopMode::Fill,
            _ => LoopMode::Reset,
        }
    }
}

// ============ Sub-Mode Pool ============

pub struct SubModePool {
    pub slots: [SubModeArray; POOL_CAPACITY],
    pub free_list: [u16; POOL_CAPACITY],
    pub free_count: u16,
}

impl Default for SubModePool {
    fn default() -> Self {
        let mut free_list = [0u16; POOL_CAPACITY];
        (0..POOL_CAPACITY).for_each(|i| { free_list[i] = i as u16; });
        Self {
            slots: [SubModeArray::default(); POOL_CAPACITY],
            free_list,
            free_count: POOL_CAPACITY as u16,
        }
    }
}

pub fn pool_alloc(pool: &mut SubModePool) -> u16 {
    assert!(pool.free_count > 0, "sub-mode pool exhausted");
    pool.free_count -= 1;
    pool.free_list[pool.free_count as usize]
}

pub fn pool_free(pool: &mut SubModePool, handle: u16) {
    if handle == POOL_HANDLE_NONE { return; }
    pool.free_list[pool.free_count as usize] = handle;
    pool.free_count += 1;
}

pub fn pool_free_event_handles(pool: &mut SubModePool, handles: &mut [u16; NUM_SUB_MODES]) {
    handles.iter_mut().for_each(|h| {
        pool_free(pool, *h);
        *h = POOL_HANDLE_NONE;
    });
}

const fn make_sm_default(val: i16) -> SubModeArray {
    let mut a = SubModeArray { values: [0i16; MAX_SUB_MODE_LEN], length: 1, loop_mode: 0 };
    a.values[0] = val;
    a
}

pub static SM_DEFAULTS: [SubModeArray; NUM_SUB_MODES] = [
    make_sm_default(100), // Velocity
    make_sm_default(100), // Hit
    make_sm_default(0),   // Timing
    make_sm_default(0),   // Flam
    make_sm_default(0),   // Modulate
    make_sm_default(0),   // Inversion
];

pub fn get_sub_mode<'a>(pool: &'a SubModePool, handles: &[u16; NUM_SUB_MODES], sm: usize) -> &'a SubModeArray {
    let h = handles[sm];
    if h == POOL_HANDLE_NONE { &SM_DEFAULTS[sm] } else { &pool.slots[h as usize] }
}

pub fn get_sub_mode_mut<'a>(pool: &'a mut SubModePool, handles: &mut [u16; NUM_SUB_MODES], sm: usize) -> &'a mut SubModeArray {
    if handles[sm] == POOL_HANDLE_NONE {
        let h = pool_alloc(pool);
        pool.slots[h as usize] = SM_DEFAULTS[sm];
        handles[sm] = h;
    }
    &mut pool.slots[handles[sm] as usize]
}

// ============ Event Pool ============

pub struct NoteEventPool {
    pub slots: [NoteEvent; EVENT_POOL_CAPACITY],
    pub free_list: [u16; EVENT_POOL_CAPACITY],
    pub free_count: u16,
}

pub fn event_alloc(pool: &mut NoteEventPool) -> u16 {
    assert!(pool.free_count > 0, "event pool exhausted");
    pool.free_count -= 1;
    pool.free_list[pool.free_count as usize]
}

pub fn event_free(pool: &mut NoteEventPool, handle: u16) {
    if handle == POOL_HANDLE_NONE { return; }
    pool.free_list[pool.free_count as usize] = handle;
    pool.free_count += 1;
}

pub fn event_free_with_sub_modes(event_pool: &mut NoteEventPool, sm_pool: &mut SubModePool, handle: u16) {
    if handle == POOL_HANDLE_NONE { return; }
    pool_free_event_handles(sm_pool, &mut event_pool.slots[handle as usize].sub_mode_handles);
    event_free(event_pool, handle);
}

#[inline]
pub fn get_event(pool: &NoteEventPool, handle: u16) -> &NoteEvent {
    &pool.slots[handle as usize]
}

#[inline]
pub fn get_event_mut(pool: &mut NoteEventPool, handle: u16) -> &mut NoteEvent {
    &mut pool.slots[handle as usize]
}

#[derive(Clone)]
#[repr(C)]
pub struct NoteEvent {
    pub row: i16,
    pub position: i32,
    pub length: i32,
    pub enabled: u8,
    pub repeat_amount: u16,
    pub repeat_space: i32,
    pub sub_mode_handles: [u16; NUM_SUB_MODES],
    pub chord_amount: u8,
    pub chord_space: u8,
    pub chord_inversion: i8,
    pub chord_voicing: u8,
    pub arp_style: u8,
    pub arp_offset: i8,
    pub arp_voices: u8,
    pub event_index: u16,
}

impl Default for NoteEvent {
    fn default() -> Self {
        Self {
            row: 0,
            position: 0,
            length: 0,
            enabled: 0,
            repeat_amount: 1,
            repeat_space: 0,
            sub_mode_handles: [POOL_HANDLE_NONE; NUM_SUB_MODES],
            chord_amount: 1,
            chord_space: 2,
            chord_inversion: 0,
            chord_voicing: 0,
            arp_style: ARP_CHORD,
            arp_offset: 0,
            arp_voices: 1,
            event_index: 0,
        }
    }
}

#[derive(Clone)]
pub struct PatternData {
    pub event_handles: [u16; MAX_EVENTS],
    pub event_count: u16,
    pub length_ticks: i32,
}

impl Default for PatternData {
    fn default() -> Self {
        Self {
            event_handles: [POOL_HANDLE_NONE; MAX_EVENTS],
            event_count: 0,
            length_ticks: DEFAULT_PATTERN_TICKS,
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct PatternLoop {
    pub start: i32,
    pub length: i32,
}

#[derive(Clone, Copy, Default)]
pub struct ActiveNote {
    pub channel: u8,
    pub event_index: u16,
    pub repeat_index: u8,
    pub chord_index: u8,
    pub start: i32,
    pub end: i32,
    pub midi_note: i8,
    pub active: bool,
}

#[derive(Clone, Copy, Default)]
pub struct RenderedNote {
    pub row: i16,
    pub position: i32,
    pub length: i32,
    pub source_idx: u16,
    pub repeat_index: u16,
    pub chord_index: u8,
    pub chord_offset: i8,
}

// ============ Engine State ============

pub struct EngineState {
    pub patterns: Box<[[PatternData; NUM_PATTERNS]; NUM_CHANNELS]>,
    pub sub_mode_pool: Box<SubModePool>,
    pub event_pool: Box<NoteEventPool>,
    pub loops: [[PatternLoop; NUM_PATTERNS]; NUM_CHANNELS],

    pub current_patterns: [u8; NUM_CHANNELS],
    pub queued_patterns: [i8; NUM_CHANNELS],
    pub muted: [u8; NUM_CHANNELS],
    pub soloed: [u8; NUM_CHANNELS],
    pub channel_types: [u8; NUM_CHANNELS],

    pub scale_notes: [u8; MAX_SCALE_NOTES],
    pub scale_count: u16,
    pub scale_zero_index: u16,
    pub scale_root: u8,
    pub scale_id_idx: u8,
    pub scale_octave_size: u8,

    pub current_tick: i32,
    pub last_scrub_tick: i32,
    pub resume_tick: i32,
    pub is_playing: u8,
    pub is_external_playback: u8,
    pub bpm: f32,
    pub swing: i32,

    pub active_notes: [ActiveNote; MAX_ACTIVE_NOTES],

    pub continue_counters: [[[u16; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES],
    pub counter_snapshots: [[[u16; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES],

    pub rng_state: u32,

    pub ui_mode: u8,
    pub modify_sub_mode: u8,
    pub current_channel: u8,
    pub zoom: i32,
    pub selected_event_idx: i16,
    pub last_deselected_event_idx: i16,
    pub loop_edit_target: u8, // 0 = end, 1 = start
    pub row_offsets: [f32; NUM_CHANNELS],
    pub target_row_offsets: [f32; NUM_CHANNELS],
    pub col_offset: f32,
    pub target_col_offset: f32,

    // Touchstrip state (0=vertical/row, 1=horizontal/col)
    pub strip_dragging: [u8; 2],
    pub strip_shift_dragging: u8,        // horizontal scrub mode
    pub strip_velocity: [f32; 2],
    pub strip_last_pos: [i32; 2],
    pub strip_last_time: [f32; 2],
    pub scrub_accumulator: f32,
    pub manual_scroll_override: u8,

    pub modifiers_held: u8,
    pub channel_colors: [u32; NUM_CHANNELS],

    pub button_values: [[u16; VISIBLE_COLS]; VISIBLE_ROWS],
    pub color_overrides: [[u32; VISIBLE_COLS]; VISIBLE_ROWS],

    pub patterns_have_notes: [[u8; NUM_PATTERNS]; NUM_CHANNELS],
    pub channels_playing_now: [u8; NUM_CHANNELS],

    pub next_event_id: u16,

    pub rendered_notes: [RenderedNote; MAX_RENDERED_NOTES],
    pub rendered_count: u16,
    pub rendered_for_channel: u8,
    pub rendered_dirty: [u8; NUM_CHANNELS],
}

impl Default for EngineState {
    fn default() -> Self {
        // Build patterns on the heap via Vec to avoid ~3MB stack temporary.
        // Each push places one channel's patterns (~368KB) on the stack — well within 1MB.
        let patterns = {
            let mut v: Vec<[PatternData; NUM_PATTERNS]> = Vec::with_capacity(NUM_CHANNELS);
            for _ in 0..NUM_CHANNELS {
                v.push(core::array::from_fn(|_| PatternData::default()));
            }
            v.into_boxed_slice().try_into().ok().unwrap()
        };
        Self {
            patterns,
            sub_mode_pool: {
                // Build pool on the heap to avoid ~68KB stack temporary in WASM.
                let mut pool = unsafe {
                    let layout = alloc::alloc::Layout::new::<SubModePool>();
                    let ptr = alloc::alloc::alloc_zeroed(layout) as *mut SubModePool;
                    Box::from_raw(ptr)
                };
                (0..POOL_CAPACITY).for_each(|i| { pool.free_list[i] = i as u16; });
                pool.free_count = POOL_CAPACITY as u16;
                pool
            },
            event_pool: {
                let mut pool = unsafe {
                    let layout = alloc::alloc::Layout::new::<NoteEventPool>();
                    let ptr = alloc::alloc::alloc_zeroed(layout) as *mut NoteEventPool;
                    Box::from_raw(ptr)
                };
                (0..EVENT_POOL_CAPACITY).for_each(|i| { pool.free_list[i] = i as u16; });
                pool.free_count = EVENT_POOL_CAPACITY as u16;
                pool
            },
            loops: [[PatternLoop::default(); NUM_PATTERNS]; NUM_CHANNELS],
            current_patterns: [0; NUM_CHANNELS],
            queued_patterns: [-1; NUM_CHANNELS],
            muted: [0; NUM_CHANNELS],
            soloed: [0; NUM_CHANNELS],
            channel_types: [0; NUM_CHANNELS],
            scale_notes: [0; MAX_SCALE_NOTES],
            scale_count: 0,
            scale_zero_index: 0,
            scale_root: 0,
            scale_id_idx: 0,
            scale_octave_size: 0,
            current_tick: -1,
            last_scrub_tick: -1,
            resume_tick: -1,
            is_playing: 0,
            is_external_playback: 0,
            bpm: 120.0,
            swing: 50,
            active_notes: [ActiveNote::default(); MAX_ACTIVE_NOTES],
            continue_counters: [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES],
            counter_snapshots: [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES],
            rng_state: 12345,
            ui_mode: UiMode::Pattern as u8,
            modify_sub_mode: SubModeId::Velocity as u8,
            current_channel: 0,
            zoom: 120, // ZOOM_1_16
            selected_event_idx: -1,
            last_deselected_event_idx: -1,
            loop_edit_target: 0,
            row_offsets: [0.0; NUM_CHANNELS],
            target_row_offsets: [0.0; NUM_CHANNELS],
            col_offset: 0.0,
            target_col_offset: 0.0,
            strip_dragging: [0; 2],
            strip_shift_dragging: 0,
            strip_velocity: [0.0; 2],
            strip_last_pos: [0; 2],
            strip_last_time: [0.0; 2],
            scrub_accumulator: 0.0,
            manual_scroll_override: 0,
            modifiers_held: 0,
            channel_colors: [0; NUM_CHANNELS],
            button_values: [[0; VISIBLE_COLS]; VISIBLE_ROWS],
            color_overrides: [[0; VISIBLE_COLS]; VISIBLE_ROWS],
            patterns_have_notes: [[0; NUM_PATTERNS]; NUM_CHANNELS],
            channels_playing_now: [0; NUM_CHANNELS],
            next_event_id: 0,
            rendered_notes: [RenderedNote::default(); MAX_RENDERED_NOTES],
            rendered_count: 0,
            rendered_for_channel: 0xFF,
            rendered_dirty: [1; NUM_CHANNELS],
        }
    }
}

// ============ Helpers ============

pub fn mod_positive(a: i32, b: i32) -> i32 {
    let r = a % b;
    if r < 0 { r + b } else { r }
}

pub fn engine_random(s: &mut EngineState) -> u32 {
    let mut x = s.rng_state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    s.rng_state = x;
    x
}

pub fn note_to_midi(row: i16, s: &EngineState) -> i8 {
    let idx = s.scale_zero_index as i32 + row as i32;
    if idx < 0 || idx >= s.scale_count as i32 {
        -1
    } else {
        s.scale_notes[idx as usize] as i8
    }
}

// ============ Scale Definitions ============

static SCALE_PATTERNS: [[u8; 12]; NUM_SCALES] = [
    [1,0,1,0,1,1,0,1,0,1,0,1], // Major
    [1,0,1,1,0,1,0,1,1,0,1,0], // Minor
    [1,0,1,1,0,1,0,1,1,0,0,1], // Harmonic Minor
    [1,0,1,1,0,1,0,1,0,1,0,1], // Melodic Minor
    [1,0,1,0,1,0,0,1,0,1,0,0], // Major Pentatonic
    [1,0,0,1,0,1,0,1,0,0,1,0], // Minor Pentatonic
    [1,0,0,1,0,1,1,1,0,0,1,0], // Blues
    [1,0,1,1,0,1,0,1,0,1,1,0], // Dorian
    [1,1,0,1,0,1,0,1,1,0,1,0], // Phrygian
    [1,0,1,0,1,0,1,1,0,1,0,1], // Lydian
    [1,0,1,0,1,1,0,1,0,1,1,0], // Mixolydian
    [1,0,1,1,0,1,0,1,1,0,1,0], // Aeolian
    [1,1,0,1,0,1,1,0,1,0,1,0], // Locrian
    [1,0,1,1,0,0,0,1,1,0,0,0], // Hirajoshi
    [1,1,0,0,0,1,0,1,0,0,1,0], // In Sen
    [1,1,0,0,0,1,1,0,0,0,1,0], // Iwato
    [1,0,1,1,0,0,0,1,0,1,0,0], // Kumoi
    [1,1,0,1,0,0,0,1,1,0,0,0], // Pelog
    [1,1,0,0,1,1,0,1,1,0,0,1], // Hijaz
    [1,1,0,0,1,1,0,1,1,0,0,1], // Double Harmonic
    [1,0,1,1,0,0,1,1,1,0,0,1], // Hungarian Minor
    [1,1,0,0,1,0,1,0,1,0,1,1], // Enigmatic
    [1,0,1,0,1,0,1,0,0,1,1,0], // Prometheus
    [1,1,0,0,1,1,1,0,1,0,0,1], // Persian
    [1,0,1,1,0,1,1,1,1,0,0,1], // Algerian
    [1,0,1,1,0,0,1,1,1,0,1,0], // Gypsy
    [1,1,0,1,0,1,0,1,1,0,0,1], // Neapolitan Minor
    [1,1,0,1,0,1,0,1,0,1,0,1], // Neapolitan Major
    [1,0,1,1,0,1,1,0,1,1,0,1], // Diminished
    [1,0,0,1,1,0,0,1,1,0,0,1], // Augmented
    [1,0,1,0,1,0,1,0,1,0,1,0], // Whole Tone
    [1,1,1,1,1,1,1,1,1,1,1,1], // Chromatic
];

pub static SCALE_NAMES: [&str; NUM_SCALES] = [
    "Major", "Minor", "Harmonic Minor", "Melodic Minor",
    "Major Pentatonic", "Minor Pentatonic", "Blues",
    "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian",
    "Hirajoshi", "In Sen", "Iwato", "Kumoi", "Pelog",
    "Hijaz", "Double Harmonic", "Hungarian Minor", "Enigmatic",
    "Prometheus", "Persian", "Algerian", "Gypsy",
    "Neapolitan Minor", "Neapolitan Major",
    "Diminished", "Augmented", "Whole Tone", "Chromatic",
];

pub fn engine_rebuild_scale(s: &mut EngineState) {
    let root = s.scale_root;
    let idx = (s.scale_id_idx as usize).min(NUM_SCALES - 1);
    let pattern = &SCALE_PATTERNS[idx];
    let zero_midi = 60 + root;

    let mut count: u16 = 0;
    let mut zero_index: u16 = 0;

    (0..=127u8).for_each(|midi| {
        let pc = ((midi as i32 - root as i32) % 12 + 12) % 12;
        if pattern[pc as usize] != 0 {
            if midi == zero_midi {
                zero_index = count;
            }
            s.scale_notes[count as usize] = midi;
            count += 1;
        }
    });

    s.scale_count = count;
    s.scale_zero_index = zero_index;
    s.scale_octave_size = pattern.iter().filter(|&&v| v != 0).count() as u8;
}

pub fn engine_cycle_scale(s: &mut EngineState, direction: i8) {
    let idx = (s.scale_id_idx as i32 + direction as i32).rem_euclid(NUM_SCALES as i32);
    s.scale_id_idx = idx as u8;
    engine_rebuild_scale(s);
    s.rendered_dirty.iter_mut().for_each(|d| *d = 1);
}

pub fn engine_cycle_scale_root(s: &mut EngineState, direction: i8) {
    let new_root_midi = ((s.scale_root as i32 + direction as i32 * 7) % 12 + 12) % 12;
    let target_midi = (60 + new_root_midi) as u8;

    let offset = (0..s.scale_count as usize)
        .find(|&i| s.scale_notes[i] == target_midi)
        .map(|i| i as i16 - s.scale_zero_index as i16)
        .unwrap_or(0);

    // Circle of Fifths drift compensation for 7-note scales.
    // 12 fifths = 7 octaves in pitch, but the scale-degree offsets (+4 up, -3 down)
    // don't sum to zero over a full cycle — they drift by exactly 1 degree.
    // Correcting at the D↔A boundary (roots 2↔9) cancels this drift.
    let cof_correction: i16 = if s.scale_octave_size == 7 {
        let old = s.scale_root;
        if (direction > 0 && old == 2 && new_root_midi == 9)
            || (direction < 0 && old == 9 && new_root_midi == 2)
        {
            -(direction as i16)
        } else {
            0
        }
    } else {
        0
    };

    // Shift all melodic notes by -offset to keep original pitches
    let total_shift = offset - cof_correction;
    (0..NUM_CHANNELS).for_each(|ch| {
        if s.channel_types[ch] == ChannelType::Drum as u8 {
            return;
        }
        (0..NUM_PATTERNS).for_each(|pat| {
            let ec = s.patterns[ch][pat].event_count as usize;
            (0..ec).for_each(|e| {
                let h = s.patterns[ch][pat].event_handles[e];
                s.event_pool.slots[h as usize].row -= total_shift;
            });
        });
    });

    s.scale_root = new_root_midi as u8;
    engine_rebuild_scale(s);
    s.rendered_dirty.iter_mut().for_each(|d| *d = 1);
}

pub fn engine_get_scale_name_str(s: &EngineState) -> &'static str {
    let idx = s.scale_id_idx as usize;
    if idx >= NUM_SCALES { "Major" } else { SCALE_NAMES[idx] }
}

// ============ Sub-Mode Resolution ============

fn resolve_sub_mode(
    s: &mut EngineState,
    ev: &NoteEvent,
    sm: usize,
    repeat_index: u16,
    channel: u8,
) -> i16 {
    let arr = get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sm);
    let len = arr.length as u16;
    match arr.mode() {
        LoopMode::Continue => {
            let idx = (ev.event_index as usize) % MAX_EVENTS;
            let count = s.continue_counters[sm][channel as usize][idx];
            let val = arr.values[(count % len) as usize];
            s.continue_counters[sm][channel as usize][idx] = count + 1;
            val
        }
        LoopMode::Fill => {
            let idx = repeat_index.min(len - 1);
            arr.values[idx as usize]
        }
        LoopMode::Reset => {
            arr.values[(repeat_index % len) as usize]
        }
    }
}

pub fn resolve_sub_mode_preview(
    s: &EngineState,
    ev: &NoteEvent,
    sm: usize,
    repeat_index: u16,
    channel: u8,
) -> i16 {
    let arr = get_sub_mode(&s.sub_mode_pool, &ev.sub_mode_handles, sm);
    let len = arr.length as u16;
    match arr.mode() {
        LoopMode::Continue => {
            let snapshot = s.counter_snapshots[sm][channel as usize][(ev.event_index as usize) % MAX_EVENTS];
            arr.values[((snapshot + repeat_index) % len) as usize]
        }
        LoopMode::Fill => {
            let idx = repeat_index.min(len - 1);
            arr.values[idx as usize]
        }
        LoopMode::Reset => {
            arr.values[(repeat_index % len) as usize]
        }
    }
}

// ============ Chord Voicing Tables ============

pub const MAX_VOICING_COUNT: usize = 8;
pub const MAX_CHORD_DISTANCE: usize = 7;

#[derive(Clone, Copy)]
pub struct VoicingEntry {
    pub offsets: [i8; MAX_CHORD_SIZE],
    pub name: &'static str,
}

#[derive(Clone, Copy)]
pub struct VoicingList {
    pub entries: [VoicingEntry; MAX_VOICING_COUNT],
    pub count: u8,
}

const VE_ZERO: VoicingEntry = VoicingEntry { offsets: [0; MAX_CHORD_SIZE], name: "" };

macro_rules! ve {
    ($offsets:expr, $name:expr) => {
        VoicingEntry { offsets: $offsets, name: $name }
    };
}

macro_rules! vl {
    ($count:expr, $( $entry:expr ),+ ) => {{
        let mut entries = [VE_ZERO; MAX_VOICING_COUNT];
        let arr = [$( $entry ),+];
        let mut i = 0;
        while i < arr.len() {
            entries[i] = arr[i];
            i += 1;
        }
        VoicingList { entries, count: $count }
    }};
}

static VOICINGS_D1: [VoicingList; 7] = [
    vl!(1, ve!([0,1,0,0,0,0,0,0], "base")),
    vl!(1, ve!([0,1,2,0,0,0,0,0], "base")),
    vl!(1, ve!([0,1,2,3,0,0,0,0], "base")),
    vl!(1, ve!([0,1,2,3,4,0,0,0], "base")),
    vl!(1, ve!([0,1,2,3,4,5,0,0], "base")),
    vl!(1, ve!([0,1,2,3,4,5,6,0], "base")),
    vl!(1, ve!([0,1,2,3,4,5,6,7], "base")),
];

static VOICINGS_D2: [VoicingList; 7] = [
    vl!(1, ve!([0,2,0,0,0,0,0,0], "3rd")),
    vl!(3,
        ve!([0,2,4,0,0,0,0,0], "triad"),
        ve!([0,1,4,0,0,0,0,0], "sus2"),
        ve!([0,3,4,0,0,0,0,0], "sus4")
    ),
    vl!(6,
        ve!([0,2,4,6,0,0,0,0], "7th"),
        ve!([0,2,4,7,0,0,0,0], "triad+oct"),
        ve!([0,1,4,6,0,0,0,0], "sus2 7"),
        ve!([0,3,4,6,0,0,0,0], "sus4 7"),
        ve!([0,1,4,7,0,0,0,0], "sus2 oct"),
        ve!([0,3,4,7,0,0,0,0], "sus4 oct")
    ),
    vl!(3,
        ve!([0,2,4,6,8,0,0,0], "9th"),
        ve!([0,2,4,6,9,0,0,0], "7+oct"),
        ve!([0,2,4,7,9,0,0,0], "triad+2oct")
    ),
    vl!(2,
        ve!([0,2,4,6,8,10,0,0], "11th"),
        ve!([0,2,4,6,9,11,0,0], "7+2oct")
    ),
    vl!(1, ve!([0,2,4,6,8,10,12,0], "13th")),
    vl!(1, ve!([0,2,4,6,8,10,12,14], "base")),
];

static VOICINGS_D3: [VoicingList; 7] = [
    vl!(1, ve!([0,3,0,0,0,0,0,0], "4th")),
    vl!(3,
        ve!([0,3,6,0,0,0,0,0], "stacked 4"),
        ve!([0,3,7,0,0,0,0,0], "4th+oct"),
        ve!([0,4,7,0,0,0,0,0], "open triad")
    ),
    vl!(2,
        ve!([0,3,6,9,0,0,0,0], "stacked 4"),
        ve!([0,3,6,10,0,0,0,0], "4th+oct")
    ),
    vl!(1, ve!([0,3,6,9,12,0,0,0], "base")),
    vl!(1, ve!([0,3,6,9,12,15,0,0], "base")),
    vl!(1, ve!([0,3,6,9,12,15,18,0], "base")),
    vl!(1, ve!([0,3,6,9,12,15,18,21], "base")),
];

static VOICINGS_D4: [VoicingList; 7] = [
    vl!(1, ve!([0,4,0,0,0,0,0,0], "5th")),
    vl!(2,
        ve!([0,4,8,0,0,0,0,0], "stacked 5"),
        ve!([0,4,7,0,0,0,0,0], "5th+oct")
    ),
    vl!(2,
        ve!([0,4,8,12,0,0,0,0], "base"),
        ve!([0,4,7,11,0,0,0,0], "5+oct")
    ),
    vl!(1, ve!([0,4,8,12,16,0,0,0], "base")),
    vl!(1, ve!([0,4,8,12,16,20,0,0], "base")),
    vl!(1, ve!([0,4,8,12,16,20,24,0], "base")),
    vl!(1, ve!([0,4,8,12,16,20,24,28], "base")),
];

static VOICINGS_D5: [VoicingList; 7] = [
    vl!(1, ve!([0,5,0,0,0,0,0,0], "6th")),
    vl!(1, ve!([0,5,10,0,0,0,0,0], "base")),
    vl!(1, ve!([0,5,10,15,0,0,0,0], "base")),
    vl!(1, ve!([0,5,10,15,20,0,0,0], "base")),
    vl!(1, ve!([0,5,10,15,20,25,0,0], "base")),
    vl!(1, ve!([0,5,10,15,20,25,30,0], "base")),
    vl!(1, ve!([0,5,10,15,20,25,30,35], "base")),
];

static VOICINGS_D6: [VoicingList; 7] = [
    vl!(1, ve!([0,6,0,0,0,0,0,0], "7th")),
    vl!(1, ve!([0,6,12,0,0,0,0,0], "base")),
    vl!(1, ve!([0,6,12,18,0,0,0,0], "base")),
    vl!(1, ve!([0,6,12,18,24,0,0,0], "base")),
    vl!(1, ve!([0,6,12,18,24,30,0,0], "base")),
    vl!(1, ve!([0,6,12,18,24,30,36,0], "base")),
    vl!(1, ve!([0,6,12,18,24,30,36,42], "base")),
];

static VOICINGS_D7: [VoicingList; 7] = [
    vl!(1, ve!([0,7,0,0,0,0,0,0], "oct")),
    vl!(1, ve!([0,7,14,0,0,0,0,0], "base")),
    vl!(1, ve!([0,7,14,21,0,0,0,0], "base")),
    vl!(1, ve!([0,7,14,21,28,0,0,0], "base")),
    vl!(1, ve!([0,7,14,21,28,35,0,0], "base")),
    vl!(1, ve!([0,7,14,21,28,35,42,0], "base")),
    vl!(1, ve!([0,7,14,21,28,35,42,49], "base")),
];

static VOICING_TABLES: [&[VoicingList; 7]; MAX_CHORD_DISTANCE] = [
    &VOICINGS_D1, &VOICINGS_D2, &VOICINGS_D3, &VOICINGS_D4,
    &VOICINGS_D5, &VOICINGS_D6, &VOICINGS_D7,
];

pub fn get_voicing_list(amount: u8, distance: u8) -> Option<&'static VoicingList> {
    if distance < 1 || distance > MAX_CHORD_DISTANCE as u8 { return None; }
    if amount < 2 || amount > MAX_CHORD_SIZE as u8 { return None; }
    Some(&VOICING_TABLES[(distance - 1) as usize][(amount - 2) as usize])
}

pub fn get_voicing_count(amount: u8, distance: u8) -> u8 {
    get_voicing_list(amount, distance).map_or(1, |vl| vl.count)
}

pub fn get_voicing_name(amount: u8, distance: u8, idx: u8) -> &'static str {
    get_voicing_list(amount, distance)
        .and_then(|vl| (idx < vl.count).then(|| vl.entries[idx as usize].name))
        .unwrap_or("")
}

pub fn get_voicing_offsets(amount: u8, distance: u8, idx: u8, out: &mut [i8]) -> u8 {
    let n = (amount as usize).min(MAX_CHORD_SIZE).min(out.len());
    match get_voicing_list(amount, distance) {
        Some(vl) if idx < vl.count => {
            out[..n].copy_from_slice(&vl.entries[idx as usize].offsets[..n]);
        }
        _ => {
            (0..n).for_each(|i| out[i] = (i as i8) * (distance as i8));
        }
    }
    n as u8
}

// ============ Arpeggio ============

pub fn get_arp_chord_index(style: u8, chord_count: u8, repeat_idx: u16, offset: i8) -> u8 {
    if style == ARP_CHORD || chord_count <= 1 { return 255; }

    if style >= ARP_CHORD_UP && style <= ARP_CHORD_DOWN_UP {
        let base_styles = [ARP_UP, ARP_DOWN, ARP_UP_DOWN, ARP_DOWN_UP];
        let base = base_styles[(style - ARP_CHORD_UP) as usize];

        let cycle = match base {
            ARP_UP | ARP_DOWN => chord_count as u16,
            _ => 2 * (chord_count as u16 - 1),
        };

        if repeat_idx % cycle == 0 { return 255; }
        return get_arp_chord_index(base, chord_count, repeat_idx % cycle, offset);
    }

    let cc = chord_count as i32;
    let effective_raw = repeat_idx as i32 - offset as i32;

    match style {
        ARP_UP => ((effective_raw % cc + cc) % cc) as u8,
        ARP_DOWN => (cc - 1 - ((effective_raw % cc + cc) % cc)) as u8,
        ARP_UP_DOWN | ARP_DOWN_UP => {
            let cycle_len = 2 * (cc - 1);
            let eff = ((effective_raw % cycle_len) + cycle_len) % cycle_len;
            let idx = if eff < cc { eff } else { cycle_len - eff };
            if style == ARP_DOWN_UP { (cc - 1 - idx) as u8 } else { idx as u8 }
        }
        _ => 255,
    }
}

pub fn is_arp_chord_active(
    style: u8, chord_count: u8, repeat_idx: u16,
    offset: i8, voices: u8, chord_idx: u8,
) -> bool {
    if style == ARP_CHORD || chord_count <= 1 { return true; }

    let base = get_arp_chord_index(style, chord_count, repeat_idx, offset);
    if base == 255 { return true; }

    let v = voices.max(1);
    if v >= chord_count { return true; }

    (0..v).any(|i| (base + i) % chord_count == chord_idx)
}

// ============ Active Notes ============

fn kill_active_notes_for_channel(s: &mut EngineState, ch: u8) {
    s.active_notes.iter_mut()
        .filter(|n| n.active && n.channel == ch)
        .for_each(|n| {
            crate::platform_note_off(ch, n.midi_note as u8);
            n.active = false;
        });
}

fn prune_active_notes(s: &mut EngineState, ch: u8, channel_tick: i32) {
    s.active_notes.iter_mut()
        .filter(|n| n.active && n.channel == ch && channel_tick > n.end)
        .for_each(|n| {
            crate::platform_note_off(ch, n.midi_note as u8);
            n.active = false;
        });
}

fn handle_active_note(
    s: &mut EngineState, ch: u8, event_index: u16,
    repeat_index: u8, chord_index: u8,
    channel_tick: i32, note_length: i32, midi_note: i8,
) {
    // Kill any active note on same channel with same MIDI note
    let mut free_slot: Option<usize> = None;
    s.active_notes.iter_mut().enumerate().for_each(|(i, n)| {
        if n.active && n.channel == ch && n.midi_note == midi_note {
            crate::platform_note_off(ch, n.midi_note as u8);
            n.active = false;
            if free_slot.is_none() { free_slot = Some(i); }
        }
        if !n.active && free_slot.is_none() {
            free_slot = Some(i);
        }
    });

    if let Some(slot) = free_slot {
        let n = &mut s.active_notes[slot];
        n.active = true;
        n.channel = ch;
        n.event_index = event_index;
        n.repeat_index = repeat_index;
        n.chord_index = chord_index;
        n.start = channel_tick;
        n.end = channel_tick + note_length - 1;
        n.midi_note = midi_note;
    }
}

// ============ Preview Computation ============

fn snapshot_counters_for_channel(s: &mut EngineState, ch: u8) {
    let pat_idx = s.current_patterns[ch as usize];
    let ec = s.patterns[ch as usize][pat_idx as usize].event_count;

    (0..ec as usize).for_each(|ei| {
        let h = s.patterns[ch as usize][pat_idx as usize].event_handles[ei];
        let ev = &s.event_pool.slots[h as usize];
        if ev.enabled == 0 { return; }
        let eidx = (ev.event_index as usize) % MAX_EVENTS;
        (0..NUM_SUB_MODES).for_each(|sm| {
            s.counter_snapshots[sm][ch as usize][eidx] =
                s.continue_counters[sm][ch as usize][eidx];
        });
    });
}

fn compute_preview_for_channel(s: &mut EngineState, ch: u8) {
    let pat_idx = s.current_patterns[ch as usize];
    let loop_data = s.loops[ch as usize][pat_idx as usize];
    let loop_end = loop_data.start + loop_data.length;
    let ec = s.patterns[ch as usize][pat_idx as usize].event_count;

    (0..ec as usize).for_each(|ei| {
        let h = s.patterns[ch as usize][pat_idx as usize].event_handles[ei];
        let ev = &s.event_pool.slots[h as usize];
        if ev.enabled == 0 { return; }

        (0..NUM_SUB_MODES).for_each(|sm| {
            (0..ev.repeat_amount).for_each(|r| {
                let ev_tick = ev.position + r as i32 * ev.repeat_space;
                if ev_tick < loop_data.start || ev_tick >= loop_end { return; }
                let val = resolve_sub_mode_preview(s, ev, sm, r, ch);
                crate::platform_preview_value(sm as u8, ch, ev.event_index, ev_tick, val);
            });
        });
    });
}

fn snapshot_and_preview_channel(s: &mut EngineState, ch: u8) {
    snapshot_counters_for_channel(s, ch);
    compute_preview_for_channel(s, ch);
}

// ============ Core Functions ============

pub fn engine_core_init(s: &mut EngineState) {
    s.current_tick = -1;
    s.last_scrub_tick = -1;
    s.is_playing = 0;
    s.active_notes.iter_mut().for_each(|n| n.active = false);

    s.continue_counters = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];
    s.counter_snapshots = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];

    s.ui_mode = UiMode::Pattern as u8;
    s.modify_sub_mode = SubModeId::Velocity as u8;
    s.current_channel = 0;
    s.zoom = 120;
    s.selected_event_idx = -1;
    s.col_offset = 0.0;
    s.target_col_offset = 0.0;
    s.row_offsets = [0.0; NUM_CHANNELS];
    s.target_row_offsets = [0.0; NUM_CHANNELS];

    if s.bpm < 20.0 { s.bpm = 120.0; }
    // next_event_id 0 is valid — counter arrays are indexed by event_index (0..MAX_EVENTS-1)

    s.button_values = [[0; VISIBLE_COLS]; VISIBLE_ROWS];
    s.color_overrides = [[0; VISIBLE_COLS]; VISIBLE_ROWS];
    s.patterns_have_notes = [[0; NUM_PATTERNS]; NUM_CHANNELS];
    s.channels_playing_now = [0; NUM_CHANNELS];

    (0..NUM_CHANNELS).for_each(|ch| {
        (0..NUM_PATTERNS).for_each(|pat| {
            s.patterns[ch][pat].length_ticks = DEFAULT_PATTERN_TICKS;
            s.loops[ch][pat].start = 0;
            s.loops[ch][pat].length = DEFAULT_LOOP_TICKS;
        });
        s.queued_patterns[ch] = -1;
    });

    if s.rng_state == 0 { s.rng_state = 12345; }
    s.rendered_dirty = [1; NUM_CHANNELS];

    s.scale_root = 0;
    s.scale_id_idx = 0;
    engine_rebuild_scale(s);
}

pub fn engine_core_play_init(s: &mut EngineState) {
    s.current_tick = -1;
    s.last_scrub_tick = -1;
    s.active_notes.iter_mut().for_each(|n| n.active = false);
    s.continue_counters = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];
    s.counter_snapshots = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];
    s.rendered_dirty.iter_mut().for_each(|d| *d = 1);
}

pub fn engine_core_play_init_from_tick(s: &mut EngineState, tick: i32) {
    s.current_tick = tick - 1;
    s.last_scrub_tick = -1;
    s.active_notes.iter_mut().for_each(|n| n.active = false);
    s.continue_counters = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];
    s.counter_snapshots = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];
    s.rendered_dirty.iter_mut().for_each(|d| *d = 1);
}

pub fn engine_core_stop(s: &mut EngineState) {
    s.active_notes.iter_mut()
        .filter(|n| n.active)
        .for_each(|n| {
            crate::platform_note_off(n.channel, n.midi_note as u8);
            n.active = false;
        });

    s.continue_counters = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];
    s.counter_snapshots = [[[0; MAX_EVENTS]; NUM_CHANNELS]; NUM_SUB_MODES];
    s.rendered_dirty.iter_mut().for_each(|d| *d = 1);
    s.queued_patterns.iter_mut().for_each(|q| *q = -1);
}

pub fn engine_core_tick(s: &mut EngineState) {
    let next_tick = s.current_tick + 1;

    let mut switch_channels: Vec<(u8, u8)> = Vec::new();
    let any_soloed = s.soloed.iter().any(|&v| v != 0);

    (0..NUM_CHANNELS as u8).for_each(|ch| {
        let pat_idx = s.current_patterns[ch as usize];
        let loop_data = s.loops[ch as usize][pat_idx as usize];
        let loop_end = loop_data.start + loop_data.length;
        let channel_tick = loop_data.start + mod_positive(next_tick - loop_data.start, loop_data.length);

        // Loop reset
        if channel_tick == loop_data.start {
            kill_active_notes_for_channel(s, ch);
            snapshot_and_preview_channel(s, ch);
            s.rendered_dirty[ch as usize] = 1;

            if s.queued_patterns[ch as usize] >= 0 {
                switch_channels.push((ch, s.queued_patterns[ch as usize] as u8));
            }
        }

        prune_active_notes(s, ch, channel_tick);

        let should_play = if any_soloed {
            s.soloed[ch as usize] != 0 && s.muted[ch as usize] == 0
        } else {
            s.muted[ch as usize] == 0
        };

        if should_play && channel_tick >= loop_data.start && channel_tick < loop_end {
            let ec = s.patterns[ch as usize][pat_idx as usize].event_count;

            (0..ec as usize).for_each(|ei| {
                // Must clone because resolve_sub_mode borrows s mutably
                let h = s.patterns[ch as usize][pat_idx as usize].event_handles[ei];
                let ev = s.event_pool.slots[h as usize].clone();
                if ev.enabled == 0 { return; }

                (0..ev.repeat_amount).for_each(|r| {
                    let ev_tick = ev.position + r as i32 * ev.repeat_space;
                    if ev_tick >= s.patterns[ch as usize][pat_idx as usize].length_ticks { return; }
                    if ev_tick != channel_tick { return; }

                    let velocity = resolve_sub_mode(s, &ev, 0, r, ch);
                    let chance = resolve_sub_mode(s, &ev, 1, r, ch);
                    let timing_raw = resolve_sub_mode(s, &ev, 2, r, ch);
                    let flam_prob = resolve_sub_mode(s, &ev, 3, r, ch);
                    let mod_val = resolve_sub_mode(s, &ev, 4, r, ch);

                    // Apply swing: delay odd 16th notes
                    let swing_offset = if (ev_tick / 120) % 2 == 1 {
                        (s.swing - 50) * 2
                    } else {
                        0
                    };
                    let timing = (timing_raw as i32 + swing_offset).clamp(-128, 127) as i16;

                    if chance < 100 && (engine_random(s) % 100) >= chance as u32 { return; }

                    let flam_count = if flam_prob > 0 && (engine_random(s) % 100) < flam_prob as u32 { 1u8 } else { 0u8 };

                    let effective_row = ev.row + mod_val;

                    let inv_extra = if ev.sub_mode_handles[SubModeId::Inversion as usize] != POOL_HANDLE_NONE {
                        resolve_sub_mode(s, &ev, SubModeId::Inversion as usize, r, ch) as i8
                    } else {
                        0
                    };
                    let mut offsets = [0i8; MAX_CHORD_SIZE];
                    let offset_count = crate::engine_ui::get_chord_offsets(s, &ev, &mut offsets, inv_extra);

                    (0..offset_count).for_each(|ci| {
                        if !is_arp_chord_active(ev.arp_style, offset_count as u8, r, ev.arp_offset, ev.arp_voices, ci as u8) { return; }

                        let chord_row = effective_row + offsets[ci] as i16;
                        let midi_note = if s.channel_types[ch as usize] == ChannelType::Drum as u8 {
                            chord_row.clamp(0, 127) as i8
                        } else {
                            let m = note_to_midi(chord_row, s);
                            if m < 0 { return; }
                            m
                        };

                        // Extend active note duration by JS-side delay (lookahead + timing)
                        // so note-off fires after the delayed note-on
                        let delay_ticks = (70 + timing as i32).max(0) * 120 / 100;
                        handle_active_note(s, ch, ev.event_index, r as u8, ci as u8, channel_tick, ev.length + delay_ticks, midi_note);
                        crate::platform_step_trigger(
                            ch, midi_note as u8, channel_tick,
                            ev.length, (velocity.clamp(0, 127)) as u8,
                            timing as i8, flam_count, ev.event_index,
                        );
                    });
                });
            });
        }
    });

    // Apply pattern switches
    if !switch_channels.is_empty() {
        switch_channels.iter().for_each(|&(ch, target)| {
            s.current_patterns[ch as usize] = target;
            s.queued_patterns[ch as usize] = -1;
            crate::platform_clear_queued_pattern(ch);
        });
        crate::platform_set_current_patterns(&s.current_patterns);

        switch_channels.iter().for_each(|&(ch, _)| {
            compute_preview_for_channel(s, ch);
            s.rendered_dirty[ch as usize] = 1;
        });
    }

    s.current_tick = next_tick;
    crate::platform_set_current_tick(next_tick);
}

// ============ Scrub ============

const SCRUB_NOTE_LENGTH: i32 = 1;

pub fn engine_core_scrub_to_tick(s: &mut EngineState, target_tick: i32) {
    // Kill all active notes
    s.active_notes.iter_mut()
        .filter(|n| n.active)
        .for_each(|n| {
            crate::platform_note_off(n.channel, n.midi_note as u8);
            n.active = false;
        });

    let any_soloed = s.soloed.iter().any(|&v| v != 0);

    (0..NUM_CHANNELS as u8).for_each(|ch| {
        let pat_idx = s.current_patterns[ch as usize];
        let loop_data = s.loops[ch as usize][pat_idx as usize];
        let loop_len = loop_data.length;
        let loop_end = loop_data.start + loop_len;

        let should_play = if any_soloed {
            s.soloed[ch as usize] != 0 && s.muted[ch as usize] == 0
        } else {
            s.muted[ch as usize] == 0
        };
        if !should_play { return; }

        let curr_looped = loop_data.start + mod_positive(target_tick - loop_data.start, loop_len);

        let (mut scan_start, mut scan_end) = if s.last_scrub_tick < 0 {
            (curr_looped, curr_looped)
        } else {
            let prev_looped = loop_data.start + mod_positive(s.last_scrub_tick - loop_data.start, loop_len);
            if target_tick >= s.last_scrub_tick {
                (prev_looped + 1, curr_looped)
            } else {
                (curr_looped, prev_looped - 1)
            }
        };

        if scan_start > scan_end { core::mem::swap(&mut scan_start, &mut scan_end); }
        scan_start = scan_start.max(loop_data.start);
        scan_end = scan_end.min(loop_end - 1);

        let ec = s.patterns[ch as usize][pat_idx as usize].event_count;

        (0..ec as usize).for_each(|ei| {
            let h = s.patterns[ch as usize][pat_idx as usize].event_handles[ei];
            let ev = s.event_pool.slots[h as usize].clone();
            if ev.enabled == 0 { return; }

            (0..ev.repeat_amount).for_each(|r| {
                let ev_tick = ev.position + r as i32 * ev.repeat_space;
                if ev_tick >= s.patterns[ch as usize][pat_idx as usize].length_ticks { return; }
                if ev_tick < scan_start || ev_tick > scan_end { return; }

                let velocity = resolve_sub_mode_preview(s, &ev, 0, r, ch);
                let mod_val = resolve_sub_mode_preview(s, &ev, 4, r, ch);
                let effective_row = ev.row + mod_val;

                let inv_extra = if ev.sub_mode_handles[SubModeId::Inversion as usize] != POOL_HANDLE_NONE {
                    resolve_sub_mode_preview(s, &ev, SubModeId::Inversion as usize, r, ch) as i8
                } else {
                    0
                };
                let mut offsets = [0i8; MAX_CHORD_SIZE];
                let offset_count = crate::engine_ui::get_chord_offsets(s, &ev, &mut offsets, inv_extra);

                (0..offset_count).for_each(|ci| {
                    let chord_row = effective_row + offsets[ci] as i16;
                    let midi_note = if s.channel_types[ch as usize] == ChannelType::Drum as u8 {
                        chord_row.clamp(0, 127) as i8
                    } else {
                        let m = note_to_midi(chord_row, s);
                        if m < 0 { return; }
                        m
                    };

                    handle_active_note(s, ch, ev.event_index, r as u8, ci as u8, curr_looped, SCRUB_NOTE_LENGTH, midi_note);
                    crate::platform_step_trigger(
                        ch, midi_note as u8, ev_tick,
                        SCRUB_NOTE_LENGTH, velocity.clamp(0, 127) as u8,
                        0, 0, ev.event_index,
                    );
                });
            });
        });
    });

    // Register active notes for UI highlighting on current channel
    {
        let view_ch = s.current_channel as usize;
        let view_pat = s.current_patterns[view_ch] as usize;
        let vloop = s.loops[view_ch][view_pat];
        let view_looped = vloop.start + mod_positive(target_tick - vloop.start, vloop.length);
        let vec = s.patterns[view_ch][view_pat].event_count;

        (0..vec as usize).for_each(|ei| {
            let h = s.patterns[view_ch][view_pat].event_handles[ei];
            let ev = s.event_pool.slots[h as usize].clone();
            if ev.enabled == 0 { return; }

            (0..ev.repeat_amount).for_each(|r| {
                let ev_tick = ev.position + r as i32 * ev.repeat_space;
                if ev_tick >= s.patterns[view_ch][view_pat].length_ticks { return; }
                let ev_end = ev_tick + ev.length;
                if view_looped < ev_tick || view_looped >= ev_end { return; }

                let mod_val = resolve_sub_mode_preview(s, &ev, 4, r, view_ch as u8);
                let effective_row = ev.row + mod_val;

                let inv_extra = if ev.sub_mode_handles[SubModeId::Inversion as usize] != POOL_HANDLE_NONE {
                    resolve_sub_mode_preview(s, &ev, SubModeId::Inversion as usize, r, view_ch as u8) as i8
                } else {
                    0
                };
                let mut offsets = [0i8; MAX_CHORD_SIZE];
                let offset_count = crate::engine_ui::get_chord_offsets(s, &ev, &mut offsets, inv_extra);

                (0..offset_count).for_each(|ci| {
                    let chord_row = effective_row + offsets[ci] as i16;
                    let midi_note = if s.channel_types[view_ch] == ChannelType::Drum as u8 {
                        chord_row.clamp(0, 127) as i8
                    } else {
                        let m = note_to_midi(chord_row, s);
                        if m < 0 { return; }
                        m
                    };
                    handle_active_note(s, view_ch as u8, ev.event_index, r as u8, ci as u8, view_looped, 1, midi_note);
                });
            });
        });
    }

    s.current_tick = target_tick;
    crate::platform_set_current_tick(target_tick);
    s.last_scrub_tick = target_tick;
}

pub fn engine_core_scrub_end(s: &mut EngineState) {
    s.last_scrub_tick = -1;
    s.active_notes.iter_mut()
        .filter(|n| n.active)
        .for_each(|n| {
            crate::platform_note_off(n.channel, n.midi_note as u8);
            n.active = false;
        });
}

pub fn engine_core_get_version() -> i32 {
    3000
}

// ============ Utility Functions ============

pub fn engine_alloc_event_id(s: &mut EngineState) -> u16 {
    let id = s.next_event_id;
    s.next_event_id += 1;
    id
}

pub fn engine_update_has_notes(s: &mut EngineState, ch: u8, pat: u8) {
    if (ch as usize) < NUM_CHANNELS && (pat as usize) < NUM_PATTERNS {
        s.patterns_have_notes[ch as usize][pat as usize] =
            if s.patterns[ch as usize][pat as usize].event_count > 0 { 1 } else { 0 };
    }
}
