// arp3-synth — shared polyphonic synth DSP
// Compiles for wasm32-unknown-unknown (browser AudioWorklet) and
// thumbv7em-none-eabihf (Teensy 4.1, rendering into an I2S/MQS DMA buffer).
//
// Everything is f32, block-based, and allocation-free: the whole synth is a
// fixed-size struct that renders into a caller-provided buffer. The same code
// produces the sound in the web prototype and (later) on hardware, mirroring
// how arp3-engine shares sequencer logic.
//
// Sound is controlled by per-channel patches (see `patch`), edited live from
// the sequencer's Sound mode. The engines share a common back end (sub osc,
// state-variable lowpass with key tracking + envelope, drive, ADSR gain):
//   - Subtractive: two band-limited oscillators with selectable waveforms
//   - FM: four sine operators in the 8 classic YM2612 algorithms with
//     quantized harmonic ratios and op-1 feedback (Akemie's-Castle flavor),
//     using a fast parabolic sine for chip-appropriate cost and character
//   - Wavetable: OP-1-style lo-fi digital — a morphing 8-table bank with
//     CZ-style phase distortion and bit-crush/decimation
//   - Additive: 16 sine partials with per-harmonic levels, harmonic stretch
//     (inharmonicity) for bells/gamelan, and automatic nyquist muting
// Envelope times are read at note-on; everything else is read per block, so
// tweaks are audible on already-sounding notes.

#![no_std]

pub mod drums;
pub mod patch;
pub mod sampler;

use patch::*;

pub const MAX_VOICES: usize = 8;

/// Patches/glide state are kept for this many sequencer channels.
pub const NUM_SYNTH_CHANNELS: usize = 8;

/// Maximum frames per render() call. Matches the Web Audio render quantum;
/// the Teensy audio ISR will use the same or a smaller block size.
pub const MAX_BLOCK: usize = 128;

// ============ Envelope ============

#[derive(Clone, Copy, PartialEq)]
enum EnvStage {
    Idle,
    Attack,
    Decay,
    Release,
}

/// ADSR built from one-pole segments. Coefficients are precomputed from the
/// patch at note-on so the per-sample cost is one multiply-add.
#[derive(Clone, Copy)]
struct Adsr {
    stage: EnvStage,
    level: f32,
    attack_coef: f32,
    decay_coef: f32,
    release_coef: f32,
    sustain: f32,
}

/// Envelope level below which a releasing voice is considered finished.
const ENV_FLOOR: f32 = 1e-4;

/// One-pole coefficient for a time constant in seconds: `1 - e^(-1/(tau*sr))`.
fn onepole_coef(tau_s: f32, sample_rate: f32) -> f32 {
    1.0 - libm::expf(-1.0 / (tau_s.max(1e-4) * sample_rate))
}

impl Adsr {
    const fn new() -> Self {
        Adsr {
            stage: EnvStage::Idle,
            level: 0.0,
            attack_coef: 0.0,
            decay_coef: 0.0,
            release_coef: 0.0,
            sustain: 0.0,
        }
    }

    fn trigger(&mut self, p: &Patch, sample_rate: f32) {
        // The attack segment aims at 1.3 and switches at 1.0, so it spans
        // ~1.47 time constants; divide so the patch value means time-to-peak.
        self.attack_coef = onepole_coef(attack_s(p[P_ATTACK]) / 1.47, sample_rate);
        self.decay_coef = onepole_coef(decay_s(p[P_DECAY]) / 3.0, sample_rate);
        self.release_coef = onepole_coef(decay_s(p[P_RELEASE]) / 3.0, sample_rate);
        self.sustain = p[P_SUSTAIN] as f32 / 100.0;
        self.stage = EnvStage::Attack;
        // level carries over on retrigger so restarts don't click
    }

    fn release(&mut self) {
        if self.stage != EnvStage::Idle {
            self.stage = EnvStage::Release;
        }
    }

    /// Fast release for voice stealing — short enough to be inaudible under
    /// the new note, long enough not to click.
    fn steal(&mut self, sample_rate: f32) {
        self.release_coef = onepole_coef(0.004, sample_rate);
        self.stage = EnvStage::Release;
    }

