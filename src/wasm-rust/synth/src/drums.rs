// drums.rs — synthesized drum kits for the drum channels. Two engines,
// selectable per channel (DP_KIT):
//
// ANALOG — a modeled TR-808, in the spirit of Tiptop Audio's 808 module
// line (BD808, SD808, RS808, CP808, MA808, CB808, HH808, CY808 and the
// tom/conga voices): each instrument is a small circuit model with the
// module's front-panel controls exposed as parameters.
//   BD  bridged-T resonator: swept sine with a tone-filtered click transient
//   SD  two detuned body sines (~176/330Hz) + snappy highpassed noise
//   LT/MT/HT swept sines with a noise skin-hit component; congas are the
//       same voices pitched up with the noise switched out, as on the 808
//   RS  two damped metallic partials + click; CL (claves) shares the page,
//       like the original's switchable RS/CL channel
//   CP  bandpassed noise through the classic 3-burst-then-tail envelope
//   MA  short highpassed noise chiff
//   CB  the two famous square oscillators (540/800Hz) through a bandpass
//   CY  6-square Schmitt bank + noise wash, tone blends body vs sizzle
//   HH  the same bank an octave up, highpassed; CH and OH share one voice so
//       a closed hat chokes a ringing open hat, as on the hardware
//
// FM — a 2-operator phase-modulation kit in the YM-chip / Machinedrum-EFM
// spirit, sharing the analog kit's voice map (and choke behavior) but with
// each instrument's FM knob driving a modulator with its own fast decay:
//   BD  ratio-1 modulator on the swept carrier — growl and click in one knob
//   SD  inharmonic ×2.43 modulator body + the same snappy noise
//   TOM ×1.87 modulator, no noise — the FM supplies the skin
//   RS/CL high-ratio metallic ring; CY/HH a two-stage modulator stack
//       (m2→m1→carrier at ×5.42/×3.52) for the classic DX metal
//   CP  the burst envelope with the noise ring-modulated toward metal
//   MA  high-ratio chiff blended with noise
//   CB  both 540/800Hz carriers driven by one shared modulator
//
// Both kits play for any GM note whose sampler slot is empty — a loaded
// sample replaces the voice note-by-note. Everything is f32, block-based,
// and allocation-free like the rest of the crate, so the same code runs in
// the AudioWorklet and on the Teensy.

use crate::patch::map_log;

// ============ Parameters (per drum channel, UI units 0..100) ============

// BD808 — bass drum
pub const DP_BD_TUNE: usize = 0;
pub const DP_BD_TONE: usize = 1;
pub const DP_BD_DECAY: usize = 2;
pub const DP_BD_LEVEL: usize = 3;
// SD808 — snare
pub const DP_SD_TUNE: usize = 4;
pub const DP_SD_TONE: usize = 5;
pub const DP_SD_SNAP: usize = 6;
pub const DP_SD_LEVEL: usize = 7;
// Toms / congas (LT, MT, HT share the controls, like the module trio)
pub const DP_TOM_TUNE: usize = 8;
pub const DP_TOM_DECAY: usize = 9;
pub const DP_TOM_LEVEL: usize = 10;
// RS808 — rimshot / claves
pub const DP_RS_TUNE: usize = 11;
pub const DP_RS_DECAY: usize = 12;
pub const DP_RS_LEVEL: usize = 13;
// CP808 — handclap
pub const DP_CP_TONE: usize = 14;
pub const DP_CP_DECAY: usize = 15;
pub const DP_CP_LEVEL: usize = 16;
// MA808 — maracas / shakers
pub const DP_MA_TONE: usize = 17;
pub const DP_MA_DECAY: usize = 18;
pub const DP_MA_LEVEL: usize = 19;
// CB808 — cowbell
pub const DP_CB_TUNE: usize = 20;
pub const DP_CB_DECAY: usize = 21;
pub const DP_CB_LEVEL: usize = 22;
// CY808 — cymbal
pub const DP_CY_TUNE: usize = 23;
pub const DP_CY_TONE: usize = 24;
pub const DP_CY_DECAY: usize = 25;
pub const DP_CY_LEVEL: usize = 26;
// HH808 — hi-hats (closed and open decays, shared tune/level)
pub const DP_HH_TUNE: usize = 27;
pub const DP_HH_CH_DEC: usize = 28;
pub const DP_HH_OH_DEC: usize = 29;
pub const DP_HH_LEVEL: usize = 30;

/// Kit engine selector: 0 = analog 808, 1 = FM. Each kit keeps its own
/// param bank, so switching back and forth never loses knob settings.
pub const DP_KIT: usize = 31;
pub const KIT_ANALOG: i16 = 0;
pub const KIT_FM: i16 = 1;
pub const NUM_KITS: usize = 2;

// ============ FM kit bank (ids 32+) ============

pub const DPF_BD_TUNE: usize = 32;
pub const DPF_BD_FM: usize = 33;
pub const DPF_BD_DECAY: usize = 34;
pub const DPF_BD_LEVEL: usize = 35;
pub const DPF_SD_TUNE: usize = 36;
pub const DPF_SD_FM: usize = 37;
pub const DPF_SD_SNAP: usize = 38;
pub const DPF_SD_LEVEL: usize = 39;
pub const DPF_TOM_TUNE: usize = 40;
pub const DPF_TOM_FM: usize = 41;
pub const DPF_TOM_DECAY: usize = 42;
pub const DPF_TOM_LEVEL: usize = 43;
pub const DPF_RS_TUNE: usize = 44;
pub const DPF_RS_FM: usize = 45;
pub const DPF_RS_DECAY: usize = 46;
pub const DPF_RS_LEVEL: usize = 47;
pub const DPF_CP_FM: usize = 48;
pub const DPF_CP_DECAY: usize = 49;
pub const DPF_CP_LEVEL: usize = 50;
pub const DPF_MA_TONE: usize = 51;
pub const DPF_MA_DECAY: usize = 52;
pub const DPF_MA_LEVEL: usize = 53;
pub const DPF_CB_TUNE: usize = 54;
pub const DPF_CB_FM: usize = 55;
pub const DPF_CB_DECAY: usize = 56;
pub const DPF_CB_LEVEL: usize = 57;
pub const DPF_CY_TUNE: usize = 58;
pub const DPF_CY_FM: usize = 59;
pub const DPF_CY_DECAY: usize = 60;
pub const DPF_CY_LEVEL: usize = 61;
pub const DPF_HH_FM: usize = 62;
pub const DPF_HH_CH_DEC: usize = 63;
pub const DPF_HH_OH_DEC: usize = 64;
pub const DPF_HH_LEVEL: usize = 65;

