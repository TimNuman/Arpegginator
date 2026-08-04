// patch.rs — shared sound-parameter definitions.
//
// Single source of truth for the patch protocol between the sequencer engine
// (which owns patch state and renders the Sound-mode UI) and the synth DSP
// (which consumes it). Both sides speak (channel, param id, i16 value); the
// mapping helpers below turn UI values into DSP units and are used by the
// engine only for OLED display, so screen and sound can never disagree.
//
// Values are 0..PARAM_MAX[param]. Continuous params use 0..100; enumerated
// params (engine type, waveforms) use small ranges.

pub const P_ENGINE: usize = 0;
pub const P_WAVE1: usize = 1;
pub const P_WAVE2: usize = 2;
pub const P_SUB_LEVEL: usize = 3; // 0 = sub osc off
pub const P_VOLUME: usize = 4;
pub const P_OSC_MIX: usize = 5; // 0 = osc1 only, 100 = osc2 only
pub const P_DETUNE: usize = 6; // osc2 detune in cents
pub const P_GLIDE: usize = 7;
pub const P_ATTACK: usize = 8;
pub const P_DECAY: usize = 9;
pub const P_SUSTAIN: usize = 10;
pub const P_RELEASE: usize = 11;
pub const P_CUTOFF: usize = 12;
pub const P_RESO: usize = 13;
pub const P_FENV: usize = 14; // how much the amp envelope opens the filter
pub const P_KEYTRACK: usize = 15;
pub const P_DRIVE: usize = 16;
pub const NUM_PARAMS: usize = 17;

// Engine types. Only subtractive exists today; the UI shows the others as
// coming-later placeholders and PARAM_MAX blocks selecting them.
pub const ENGINE_SUBTRACTIVE: i16 = 0;
pub const NUM_ENGINE_TYPES: usize = 4; // SUBTR, ADD, FM, WAVE (display)

pub const WAVE_SAW: i16 = 0;
pub const WAVE_SQUARE: i16 = 1;
pub const WAVE_TRI: i16 = 2;
pub const WAVE_SINE: i16 = 3;
pub const WAVE_PULSE: i16 = 4;
pub const WAVE_NOISE: i16 = 5;
pub const NUM_WAVES: usize = 6;

/// Inclusive maximum per param (minimum is always 0).
pub const PARAM_MAX: [i16; NUM_PARAMS] = [
    0,   // ENGINE — only subtractive selectable for now
    5,   // WAVE1
    5,   // WAVE2
    100, // SUB_LEVEL
    100, // VOLUME
    100, // OSC_MIX
    100, // DETUNE
    100, // GLIDE
    100, // ATTACK
    100, // DECAY
    100, // SUSTAIN
    100, // RELEASE
    100, // CUTOFF
    100, // RESO
    100, // FENV
    100, // KEYTRACK
    100, // DRIVE
];

/// Defaults tuned to match the original hard-coded voice: detuned saws,
/// ~3ms/350ms/55%/140ms envelope, keytracked lowpass, no sub, no drive.
pub const DEFAULTS: [i16; NUM_PARAMS] = [
    ENGINE_SUBTRACTIVE,
    WAVE_SAW, // wave 1
    WAVE_SAW, // wave 2
    0,        // sub level (0 = off)
    85,       // volume
    40,       // osc mix ~ the old 1.0 : 0.7 blend
    7,        // detune cents
    0,        // glide off
    14,       // attack ~3ms
    64,       // decay ~350ms
    55,       // sustain
    50,       // release ~140ms
    48,       // cutoff ~880Hz base
    35,       // resonance (k ~1.4)
    75,       // filter env amount
    100,      // full key tracking
    0,        // drive off
];

/// One channel's sound settings, in UI units.
pub type Patch = [i16; NUM_PARAMS];

// ============ Presets ============

/// A named factory patch. Names are uppercase and at most 13 characters so
/// they fit the OLED's value column without a marquee.
pub struct Preset {
    pub name: &'static str,
    pub values: Patch,
}

/// Shorthand: values in declaration order, engine always subtractive.
#[rustfmt::skip]
const fn preset(
    name: &'static str,
    w1: i16, w2: i16, sub: i16, vol: i16, mix: i16, det: i16, gld: i16,
    a: i16, d: i16, s: i16, r: i16,
    cut: i16, res: i16, fenv: i16, key: i16, drv: i16,
) -> Preset {
    Preset {
        name,
        values: [ENGINE_SUBTRACTIVE, w1, w2, sub, vol, mix, det, gld, a, d, s, r, cut, res, fenv, key, drv],
    }
}

