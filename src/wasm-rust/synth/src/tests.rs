// tests.rs — host-side unit tests for the synth DSP (cargo test -p arp3-synth)

use super::*;

const SR: f32 = 44_100.0;

fn render_blocks(synth: &mut Synth, blocks: usize) -> stats::Stats {
    let mut buf = [0.0f32; MAX_BLOCK];
    let mut stats = stats::Stats::default();
    for _ in 0..blocks {
        synth.render(&mut buf);
        for &s in &buf {
            stats.observe(s);
        }
    }
    stats
}

/// Tiny helper module so tests can assert on rendered audio without pulling
/// in std-only dependencies.
mod stats {
    #[derive(Default)]
    pub struct Stats {
        pub peak: f32,
        pub sum_abs: f64,
        pub count: u64,
        pub non_finite: u64,
    }

    impl Stats {
        pub fn observe(&mut self, s: f32) {
            if !s.is_finite() {
                self.non_finite += 1;
                return;
            }
            let a = s.abs();
            if a > self.peak {
                self.peak = a;
            }
            self.sum_abs += a as f64;
            self.count += 1;
        }

        pub fn mean_abs(&self) -> f64 {
            if self.count == 0 { 0.0 } else { self.sum_abs / self.count as f64 }
        }
    }
}

#[test]
fn silent_when_idle() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    let stats = render_blocks(&mut synth, 10);
    assert_eq!(stats.peak, 0.0);
    assert_eq!(stats.non_finite, 0);
}

#[test]
fn note_on_produces_bounded_audio() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.note_on(0, 60, 100);
    let stats = render_blocks(&mut synth, 20);
    assert!(stats.mean_abs() > 0.005, "note-on should produce audio");
    assert!(stats.peak <= 1.0, "output must stay within [-1,1], peak {}", stats.peak);
    assert_eq!(stats.non_finite, 0, "output must contain no NaN/inf");
}

#[test]
fn note_off_decays_to_silence() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.note_on(0, 60, 100);
    render_blocks(&mut synth, 20);
    synth.note_off(0, 60);
    // 1 second of release — far beyond the 140ms release tau
    let stats = render_blocks(&mut synth, (SR as usize) / MAX_BLOCK);
    let tail = render_blocks(&mut synth, 5);
    assert!(tail.peak < 1e-3, "voice should decay to silence, tail peak {}", tail.peak);
    assert_eq!(stats.non_finite, 0);
}

#[test]
fn chord_and_voice_stealing_stay_bounded() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    // More notes than voices — exercises oldest-voice stealing
    for (i, note) in [48u8, 52, 55, 60, 64, 67, 72, 76, 79, 84, 88].iter().enumerate() {
        synth.note_on((i % 4) as u8, *note, 110);
        render_blocks(&mut synth, 2);
    }
    let stats = render_blocks(&mut synth, 40);
    assert!(stats.mean_abs() > 0.01);
    assert!(stats.peak <= 1.0, "soft clip must bound stacked voices, peak {}", stats.peak);
    assert_eq!(stats.non_finite, 0);
}

#[test]
fn same_note_on_two_channels_is_two_voices() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.note_on(0, 60, 100);
    synth.note_on(1, 60, 100);
    // Releasing one channel's note must leave the other sounding
    synth.note_off(0, 60);
    let mut buf = [0.0f32; MAX_BLOCK];
    for _ in 0..(SR as usize) / MAX_BLOCK {
        synth.render(&mut buf);
    }
    let sustained = render_blocks(&mut synth, 20);
    assert!(sustained.mean_abs() > 0.005, "channel 1 voice should still sustain");
}

#[test]
fn all_notes_off_silences_quickly() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    for note in [60u8, 64, 67] {
        synth.note_on(0, note, 100);
    }
    render_blocks(&mut synth, 10);
    synth.all_notes_off();
    // Steal-release tau is 4ms; 100ms is plenty
    render_blocks(&mut synth, 35);
    let tail = render_blocks(&mut synth, 5);
    assert!(tail.peak < 1e-3, "all_notes_off should fully silence, peak {}", tail.peak);
}

#[test]
fn every_waveform_produces_bounded_audio() {
    for wave in 0..patch::NUM_WAVES as i16 {
        let mut synth = Synth::new();
        synth.set_sample_rate(SR);
        synth.set_param(0, patch::P_WAVE1 as u8, wave);
        synth.set_param(0, patch::P_WAVE2 as u8, wave);
        synth.note_on(0, 60, 100);
        let stats = render_blocks(&mut synth, 30);
        assert!(stats.mean_abs() > 0.003, "wave {wave} should produce audio");
        assert!(stats.peak <= 1.0, "wave {wave} out of bounds, peak {}", stats.peak);
        assert_eq!(stats.non_finite, 0, "wave {wave} produced NaN/inf");
    }
}

