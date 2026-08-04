// sampler.rs — drum sampler: slots, granular playback, and slot params.
//
// Each sequencer channel can own a kit of 16 sample slots (only drum
// channels use them today). Sample audio lives in caller-owned memory —
// a Vec arena in the browser shim, a PSRAM arena on the Teensy — and the
// sampler stores raw (ptr, len) pairs; see the safety contract on
// `set_sample`. Everything else (slot params, voices) is fixed-size and
// allocation-free like the rest of the crate.
//
// Playback decouples time and pitch with a small granular engine: two read
// heads alternate over 30ms grains with an equal-power crossfade. SPEED
// moves the grain window through the sample without changing pitch; PITCH
// resamples inside grains without changing length. TAPE mode collapses both
// into classic varispeed (single head, no grains — bit-exact tape behavior).
// Trim handles are non-destructive and every voice runs through the same
// SVF filter + drive back end as the synth engines.

use crate::patch::PARAM_MAX;

pub const NUM_SLOTS: usize = 16;
pub const NUM_SAMPLER_VOICES: usize = 8;

/// Sample rate the DSP assumes for stored samples (takes are recorded at the
/// context rate and resampled by the host if it differs).
// ============ Slot params ============

pub const SP_TRIM_START: usize = 0; // 0..1000 (per-mille of the take)
pub const SP_TRIM_END: usize = 1; // 0..1000
pub const SP_SPEED: usize = 2; // 0..100 log x0.25..x4, 50 = x1
pub const SP_PITCH: usize = 3; // 0..48 semitones, 24 = unshifted
pub const SP_LEVEL: usize = 4; // 0..100
pub const SP_DECAY: usize = 5; // 0..100, 100 = no clamp
pub const SP_MODE: usize = 6; // 0 = one-shot, 1 = loop, 2 = gate
pub const SP_CUT: usize = 7; // 0..100 (same mapping as synth cutoff)
pub const SP_RES: usize = 8; // 0..100
pub const SP_DRIVE: usize = 9; // 0..100
pub const SP_TAPE: usize = 10; // 0/1: link speed+pitch as varispeed
pub const NUM_SLOT_PARAMS: usize = 11;

pub const MODE_ONE: i16 = 0;
pub const MODE_LOOP: i16 = 1;
pub const MODE_GATE: i16 = 2;

pub const SLOT_PARAM_MAX: [i16; NUM_SLOT_PARAMS] =
    [1000, 1000, 100, 48, 100, 100, 2, 100, 100, 100, 1];

pub const SLOT_PARAM_DEFAULTS: [i16; NUM_SLOT_PARAMS] =
    [0, 1000, 50, 24, 85, 100, MODE_ONE, 100, 10, 0, 0];

pub fn clamp_slot_param(param: usize, value: i16) -> i16 {
    value.clamp(0, SLOT_PARAM_MAX[param.min(NUM_SLOT_PARAMS - 1)])
}

/// SPEED value → playback rate: x0.25 .. x4 (log), 50 = x1.
pub fn speed_ratio(v: i16) -> f32 {
    libm::powf(2.0, (v as f32 - 50.0) / 25.0)
}

/// PITCH value → frequency ratio: ±24 semitones, 24 = unshifted.
pub fn pitch_ratio(v: i16) -> f32 {
    libm::exp2f((v as f32 - 24.0) / 12.0)
}

/// DECAY value → seconds the hit is clamped to (100 = effectively off).
pub fn decay_clamp_s(v: i16) -> f32 {
    if v >= 100 { 1.0e6 } else { 0.02 + libm::powf(v as f32 / 100.0, 2.0) * 3.98 }
}

/// GM drum note → slot index. Slot 0 sits on the acoustic bass drum (35) so
/// the default drum rows map to slots 0..15 in order; other notes cycle.
pub fn note_to_slot(note: u8) -> usize {
    ((note as i32 - 35).rem_euclid(NUM_SLOTS as i32)) as usize
}

// ============ Sample storage ============

