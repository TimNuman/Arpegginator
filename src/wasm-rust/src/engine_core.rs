// engine_core.rs — Core types, constants, state, scales, arpeggios, voicings, playback

// ============ FmtBuf — zero-alloc string formatting ============

/// Fixed-capacity string buffer for `write!()` formatting without heap allocation.
pub struct FmtBuf<const N: usize> {
    buf: [u8; N],
    len: usize,
}

impl<const N: usize> FmtBuf<N> {
    pub const fn new() -> Self {
        Self { buf: [0u8; N], len: 0 }
    }

    pub fn as_str(&self) -> &str {
        unsafe { core::str::from_utf8_unchecked(&self.buf[..self.len]) }
    }

    pub fn push_str(&mut self, s: &str) {
        let bytes = s.as_bytes();
        let copy_len = bytes.len().min(N - self.len);
        self.buf[self.len..self.len + copy_len].copy_from_slice(&bytes[..copy_len]);
        self.len += copy_len;
    }

    pub fn push(&mut self, c: char) {
        let mut tmp = [0u8; 4];
        let s = c.encode_utf8(&mut tmp);
        self.push_str(s);
    }

    pub fn clear(&mut self) {
        self.len = 0;
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl<const N: usize> core::fmt::Write for FmtBuf<N> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.push_str(s);
        Ok(())
    }
}

impl<const N: usize> PartialEq<&str> for FmtBuf<N> {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

impl<const N: usize> core::fmt::Debug for FmtBuf<N> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl<const N: usize> core::ops::Deref for FmtBuf<N> {
    type Target = str;
    fn deref(&self) -> &str {
        self.as_str()
    }
}

// ============ Constants ============

pub const NUM_CHANNELS: usize = 6;
pub const NUM_PATTERNS: usize = 8;
pub const MAX_EVENTS: usize = 128;
pub const MAX_SUB_MODE_LEN: usize = 32;
pub const NUM_SUB_MODES: usize = 6;
pub const MAX_CHORD_SIZE: usize = 8;
pub const MAX_SCALE_NOTES: usize = 128;
pub const NUM_SCALES: usize = 31;
pub const MAX_ACTIVE_NOTES: usize = 64;
pub const DIATONIC_OCTAVE: u8 = 7;
pub const VISIBLE_ROWS: usize = 8;
pub const VISIBLE_COLS: usize = 16;
pub const TICKS_PER_QUARTER: i32 = 480;
pub const MAX_RENDERED_NOTES: usize = 512;

pub const POOL_CAPACITY: usize = 512;
pub const EVENT_POOL_CAPACITY: usize = 1024;
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
pub const FLAG_NO_HIT: u16 = 8192;
pub const FLAG_GHOST: u16 = 16384;
pub const FLAG_OFFSCREEN: u16 = 32768;

pub const MAX_GHOST_NOTES: usize = 128;

// ============ Enums ============

#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum LoopMode {
    #[default]
    Continue = 0,
    Reset = 1,
    Fill = 2,
}