/// Kit-wide wavefolder amount, shared by both kit engines: every voice on
/// the channel runs through the triangle folder (patch::wave_fold)
/// individually, so each hit folds against its own envelope — loud attacks
/// bloom, decayed tails pass clean.
pub const DP_FOLD: usize = 66;
pub const NUM_DRUM_PARAMS: usize = 67;

/// One drum channel's kit settings (both banks + the kit selector).
pub type DrumPatch = [i16; NUM_DRUM_PARAMS];

/// Inclusive maximum per drum param (minimum is always 0).
pub fn drum_param_max(param: usize) -> i16 {
    if param == DP_KIT { (NUM_KITS - 1) as i16 } else { 100 }
}

/// Defaults tuned to the classic 808 sound (knobs around noon) and an FM
/// bank voiced to sit at comparable loudness.
pub const DRUM_PARAM_DEFAULTS: DrumPatch = [
    50, 35, 55, 90, // BD  tune/tone/decay/level
    50, 50, 60, 80, // SD  tune/tone/snap/level
    50, 50, 80, //     TOM tune/decay/level
    50, 40, 75, //     RS  tune/decay/level
    50, 45, 80, //     CP  tone/decay/level
    55, 40, 65, //     MA  tone/decay/level
    50, 40, 70, //     CB  tune/decay/level
    50, 55, 60, 65, // CY  tune/tone/decay/level
    50, 35, 55, 70, // HH  tune/ch dec/oh dec/level
    KIT_ANALOG, //     kit engine
    50, 45, 55, 90, // FM BD  tune/fm/decay/level
    50, 40, 60, 80, // FM SD  tune/fm/snap/level
    50, 45, 50, 80, // FM TOM tune/fm/decay/level
    50, 50, 40, 75, // FM RS  tune/fm/decay/level
    45, 45, 80, //     FM CP  fm/decay/level
    55, 40, 65, //     FM MA  tone/decay/level
    50, 55, 40, 70, // FM CB  tune/fm/decay/level
    50, 60, 60, 65, // FM CY  tune/fm/decay/level
    55, 35, 55, 70, // FM HH  fm/ch dec/oh dec/level
    0, //              kit fold off
];

pub fn clamp_drum_param(param: usize, value: i16) -> i16 {
    value.clamp(0, drum_param_max(param.min(NUM_DRUM_PARAMS - 1)))
}

// ============ UI value → DSP unit mappings (shared with the OLED) ============

/// BD fundamental in Hz: 36..72 (log), 50 ≈ 51Hz.
pub fn bd_freq_hz(v: i16) -> f32 {
    36.0 * libm::exp2f(v as f32 / 100.0)
}

/// BD decay in seconds: 60ms .. 1.5s (log).
pub fn bd_decay_s(v: i16) -> f32 {
    map_log(v, 0.06, 25.0)
}

/// Wide tune ratio (BD/SD/TOM/RS/CB): ±10 semitones around center.
pub fn tune_ratio(v: i16) -> f32 {
    libm::exp2f((v as f32 - 50.0) / 60.0)
}

/// Narrow tune ratio (metallic HH/CY banks): ±6 semitones around center.
pub fn tune_ratio_narrow(v: i16) -> f32 {
    libm::exp2f((v as f32 - 50.0) / 100.0)
}

// ============ Instruments ============

pub const INST_BD: u8 = 0;
pub const INST_SD: u8 = 1;
pub const INST_LT: u8 = 2;
pub const INST_MT: u8 = 3;
pub const INST_HT: u8 = 4;
pub const INST_RS: u8 = 5;
pub const INST_CL: u8 = 6;
pub const INST_CP: u8 = 7;
pub const INST_MA: u8 = 8;
pub const INST_CB: u8 = 9;
pub const INST_CY: u8 = 10;
pub const INST_HH: u8 = 11;
pub const NUM_INSTRUMENTS: usize = 12;

/// The 808's metallic six-oscillator bank (Hz). Hats run it an octave up,
/// the cymbal a fifth up.
const METAL_FREQS: [f32; 6] = [263.0, 400.0, 421.0, 474.0, 587.0, 845.0];

/// GM drum note → (instrument, variant, pitch ratio). Variant selects a
/// sub-flavor of the voice (open/closed hat, crash/ride, tom vs conga...);
/// pitch spreads note pairs that share a voice.
pub fn note_to_inst(note: u8) -> (u8, u8, f32) {
    match note {
        35 | 36 => (INST_BD, 0, 1.0),
        38 | 40 => (INST_SD, 0, 1.0),
        37 => (INST_RS, 0, 1.0),
        39 => (INST_CP, 0, 1.0),
        41 => (INST_LT, 0, 1.0),
        43 => (INST_LT, 0, 1.12),
        45 => (INST_MT, 0, 1.0),
        47 => (INST_MT, 0, 1.12),
        48 => (INST_HT, 0, 1.0),
        50 => (INST_HT, 0, 1.12),
        // Congas: the tom voices pitched up with the noise skin switched out
        64 => (INST_LT, 1, 1.6),
        63 => (INST_MT, 1, 1.6),
        62 => (INST_HT, 1, 1.5),
        42 => (INST_HH, 0, 1.0), // closed
        44 => (INST_HH, 1, 1.0), // pedal
        46 => (INST_HH, 2, 1.0), // open
        49 => (INST_CY, 0, 1.0),  // crash
        57 => (INST_CY, 0, 1.15),
        51 => (INST_CY, 1, 1.0), // ride
        59 => (INST_CY, 1, 1.1),
        53 => (INST_CY, 1, 1.3), // ride bell
        52 => (INST_CY, 2, 1.0), // china / splash
        55 => (INST_CY, 2, 1.2),
        56 => (INST_CB, 0, 1.0),
        54 => (INST_MA, 1, 1.0), // tambourine: jangly variant
        75 => (INST_CL, 0, 1.0),
        76 => (INST_CL, 0, 0.85),
        77 => (INST_CL, 0, 0.75),
        // Everything else (cabasa, shakers, unmapped percussion): a chiff
        _ => (INST_MA, 0, 1.0),
    }
}

