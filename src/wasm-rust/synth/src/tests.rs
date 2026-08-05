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
fn fm_engine_all_algorithms_bounded_and_audible() {
    for algo in 0..8i16 {
        let mut synth = Synth::new();
        synth.set_sample_rate(SR);
        synth.set_param(0, patch::P_ENGINE as u8, patch::ENGINE_FM);
        synth.set_param(0, patch::P_ALGO as u8, algo);
        synth.set_param(0, patch::P_RATIO1 as u8, 2);
        synth.set_param(0, patch::P_FM_AMT as u8, 80);
        synth.set_param(0, patch::P_FB as u8, 60);
        synth.set_param(0, patch::P_MENV as u8, 70);
        synth.note_on(0, 60, 110);
        synth.note_on(0, 67, 90);
        let stats = render_blocks(&mut synth, 40);
        assert!(stats.mean_abs() > 0.003, "algo {algo} should produce audio");
        assert!(stats.peak <= 1.0, "algo {algo} out of bounds, peak {}", stats.peak);
        assert_eq!(stats.non_finite, 0, "algo {algo} produced NaN/inf");
    }
}

#[test]
fn fm_high_note_high_ratio_stays_stable() {
    // Top of the MIDI range with a x15 ratio steps operator phase by more
    // than a full cycle per sample — the phase must wrap with a true modulo
    // (regression: single-subtraction wrapping let phases grow unboundedly)
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.set_param(0, patch::P_ENGINE as u8, patch::ENGINE_FM);
    synth.set_param(0, patch::P_RATIO1 as u8, 15);
    synth.set_param(0, patch::P_RATIO4 as u8, 15);
    synth.set_param(0, patch::P_SUSTAIN as u8, 100);
    synth.note_on(0, 127, 110);
    // ~3 seconds — long enough that unbounded phases would visibly rot
    let stats = render_blocks(&mut synth, 1000);
    assert!(stats.peak <= 1.0, "peak {}", stats.peak);
    assert_eq!(stats.non_finite, 0);
}

#[test]
fn fm_engine_switch_mid_note_is_safe() {
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.note_on(0, 60, 100);
    render_blocks(&mut synth, 10);
    // Flip a sounding voice to FM and back — must stay bounded, no panic
    synth.set_param(0, patch::P_ENGINE as u8, patch::ENGINE_FM);
    let fm = render_blocks(&mut synth, 20);
    synth.set_param(0, patch::P_ENGINE as u8, patch::ENGINE_SUBTRACTIVE);
    let back = render_blocks(&mut synth, 20);
    assert!(fm.peak <= 1.0 && back.peak <= 1.0);
    assert_eq!(fm.non_finite + back.non_finite, 0);
}

#[test]
fn wavetable_engine_morph_warp_crush_bounded() {
    for (pos, warp, crush) in [(0, 0, 0), (50, 50, 50), (100, 100, 100), (33, 90, 80)] {
        let mut synth = Synth::new();
        synth.set_sample_rate(SR);
        synth.set_param(0, patch::P_ENGINE as u8, patch::ENGINE_WAVETABLE);
        synth.set_param(0, patch::P_WT_POS as u8, pos);
        synth.set_param(0, patch::P_WT_WARP as u8, warp);
        synth.set_param(0, patch::P_CRUSH as u8, crush);
        synth.note_on(0, 60, 100);
        let stats = render_blocks(&mut synth, 30);
        assert!(stats.mean_abs() > 0.003, "wt {pos}/{warp}/{crush} silent");
        assert!(stats.peak <= 1.0, "wt {pos}/{warp}/{crush} clips, peak {}", stats.peak);
        assert_eq!(stats.non_finite, 0, "wt {pos}/{warp}/{crush} NaN/inf");
    }
}