impl LoopMode {
    pub fn cycle(self) -> Self {
        match self {
            Self::Continue => Self::Reset,
            Self::Reset => Self::Fill,
            Self::Fill => Self::Continue,
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
pub const ARP_E1M1: u8 = 9;
pub const ARP_ZIG_UP: u8 = 10;
pub const ARP_ZIG_DOWN: u8 = 11;
pub const ARP_ZIG_UP_DOWN: u8 = 12;
pub const ARP_ZIG_DOWN_UP: u8 = 13;
pub const ARP_RANDOM: u8 = 14;
pub const ARP_STYLE_COUNT: u8 = 15;

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

// ============ Edit Groups (pattern mode, selected note) ============

/// Identifies which pair of parameters the current modifier combo edits.
/// Used by both OLED renderer (for highlight colors) and input handler (for dispatch).
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EditGroup {
    Move      = 0, // bare:       U/D = move note,     L/R = move note
    Inversion = 1, // Shift:      U/D = inversion,     L/R = length
    Stack     = 2, // Cmd:        U/D = stack amount,   L/R = repeat amount
    Spacing   = 3, // Cmd+Shift:  U/D = stack space,    L/R = repeat space
    Arp       = 4, // Alt:        U/D = arp style,      L/R = arp offset
    Voicing   = 5, // Alt+Shift:  U/D = voicing,        L/R = arp voices
    None      = 6, // Cmd+Alt / Cmd+Alt+Shift: no arrow editing
}

impl EditGroup {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Move,
            1 => Self::Inversion,
            2 => Self::Stack,
            3 => Self::Spacing,
            4 => Self::Arp,
            5 => Self::Voicing,
            _ => Self::None,
        }
    }

    /// Derive edit group from modifier flags. Pass booleans, not raw bitmask,
    /// since OLED and input use different encodings.
    pub fn from_mods(meta: bool, alt: bool, shift: bool) -> Self {
        match (meta, alt, shift) {
            (false, false, false) => Self::Move,
            (false, false, true)  => Self::Inversion,
            (true,  false, false) => Self::Stack,
            (true,  false, true)  => Self::Spacing,
            (false, true,  false) => Self::Arp,
            (false, true,  true)  => Self::Voicing,
            _                     => Self::None,
        }
    }
}

/// Static metadata for each edit group — labels and highlight info.
pub struct EditMeta {
    pub ud_label: &'static str,
    pub lr_label: &'static str,
    pub grid_label: &'static str,
    /// Bitmask: which of the 5 OLED rows get yellow highlight (bit 0 = row 0)
    pub ud_rows: u8,
    /// Bitmask: which of the 5 OLED rows get red highlight
    pub lr_rows: u8,
}

/// Metadata for pattern mode with a note selected, indexed by EditGroup.
pub static EDIT_META: [EditMeta; 7] = [
    // Move (bare)
    EditMeta { ud_label: "MOVE",    lr_label: "MOVE",    grid_label: "DESELECT", ud_rows: 0b00010, lr_rows: 0 },
    // Inversion (Shift)
    EditMeta { ud_label: "INVERT",  lr_label: "LENGTH",  grid_label: "LENGTH",   ud_rows: 0b00001, lr_rows: 0b00010 },
    // Stack (Cmd)
    EditMeta { ud_label: "STACK",   lr_label: "REPEAT",  grid_label: "DISABLE",  ud_rows: 0b01000, lr_rows: 0b00100 },
    // Spacing (Cmd+Shift)
    EditMeta { ud_label: "SPACING", lr_label: "SPACING", grid_label: "RST/RPT",  ud_rows: 0b01000, lr_rows: 0b00100 },
    // Arp (Alt)
    EditMeta { ud_label: "ARP",     lr_label: "OFFSET",  grid_label: "COPY",     ud_rows: 0b10000, lr_rows: 0b10000 },
    // Voicing (Alt+Shift)
    EditMeta { ud_label: "VOICING", lr_label: "VOICES",  grid_label: "",         ud_rows: 0b00001, lr_rows: 0b10000 },
    // None (Cmd+Alt combos)
    EditMeta { ud_label: "",        lr_label: "",        grid_label: "RANDOM",    ud_rows: 0, lr_rows: 0 },
];

// ============ Data Structures ============

#[derive(Clone, Copy)]
#[repr(C)]
pub struct SubModeArray {
    pub values: [i16; MAX_SUB_MODE_LEN],
    pub length: u8,
    pub loop_mode: u8, // LoopMode as u8
    pub stay: u8,      // Stay mode: repeat each value this many times
}

impl Default for SubModeArray {
    fn default() -> Self {
        Self {
            values: [0; MAX_SUB_MODE_LEN],
            length: 1,
            loop_mode: LoopMode::Continue as u8,
            stay: 1,
        }
    }
}

impl SubModeArray {
    pub fn mode(&self) -> LoopMode {
        match self.loop_mode {
            0 => LoopMode::Continue,
            1 => LoopMode::Reset,
            2 => LoopMode::Fill,
            _ => LoopMode::Continue,
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

pub fn pool_alloc(pool: &mut SubModePool) -> Option<u16> {
    if pool.free_count == 0 { return None; }
    pool.free_count -= 1;
    Some(pool.free_list[pool.free_count as usize])
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
    let mut a = SubModeArray { values: [0i16; MAX_SUB_MODE_LEN], length: 1, loop_mode: LoopMode::Continue as u8, stay: 1 };
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

pub fn get_sub_mode_mut<'a>(pool: &'a mut SubModePool, handles: &mut [u16; NUM_SUB_MODES], sm: usize) -> Option<&'a mut SubModeArray> {
    if handles[sm] == POOL_HANDLE_NONE {
        let h = pool_alloc(pool)?;
        pool.slots[h as usize] = SM_DEFAULTS[sm];
        handles[sm] = h;
    }
    Some(&mut pool.slots[handles[sm] as usize])
}

// ============ Event Pool ============

pub struct NoteEventPool {
    pub slots: [NoteEvent; EVENT_POOL_CAPACITY],
    pub free_list: [u16; EVENT_POOL_CAPACITY],
    pub free_count: u16,
}

pub fn event_alloc(pool: &mut NoteEventPool) -> Option<u16> {
    if pool.free_count == 0 { return None; }
    pool.free_count -= 1;
    Some(pool.free_list[pool.free_count as usize])
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

#[derive(Clone, Copy, Default)]
pub struct GhostNote {
    pub position: i32,
    pub length: i32,
    pub pitch_class: u8,
}

// ============ Engine State ============

pub struct EngineState {
    pub patterns: [[PatternData; NUM_PATTERNS]; NUM_CHANNELS],
    pub sub_mode_pool: SubModePool,
    pub event_pool: NoteEventPool,
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
    pub grid_colors: [[u32; VISIBLE_COLS]; VISIBLE_ROWS], // 0xAARRGGBB output for LEDs/web

    pub patterns_have_notes: [[u8; NUM_PATTERNS]; NUM_CHANNELS],
    pub channels_playing_now: [u8; NUM_CHANNELS],

    pub next_event_id: u16,

    pub rendered_notes: [RenderedNote; MAX_RENDERED_NOTES],
    pub rendered_count: u16,
    pub rendered_for_channel: u8,
    pub rendered_dirty: [u8; NUM_CHANNELS],

    pub ghost_notes: [GhostNote; MAX_GHOST_NOTES],
    pub ghost_count: u16,
    pub ghost_enabled: u8,

    // Pulse animation state
    pub brightness: u8, // 0-255, computed each frame
    pub pulse_active: u8, // nonzero if any cell is pulsing this frame

    // Pre-allocated temp buffer (avoid per-frame heap allocation)
    pub temp_sub_modes: [[SubModeArray; NUM_SUB_MODES]; MAX_EVENTS],
}

impl EngineState {
    /// Initialize a zero-allocated EngineState in place. Call on a pointer from alloc_zeroed.
    /// Most fields are correct at zero; this sets the non-zero defaults.
    pub fn init_in_place(&mut self) {
        // Pattern defaults: length_ticks and event_handles
        for ch in 0..NUM_CHANNELS {
            for pat in 0..NUM_PATTERNS {
                self.patterns[ch][pat].length_ticks = DEFAULT_PATTERN_TICKS;
                self.patterns[ch][pat].event_handles = [POOL_HANDLE_NONE; MAX_EVENTS];
            }
        }

        // Pool free lists
        (0..POOL_CAPACITY).for_each(|i| { self.sub_mode_pool.free_list[i] = i as u16; });
        self.sub_mode_pool.free_count = POOL_CAPACITY as u16;
        (0..EVENT_POOL_CAPACITY).for_each(|i| { self.event_pool.free_list[i] = i as u16; });
        self.event_pool.free_count = EVENT_POOL_CAPACITY as u16;

        // Event pool defaults (sub_mode_handles must be POOL_HANDLE_NONE)
        for slot in self.event_pool.slots.iter_mut() {
            slot.sub_mode_handles = [POOL_HANDLE_NONE; NUM_SUB_MODES];
            slot.repeat_amount = 1;
            slot.chord_amount = 1;
            slot.chord_space = 2;
            slot.arp_voices = 1;
        }

        // SubModePool slot defaults
        for slot in self.sub_mode_pool.slots.iter_mut() {
            slot.length = 1;
            slot.loop_mode = LoopMode::Continue as u8;
            slot.stay = 1;
        }

        // Loop defaults
        for ch in 0..NUM_CHANNELS {
            for pat in 0..NUM_PATTERNS {
                self.loops[ch][pat].length = DEFAULT_LOOP_TICKS;
            }
        }

        self.queued_patterns = [-1; NUM_CHANNELS];
        self.current_tick = -1;
        self.last_scrub_tick = -1;
        self.resume_tick = -1;
        self.bpm = 120.0;
        self.swing = 50;
        // Default channel colors
        self.channel_colors = [
            0xFF3366, // Hot pink
            0xFF9933, // Orange
            0xFFCC00, // Yellow
            0x33CC66, // Green
            0x3399FF, // Cyan
            0x9966FF, // Purple
        ];

        self.rng_state = 12345;
        self.zoom = 120;
        self.selected_event_idx = -1;
        self.last_deselected_event_idx = -1;
        self.rendered_for_channel = 0xFF;
        self.rendered_dirty = [1; NUM_CHANNELS];
    }

    /// Allocate a zeroed EngineState on the heap and initialize non-zero defaults.
    /// Avoids constructing the large struct on the stack.
    pub fn new_boxed() -> Box<EngineState> {
        extern crate alloc;
        let mut s = unsafe {
            let layout = core::alloc::Layout::new::<EngineState>();
            let ptr = alloc::alloc::alloc_zeroed(layout) as *mut EngineState;
            if ptr.is_null() {
                alloc::alloc::handle_alloc_error(layout);
            }
            Box::from_raw(ptr)
        };
        s.init_in_place();
        s
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

pub static SCALE_PATTERNS: [[u8; 12]; NUM_SCALES] = [
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
    [1,1,0,0,1,1,0,1,1,0,0,1], // Double Harmonic / Hijaz
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
    "Double Harmonic / Hijaz", "Hungarian Minor", "Enigmatic",
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
    let stay = (arr.stay as u16).max(1);
    match arr.mode() {
        LoopMode::Continue => {
            let idx = (ev.event_index as usize) % MAX_EVENTS;
            let count = s.continue_counters[sm][channel as usize][idx];
            let val = arr.values[((count / stay) % len) as usize];
            s.continue_counters[sm][channel as usize][idx] = count + 1;
            val
        }
        LoopMode::Fill => {
            let idx = (repeat_index / stay).min(len - 1);
            arr.values[idx as usize]
        }
        LoopMode::Reset => {
            arr.values[((repeat_index / stay) % len) as usize]
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
    let stay = (arr.stay as u16).max(1);
    match arr.mode() {
        LoopMode::Continue => {
            let snapshot = s.counter_snapshots[sm][channel as usize][(ev.event_index as usize) % MAX_EVENTS];
            arr.values[(((snapshot + repeat_index) / stay) % len) as usize]
        }
        LoopMode::Fill => {
            let idx = (repeat_index / stay).min(len - 1);
            arr.values[idx as usize]
        }
        LoopMode::Reset => {
            arr.values[((repeat_index / stay) % len) as usize]
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
        ve!([0,3,4,0,0,0,0,0], "sus4"),
        ve!([0,1,4,0,0,0,0,0], "sus2")
    ),
    vl!(6,
        ve!([0,2,4,6,0,0,0,0], "7th"),
        ve!([0,2,4,7,0,0,0,0], "triad+oct"),
        ve!([0,3,4,6,0,0,0,0], "sus4 7"),
        ve!([0,1,4,6,0,0,0,0], "sus2 7"),
        ve!([0,3,4,7,0,0,0,0], "sus4 oct"),
        ve!([0,1,4,7,0,0,0,0], "sus2 oct")
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

static mut ARP_RANDOM_SEED: u32 = 0;

pub fn engine_reseed_random_arp() {
    unsafe { ARP_RANDOM_SEED = ARP_RANDOM_SEED.wrapping_add(1); }
}

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
        ARP_E1M1 => {
            // Pattern: [0,0,N-1], [0,0,N-2], ..., [0,0,1], [0,0,1,2]
            // Cycle = 3*(N-1) + 4
            let cycle_len = 3 * (cc - 1) + 4;
            let pos = ((effective_raw % cycle_len) + cycle_len) % cycle_len;
            let triplet_end = 3 * (cc - 1);
            if pos < triplet_end {
                if pos % 3 < 2 { 0 }
                else { (cc - 1 - pos / 3) as u8 }
            } else {
                match pos - triplet_end {
                    0 | 1 => 0,
                    2 => 1u8.min((cc - 1) as u8),
                    _ => 2u8.min((cc - 1) as u8),
                }
            }
        }
        ARP_ZIG_UP | ARP_ZIG_DOWN => {
            // Zigzag up: 0,1,0,2,1,3,2,4  Cycle = 2*(N-1)
            let cycle_len = 2 * (cc - 1);
            let pos = ((effective_raw % cycle_len) + cycle_len) % cycle_len;
            let val = zig_up_value(pos, cc);
            if style == ARP_ZIG_DOWN { (cc - 1 - val as i32) as u8 } else { val }
        }
        ARP_ZIG_UP_DOWN | ARP_ZIG_DOWN_UP => {
            // Zigzag up then zigzag down, skip shared endpoints
            // Cycle = 4*(N-1) - 2  (or 2*(N-1) when N<=2)
            let half = 2 * (cc - 1);
            let cycle_len = if cc > 2 { 4 * (cc - 1) - 2 } else { half };
            let pos = ((effective_raw % cycle_len) + cycle_len) % cycle_len;
            let val = if pos < half {
                zig_up_value(pos, cc)
            } else {
                let q = pos - half + 1;
                (cc - 1 - zig_up_value(q, cc) as i32) as u8
            };
            if style == ARP_ZIG_DOWN_UP { (cc - 1) as u8 - val } else { val }
        }
        ARP_RANDOM => {
            // Shuffle-bag: each epoch of N notes is a full permutation.
            // Deterministic per epoch via hash-seeded Fisher-Yates.
            let epoch = if effective_raw >= 0 {
                effective_raw / cc
            } else {
                (effective_raw - cc + 1) / cc
            };
            let pos = ((effective_raw % cc) + cc) % cc;

            let mut perm = [0u8; 8];
            for i in 0..cc as usize { perm[i] = i as u8; }

            // Hash epoch + global seed, then Fisher-Yates
            let seed = unsafe { ARP_RANDOM_SEED };
            let mut h = (epoch as u32).wrapping_mul(2654435761).wrapping_add(seed.wrapping_mul(374761393));
            for i in (1..cc as usize).rev() {
                h ^= h >> 15;
                h = h.wrapping_mul(2246822519);
                h ^= h >> 13;
                let j = (h as usize) % (i + 1);
                perm.swap(i, j);
            }

            perm[pos as usize]
        }
        _ => 255,
    }
}

/// Zigzag ascending value: pairs (back-one, forward-one) climbing up
/// 0,1,0,2,1,3,2,4,...  pos must be non-negative.
fn zig_up_value(pos: i32, cc: i32) -> u8 {
    let pair = pos / 2;
    if pos % 2 == 0 {
        (pair - 1).max(0) as u8
    } else {
        (pair + 1).min(cc - 1) as u8
    }
}

/// Returns the natural cycle length for an arp style.
pub fn get_arp_cycle_length(style: u8, chord_count: u8) -> u16 {
    if chord_count <= 1 { return 1; }
    let cc = chord_count as u16;
    match style {
        ARP_CHORD => 1,
        ARP_UP | ARP_DOWN | ARP_CHORD_UP | ARP_CHORD_DOWN => cc,
        ARP_UP_DOWN | ARP_DOWN_UP | ARP_CHORD_UP_DOWN | ARP_CHORD_DOWN_UP => 2 * (cc - 1),
        ARP_E1M1 => 3 * (cc - 1) + 4,
        ARP_ZIG_UP | ARP_ZIG_DOWN => 2 * (cc - 1),
        ARP_ZIG_UP_DOWN | ARP_ZIG_DOWN_UP => if cc > 2 { 4 * (cc - 1) - 2 } else { 2 * (cc - 1) },
        ARP_RANDOM => cc,
        _ => cc,
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
            crate::platform::platform_note_off(ch, n.midi_note as u8);
            n.active = false;
        });
}

fn prune_active_notes(s: &mut EngineState, ch: u8, channel_tick: i32) {
    s.active_notes.iter_mut()
        .filter(|n| n.active && n.channel == ch && channel_tick > n.end)
        .for_each(|n| {
            crate::platform::platform_note_off(ch, n.midi_note as u8);
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
            crate::platform::platform_note_off(ch, n.midi_note as u8);
            n.active = false;
            if free_slot.is_none() { free_slot = Some(i); }
        }
        if !n.active && free_slot.is_none() {
            free_slot = Some(i);
        }
    });

    // If no free slot, evict the oldest active note to prevent stuck notes
    let slot = free_slot.unwrap_or_else(|| {
        let oldest = s.active_notes.iter().enumerate()
            .filter(|(_, n)| n.active)
            .min_by_key(|(_, n)| n.start)
            .map(|(i, _)| i)
            .unwrap_or(0);
        let old = &s.active_notes[oldest];
        crate::platform::platform_note_off(old.channel, old.midi_note as u8);
        oldest
    });

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
                crate::platform::platform_preview_value(sm as u8, ch, ev.event_index, ev_tick, val);
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
            crate::platform::platform_note_off(n.channel, n.midi_note as u8);
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
                        crate::platform::platform_step_trigger(
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
            crate::platform::platform_clear_queued_pattern(ch);
        });
        crate::platform::platform_set_current_patterns(&s.current_patterns);

        switch_channels.iter().for_each(|&(ch, _)| {
            compute_preview_for_channel(s, ch);
            s.rendered_dirty[ch as usize] = 1;
        });
    }

    s.current_tick = next_tick;
    crate::platform::platform_set_current_tick(next_tick);
}

// ============ Scrub ============

const SCRUB_NOTE_LENGTH: i32 = 1;

pub fn engine_core_scrub_to_tick(s: &mut EngineState, target_tick: i32) {
    // Kill all active notes
    s.active_notes.iter_mut()
        .filter(|n| n.active)
        .for_each(|n| {
            crate::platform::platform_note_off(n.channel, n.midi_note as u8);
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
                    crate::platform::platform_step_trigger(
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
    crate::platform::platform_set_current_tick(target_tick);
    s.last_scrub_tick = target_tick;
}

pub fn engine_core_scrub_end(s: &mut EngineState) {
    s.last_scrub_tick = -1;
    s.active_notes.iter_mut()
        .filter(|n| n.active)
        .for_each(|n| {
            crate::platform::platform_note_off(n.channel, n.midi_note as u8);
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