/// The GM note the UI auditions an instrument's page with.
pub fn inst_preview_note(inst: u8) -> u8 {
    match inst {
        INST_BD => 36,
        INST_SD => 38,
        INST_LT => 41,
        INST_MT => 45,
        INST_HT => 48,
        INST_RS => 37,
        INST_CL => 75,
        INST_CP => 39,
        INST_MA => 70,
        INST_CB => 56,
        INST_CY => 49,
        _ => 42,
    }
}

// ============ Voice ============

const ENV_FLOOR: f32 = 1.0e-4;

/// Per-sample decay coefficient for an exponential envelope with time
/// constant `tau` seconds (level multiplied by this every sample).
#[inline]
fn decay_coef(tau: f32, sample_rate: f32) -> f32 {
    libm::expf(-1.0 / (tau.max(1.0e-3) * sample_rate))
}

/// Naive square from a normalized phase — always heard through the metallic
/// voices' bandpass/highpass stages, where the aliasing residue reads as
/// circuit grit rather than digital fizz.
#[inline]
fn square(phase: f32) -> f32 {
    if phase < 0.5 { 1.0 } else { -1.0 }
}

#[derive(Clone, Copy)]
pub struct DrumVoice {
    active: bool,
    channel: u8,
    inst: u8,
    variant: u8,
    /// Kit engine at trigger time — a ringing voice keeps its engine even if
    /// the channel's kit is switched under it
    fm: bool,
    /// Note-derived frequency spread within a shared voice
    pitch: f32,
    age: u32,
    vel: f32,
    /// Seconds since trigger
    t: f32,
    phases: [f32; 6],
    /// Pitch-sweep / click envelope (1 → 0, fast)
    penv: f32,
    /// Main amplitude envelope (1 → 0)
    env: f32,
    /// Secondary envelope (noise snap, clap tail, sizzle)
    env2: f32,
    /// Clap burst scheduler: time of the next retrigger
    next_burst: f32,
    lp1: f32,
    lp2: f32,
    lp3: f32,
    noise: u32,
    killed: bool,
}