#[derive(Clone, Copy)]
pub struct SampleRef {
    ptr: *const i16,
    len: u32,
    /// Bumped on every (re)load so playing voices from an older load stop
    /// reading rather than touching swapped memory.
    generation: u32,
}

impl SampleRef {
    const fn empty() -> Self {
        SampleRef { ptr: core::ptr::null(), len: 0, generation: 0 }
    }

    pub fn is_loaded(&self) -> bool {
        !self.ptr.is_null() && self.len > 1
    }
}

// SAFETY: the sampler is only used from the single audio thread; the raw
// pointer is data the host guarantees to keep alive (see set_sample).
unsafe impl Send for SampleRef {}
unsafe impl Sync for SampleRef {}

pub struct SlotBank {
    pub samples: [SampleRef; NUM_SLOTS],
    pub params: [[i16; NUM_SLOT_PARAMS]; NUM_SLOTS],
}

impl SlotBank {
    pub const fn new() -> Self {
        SlotBank {
            samples: [SampleRef::empty(); NUM_SLOTS],
            params: [SLOT_PARAM_DEFAULTS; NUM_SLOTS],
        }
    }
}

impl Default for SlotBank {
    fn default() -> Self {
        Self::new()
    }
}

// ============ Sampler voice ============

const GRAIN_S: f32 = 0.030;

pub struct SamplerVoice {
    active: bool,
    channel: u8,
    slot: u8,
    note: u8,
    generation: u32,
    /// Output position in the (trimmed) sample, in source samples
    pos: f32,
    /// Grain read heads: source positions + normalized phase through grain
    head_a: f32,
    head_b: f32,
    grain_phase: f32,
    vel: f32,
    age: u32,
    released: bool,
    env: f32,
    svf: crate::Svf,
}

impl SamplerVoice {
    pub const fn new() -> Self {
        SamplerVoice {
            active: false,
            channel: 0,
            slot: 0,
            note: 0,
            generation: 0,
            pos: 0.0,
            head_a: 0.0,
            head_b: 0.0,
            grain_phase: 0.0,
            vel: 0.0,
            age: 0,
            released: false,
            env: 0.0,
            svf: crate::Svf::new(),
        }
    }

    fn start(&mut self, channel: u8, slot: u8, note: u8, vel: f32, generation: u32, age: u32) {
        self.active = true;
        self.channel = channel;
        self.slot = slot;
        self.note = note;
        self.generation = generation;
        self.pos = 0.0;
        self.head_a = 0.0;
        self.head_b = 0.0;
        self.grain_phase = 0.0;
        self.vel = vel;
        self.age = age;
        self.released = false;
        self.env = 1.0;
        self.svf.reset();
    }

    /// Read the sample with linear interpolation at trimmed position `p`.
    #[inline]
    fn read(sample: &SampleRef, start: f32, end: f32, p: f32, looped: bool) -> f32 {
        let span = end - start;
        if span <= 1.0 {
            return 0.0;
        }
        let p = if looped { start + fmodf_pos(p, span) } else { start + p };
        if p >= end - 1.0 {
            return 0.0;
        }
        let i = p as usize;
        let frac = p - i as f32;
        // SAFETY: i+1 < len is guaranteed by the end-1 guard above and by
        // start/end being clamped to the sample length by the caller.
        unsafe {
            let a = *sample.ptr.add(i) as f32;
            let b = *sample.ptr.add(i + 1) as f32;
            (a + (b - a) * frac) / 32768.0
        }
    }

