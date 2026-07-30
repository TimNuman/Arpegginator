// arp3-synth — shared polyphonic synth DSP
// Compiles for wasm32-unknown-unknown (browser AudioWorklet) and
// thumbv7em-none-eabihf (Teensy 4.1, rendering into an I2S/MQS DMA buffer).
//
// Everything is f32, block-based, and allocation-free: the whole synth is a
// fixed-size struct that renders into a caller-provided buffer. The same code
// produces the sound in the web prototype and (later) on hardware, mirroring
// how arp3-engine shares sequencer logic.
//
// Signal path per voice: two detuned polyBLEP saws -> state-variable lowpass
// (cutoff tracks note, velocity and the amp envelope) -> ADSR gain. Voices are
// summed and soft-clipped into the output block.

#![no_std]

pub const MAX_VOICES: usize = 8;

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
/// sample rate at note-on so the per-sample cost is one multiply-add.
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
    1.0 - libm::expf(-1.0 / (tau_s * sample_rate))
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

    fn trigger(&mut self, sample_rate: f32) {
        // Attack ~3ms, decay ~350ms to the sustain plateau, release ~140ms.
        self.attack_coef = onepole_coef(0.003, sample_rate);
        self.decay_coef = onepole_coef(0.35, sample_rate);
        self.release_coef = onepole_coef(0.14, sample_rate);
        self.sustain = 0.55;
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
                // Aim past 1.0 so the linear-ish segment actually reaches it
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
/// once per block as the cutoff follows the envelope.
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

    /// Set cutoff (Hz) and resonance (k = 2 - 2*res, here fixed mild res).
    fn set_cutoff(&mut self, cutoff_hz: f32, sample_rate: f32) {
        // Clamp well below Nyquist — tan() blows up at fs/2
        let fc = cutoff_hz.clamp(20.0, sample_rate * 0.45);
        let g = libm::tanf(core::f32::consts::PI * fc / sample_rate);
        let k = 1.4; // slight resonance without ringing
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

// ============ Oscillator ============

/// PolyBLEP correction for a sawtooth discontinuity. `t` is phase in [0,1),
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

// ============ Voice ============

#[derive(Clone, Copy)]
struct Voice {
    /// Key identity: channel * 128 + note. -1 when the slot is free.
    key: i32,
    /// Monotonic counter value at note-on, for oldest-voice stealing.
    age: u32,
    phase1: f32,
    phase2: f32,
    /// Phase increments per sample (freq / sample_rate)
    dt1: f32,
    dt2: f32,
    /// Filter cutoff at full envelope, Hz
    cutoff: f32,
    gain: f32,
    env: Adsr,
    svf: Svf,
}

impl Voice {
    const fn new() -> Self {
        Voice {
            key: -1,
            age: 0,
            phase1: 0.0,
            phase2: 0.0,
            dt1: 0.0,
            dt2: 0.0,
            cutoff: 0.0,
            gain: 0.0,
            env: Adsr::new(),
            svf: Svf::new(),
        }
    }

    fn start(&mut self, key: i32, note: u8, vel: f32, age: u32, sample_rate: f32) {
        let freq = midi_to_freq(note);
        self.key = key;
        self.age = age;
        self.dt1 = freq / sample_rate;
        // Second saw detuned +7 cents for width/warmth
        self.dt2 = freq * 1.00405 / sample_rate;
        // Brighter when hit harder; scales with pitch so high notes open up
        self.cutoff = freq * (2.0 + 6.0 * vel);
        self.gain = 0.20 + 0.55 * vel * vel;
        self.svf.reset();
        self.env.trigger(sample_rate);
    }

    /// Render this voice additively into `out`, freeing the slot once the
    /// envelope has fully decayed.
    fn render(&mut self, out: &mut [f32], sample_rate: f32) {
        // Cutoff follows the amp envelope (updated once per block)
        let env_now = self.env.level;
        self.svf.set_cutoff(self.cutoff * (0.25 + 0.75 * env_now), sample_rate);

        for sample in out.iter_mut() {
            let osc = blep_saw(self.phase1, self.dt1) + 0.7 * blep_saw(self.phase2, self.dt2);
            self.phase1 += self.dt1;
            if self.phase1 >= 1.0 {
                self.phase1 -= 1.0;
            }
            self.phase2 += self.dt2;
            if self.phase2 >= 1.0 {
                self.phase2 -= 1.0;
            }
            let filtered = self.svf.process(osc);
            *sample += filtered * self.env.next() * self.gain;
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
    sample_rate: f32,
    age_counter: u32,
}

impl Synth {
    pub const fn new() -> Self {
        Synth {
            voices: [Voice::new(); MAX_VOICES],
            sample_rate: 44_100.0,
            age_counter: 0,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        if sample_rate > 0.0 {
            self.sample_rate = sample_rate;
        }
    }

    /// `channel`/`note` identify the voice for the matching note_off;
    /// `velocity` is MIDI 0-127.
    pub fn note_on(&mut self, channel: u8, note: u8, velocity: u8) {
        let key = channel as i32 * 128 + note as i32;
        let vel = (velocity.min(127) as f32) / 127.0;
        self.age_counter = self.age_counter.wrapping_add(1);
        let age = self.age_counter;

        // Retrigger: reuse the voice already playing this key
        if let Some(v) = self.voices.iter_mut().find(|v| v.key == key) {
            v.start(key, note, vel, age, self.sample_rate);
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
        self.voices[slot].start(key, note, vel, age, self.sample_rate);
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
        for v in self.voices.iter_mut() {
            if v.key != -1 {
                v.render(out, self.sample_rate);
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