/// Factory presets. Slot 0 is the boot patch (same values as `DEFAULTS`).
/// A mix of classic-analog staples and NES / SID chip flavors — the NES ones
/// lean on the pulse/triangle/noise waves with the filter wide open, the SID
/// ones on pulse + resonant filter + drive.
#[rustfmt::skip]
pub static PRESETS: [Preset; 18] = [
    //                      w1          w2          sub  vol  mix  det gld   a   d    s   r   cut  res fenv key  drv
    preset("INIT SAW",      WAVE_SAW,   WAVE_SAW,     0,  85,  40,   7,  0, 14, 64,  55, 50,  48,  35,  75, 100,  0),
    preset("FAT STACK",     WAVE_SAW,   WAVE_SAW,    35,  80,  50,  20,  0, 10, 70,  70, 55,  62,  25,  55,  90, 15),
    preset("ACID LINE",     WAVE_SAW,   WAVE_SAW,     0,  80,   0,   0, 30,  0, 45,   5, 20,  35,  85, 100,  60, 25),
    preset("RUBBER BASS",   WAVE_SQUARE,WAVE_SQUARE, 55,  85,  30,   5,  0,  5, 55,  35, 25,  30,  45,  80,  80, 10),
    preset("GLASS KEYS",    WAVE_SINE,  WAVE_TRI,     0,  90,  35,   3,  0,  8, 72,  25, 55,  62,  15,  55, 100,  0),
    preset("STARDUST",      WAVE_SAW,   WAVE_SAW,     0,  75,  50,  12,  0, 55, 70,  85, 70,  52,  10,  20,  90,  0),
    preset("HOOVERCRAFT",   WAVE_SAW,   WAVE_PULSE,  45,  75,  45,  28, 10, 12, 60,  90, 40,  65,  30,  40,  80, 35),
    preset("LASERBEAM",     WAVE_SAW,   WAVE_SQUARE, 20,  78,  30,   9, 35,  5, 55,  80, 30,  70,  50,  60,  80, 25),
    preset("DEEP SPACE",    WAVE_TRI,   WAVE_SAW,    25,  80,  45,  14,  0, 80, 75, 100, 90,  40,  20,  15,  80,  0),
    preset("8-BIT HERO",    WAVE_PULSE, WAVE_SQUARE,  0,  80,  30,   0,  0,  0, 40,  65,  8,  88,   5,   0,  40,  0),
    preset("PIPE DREAM",    WAVE_TRI,   WAVE_TRI,     0,  90,   0,   0,  5,  4, 50, 100, 12,  78,   0,   0,  60,  0),
    preset("COIN GET",      WAVE_PULSE, WAVE_PULSE,   0,  82,   0,   0,  0,  0, 28,   0, 10,  92,  10,   0,  50,  0),
    preset("TURBO ARP",     WAVE_PULSE, WAVE_PULSE,   0,  78,  50,  50,  0,  0, 35,  55, 10,  80,  20,  30,  60,  5),
    preset("BREADBIN",      WAVE_PULSE, WAVE_TRI,     0,  82,  40,   4,  0,  3, 55,  70, 25,  50,  45,  70,  80, 10),
    preset("LAST NINJA",    WAVE_SQUARE,WAVE_SAW,    25,  80,  35,   6, 15,  5, 60,  45, 30,  55,  60,  85,  70, 25),
    preset("SEWER GOBLIN",  WAVE_SAW,   WAVE_SQUARE, 70,  82,  50,   8,  0,  4, 50,  40, 25,  25,  70,  90,  70, 60),
    preset("GHOST WHISTLE", WAVE_SINE,  WAVE_SINE,    0,  88,   0,   0, 60, 30, 60, 100, 60,  70,   0,   0, 100,  0),
    preset("DIAL-UP DEMON", WAVE_NOISE, WAVE_PULSE,   0,  75,  60,   0,  0,  2, 42,  30, 20,  65,  80, 100,  40, 70),
];

pub const NUM_PRESETS: usize = PRESETS.len();

pub fn clamp_param(param: usize, value: i16) -> i16 {
    value.clamp(0, PARAM_MAX[param.min(NUM_PARAMS - 1)])
}

// ============ UI value → DSP unit mappings ============

fn map_log(v: i16, min: f32, ratio: f32) -> f32 {
    min * libm::powf(ratio, v as f32 / 100.0)
}

/// Attack time in seconds: 1ms .. 2s (log).
pub fn attack_s(v: i16) -> f32 {
    map_log(v, 0.001, 2000.0)
}

/// Decay/release time in seconds: 5ms .. 4s (log).
pub fn decay_s(v: i16) -> f32 {
    map_log(v, 0.005, 800.0)
}

/// Base filter cutoff in Hz: 80 .. 12k (log).
pub fn cutoff_hz(v: i16) -> f32 {
    map_log(v, 80.0, 150.0)
}

/// Glide time in seconds: 0 = off, else 5ms .. 400ms (log).
pub fn glide_s(v: i16) -> f32 {
    if v <= 0 { 0.0 } else { map_log(v, 0.005, 80.0) }
}

/// Osc2 detune as a frequency ratio (value = cents).
pub fn detune_ratio(v: i16) -> f32 {
    libm::exp2f(v as f32 / 1200.0)
}

/// SVF damping k: 2.0 (none) down to 0.3 (strong resonance).
pub fn reso_k(v: i16) -> f32 {
    2.0 - 1.7 * v as f32 / 100.0
}
