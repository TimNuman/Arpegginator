// patch.rs — shared sound-parameter definitions.
//
// Single source of truth for the patch protocol between the sequencer engine
// (which owns patch state and renders the Sound-mode UI) and the synth DSP
// (which consumes it). Both sides speak (channel, param id, i16 value); the
// mapping helpers below turn UI values into DSP units and are used by the
// engine only for OLED display, so screen and sound can never disagree.
//
// Values are 0..PARAM_MAX[param]. Continuous params use 0..100; enumerated
// params (engine type, waveforms) use small ranges; toggles are 0/1.

pub const P_ENGINE: usize = 0;
pub const P_WAVE1: usize = 1;
pub const P_WAVE2: usize = 2;
pub const P_SUB_LEVEL: usize = 3;
pub const P_SUB_ON: usize = 4;
pub const P_VOLUME: usize = 5;
pub const P_OSC_MIX: usize = 6; // 0 = osc1 only, 100 = osc2 only
pub const P_DETUNE: usize = 7; // osc2 detune in cents
pub const P_GLIDE: usize = 8;
pub const P_ATTACK: usize = 9;
pub const P_DECAY: usize = 10;
pub const P_SUSTAIN: usize = 11;
pub const P_RELEASE: usize = 12;
pub const P_CUTOFF: usize = 13;
pub const P_RESO: usize = 14;
pub const P_FENV: usize = 15; // how much the amp envelope opens the filter
pub const P_KEYTRACK: usize = 16;
pub const P_DRIVE: usize = 17;
pub const NUM_PARAMS: usize = 18;

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
    1,   // SUB_ON
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
    30,       // sub level (audible the moment it's switched on)
    0,        // sub off
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