    /// Render additively into `out`; deactivates itself when done.
    #[allow(clippy::too_many_arguments)]
    pub fn render(&mut self, out: &mut [f32], bank: &SlotBank, sample_rate: f32) {
        let slot = self.slot as usize;
        let sample = &bank.samples[slot];
        if !sample.is_loaded() || sample.generation != self.generation {
            self.active = false;
            return;
        }
        let p = &bank.params[slot];
        let len = sample.len as f32;
        let start = (p[SP_TRIM_START] as f32 / 1000.0 * len).min(len - 2.0);
        let end = (p[SP_TRIM_END] as f32 / 1000.0 * len).clamp(start + 2.0, len);
        let span = end - start;

        let mode = p[SP_MODE];
        let looped = mode == MODE_LOOP;
        let tape = p[SP_TAPE] != 0;
        let speed = speed_ratio(p[SP_SPEED]);
        let pitch = pitch_ratio(p[SP_PITCH]);
        let gain = (0.25 + 0.65 * self.vel * self.vel) * (p[SP_LEVEL] as f32 / 100.0);

        // Decay clamp: exponential fade once the hit exceeds its budget
        // (or immediately after release in GATE mode)
        let decay_at = decay_clamp_s(p[SP_DECAY]) * sample_rate;
        let fade_coef = 1.0 - libm::expf(-1.0 / (0.008 * sample_rate));

        // Per-block filter setup from slot params
        self.svf.set_cutoff(
            crate::patch::cutoff_hz(p[SP_CUT]),
            crate::patch::reso_k(p[SP_RES]),
            sample_rate,
        );
        let drive = p[SP_DRIVE] as f32 / 100.0;

        let grain_len = GRAIN_S * sample_rate;

        for sample_out in out.iter_mut() {
            let raw = if tape {
                // Varispeed: single head, speed and pitch collapse into rate
                let s = Self::read(sample, start, end, self.pos, looped);
                self.pos += speed * pitch;
                s
            } else {
                // Granular: window advances at `speed`, heads read at `pitch`
                let a = Self::read(sample, start, end, self.head_a, looped);
                let b = Self::read(sample, start, end, self.head_b, looped);
                // Equal-power crossfade between the two heads
                let x = self.grain_phase;
                let ga = libm::sqrtf(1.0 - x);
                let gb = libm::sqrtf(x);
                self.head_a += pitch;
                self.head_b += pitch;
                self.grain_phase += 1.0 / grain_len;
                self.pos += speed;
                if self.grain_phase >= 1.0 {
                    // Head B becomes the sounding head; respawn A at the window
                    self.head_a = self.head_b;
                    self.head_b = self.pos;
                    self.grain_phase = 0.0;
                }
                a * ga + b * gb
            };

            // Envelope: full until the decay budget, or once the step lets go
            // in LOOP/GATE modes (ONE always plays out), then a fast fade
            let past_budget = self.pos > decay_at || (mode != MODE_ONE && self.released);
            if past_budget {
                self.env += fade_coef * (0.0 - self.env);
            }
            let filtered = self.svf.process(raw);
            let shaped = if drive > 0.0 {
                let sat = crate::soft_sat(filtered * (1.0 + 4.0 * drive));
                filtered * (1.0 - drive) + sat * drive
            } else {
                filtered
            };
            *sample_out += shaped * self.env * gain;

            // End of sample (non-loop modes) or faded out
            if (!looped && self.pos >= span - 1.0) || (past_budget && self.env < 1.0e-3) {
                self.active = false;
                return;
            }
        }
    }
}

/// Positive fmod for loop wrapping.
#[inline]
fn fmodf_pos(x: f32, m: f32) -> f32 {
    let r = x - libm::floorf(x / m) * m;
    if r < 0.0 { r + m } else { r }
}

// ============ Bank-level operations (called from Synth) ============

pub struct Sampler {
    pub banks: [SlotBank; crate::NUM_SYNTH_CHANNELS],
    pub voices: [SamplerVoice; NUM_SAMPLER_VOICES],
    age_counter: u32,
}

impl Sampler {
    pub const fn new() -> Self {
        Sampler {
            banks: [
                SlotBank::new(),
                SlotBank::new(),
                SlotBank::new(),
                SlotBank::new(),
                SlotBank::new(),
                SlotBank::new(),
                SlotBank::new(),
                SlotBank::new(),
            ],
            voices: [
                SamplerVoice::new(),
                SamplerVoice::new(),
                SamplerVoice::new(),
                SamplerVoice::new(),
                SamplerVoice::new(),
                SamplerVoice::new(),
                SamplerVoice::new(),
                SamplerVoice::new(),
            ],
            age_counter: 0,
        }
    }