    #[inline]
    fn next(&mut self) -> f32 {
        match self.stage {
            EnvStage::Idle => {}
            EnvStage::Attack => {
                // Aim past 1.0 so the segment actually reaches it
                self.level += self.attack_coef * (1.3 - self.level);
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = EnvStage::Decay;
                }
            }
            EnvStage::Decay => {
                self.level += self.decay_coef * (self.sustain - self.level);
            }
            EnvStage::Release => {
                self.level += self.release_coef * (0.0 - self.level);
                if self.level < ENV_FLOOR {
                    self.level = 0.0;
                    self.stage = EnvStage::Idle;
                }
            }
        }
        self.level
    }

    fn is_idle(&self) -> bool {
        self.stage == EnvStage::Idle
    }
}

// ============ Filter ============

/// Topology-preserving-transform state variable filter (Cytomic SVF), lowpass
/// output. Stable under audio-rate cutoff changes; we update the coefficients
/// once per block as the cutoff follows the envelope and live patch edits.
#[derive(Clone, Copy)]
struct Svf {
    ic1: f32,
    ic2: f32,
    a1: f32,
    a2: f32,
    a3: f32,
}

impl Svf {
    const fn new() -> Self {
        Svf { ic1: 0.0, ic2: 0.0, a1: 0.0, a2: 0.0, a3: 0.0 }
    }

    fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }

    /// Set cutoff (Hz) and damping `k` (2.0 = none, lower = more resonance).
    fn set_cutoff(&mut self, cutoff_hz: f32, k: f32, sample_rate: f32) {
        // Clamp well below Nyquist — tan() blows up at fs/2
        let fc = cutoff_hz.clamp(20.0, sample_rate * 0.45);
        let g = libm::tanf(core::f32::consts::PI * fc / sample_rate);
        self.a1 = 1.0 / (1.0 + g * (g + k));
        self.a2 = g * self.a1;
        self.a3 = g * self.a2;
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let v3 = input - self.ic2;
        let v1 = self.a1 * self.ic1 + self.a2 * v3;
        let v2 = self.ic2 + self.a2 * self.ic1 + self.a3 * v3;
        self.ic1 = 2.0 * v1 - self.ic1;
        self.ic2 = 2.0 * v2 - self.ic2;
        v2 // lowpass
    }
}

// ============ Oscillators ============

/// PolyBLEP correction for a step discontinuity. `t` is phase in [0,1),
/// `dt` is phase increment per sample.
#[inline]
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// Band-limited saw at phase `t` with increment `dt`, output in [-1,1].
#[inline]
fn blep_saw(t: f32, dt: f32) -> f32 {
    2.0 * t - 1.0 - poly_blep(t, dt)
}

/// Band-limited pulse with the given duty cycle (0.5 = square).
#[inline]
fn blep_pulse(t: f32, dt: f32, duty: f32) -> f32 {
    let mut v = if t < duty { 1.0 } else { -1.0 };
    v += poly_blep(t, dt);
    let mut t2 = t + (1.0 - duty);
    if t2 >= 1.0 {
        t2 -= 1.0;
    }
    v - poly_blep(t2, dt)
}

#[inline]
fn xorshift(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as f32 / u32::MAX as f32) * 2.0 - 1.0
}

#[inline]
fn osc_sample(wave: i16, t: f32, dt: f32, noise: &mut u32) -> f32 {
    match wave {
        WAVE_SAW => blep_saw(t, dt),
        WAVE_SQUARE => blep_pulse(t, dt, 0.5),
        WAVE_TRI => 4.0 * libm::fabsf(t - 0.5) - 1.0,
        WAVE_SINE => fast_sin(t),
        WAVE_PULSE => blep_pulse(t, dt, 0.25),
        WAVE_NOISE => xorshift(noise),
        _ => 0.0,
    }
}