#[test]
fn param_edits_change_sound_live() {
    let render_sum = |edit: Option<(usize, i16)>| {
        let mut synth = Synth::new();
        synth.set_sample_rate(SR);
        synth.note_on(0, 60, 100);
        render_blocks(&mut synth, 10);
        if let Some((param, value)) = edit {
            synth.set_param(0, param as u8, value);
        }
        // Same note keeps sounding — edits must be audible without retrigger
        render_blocks(&mut synth, 30).sum_abs
    };
    let baseline = render_sum(None);
    for (param, value) in [
        (patch::P_CUTOFF, 5),
        (patch::P_OSC_MIX, 100),
        (patch::P_SUB_LEVEL, 100),
        (patch::P_DRIVE, 100),
        (patch::P_VOLUME, 10),
    ] {
        let edited = render_sum(Some((param, value)));
        assert!(
            (edited - baseline).abs() / baseline > 0.01,
            "editing param {param} to {value} should audibly change output"
        );
    }
}

#[test]
fn params_clamp_to_range() {
    let mut synth = Synth::new();
    synth.set_param(0, patch::P_WAVE1 as u8, 99);
    assert_eq!(synth.get_param(0, patch::P_WAVE1 as u8), patch::PARAM_MAX[patch::P_WAVE1]);
    synth.set_param(0, patch::P_SUSTAIN as u8, -5);
    assert_eq!(synth.get_param(0, patch::P_SUSTAIN as u8), 0);
    // Out-of-range channel/param ids must not panic
    synth.set_param(200, 250, 50);
}

#[test]
fn glide_slides_between_notes() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.set_param(0, patch::P_GLIDE as u8, 80);
    synth.note_on(0, 48, 100);
    render_blocks(&mut synth, 10);
    synth.note_off(0, 48);
    synth.note_on(0, 72, 100);
    // Must stay bounded and finite while the pitch travels two octaves
    let stats = render_blocks(&mut synth, 60);
    assert!(stats.mean_abs() > 0.003);
    assert!(stats.peak <= 1.0);
    assert_eq!(stats.non_finite, 0);
}

#[test]
fn channels_have_independent_patches() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.set_param(1, patch::P_VOLUME as u8, 0);
    synth.note_on(0, 60, 100);
    synth.note_on(1, 60, 100);
    let stats = render_blocks(&mut synth, 20);
    // Channel 0 still sounds at default volume; channel 1 is silenced
    assert!(stats.mean_abs() > 0.005, "channel 0 must be unaffected by channel 1's patch");
    assert_eq!(synth.get_param(0, patch::P_VOLUME as u8), patch::DEFAULTS[patch::P_VOLUME]);
}

#[test]
fn presets_are_valid_and_audible() {
    assert_eq!(patch::PRESETS[0].values, patch::DEFAULTS, "slot 0 is the boot patch");
    for (i, preset) in patch::PRESETS.iter().enumerate() {
        assert!(preset.name.len() <= 13, "preset {i} name too long for OLED: {}", preset.name);
        for (param, &value) in preset.values.iter().enumerate() {
            assert!(
                (0..=patch::PARAM_MAX[param]).contains(&value),
                "preset {} param {param} value {value} out of range",
                preset.name
            );
        }
        // Every preset must actually make sound
        let mut synth = Synth::new();
        synth.set_sample_rate(SR);
        for (param, &value) in preset.values.iter().enumerate() {
            synth.set_param(0, param as u8, value);
        }
        synth.note_on(0, 60, 100);
        let stats = render_blocks(&mut synth, 40);
        assert!(stats.mean_abs() > 0.001, "preset {} is silent", preset.name);
        assert!(stats.peak <= 1.0, "preset {} clips, peak {}", preset.name, stats.peak);
        assert_eq!(stats.non_finite, 0, "preset {} produced NaN/inf", preset.name);
    }
}

#[test]
fn deterministic_output() {
    let run = || {
        let mut synth = Synth::new();
        synth.set_sample_rate(SR);
        synth.note_on(0, 57, 90);
        let mut buf = [0.0f32; MAX_BLOCK];
        let mut acc: f64 = 0.0;
        for _ in 0..50 {
            synth.render(&mut buf);
            for &s in &buf {
                acc += s as f64;
            }
        }
        acc
    };
    assert_eq!(run(), run(), "same inputs must produce identical audio");
}