impl DrumVoice {
    pub const fn new() -> Self {
        DrumVoice {
            active: false,
            channel: 0,
            inst: 0,
            variant: 0,
            fm: false,
            pitch: 1.0,
            age: 0,
            vel: 0.0,
            t: 0.0,
            phases: [0.0; 6],
            penv: 0.0,
            env: 0.0,
            env2: 0.0,
            next_burst: 0.0,
            lp1: 0.0,
            lp2: 0.0,
            lp3: 0.0,
            noise: 0,
            killed: false,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn start(&mut self, channel: u8, inst: u8, variant: u8, fm: bool, pitch: f32, vel: f32, age: u32) {
        self.active = true;
        self.channel = channel;
        self.inst = inst;
        self.variant = variant;
        self.fm = fm;
        self.pitch = pitch;
        self.age = age;
        self.vel = vel;
        self.t = 0.0;
        self.phases = [0.0; 6];
        self.penv = 1.0;
        self.env = 1.0;
        self.env2 = 1.0;
        self.next_burst = 0.011;
        self.lp1 = 0.0;
        self.lp2 = 0.0;
        self.lp3 = 0.0;
        self.noise = 0x9e3779b9 ^ ((inst as u32 + 1).wrapping_mul(2654435761)).wrapping_add(age);
        self.killed = false;
    }

    /// Render additively into `out`, reading the channel's kit params live so
    /// edits are audible on ringing hits. Frees itself once decayed.
    #[allow(clippy::too_many_lines)]
    fn render(&mut self, out: &mut [f32], p: &DrumPatch, sample_rate: f32) {
        if self.fm {
            self.render_fm(out, p, sample_rate);
        } else {
            self.render_analog(out, p, sample_rate);
        }
        // Bursting clap keeps env high by design; everything is done once the
        // envelopes are gone and the burst phase is over
        if self.env < ENV_FLOOR && self.env2 < ENV_FLOOR && self.t > 0.04 {
            self.active = false;
        }
    }

    #[allow(clippy::too_many_lines)]
    fn render_analog(&mut self, out: &mut [f32], p: &DrumPatch, sample_rate: f32) {
        let inv_sr = 1.0 / sample_rate;
        // One-pole coefficient for a cutoff in Hz
        let onepole = |hz: f32| -> f32 {
            1.0 - libm::expf(-core::f32::consts::TAU * hz.min(sample_rate * 0.45) * inv_sr)
        };
        // All-notes-off: collapse every envelope quickly but clicklessly
        let kill_coef = decay_coef(0.003, sample_rate);
        let gain = 0.25 + 0.75 * self.vel * self.vel;

        match self.inst {
            INST_BD => {
                let base = bd_freq_hz(p[DP_BD_TUNE]) * self.pitch;
                let tone = p[DP_BD_TONE] as f32 / 100.0;
                let pcoef = decay_coef(0.010, sample_rate);
                let mut acoef = decay_coef(bd_decay_s(p[DP_BD_DECAY]), sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let klp = onepole(250.0 * libm::exp2f(3.5 * tone));
                let level = p[DP_BD_LEVEL] as f32 / 100.0 * 1.5 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    self.penv *= pcoef;
                    let freq = base * (1.0 + 2.5 * self.penv);
                    self.phases[0] += freq * inv_sr;
                    if self.phases[0] >= 1.0 {
                        self.phases[0] -= 1.0;
                    }
                    let click = crate::xorshift(&mut self.noise) * self.penv * tone * 0.6;
                    let pre = crate::fast_sin(self.phases[0]) * 1.2 + click;
                    self.lp1 += klp * (pre - self.lp1);
                    self.env *= acoef;
                    *s += crate::soft_sat(self.lp1 * 1.3) * self.env * level;
                    self.t += inv_sr;
                }
            }
            INST_SD => {
                let r = tune_ratio(p[DP_SD_TUNE]) * self.pitch;
                let (f1, f2) = (176.0 * r, 330.0 * r);
                let snap = p[DP_SD_SNAP] as f32 / 100.0;
                let pcoef = decay_coef(0.005, sample_rate);
                let mut bcoef = decay_coef(0.055, sample_rate);
                let mut ncoef = decay_coef(0.030 + 0.110 * snap, sample_rate);
                if self.killed {
                    bcoef = kill_coef;
                    ncoef = kill_coef;
                }
                let khp = onepole(800.0 * libm::exp2f(3.0 * p[DP_SD_TONE] as f32 / 100.0));
                let noise_gain = 0.25 + 0.85 * snap;
                let level = p[DP_SD_LEVEL] as f32 / 100.0 * 0.9 * gain;
                for s in out.iter_mut() {
                    self.penv *= pcoef;
                    let sweep = 1.0 + 0.6 * self.penv;
                    self.phases[0] += f1 * sweep * inv_sr;
                    self.phases[1] += f2 * sweep * inv_sr;
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    let body =
                        0.6 * crate::fast_sin(self.phases[0]) + 0.4 * crate::fast_sin(self.phases[1]);
                    let n = crate::xorshift(&mut self.noise);
                    self.lp1 += khp * (n - self.lp1);
                    let hpn = n - self.lp1;
                    self.env *= bcoef;
                    self.env2 *= ncoef;
                    *s += (body * self.env + hpn * self.env2 * noise_gain) * level;
                    self.t += inv_sr;
                }
            }
            INST_LT | INST_MT | INST_HT => {
                let base = match self.inst {
                    INST_LT => 82.0,
                    INST_MT => 118.0,
                    _ => 160.0,
                };
                let conga = self.variant == 1;
                let freq_base = base * tune_ratio(p[DP_TOM_TUNE]) * self.pitch;
                let decay = p[DP_TOM_DECAY] as f32 / 100.0;
                let vscale = match self.inst {
                    INST_LT => 1.0,
                    INST_MT => 0.85,
                    _ => 0.72,
                };
                let tau = (0.09 + 0.50 * decay) * vscale * if conga { 0.55 } else { 1.0 };
                let mut acoef = decay_coef(tau, sample_rate);
                let mut ncoef = decay_coef(0.020, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                    ncoef = kill_coef;
                }
                let pcoef = decay_coef(0.018, sample_rate);
                // Skin-hit noise, bandpassed low (two staggered one-poles)
                let k_hi = onepole(1400.0);
                let k_lo = onepole(250.0);
                let noise_amt = if conga { 0.0 } else { 0.35 };
                let level = p[DP_TOM_LEVEL] as f32 / 100.0 * 1.0 * gain;
                for s in out.iter_mut() {
                    self.penv *= pcoef;
                    let freq = freq_base * (1.0 + 0.9 * self.penv);
                    self.phases[0] += freq * inv_sr;
                    if self.phases[0] >= 1.0 {
                        self.phases[0] -= 1.0;
                    }
                    let n = crate::xorshift(&mut self.noise);
                    self.lp1 += k_hi * (n - self.lp1);
                    self.lp2 += k_lo * (self.lp1 - self.lp2);
                    let skin = self.lp1 - self.lp2;
                    self.env *= acoef;
                    self.env2 *= ncoef;
                    *s += (crate::fast_sin(self.phases[0]) * self.env
                        + skin * self.env2 * noise_amt)
                        * level;
                    self.t += inv_sr;
                }
            }
            INST_RS | INST_CL => {
                let r = tune_ratio(p[DP_RS_TUNE]) * self.pitch;
                let ds = map_log(p[DP_RS_DECAY], 0.4, 6.0); // 0.4x .. 2.4x
                let claves = self.inst == INST_CL;
                let (f1, f2) = if claves { (2523.0 * r, 0.0) } else { (455.0 * r, 1735.0 * r) };
                let tau1 = if claves { 0.010 } else { 0.007 } * ds;
                let mut c1 = decay_coef(tau1, sample_rate);
                let mut c2 = decay_coef(0.005 * ds, sample_rate);
                if self.killed {
                    c1 = kill_coef;
                    c2 = kill_coef;
                }
                let pcoef = decay_coef(0.0012, sample_rate);
                let level = p[DP_RS_LEVEL] as f32 / 100.0 * 0.8 * gain;
                for s in out.iter_mut() {
                    self.phases[0] += f1 * inv_sr;
                    self.phases[1] += f2 * inv_sr;
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    self.penv *= pcoef;
                    self.env *= c1;
                    self.env2 *= c2;
                    let mut v = crate::fast_sin(self.phases[0]) * self.env;
                    if !claves {
                        v = 0.55 * v + 0.75 * crate::fast_sin(self.phases[1]) * self.env2;
                    }
                    v += crate::xorshift(&mut self.noise) * self.penv * 0.3;
                    *s += v * level;
                    self.t += inv_sr;
                }
            }
            INST_CP => {
                let center = 1050.0 * libm::exp2f((p[DP_CP_TONE] as f32 - 50.0) / 50.0);
                let k_hi = onepole(center * 1.5);
                let k_lo = onepole(center * 0.6);
                let burst_coef = decay_coef(0.004, sample_rate);
                let mut tail_coef =
                    decay_coef(0.030 + 0.250 * p[DP_CP_DECAY] as f32 / 100.0, sample_rate);
                if self.killed {
                    tail_coef = kill_coef;
                }
                let level = p[DP_CP_LEVEL] as f32 / 100.0 * 1.4 * gain;
                for s in out.iter_mut() {
                    // 3 fast retriggered bursts, then a smooth tail — the
                    // classic clap envelope
                    if self.t < 0.033 {
                        self.env *= burst_coef;
                        if self.t >= self.next_burst {
                            self.env = 1.0;
                            self.next_burst += 0.011;
                        }
                    } else {
                        self.env2 *= tail_coef;
                        self.env = 0.7 * self.env2;
                    }
                    let n = crate::xorshift(&mut self.noise);
                    self.lp1 += k_hi * (n - self.lp1);
                    self.lp2 += k_lo * (self.lp1 - self.lp2);
                    *s += (self.lp1 - self.lp2) * self.env * level;
                    self.t += inv_sr;
                }
            }
            INST_MA => {
                let khp = onepole(2500.0 * libm::exp2f(1.5 * p[DP_MA_TONE] as f32 / 100.0));
                let jangle = self.variant == 1; // tambourine
                let tau = (0.015 + 0.100 * p[DP_MA_DECAY] as f32 / 100.0)
                    * if jangle { 1.8 } else { 1.0 };
                let mut acoef = decay_coef(tau, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let level = p[DP_MA_LEVEL] as f32 / 100.0 * 0.7 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    let n = crate::xorshift(&mut self.noise);
                    self.lp1 += khp * (n - self.lp1);
                    let mut v = n - self.lp1;
                    if jangle {
                        // A little metallic shimmer under the noise
                        self.phases[0] += 4200.0 * inv_sr;
                        if self.phases[0] >= 1.0 {
                            self.phases[0] -= 1.0;
                        }
                        v = 0.8 * v + 0.2 * square(self.phases[0]);
                    }
                    self.env *= acoef;
                    *s += v * self.env * level;
                    self.t += inv_sr;
                }
            }
            INST_CB => {
                let r = tune_ratio(p[DP_CB_TUNE]) * self.pitch;
                let (f1, f2) = (540.0 * r, 800.0 * r);
                let k_hi = onepole(1900.0);
                let k_lo = onepole(600.0);
                let spike_coef = decay_coef(0.012, sample_rate);
                let mut acoef = decay_coef(
                    0.080 + 0.400 * p[DP_CB_DECAY] as f32 / 100.0,
                    sample_rate,
                );
                if self.killed {
                    acoef = kill_coef;
                }
                let level = p[DP_CB_LEVEL] as f32 / 100.0 * 0.8 * gain;
                for s in out.iter_mut() {
                    self.phases[0] += f1 * inv_sr;
                    self.phases[1] += f2 * inv_sr;
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    let raw = 0.5 * (square(self.phases[0]) + square(self.phases[1]));
                    self.lp1 += k_hi * (raw - self.lp1);
                    self.lp2 += k_lo * (self.lp1 - self.lp2);
                    self.env *= acoef;
                    self.env2 *= spike_coef;
                    *s += (self.lp1 - self.lp2) * (0.45 * self.env + 0.55 * self.env2) * level;
                    self.t += inv_sr;
                }
            }
            INST_CY => {
                let r = tune_ratio_narrow(p[DP_CY_TUNE]) * self.pitch;
                let tone = p[DP_CY_TONE] as f32 / 100.0;
                let vscale = match self.variant {
                    1 => 0.40, // ride
                    2 => 0.60, // china / splash
                    _ => 1.0,  // crash
                };
                let tau = map_log(p[DP_CY_DECAY], 0.25, 10.0) * vscale; // 0.25..2.5s
                let mut acoef = decay_coef(tau, sample_rate);
                let mut scoef = decay_coef(tau * 0.45, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                    scoef = kill_coef;
                }
                let k_body_hi = onepole(5200.0);
                let k_body_lo = onepole(2400.0);
                let k_hp = onepole(6300.0);
                let level = p[DP_CY_LEVEL] as f32 / 100.0 * 0.9 * gain;
                for s in out.iter_mut() {
                    let mut bank = 0.0;
                    for (ph, f) in self.phases.iter_mut().zip(METAL_FREQS.iter()) {
                        *ph += f * 1.5 * r * inv_sr;
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                        bank += square(*ph);
                    }
                    bank = bank * (1.0 / 6.0) + crate::xorshift(&mut self.noise) * 0.35;
                    self.lp1 += k_body_hi * (bank - self.lp1);
                    self.lp2 += k_body_lo * (self.lp1 - self.lp2);
                    let body = self.lp1 - self.lp2;
                    self.lp3 += k_hp * (bank - self.lp3);
                    let sizzle = bank - self.lp3;
                    self.env *= acoef;
                    self.env2 *= scoef;
                    *s += ((1.0 - tone) * body * self.env
                        + (0.4 + 0.6 * tone) * sizzle * self.env2)
                        * level;
                    self.t += inv_sr;
                }
            }
            _ => {
                // INST_HH — one voice for closed/pedal/open, so CH chokes OH
                let r = tune_ratio_narrow(p[DP_HH_TUNE]);
                let tau = match self.variant {
                    2 => 0.120 + 0.900 * p[DP_HH_OH_DEC] as f32 / 100.0, // open
                    1 => (0.020 + 0.130 * p[DP_HH_CH_DEC] as f32 / 100.0) * 1.8, // pedal
                    _ => 0.020 + 0.130 * p[DP_HH_CH_DEC] as f32 / 100.0, // closed
                };
                let mut acoef = decay_coef(tau, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let k_hp = onepole(6800.0);
                let k_lp = onepole(13000.0);
                let level = p[DP_HH_LEVEL] as f32 / 100.0 * 0.55 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    let mut bank = 0.0;
                    for (ph, f) in self.phases.iter_mut().zip(METAL_FREQS.iter()) {
                        *ph += f * 2.0 * r * inv_sr;
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                        bank += square(*ph);
                    }
                    bank *= 1.0 / 6.0;
                    // Highpass twice for the thin 808 sizzle, then tame the top
                    self.lp1 += k_hp * (bank - self.lp1);
                    let hp1 = bank - self.lp1;
                    self.lp2 += k_hp * (hp1 - self.lp2);
                    let hp2 = hp1 - self.lp2;
                    self.lp3 += k_lp * (hp2 - self.lp3);
                    self.env *= acoef;
                    *s += self.lp3 * self.env * level;
                    self.t += inv_sr;
                }
            }
        }

    }

    /// The FM kit: 2-op phase modulation per voice, mod envelopes tracked as
    /// block-local exponentials seeded from `t` so live edits stay exact.
    #[allow(clippy::too_many_lines)]
    fn render_fm(&mut self, out: &mut [f32], p: &DrumPatch, sample_rate: f32) {
        let inv_sr = 1.0 / sample_rate;
        let onepole = |hz: f32| -> f32 {
            1.0 - libm::expf(-core::f32::consts::TAU * hz.min(sample_rate * 0.45) * inv_sr)
        };
        let kill_coef = decay_coef(0.003, sample_rate);
        let gain = 0.25 + 0.75 * self.vel * self.vel;
        // Mod-index envelope for this block: value at t, decayed per sample
        let menv_at = |tau: f32| libm::expf(-self.t / tau.max(1.0e-3));

        match self.inst {
            INST_BD => {
                let base = bd_freq_hz(p[DPF_BD_TUNE]) * self.pitch;
                let idx = p[DPF_BD_FM] as f32 / 100.0 * 1.8;
                let pcoef = decay_coef(0.012, sample_rate);
                let mut menv = menv_at(0.045);
                let mcoef = decay_coef(0.045, sample_rate);
                let mut acoef = decay_coef(bd_decay_s(p[DPF_BD_DECAY]), sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let level = p[DPF_BD_LEVEL] as f32 / 100.0 * 1.5 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    self.penv *= pcoef;
                    menv *= mcoef;
                    let freq = base * (1.0 + 2.0 * self.penv);
                    self.phases[0] += freq * inv_sr; // carrier
                    self.phases[1] += freq * inv_sr; // ratio-1 modulator
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    let m = crate::fast_sin(self.phases[1]);
                    let v = crate::fast_sin(self.phases[0] + idx * menv * m);
                    self.env *= acoef;
                    *s += crate::soft_sat(v * 1.3) * self.env * level;
                    self.t += inv_sr;
                }
            }
            INST_SD => {
                let r = tune_ratio(p[DPF_SD_TUNE]) * self.pitch;
                let f = 175.0 * r;
                let idx = p[DPF_SD_FM] as f32 / 100.0 * 1.4;
                let snap = p[DPF_SD_SNAP] as f32 / 100.0;
                let pcoef = decay_coef(0.005, sample_rate);
                let mut menv = menv_at(0.060);
                let mcoef = decay_coef(0.060, sample_rate);
                let mut bcoef = decay_coef(0.070, sample_rate);
                let mut ncoef = decay_coef(0.030 + 0.110 * snap, sample_rate);
                if self.killed {
                    bcoef = kill_coef;
                    ncoef = kill_coef;
                }
                let khp = onepole(3000.0);
                let noise_gain = 0.25 + 0.85 * snap;
                let level = p[DPF_SD_LEVEL] as f32 / 100.0 * 0.9 * gain;
                for s in out.iter_mut() {
                    self.penv *= pcoef;
                    menv *= mcoef;
                    let sweep = 1.0 + 0.5 * self.penv;
                    self.phases[0] += f * sweep * inv_sr;
                    self.phases[1] += f * 2.43 * sweep * inv_sr; // inharmonic mod
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    let m = crate::fast_sin(self.phases[1]);
                    let body = crate::fast_sin(self.phases[0] + idx * menv * m);
                    let n = crate::xorshift(&mut self.noise);
                    self.lp1 += khp * (n - self.lp1);
                    let hpn = n - self.lp1;
                    self.env *= bcoef;
                    self.env2 *= ncoef;
                    *s += (body * self.env + hpn * self.env2 * noise_gain) * level;
                    self.t += inv_sr;
                }
            }
            INST_LT | INST_MT | INST_HT => {
                let base = match self.inst {
                    INST_LT => 82.0,
                    INST_MT => 118.0,
                    _ => 160.0,
                };
                let conga = self.variant == 1;
                let freq_base = base * tune_ratio(p[DPF_TOM_TUNE]) * self.pitch;
                let idx = p[DPF_TOM_FM] as f32 / 100.0 * 1.1;
                let decay = p[DPF_TOM_DECAY] as f32 / 100.0;
                let vscale = match self.inst {
                    INST_LT => 1.0,
                    INST_MT => 0.85,
                    _ => 0.72,
                };
                let tau = (0.09 + 0.50 * decay) * vscale * if conga { 0.55 } else { 1.0 };
                let mut acoef = decay_coef(tau, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let pcoef = decay_coef(0.018, sample_rate);
                let mut menv = menv_at(0.080);
                let mcoef = decay_coef(0.080, sample_rate);
                let level = p[DPF_TOM_LEVEL] as f32 / 100.0 * 1.0 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    self.penv *= pcoef;
                    menv *= mcoef;
                    let freq = freq_base * (1.0 + 0.9 * self.penv);
                    self.phases[0] += freq * inv_sr;
                    self.phases[1] += freq * 1.87 * inv_sr;
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    let m = crate::fast_sin(self.phases[1]);
                    let v = crate::fast_sin(self.phases[0] + idx * menv * m);
                    self.env *= acoef;
                    *s += v * self.env * level;
                    self.t += inv_sr;
                }
            }
            INST_RS | INST_CL => {
                let r = tune_ratio(p[DPF_RS_TUNE]) * self.pitch;
                let claves = self.inst == INST_CL;
                let ds = map_log(p[DPF_RS_DECAY], 0.5, 6.0); // 0.5x .. 3x
                let (fc, ratio, depth) =
                    if claves { (1800.0 * r, 2.0, 0.9) } else { (455.0 * r, 3.53, 1.8) };
                let idx = p[DPF_RS_FM] as f32 / 100.0 * depth;
                let tau = if claves { 0.012 } else { 0.008 } * ds;
                let mut acoef = decay_coef(tau, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let pcoef = decay_coef(0.0012, sample_rate);
                let mut menv = menv_at(0.030);
                let mcoef = decay_coef(0.030, sample_rate);
                let level = p[DPF_RS_LEVEL] as f32 / 100.0 * 0.8 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    self.phases[0] += fc * inv_sr;
                    self.phases[1] += fc * ratio * inv_sr;
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    self.penv *= pcoef;
                    menv *= mcoef;
                    let m = crate::fast_sin(self.phases[1]);
                    let mut v = crate::fast_sin(self.phases[0] + idx * menv * m);
                    self.env *= acoef;
                    v = v * self.env + crate::xorshift(&mut self.noise) * self.penv * 0.3;
                    *s += v * level;
                    self.t += inv_sr;
                }
            }
            INST_CP => {
                // Same 3-burst envelope; FM knob ring-modulates the noise
                // toward metal
                let fmk = p[DPF_CP_FM] as f32 / 100.0;
                let k_hi = onepole(1800.0);
                let k_lo = onepole(650.0);
                let burst_coef = decay_coef(0.004, sample_rate);
                let mut tail_coef =
                    decay_coef(0.030 + 0.250 * p[DPF_CP_DECAY] as f32 / 100.0, sample_rate);
                if self.killed {
                    tail_coef = kill_coef;
                }
                let level = p[DPF_CP_LEVEL] as f32 / 100.0 * 1.4 * gain;
                for s in out.iter_mut() {
                    if self.t < 0.033 {
                        self.env *= burst_coef;
                        if self.t >= self.next_burst {
                            self.env = 1.0;
                            self.next_burst += 0.011;
                        }
                    } else {
                        self.env2 *= tail_coef;
                        self.env = 0.7 * self.env2;
                    }
                    self.phases[0] += 940.0 * inv_sr;
                    if self.phases[0] >= 1.0 {
                        self.phases[0] -= 1.0;
                    }
                    let n = crate::xorshift(&mut self.noise);
                    let ring = n * crate::fast_sin(self.phases[0]) * 1.8;
                    let src = n * (1.0 - fmk) + ring * fmk;
                    self.lp1 += k_hi * (src - self.lp1);
                    self.lp2 += k_lo * (self.lp1 - self.lp2);
                    *s += (self.lp1 - self.lp2) * self.env * level;
                    self.t += inv_sr;
                }
            }
            INST_MA => {
                // High-ratio FM chiff blended with the noise
                let fc = 4000.0 * libm::exp2f(1.5 * p[DPF_MA_TONE] as f32 / 100.0 - 0.75);
                let khp = onepole(fc * 0.9);
                let tau = (0.015 + 0.100 * p[DPF_MA_DECAY] as f32 / 100.0)
                    * if self.variant == 1 { 1.8 } else { 1.0 };
                let mut acoef = decay_coef(tau, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let level = p[DPF_MA_LEVEL] as f32 / 100.0 * 0.7 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    self.phases[0] += fc * inv_sr;
                    self.phases[1] += fc * 1.41 * inv_sr;
                    for ph in self.phases.iter_mut().take(2) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    let chiff =
                        crate::fast_sin(self.phases[0] + 0.9 * crate::fast_sin(self.phases[1]));
                    let n = crate::xorshift(&mut self.noise);
                    self.lp1 += khp * (n - self.lp1);
                    let v = 0.5 * (n - self.lp1) + 0.5 * chiff;
                    self.env *= acoef;
                    *s += v * self.env * level;
                    self.t += inv_sr;
                }
            }
            INST_CB => {
                // Both classic carriers driven by one shared modulator
                let r = tune_ratio(p[DPF_CB_TUNE]) * self.pitch;
                let (f1, f2, fm) = (540.0 * r, 800.0 * r, 540.0 * 2.78 * r);
                let idx = p[DPF_CB_FM] as f32 / 100.0 * 1.2;
                let k_hi = onepole(1900.0);
                let k_lo = onepole(600.0);
                let spike_coef = decay_coef(0.012, sample_rate);
                let mut menv = menv_at(0.060);
                let mcoef = decay_coef(0.060, sample_rate);
                let mut acoef =
                    decay_coef(0.080 + 0.400 * p[DPF_CB_DECAY] as f32 / 100.0, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let level = p[DPF_CB_LEVEL] as f32 / 100.0 * 0.8 * gain;
                for s in out.iter_mut() {
                    self.phases[0] += f1 * inv_sr;
                    self.phases[1] += f2 * inv_sr;
                    self.phases[2] += fm * inv_sr;
                    for ph in self.phases.iter_mut().take(3) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    menv *= mcoef;
                    let m = idx * menv * crate::fast_sin(self.phases[2]);
                    let raw = 0.5
                        * (crate::fast_sin(self.phases[0] + m)
                            + crate::fast_sin(self.phases[1] + m));
                    self.lp1 += k_hi * (raw - self.lp1);
                    self.lp2 += k_lo * (self.lp1 - self.lp2);
                    self.env *= acoef;
                    self.env2 *= spike_coef;
                    *s += (self.lp1 - self.lp2) * (0.45 * self.env + 0.55 * self.env2) * level;
                    self.t += inv_sr;
                }
            }
            INST_CY => {
                // Two-stage modulator stack (m2 → m1 → carrier), DX metal
                let r = tune_ratio_narrow(p[DPF_CY_TUNE]) * self.pitch;
                let fc = 620.0 * r;
                let idx = p[DPF_CY_FM] as f32 / 100.0 * 2.2;
                let vscale = match self.variant {
                    1 => 0.40, // ride
                    2 => 0.60, // china / splash
                    _ => 1.0,  // crash
                };
                let tau = map_log(p[DPF_CY_DECAY], 0.25, 10.0) * vscale;
                let mut acoef = decay_coef(tau, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let mut menv = menv_at(tau * 0.35);
                let mcoef = decay_coef(tau * 0.35, sample_rate);
                let k_hp = onepole(3800.0);
                let level = p[DPF_CY_LEVEL] as f32 / 100.0 * 0.9 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    self.phases[0] += fc * inv_sr;
                    self.phases[1] += fc * 3.52 * inv_sr;
                    self.phases[2] += fc * 5.42 * inv_sr;
                    for ph in self.phases.iter_mut().take(3) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    menv *= mcoef;
                    let m2 = crate::fast_sin(self.phases[2]);
                    let m1 = crate::fast_sin(self.phases[1] + idx * 0.7 * m2);
                    let raw = crate::fast_sin(self.phases[0] + idx * menv * m1);
                    self.lp1 += k_hp * (raw - self.lp1);
                    let v = 0.8 * (raw - self.lp1) + 0.2 * raw;
                    self.env *= acoef;
                    *s += v * self.env * level;
                    self.t += inv_sr;
                }
            }
            _ => {
                // INST_HH — the same stack an octave up; CH still chokes OH
                let fc = 1150.0;
                let idx = p[DPF_HH_FM] as f32 / 100.0 * 2.5;
                let tau = match self.variant {
                    2 => 0.120 + 0.900 * p[DPF_HH_OH_DEC] as f32 / 100.0, // open
                    1 => (0.020 + 0.130 * p[DPF_HH_CH_DEC] as f32 / 100.0) * 1.8, // pedal
                    _ => 0.020 + 0.130 * p[DPF_HH_CH_DEC] as f32 / 100.0, // closed
                };
                let mut acoef = decay_coef(tau, sample_rate);
                if self.killed {
                    acoef = kill_coef;
                }
                let k_hp = onepole(6800.0);
                let k_lp = onepole(13000.0);
                let level = p[DPF_HH_LEVEL] as f32 / 100.0 * 0.55 * gain;
                self.env2 = 0.0; // unused here — clear so the done-check sees only env
                for s in out.iter_mut() {
                    self.phases[0] += fc * inv_sr;
                    self.phases[1] += fc * 3.52 * inv_sr;
                    self.phases[2] += fc * 5.42 * inv_sr;
                    for ph in self.phases.iter_mut().take(3) {
                        if *ph >= 1.0 {
                            *ph -= 1.0;
                        }
                    }
                    let m2 = crate::fast_sin(self.phases[2]);
                    let m1 = crate::fast_sin(self.phases[1] + idx * 0.8 * m2);
                    let raw = crate::fast_sin(self.phases[0] + idx * m1);
                    self.lp1 += k_hp * (raw - self.lp1);
                    let hp1 = raw - self.lp1;
                    self.lp2 += k_hp * (hp1 - self.lp2);
                    let hp2 = hp1 - self.lp2;
                    self.lp3 += k_lp * (hp2 - self.lp3);
                    self.env *= acoef;
                    *s += self.lp3 * self.env * level;
                    self.t += inv_sr;
                }
            }
        }
    }
}

// ============ Kit-level operations (called from Synth) ============

pub const NUM_DRUM_VOICES: usize = 12;

pub struct Drums {
    pub params: [DrumPatch; crate::NUM_SYNTH_CHANNELS],
    voices: [DrumVoice; NUM_DRUM_VOICES],
    age_counter: u32,
}

impl Drums {
    pub const fn new() -> Self {
        Drums {
            params: [DRUM_PARAM_DEFAULTS; crate::NUM_SYNTH_CHANNELS],
            voices: [DrumVoice::new(); NUM_DRUM_VOICES],
            age_counter: 0,
        }
    }

    pub fn set_param(&mut self, channel: u8, param: u8, value: i16) {
        let ch = channel as usize % crate::NUM_SYNTH_CHANNELS;
        if (param as usize) < NUM_DRUM_PARAMS {
            self.params[ch][param as usize] = clamp_drum_param(param as usize, value);
        }
    }

    pub fn get_param(&self, channel: u8, param: u8) -> i16 {
        let ch = channel as usize % crate::NUM_SYNTH_CHANNELS;
        self.params[ch][(param as usize).min(NUM_DRUM_PARAMS - 1)]
    }

    /// Trigger a hit. Each (channel, instrument) is monophonic like the
    /// hardware — a new hit retriggers the ringing voice, which also gives
    /// the CH/OH choke for free since both live on the hi-hat voice.
    pub fn trigger(&mut self, channel: u8, note: u8, velocity: u8) {
        let ch = channel % crate::NUM_SYNTH_CHANNELS as u8;
        let (inst, variant, pitch) = note_to_inst(note);
        let fm = self.params[ch as usize][DP_KIT] == KIT_FM;
        let vel = (velocity.min(127) as f32) / 127.0;
        self.age_counter = self.age_counter.wrapping_add(1);
        let age = self.age_counter;

        let idx = self
            .voices
            .iter()
            .position(|v| v.active && v.channel == ch && v.inst == inst)
            .or_else(|| self.voices.iter().position(|v| !v.active))
            .unwrap_or_else(|| {
                let mut oldest = 0;
                for i in 1..NUM_DRUM_VOICES {
                    if self.voices[i].age.wrapping_sub(self.voices[oldest].age) > u32::MAX / 2 {
                        oldest = i;
                    }
                }
                oldest
            });
        self.voices[idx].start(ch, inst, variant, fm, pitch, vel, age);
    }

    /// Number of voices still rendering — decayed hits must free their slot
    /// (regression guard: a stuck `active` flag wastes CPU forever).
    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    /// Fast-fade every ringing voice (transport stop / all-notes-off).
    pub fn all_off(&mut self) {
        for v in self.voices.iter_mut() {
            if v.active {
                v.killed = true;
            }
        }
    }

    pub fn render(&mut self, out: &mut [f32], sample_rate: f32) {
        let Drums { params, voices, .. } = self;
        let mut scratch = [0.0f32; crate::MAX_BLOCK];
        for v in voices.iter_mut() {
            if !v.active {
                continue;
            }
            let p = &params[v.channel as usize % crate::NUM_SYNTH_CHANNELS];
            let fold = p[DP_FOLD];
            if fold > 0 {
                // Fold each voice individually: render into a scratch block,
                // then push it through the shared triangle folder. Identity
                // near zero, so tails decay through the folder cleanly.
                let n = out.len().min(crate::MAX_BLOCK);
                let scratch = &mut scratch[..n];
                scratch.fill(0.0);
                v.render(scratch, p, sample_rate);
                let g = crate::patch::fold_gain(fold);
                for (o, &s) in out.iter_mut().zip(scratch.iter()) {
                    *o += crate::patch::wave_fold(s * g);
                }
            } else {
                v.render(out, p, sample_rate);
            }
        }
    }
}

impl Default for Drums {
    fn default() -> Self {
        Self::new()
    }
}