#[test]
fn wavetable_preview_matches_range() {
    // The UI preview must stay in [-1,1] across the whole morph/warp space
    for pos in (0..=100).step_by(10) {
        for warp in (0..=100).step_by(25) {
            for i in 0..64 {
                let v = patch::wt_preview(pos as i16, warp as i16, i as f32 / 64.0);
                assert!(v.is_finite() && (-1.01..=1.01).contains(&v));
            }
        }
    }
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

// ============ Drum sampler ============

mod sampler_tests {
    use super::*;
    use crate::sampler::*;

    extern crate std;
    use std::vec::Vec;

    /// A 0.2s 220Hz sine take at SR, kept alive by the caller.
    fn make_take() -> Vec<i16> {
        let n = (SR * 0.2) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / SR;
                (libm::sinf(core::f32::consts::TAU * 220.0 * t) * 20000.0) as i16
            })
            .collect()
    }

    fn synth_with_sample(take: &[i16]) -> Synth {
        let mut synth = Synth::new();
        synth.set_sample_rate(SR);
        // Slot 0 = GM note 35
        unsafe { synth.set_sample(4, 0, take.as_ptr(), take.len() as u32) };
        synth
    }

    #[test]
    fn trigger_plays_and_one_shot_ends() {
        let take = make_take();
        let mut synth = synth_with_sample(&take);
        synth.drum_trigger(4, 35, 110);
        let playing = render_blocks(&mut synth, 20);
        assert!(playing.mean_abs() > 0.01, "sampled hit should be audible");
        assert!(playing.peak <= 1.0);
        assert_eq!(playing.non_finite, 0);
        // One-shot: after the take's 0.2s it must be silent
        render_blocks(&mut synth, (SR * 0.3 / MAX_BLOCK as f32) as usize);
        let tail = render_blocks(&mut synth, 5);
        assert_eq!(tail.peak, 0.0, "one-shot must end with the sample");
    }

    #[test]
    fn empty_slot_is_silent() {
        let take = make_take();
        let mut synth = synth_with_sample(&take);
        synth.drum_trigger(4, 36, 110); // slot 1: nothing loaded
        let stats = render_blocks(&mut synth, 10);
        assert_eq!(stats.peak, 0.0);
    }

    #[test]
    fn trim_shortens_playback() {
        let take = make_take();
        let mut synth = synth_with_sample(&take);
        // Cut to the first 10% -> 0.02s
        synth.set_slot_param(4, 0, SP_TRIM_END as u8, 100);
        synth.drum_trigger(4, 35, 110);
        render_blocks(&mut synth, (SR * 0.05 / MAX_BLOCK as f32) as usize);
        let tail = render_blocks(&mut synth, 5);
        assert_eq!(tail.peak, 0.0, "trimmed hit should have ended");
    }

    #[test]
    fn loop_mode_sustains_until_release() {
        let take = make_take();
        let mut synth = synth_with_sample(&take);
        synth.set_slot_param(4, 0, SP_MODE as u8, MODE_LOOP);
        synth.drum_trigger(4, 35, 110);
        // Way past the take's length, still sounding
        render_blocks(&mut synth, (SR * 0.5 / MAX_BLOCK as f32) as usize);
        let looping = render_blocks(&mut synth, 10);
        assert!(looping.mean_abs() > 0.01, "loop mode should sustain");
        synth.drum_release(4, 35);
        render_blocks(&mut synth, 20);
        let tail = render_blocks(&mut synth, 5);
        assert_eq!(tail.peak, 0.0, "loop should fade after release");
    }

    #[test]
    fn gate_mode_stops_on_release() {
        let take = make_take();
        let mut synth = synth_with_sample(&take);
        synth.set_slot_param(4, 0, SP_MODE as u8, MODE_GATE);
        synth.drum_trigger(4, 35, 110);
        render_blocks(&mut synth, 5);
        synth.drum_release(4, 35);
        render_blocks(&mut synth, 20);
        let tail = render_blocks(&mut synth, 5);
        assert_eq!(tail.peak, 0.0, "gate should fade after release");
    }

    #[test]
    fn granular_speed_and_pitch_are_bounded() {
        let take = make_take();
        for (speed, pitch, tape) in [(0, 24, 0), (100, 24, 0), (50, 0, 0), (50, 48, 0), (80, 40, 1)]
        {
            let mut synth = synth_with_sample(&take);
            synth.set_slot_param(4, 0, SP_MODE as u8, MODE_LOOP);
            synth.set_slot_param(4, 0, SP_SPEED as u8, speed);
            synth.set_slot_param(4, 0, SP_PITCH as u8, pitch);
            synth.set_slot_param(4, 0, SP_TAPE as u8, tape);
            synth.drum_trigger(4, 35, 110);
            let stats = render_blocks(&mut synth, 60);
            assert!(stats.mean_abs() > 0.005, "speed {speed} pitch {pitch} tape {tape} silent");
            assert!(stats.peak <= 1.0, "speed {speed} pitch {pitch} peak {}", stats.peak);
            assert_eq!(stats.non_finite, 0);
        }
    }

    #[test]
    fn reload_swaps_safely_while_playing() {
        let take = make_take();
        let mut synth = synth_with_sample(&take);
        synth.set_slot_param(4, 0, SP_MODE as u8, MODE_LOOP);
        synth.drum_trigger(4, 35, 110);
        render_blocks(&mut synth, 5);
        // Swap in a new take mid-play: the old voice must stop, not read freed memory
        let take2 = make_take();
        unsafe { synth.set_sample(4, 0, take2.as_ptr(), take2.len() as u32) };
        drop(take);
        let after = render_blocks(&mut synth, 5);
        assert_eq!(after.non_finite, 0);
        // New trigger plays the new take
        synth.drum_trigger(4, 35, 110);
        let replay = render_blocks(&mut synth, 10);
        assert!(replay.mean_abs() > 0.01);
    }

    #[test]
    fn slot_mapping_starts_at_gm_kick() {
        assert_eq!(note_to_slot(35), 0);
        assert_eq!(note_to_slot(36), 1);
        assert_eq!(note_to_slot(50), 15);
        assert_eq!(note_to_slot(51), 0);
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

#[test]
fn mod_matrix_offsets_target_without_touching_patch() {
    // Slot 1: wheel closes the volume all the way down (depth 0 = -100%).
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.set_param(0, patch::P_MOD1_TARGET as u8, patch::P_VOLUME as i16);
    synth.set_param(0, patch::P_MOD1_DEPTH as u8, 0);

    synth.note_on(0, 60, 100);
    let unmodded = render_blocks(&mut synth, 20);
    assert!(unmodded.mean_abs() > 0.005, "wheel at 0 must leave the sound alone");

    synth.set_param(0, patch::P_MOD_VALUE as u8, 100);
    synth.note_on(0, 60, 100);
    let modded = render_blocks(&mut synth, 20);
    assert!(
        modded.mean_abs() < unmodded.mean_abs() / 4.0,
        "full wheel at -100% volume depth should mute: {} vs {}",
        modded.mean_abs(),
        unmodded.mean_abs()
    );
    assert_eq!(unmodded.non_finite + modded.non_finite, 0);

    // The stored patch is untouched -- modulation is a render-time overlay.
    assert_eq!(synth.get_param(0, patch::P_VOLUME as u8), patch::DEFAULTS[patch::P_VOLUME]);
}

#[test]
fn mod_matrix_second_slot_and_bounds() {
    // Both slots on distinct targets; extreme depths must stay clamped.
    let mut synth = Synth::new();
    synth.set_sample_rate(SR);
    synth.set_param(0, patch::P_MOD1_TARGET as u8, patch::P_CUTOFF as i16);
    synth.set_param(0, patch::P_MOD1_DEPTH as u8, 200);
    synth.set_param(0, patch::P_MOD2_TARGET as u8, patch::P_DRIVE as i16);
    synth.set_param(0, patch::P_MOD2_DEPTH as u8, 200);
    synth.set_param(0, patch::P_MOD_VALUE as u8, 100);
    synth.note_on(0, 48, 110);
    let stats = render_blocks(&mut synth, 30);
    assert!(stats.mean_abs() > 0.003);
    assert!(stats.peak <= 1.0, "modded output out of bounds, peak {}", stats.peak);
    assert_eq!(stats.non_finite, 0);
}