    /// Register sample memory for a slot.
    ///
    /// # Safety
    /// `ptr` must point to `len` valid i16 samples that stay alive and
    /// unmodified until the next `set_sample` for the same slot; the caller
    /// must not free the previous buffer until after that call returns.
    pub unsafe fn set_sample(&mut self, channel: u8, slot: u8, ptr: *const i16, len: u32) {
        let ch = channel as usize % crate::NUM_SYNTH_CHANNELS;
        let slot = slot as usize % NUM_SLOTS;
        // Stop voices still reading the old buffer
        for v in self.voices.iter_mut() {
            if v.active && v.channel as usize == ch && v.slot as usize == slot {
                v.active = false;
            }
        }
        let generation = self.banks[ch].samples[slot].generation.wrapping_add(1);
        self.banks[ch].samples[slot] = SampleRef { ptr, len, generation };
    }

    pub fn set_slot_param(&mut self, channel: u8, slot: u8, param: u8, value: i16) {
        let ch = channel as usize % crate::NUM_SYNTH_CHANNELS;
        let slot = slot as usize % NUM_SLOTS;
        let param = param as usize;
        if param < NUM_SLOT_PARAMS {
            self.banks[ch].params[slot][param] = clamp_slot_param(param, value);
        }
    }

    pub fn slot_loaded(&self, channel: u8, slot: u8) -> bool {
        self.banks[channel as usize % crate::NUM_SYNTH_CHANNELS].samples
            [slot as usize % NUM_SLOTS]
            .is_loaded()
    }

    /// Trigger a drum hit: GM `note` picks the slot. Steals the oldest voice.
    pub fn trigger(&mut self, channel: u8, note: u8, velocity: u8) {
        let ch = channel as usize % crate::NUM_SYNTH_CHANNELS;
        let slot = note_to_slot(note);
        let sample = self.banks[ch].samples[slot];
        if !sample.is_loaded() {
            return;
        }
        self.age_counter = self.age_counter.wrapping_add(1);
        let age = self.age_counter;
        let vel = (velocity.min(127) as f32) / 127.0;

        // Retrigger the same slot (mono per slot: new hit chokes the old),
        // else a free voice, else steal the oldest
        let idx = self
            .voices
            .iter()
            .position(|v| v.active && v.channel as usize == ch && v.slot as usize == slot)
            .or_else(|| self.voices.iter().position(|v| !v.active))
            .unwrap_or_else(|| {
                let mut oldest = 0;
                for i in 1..NUM_SAMPLER_VOICES {
                    if self.voices[i].age.wrapping_sub(self.voices[oldest].age) > u32::MAX / 2 {
                        oldest = i;
                    }
                }
                oldest
            });
        self.voices[idx].start(ch as u8, slot as u8, note, vel, sample.generation, age);
    }

    /// Note-off matters only for GATE-mode slots.
    pub fn release(&mut self, channel: u8, note: u8) {
        let ch = channel as usize % crate::NUM_SYNTH_CHANNELS;
        let slot = note_to_slot(note);
        for v in self.voices.iter_mut() {
            if v.active && v.channel as usize == ch && v.slot as usize == slot {
                v.released = true;
            }
        }
    }

    pub fn all_off(&mut self) {
        for v in self.voices.iter_mut() {
            v.released = true;
        }
    }

    pub fn render(&mut self, out: &mut [f32], sample_rate: f32) {
        let Sampler { banks, voices, .. } = self;
        for v in voices.iter_mut() {
            if v.active {
                v.render(out, &banks[v.channel as usize % crate::NUM_SYNTH_CHANNELS], sample_rate);
            }
        }
    }
}

impl Default for Sampler {
    fn default() -> Self {
        Self::new()
    }
}

// Slot-param sanity against the shared PARAM_MAX table size (compile guard
// that the two param spaces stay distinct).
const _: () = assert!(NUM_SLOT_PARAMS < PARAM_MAX.len());
