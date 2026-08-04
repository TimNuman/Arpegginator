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
// the sequencer's Sound mode. Signal path per voice: two band-limited oscs
// (selectable waveform) + optional sub sine -> state-variable lowpass (cutoff
// from patch, key tracking and the amp envelope) -> drive -> ADSR gain.
// Envelope times are read at note-on; everything else is read per block, so
// tweaks are audible on already-sounding notes.

#![no_std]

pub mod patch;

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
        WAVE_SINE => libm::sinf(core::f32::consts::TAU * t),
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
        self.svf.reset();
        self.env.trigger(p, sample_rate);
    }

    /// Render this voice additively into `out`, freeing the slot once the
    /// envelope has fully decayed. Reads everything but envelope times live
    /// from the patch so Sound-mode edits are audible immediately.
    fn render(&mut self, out: &mut [f32], p: &Patch, sample_rate: f32) {
        let inv_sr = 1.0 / sample_rate;
        let wave1 = p[P_WAVE1];
        let wave2 = p[P_WAVE2];
        let mix2 = p[P_OSC_MIX] as f32 / 100.0;
        let mix1 = 1.0 - mix2;
        let detune = detune_ratio(p[P_DETUNE]);
        let sub_level = if p[P_SUB_ON] != 0 { p[P_SUB_LEVEL] as f32 / 100.0 } else { 0.0 };
        let drive = p[P_DRIVE] as f32 / 100.0;
        let volume = p[P_VOLUME] as f32 / 100.0;
        let gain = (0.20 + 0.55 * self.vel * self.vel) * volume;

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
            let dt2 = dt1 * detune;
            let dt_sub = dt1 * 0.5;

            let mut osc = mix1 * osc_sample(wave1, self.phase1, dt1, &mut self.noise_state)
                + mix2 * osc_sample(wave2, self.phase2, dt2, &mut self.noise_state);
            if sub_level > 0.0 {
                osc += sub_level * libm::sinf(core::f32::consts::TAU * self.phase_sub);
            }

            self.phase1 += dt1;
            if self.phase1 >= 1.0 {
                self.phase1 -= 1.0;
            }
            self.phase2 += dt2;
            if self.phase2 >= 1.0 {
                self.phase2 -= 1.0;
            }
            self.phase_sub += dt_sub;
            if self.phase_sub >= 1.0 {
                self.phase_sub -= 1.0;
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

// ============ Synth ============

pub struct Synth {
    voices: [Voice; MAX_VOICES],
    patches: [Patch; NUM_SYNTH_CHANNELS],
    /// Last note-on frequency per channel — glide starting point.
    last_freq: [f32; NUM_SYNTH_CHANNELS],
    sample_rate: f32,
    age_counter: u32,
}

impl Synth {
    pub const fn new() -> Self {
        Synth {
            voices: [Voice::new(); MAX_VOICES],
            patches: [DEFAULTS; NUM_SYNTH_CHANNELS],
            last_freq: [0.0; NUM_SYNTH_CHANNELS],
            sample_rate: 44_100.0,
            age_counter: 0,
        }
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
        let patch = self.patches[ch];
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
    }

    /// Render one mono block, overwriting `out` (at most MAX_BLOCK frames).
    pub fn render(&mut self, out: &mut [f32]) {
        let n = out.len().min(MAX_BLOCK);
        let out = &mut out[..n];
        out.fill(0.0);
        for i in 0..MAX_VOICES {
            if self.voices[i].key != -1 {
                let patch = self.patches[self.voices[i].channel as usize % NUM_SYNTH_CHANNELS];
                self.voices[i].render(out, &patch, self.sample_rate);
            }
        }
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
