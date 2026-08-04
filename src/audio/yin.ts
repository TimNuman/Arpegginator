// yin.ts — YIN pitch detection for recorded takes.
//
// Used once per take (not real-time) to tag a sampler slot with its musical
// key, so the TUNE cell can snap PITCH to the scale root. Plain YIN with the
// cumulative-mean-normalized difference function and parabolic interpolation
// (de Cheveigné & Kawahara 2002), which handles drum-ish material better than
// bare autocorrelation.

const YIN_THRESHOLD = 0.15;
const F_MIN = 60;
const F_MAX = 1000;
const WINDOW = 2048;

/**
 * Detect the fundamental of `samples` around its loudest region.
 * Returns frequency in Hz, or -1 when nothing tonal is found.
 */
export function detectPitch(samples: Float32Array, sampleRate: number): number {
  if (samples.length < WINDOW * 2) return -1;

  // Analyze right after the loudest instant — past the attack transient,
  // where the tone (if any) rings clearest.
  let peakIdx = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) {
      peak = a;
      peakIdx = i;
    }
  }
  if (peak < 1e-4) return -1;
  const start = Math.min(peakIdx + 256, samples.length - WINDOW * 2);
  const frame = samples.subarray(start, start + WINDOW * 2);

  const tauMin = Math.max(2, Math.floor(sampleRate / F_MAX));
  const tauMax = Math.min(WINDOW, Math.ceil(sampleRate / F_MIN));

  // Difference function
  const diff = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < WINDOW; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Cumulative mean normalized difference
  const cmndf = new Float32Array(tauMax + 1);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1;
  }

  // First dip below threshold, refined to its local minimum
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmndf[t] < YIN_THRESHOLD) {
      while (t + 1 <= tauMax && cmndf[t + 1] < cmndf[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return -1;

  // Parabolic interpolation around the dip for sub-sample precision
  let better = tau;
  if (tau > tauMin && tau < tauMax) {
    const s0 = cmndf[tau - 1];
    const s1 = cmndf[tau];
    const s2 = cmndf[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-12) {
      better = tau + (s2 - s0) / denom;
    }
  }
  return sampleRate / better;
}

/**
 * Detect the musical key (pitch class 0-11, C = 0) of a take.
 * Returns -1 for atonal material (noise, clicks, most hats).
 */
export function detectKey(samples: Float32Array, sampleRate: number): number {
  const freq = detectPitch(samples, sampleRate);
  if (freq <= 0) return -1;
  const midi = 69 + 12 * Math.log2(freq / 440);
  return ((Math.round(midi) % 12) + 12) % 12;
}