/// Cheap tanh-shaped saturator (Padé approximant), input clamped to ±3.
#[inline]
fn soft_sat(x: f32) -> f32 {
    let x = x.clamp(-3.0, 3.0);
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

/// Fractional part in [0,1) for any input magnitude below 2^31. A cast
/// round-trip instead of libm::floorf, which is a software routine on
/// thumbv7em — this is per-sample-per-oscillator hot.
#[inline]
fn fract_pos(x: f32) -> f32 {
    let f = x - (x as i32) as f32;
    if f < 0.0 { f + 1.0 } else { f }
}

/// sin(2π·t) for normalized phase, via the parabola + correction trick
/// (~0.1% error). Roughly 4× cheaper than libm::sinf — with four operators
/// per voice per sample, the FM engine leans on this. The slight impurity is
/// in character for chip-style FM.
#[inline]
pub(crate) fn fast_sin(t: f32) -> f32 {
    let t = fract_pos(t); // wrap to [0,1)
    let x = if t < 0.5 { t } else { t - 1.0 }; // [-0.5,0.5)
    let y = 16.0 * x * (0.5 - libm::fabsf(x));
    0.225 * (y * libm::fabsf(y) - y) + y
}

// ============ Voice ============

#[derive(Clone, Copy)]
struct Voice {
    /// Key identity: channel * 128 + note. -1 when the slot is free.
    key: i32,
    channel: u8,
    /// Monotonic counter value at note-on, for oldest-voice stealing.
    age: u32,
    phase1: f32,
    phase2: f32,
    phase_sub: f32,
    /// Current fundamental (Hz) — approaches freq_target when gliding
    freq: f32,
    freq_target: f32,
    glide_coef: f32,
    vel: f32,
    noise_state: u32,
    /// FM operator phases (normalized 0..1)
    op_phase: [f32; 4],
    /// Op-1 output of the previous sample, for the feedback path
    fb_last: f32,
    /// Bit-crush decimation: held sample + countdown
    held: f32,
    hold_count: u8,
    /// Additive partial phases (normalized 0..1)
    add_phase: [f32; NUM_ADD_HARMONICS],
    /// DC-blocker state for the West Coast engine (asymmetric folding
    /// pushes a DC offset the lowpass would otherwise pass)
    dc: f32,
    env: Adsr,
    svf: Svf,
}

impl Voice {
    const fn new() -> Self {
        Voice {
            key: -1,
            channel: 0,
            age: 0,
            phase1: 0.0,
            phase2: 0.0,
            phase_sub: 0.0,
            freq: 0.0,
            freq_target: 0.0,
            glide_coef: 0.0,
            vel: 0.0,
            noise_state: 0,
            op_phase: [0.0; 4],
            fb_last: 0.0,
            held: 0.0,
            hold_count: 0,
            add_phase: [0.0; NUM_ADD_HARMONICS],
            dc: 0.0,
            env: Adsr::new(),
            svf: Svf::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn start(
        &mut self,
        key: i32,
        channel: u8,
        note: u8,
        vel: f32,
        age: u32,
        glide_from: f32,
        p: &Patch,
        sample_rate: f32,
    ) {
        let target = midi_to_freq(note);
        let glide = glide_s(p[P_GLIDE]);
        self.key = key;
        self.channel = channel;
        self.age = age;
        self.freq_target = target;
        if glide > 0.0 && glide_from > 0.0 {
            self.freq = glide_from;
            self.glide_coef = onepole_coef(glide / 3.0, sample_rate);
        } else {
            self.freq = target;
            self.glide_coef = 0.0;
        }
        self.vel = vel;
        self.noise_state = 0x9e3779b9 ^ (key as u32).wrapping_mul(2654435761);
        self.op_phase = [0.0; 4]; // key-on phase reset, like the YM chips
        self.fb_last = 0.0;
        self.held = 0.0;
        self.hold_count = 0;
        self.add_phase = [0.0; NUM_ADD_HARMONICS];
        self.dc = 0.0;
        self.svf.reset();
        self.env.trigger(p, sample_rate);
    }

    /// Render this voice additively into `out`, freeing the slot once the
    /// envelope has fully decayed. Reads everything but envelope times live
    /// from the patch so Sound-mode edits are audible immediately.
    fn render(
        &mut self,
        out: &mut [f32],
        p: &Patch,
        wt: &[[f32; WT_LEN + 1]; NUM_WT_TABLES],
        sample_rate: f32,
    ) {
        let inv_sr = 1.0 / sample_rate;
        let is_fm = p[P_ENGINE] == ENGINE_FM;
        let is_wt = p[P_ENGINE] == ENGINE_WAVETABLE;
        let is_add = p[P_ENGINE] == ENGINE_ADDITIVE;
        let is_west = p[P_ENGINE] == ENGINE_WEST;

        // Wavefolder settings. The West Coast engine folds inside its osc
        // branch (with symmetry + envelope bloom); every other engine gets
        // the plain folder just before the filter.
        let fold = p[P_FOLD] as f32 / 100.0;
        let fold_g = fold_gain(p[P_FOLD]);
        let wc_shape = p[P_WC_SHAPE] as f32 / 100.0;
        let wc_sym = (p[P_WC_SYM] as f32 - 50.0) / 100.0;
        let wc_env = p[P_WC_ENV] as f32 / 100.0;
        // DC blocker ~8Hz for the folded West Coast core
        let dc_k = 1.0 - libm::expf(-core::f32::consts::TAU * 8.0 * inv_sr);

        // Additive engine settings: per-partial amplitude and (stretched)
        // frequency ratio, computed per block. Partials above ~0.45·fs are
        // muted so high notes don't alias.
        let mut add_amp = [0.0f32; NUM_ADD_HARMONICS];
        let mut add_ratio = [0.0f32; NUM_ADD_HARMONICS];
        if is_add {
            let stretch_b = p[P_ADD_STRETCH] as f32 / 100.0 * 0.001;
            let nyquist_dt = 0.45;
            let base_dt = self.freq_target * inv_sr;
            let mut level_sum = 0.0;
            for k in 0..NUM_ADD_HARMONICS {
                let n = (k + 1) as f32;
                let ratio = n * (1.0 + stretch_b * n * n);
                let amp = p[P_H1 + k] as f32 / 100.0;
                if amp > 0.0 && base_dt * ratio < nyquist_dt {
                    add_amp[k] = amp;
                    add_ratio[k] = ratio;
                    level_sum += amp;
                }
            }
            // Normalize by total level so stacked partials can't clip
            if level_sum > 1.0 {
                let inv = 1.0 / level_sum;
                for a in add_amp.iter_mut() {
                    *a *= inv;
                }
            }
        }

        // Wavetable engine settings
        let wt_scan = p[P_WT_POS] as f32 / 100.0 * (NUM_WT_TABLES - 1) as f32;
        let wt_i = (wt_scan as usize).min(NUM_WT_TABLES - 2);
        let wt_frac = wt_scan - wt_i as f32;
        let warp = p[P_WT_WARP] as f32 / 100.0;
        let crush = p[P_CRUSH] as f32 / 100.0;
        // Amplitude steps from 4096 down to ~8, decimation hold 1..12 samples
        let crush_levels = libm::powf(2.0, 12.0 - 9.0 * crush);
        let inv_crush_levels = 1.0 / crush_levels; // no per-sample divide
        let crush_hold = (1.0 + crush * 11.0) as u8;
        let wave1 = p[P_WAVE1];
        let wave2 = p[P_WAVE2];
        let mix2 = p[P_OSC_MIX] as f32 / 100.0;
        let mix1 = 1.0 - mix2;
        let detune = detune_ratio(p[P_DETUNE]);
        let sub_level = p[P_SUB_LEVEL] as f32 / 100.0; // 0 = sub off
        let drive = p[P_DRIVE] as f32 / 100.0;
        let volume = p[P_VOLUME] as f32 / 100.0;
        let gain = (0.20 + 0.55 * self.vel * self.vel) * volume;

        // FM engine settings (cheap to derive even when unused)
        let algo = (p[P_ALGO] as usize).min(7);
        let routes = &ALGO_ROUTES[algo];
        let carriers = ALGO_CARRIERS[algo];
        let carrier_norm = 1.0 / carriers.count_ones().max(1) as f32;
        let ratios = [
            op_ratio(p[P_RATIO1]),
            op_ratio(p[P_RATIO2]),
            op_ratio(p[P_RATIO3]),
            op_ratio(p[P_RATIO4]),
        ];
        // Modulation index in normalized-phase units (~0.8 max ≈ deep FM)
        let fm_index = p[P_FM_AMT] as f32 / 100.0 * 0.8;
        let fb_gain = p[P_FB] as f32 / 100.0 * 0.7;
        let menv = p[P_MENV] as f32 / 100.0;

        // Cutoff: base from patch, scaled by key tracking (relative to middle
        // C) and opened by the amp envelope per the env-amount setting.
        let fenv = p[P_FENV] as f32 / 100.0;
        let keytrack = p[P_KEYTRACK] as f32 / 100.0;
        let kt_factor = libm::powf(self.freq_target / 261.63, keytrack);
        let env_factor = (1.0 - fenv) + fenv * self.env.level;
        let cutoff = cutoff_hz(p[P_CUTOFF]) * kt_factor * env_factor;
        self.svf.set_cutoff(cutoff, reso_k(p[P_RESO]), sample_rate);

        for sample in out.iter_mut() {
            if self.glide_coef > 0.0 {
                self.freq += self.glide_coef * (self.freq_target - self.freq);
            }
            let dt1 = self.freq * inv_sr;
            let dt_sub = dt1 * 0.5;

            let mut osc = if is_west {
                // Sine/triangle core (phase-aligned so the morph adds
                // instead of cancelling) into the folder; fold depth blooms
                // with the amp envelope, symmetry offsets into asymmetry
                let f = crate::fract_pos(self.phase1 + 0.75) - 0.5;
                let tri = 4.0 * (if f < 0.0 { -f } else { f }) - 1.0;
                let sine = fast_sin(self.phase1);
                let core = sine + (tri - sine) * wc_shape;
                self.phase1 += dt1;
                if self.phase1 >= 1.0 {
                    self.phase1 -= 1.0;
                }
                let bloom = (1.0 - wc_env) + wc_env * self.env.level;
                let folded =
                    wave_fold((core + wc_sym) * (1.0 + (fold_g - 1.0) * bloom));
                // Asymmetric folding leaves DC — block it (the sub osc is
                // added after and stays clean under the folded core)
                self.dc += dc_k * (folded - self.dc);
                folded - self.dc
            } else if is_add {
                let mut sum = 0.0;
                for k in 0..NUM_ADD_HARMONICS {
                    if add_amp[k] > 0.0 {
                        sum += add_amp[k] * fast_sin(self.add_phase[k]);
                        self.add_phase[k] += dt1 * add_ratio[k];
                        if self.add_phase[k] >= 1.0 {
                            self.add_phase[k] -= 1.0;
                        }
                    }
                }
                sum
            } else if is_wt {
                if self.hold_count > 0 {
                    // Decimation: hold the previous output
                    self.hold_count -= 1;
                    self.phase1 += dt1;
                    if self.phase1 >= 1.0 {
                        self.phase1 -= 1.0;
                    }
                    self.phase2 += dt1 * detune;
                    if self.phase2 >= 1.0 {
                        self.phase2 -= 1.0;
                    }
                    self.held
                } else {
                    // Two detuned reads of the morphed, phase-warped table
                    let read = |phase: f32| {
                        let tw = wt_warp(phase, warp);
                        let x = tw * WT_LEN as f32;
                        let xi = (x as usize).min(WT_LEN - 1);
                        let xf = x - xi as f32;
                        let a = wt[wt_i][xi] + (wt[wt_i][xi + 1] - wt[wt_i][xi]) * xf;
                        let b = wt[wt_i + 1][xi] + (wt[wt_i + 1][xi + 1] - wt[wt_i + 1][xi]) * xf;
                        a + (b - a) * wt_frac
                    };
                    let mut o = 0.5 * (read(self.phase1) + read(self.phase2));
                    self.phase1 += dt1;
                    if self.phase1 >= 1.0 {
                        self.phase1 -= 1.0;
                    }
                    self.phase2 += dt1 * detune;
                    if self.phase2 >= 1.0 {
                        self.phase2 -= 1.0;
                    }
                    // Bit crush: quantize amplitude, then hold via decimation
                    if crush > 0.0 {
                        o = libm::floorf(o * crush_levels) * inv_crush_levels;
                        self.hold_count = crush_hold - 1;
                    }
                    self.held = o;
                    o
                }
            } else if is_fm {
                // Modulator depth follows the envelope (squared for a faster
                // decay than the carrier — the classic FM pluck)
                let e = self.env.level;
                let index = fm_index * ((1.0 - menv) + menv * e * e);
                let mut outs = [0.0f32; 4];
                let mut carrier_sum = 0.0;
                for i in 0..4 {
                    let mut m = 0.0;
                    let route = routes[i];
                    for (j, &o) in outs.iter().enumerate().take(i) {
                        if route & (1 << j) != 0 {
                            m += o;
                        }
                    }
                    if i == 0 {
                        m += self.fb_last * fb_gain;
                    }
                    let s = fast_sin(self.op_phase[i] + index * m);
                    outs[i] = s;
                    if carriers & (1 << i) != 0 {
                        carrier_sum += s;
                    }
                    // Op 4 carries the detune for chorus on parallel algos
                    let ratio = if i == 3 { ratios[i] * detune } else { ratios[i] };
                    // High ratios at high notes can step phase by more than a
                    // whole cycle per sample, so wrap with a true modulo —
                    // a single subtraction would let the phase grow without
                    // bound and rot away f32 precision. The phase is always
                    // non-negative here, so trunc-by-cast is that modulo.
                    let p = self.op_phase[i] + dt1 * ratio;
                    self.op_phase[i] = p - (p as i32) as f32;
                }
                self.fb_last = outs[0];
                carrier_sum * carrier_norm
            } else {
                let dt2 = dt1 * detune;
                let o = mix1 * osc_sample(wave1, self.phase1, dt1, &mut self.noise_state)
                    + mix2 * osc_sample(wave2, self.phase2, dt2, &mut self.noise_state);
                self.phase1 += dt1;
                if self.phase1 >= 1.0 {
                    self.phase1 -= 1.0;
                }
                self.phase2 += dt2;
                if self.phase2 >= 1.0 {
                    self.phase2 -= 1.0;
                }
                o
            };

            if sub_level > 0.0 {
                osc += sub_level * fast_sin(self.phase_sub);
            }
            self.phase_sub += dt_sub;
            if self.phase_sub >= 1.0 {
                self.phase_sub -= 1.0;
            }

            // Shared wavefolder, pre-filter (identity at fold 0; the West
            // Coast engine already folded inside its branch)
            if fold > 0.0 && !is_west {
                osc = wave_fold(osc * fold_g);
            }

            let filtered = self.svf.process(osc);
            // Drive: crossfade toward a saturated copy so 0 is bit-exact clean
            let shaped = if drive > 0.0 {
                let sat = soft_sat(filtered * (1.0 + 4.0 * drive));
                filtered * (1.0 - drive) + sat * drive
            } else {
                filtered
            };
            *sample += shaped * self.env.next() * gain;
        }

        if self.env.is_idle() {
            self.key = -1;
        }
    }
}

fn midi_to_freq(note: u8) -> f32 {
    440.0 * libm::exp2f((note as f32 - 69.0) / 12.0)
}

/// Apply the two mod-matrix slots to a working copy of a patch: each slot
/// offsets its target param by depth × wheel value, clamped to the param's
/// range. Integer math on UI units, so the result is exactly what a fader
/// at that position would sound like. The stored patch is never touched.
fn apply_mod_slots(p: &mut Patch, wheel: i32) {
    let value = wheel.clamp(0, 100);
    if value == 0 {
        return;
    }
    for (target_param, depth_param) in
        [(P_MOD1_TARGET, P_MOD1_DEPTH), (P_MOD2_TARGET, P_MOD2_DEPTH)]
    {
        let target = p[target_param] as usize;
        if target == 0 || target > MAX_MOD_TARGET {
            continue;
        }
        let max = PARAM_MAX[target] as i32;
        // depth 0..200 → -1..+1 of the target's full range
        let offset = (p[depth_param] as i32 - 100) * max * value / (100 * 100);
        p[target] = (p[target] as i32 + offset).clamp(0, max) as i16;
    }
}

// ============ Synth ============

/// Wavetable resolution: 256 samples + 1 guard sample for interpolation.
const WT_LEN: usize = 256;

pub struct Synth {
    /// Drum sampler: slot banks + dedicated voices (drum channels)
    pub sampler: sampler::Sampler,
    /// Analog-modeled 808 kit — plays drum notes whose sampler slot is empty
    pub drums: drums::Drums,
    voices: [Voice; MAX_VOICES],
    patches: [Patch; NUM_SYNTH_CHANNELS],
    /// Last note-on frequency per channel — glide starting point.
    last_freq: [f32; NUM_SYNTH_CHANNELS],
    /// Wheel value after optional slew (P_MOD_SLEW), tracked per channel at
    /// block rate so both mod slots glide between sequenced steps together.
    mod_smoothed: [f32; NUM_SYNTH_CHANNELS],
    /// Cached wavetable bank, generated from patch::wt_base on first render.
    wt_tables: [[f32; WT_LEN + 1]; NUM_WT_TABLES],
    wt_ready: bool,
    sample_rate: f32,
    age_counter: u32,
}

impl Synth {
    pub const fn new() -> Self {
        Synth {
            sampler: sampler::Sampler::new(),
            drums: drums::Drums::new(),
            voices: [Voice::new(); MAX_VOICES],
            patches: [DEFAULTS; NUM_SYNTH_CHANNELS],
            last_freq: [0.0; NUM_SYNTH_CHANNELS],
            mod_smoothed: [0.0; NUM_SYNTH_CHANNELS],
            wt_tables: [[0.0; WT_LEN + 1]; NUM_WT_TABLES],
            wt_ready: false,
            sample_rate: 44_100.0,
            age_counter: 0,
        }
    }

    fn ensure_wavetables(&mut self) {
        if self.wt_ready {
            return;
        }
        for (table, buf) in self.wt_tables.iter_mut().enumerate() {
            for (i, slot) in buf.iter_mut().enumerate() {
                *slot = wt_base(table, (i % WT_LEN) as f32 / WT_LEN as f32);
            }
        }
        self.wt_ready = true;
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        if sample_rate > 0.0 {
            self.sample_rate = sample_rate;
        }
    }

    /// Set one patch parameter (UI units, clamped). Takes effect immediately
    /// for sounding notes, except envelope times which apply from the next
    /// note-on.
    pub fn set_param(&mut self, channel: u8, param: u8, value: i16) {
        let ch = channel as usize % NUM_SYNTH_CHANNELS;
        let param = param as usize;
        if param < NUM_PARAMS {
            self.patches[ch][param] = clamp_param(param, value);
        }
    }

    pub fn get_param(&self, channel: u8, param: u8) -> i16 {
        let ch = channel as usize % NUM_SYNTH_CHANNELS;
        self.patches[ch][(param as usize).min(NUM_PARAMS - 1)]
    }

    /// `channel`/`note` identify the voice for the matching note_off;
    /// `velocity` is MIDI 0-127.
    pub fn note_on(&mut self, channel: u8, note: u8, velocity: u8) {
        let key = channel as i32 * 128 + note as i32;
        let vel = (velocity.min(127) as f32) / 127.0;
        let ch = channel as usize % NUM_SYNTH_CHANNELS;
        // Mods apply to note-on-time reads too (envelope times, glide), so a
        // wheel targeting e.g. attack is honored from the next note. Uses the
        // slewed value so smoothed sweeps are heard mid-glide.
        let mut patch = self.patches[ch];
        apply_mod_slots(&mut patch, self.mod_smoothed[ch] as i32);
        let glide_from = self.last_freq[ch];
        self.last_freq[ch] = midi_to_freq(note);
        self.age_counter = self.age_counter.wrapping_add(1);
        let age = self.age_counter;
        let sr = self.sample_rate;

        // Retrigger: reuse the voice already playing this key
        if let Some(v) = self.voices.iter_mut().find(|v| v.key == key) {
            v.start(key, channel, note, vel, age, glide_from, &patch, sr);
            return;
        }
        // Free slot, else steal the oldest voice
        let slot = match self.voices.iter_mut().position(|v| v.key == -1) {
            Some(i) => i,
            None => {
                let mut oldest = 0;
                for i in 1..MAX_VOICES {
                    if self.voices[i].age.wrapping_sub(self.voices[oldest].age) > u32::MAX / 2 {
                        oldest = i;
                    }
                }
                oldest
            }
        };
        self.voices[slot].start(key, channel, note, vel, age, glide_from, &patch, sr);
    }

    pub fn note_off(&mut self, channel: u8, note: u8) {
        let key = channel as i32 * 128 + note as i32;
        for v in self.voices.iter_mut() {
            if v.key == key {
                v.env.release();
            }
        }
    }

    pub fn all_notes_off(&mut self) {
        for v in self.voices.iter_mut() {
            if v.key != -1 {
                v.env.steal(self.sample_rate);
            }
        }
        self.sampler.all_off();
        self.drums.all_off();
    }

    // ============ Drum API (sampler + 808 kit) ============

    /// Trigger a drum hit (GM note picks the sampler slot). A loaded sample
    /// replaces the 808 voice note-by-note; empty slots play the analog-
    /// modeled kit.
    pub fn drum_trigger(&mut self, channel: u8, note: u8, velocity: u8) {
        let slot = sampler::note_to_slot(note) as u8;
        if self.sampler.slot_loaded(channel, slot) {
            self.sampler.trigger(channel, note, velocity);
        } else {
            self.drums.trigger(channel, note, velocity);
        }
    }

    /// Set one 808 kit parameter (UI units, ids from `drums`). Audible
    /// immediately, including on already-ringing hits.
    pub fn set_drum_param(&mut self, channel: u8, param: u8, value: i16) {
        self.drums.set_param(channel, param, value);
    }

    pub fn get_drum_param(&self, channel: u8, param: u8) -> i16 {
        self.drums.get_param(channel, param)
    }

    pub fn drum_release(&mut self, channel: u8, note: u8) {
        self.sampler.release(channel, note);
    }

    /// See [`sampler::Sampler::set_sample`] for the safety contract.
    ///
    /// # Safety
    /// `ptr`/`len` must describe sample memory the caller keeps alive until
    /// the next `set_sample` call for the same slot.
    pub unsafe fn set_sample(&mut self, channel: u8, slot: u8, ptr: *const i16, len: u32) {
        unsafe { self.sampler.set_sample(channel, slot, ptr, len) };
    }

    pub fn set_slot_param(&mut self, channel: u8, slot: u8, param: u8, value: i16) {
        self.sampler.set_slot_param(channel, slot, param, value);
    }

    /// Render one mono block, overwriting `out` (at most MAX_BLOCK frames).
    pub fn render(&mut self, out: &mut [f32]) {
        self.ensure_wavetables();
        let n = out.len().min(MAX_BLOCK);
        let out = &mut out[..n];
        out.fill(0.0);
        // Advance each channel's slewed wheel value one block toward its
        // sequenced target. Slew 0 snaps (stepped, the default); otherwise a
        // one-pole glide with the block-length-corrected coefficient, so the
        // rate is identical across the browser's 128-sample and the Teensy's
        // 32-sample blocks.
        for ch in 0..NUM_SYNTH_CHANNELS {
            let target = self.patches[ch][P_MOD_VALUE] as f32;
            let tau = slew_s(self.patches[ch][P_MOD_SLEW]);
            if tau <= 0.0 {
                self.mod_smoothed[ch] = target;
            } else {
                let coef = 1.0 - libm::expf(-(n as f32) / (tau * self.sample_rate));
                self.mod_smoothed[ch] += coef * (target - self.mod_smoothed[ch]);
            }
        }
        // Split borrows so voices render against the shared table bank
        let Synth { voices, patches, wt_tables, sample_rate, mod_smoothed, .. } = self;
        for v in voices.iter_mut() {
            if v.key != -1 {
                let ch = v.channel as usize % NUM_SYNTH_CHANNELS;
                let mut patch = patches[ch];
                apply_mod_slots(&mut patch, mod_smoothed[ch] as i32);
                v.render(out, &patch, wt_tables, *sample_rate);
            }
        }
        self.sampler.render(out, self.sample_rate);
        self.drums.render(out, self.sample_rate);

        // Headroom scale + cubic soft clip so stacked chords don't crack
        for sample in out.iter_mut() {
            let x = (*sample * 0.5).clamp(-1.5, 1.5);
            *sample = x - x * x * x / 6.75; // maps ±1.5 to ±1.0 smoothly
        }
    }
}

impl Default for Synth {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests;
