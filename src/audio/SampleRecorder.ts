// SampleRecorder — web-mic recording path for the drum sampler.
//
// The engine's REC page emits rec-control presses; this class owns the whole
// recorder state machine on the main thread and feeds UI state back into the
// engine (rec state, input level, live 16-bucket waveform), so the grid and
// OLED show what the mic hears. Audio arrives as ~46ms Float32Array chunks
// from a tiny capture AudioWorklet (public/capture-worklet.js); there is no
// input monitoring by design.
//
//   idle --press--> armed (mic open, waiting for level > threshold)
//   armed --press--> idle (cancel)   armed --signal--> recording
//   recording --press/silence/max-length--> take lands in the selected slot
//
// A finished take is peak-normalized, converted to i16, uploaded to the synth
// worklet, tagged with a YIN-detected key, and its waveform preview pushed to
// the engine. Later the same flow runs on the Teensy from the codec line-in.

import { markDirty } from "../store/renderStore";
import type { Engine } from "../engine/types";
import type { WebAudioSynth } from "./WebAudioSynth";
import { detectKey } from "./yin";

const REC_IDLE = 0;
const REC_ARMED = 1;
const REC_RECORDING = 2;

/** Input peak that trips armed → recording. */
const ARM_THRESHOLD = 0.05;
/** Seconds of continuous sub-threshold input that end a take. */
const SILENCE_S = 0.5;
/** Hard cap per take (bounds sampler memory: 6s ≈ 530KB of i16). */
const MAX_TAKE_S = 6.0;
/** Audio kept from just before the threshold trip (attack transients). */
const PREROLL_CHUNKS = 3;

const WAVEFORM_BUCKETS = 16;
/** Live REC-page waveform: one bucket ≈ this many seconds. */
const LIVE_BUCKET_S = 0.08;

export class SampleRecorder {
  /** Wired by App once the engine backend is loaded. */
  engine: Engine | null = null;

  private state = REC_IDLE;
  private channel = 0;
  private slot = 0;

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private captureModuleLoaded = false;

  private preroll: Float32Array[] = [];
  private take: Float32Array[] = [];
  private takeSamples = 0;
  private silenceSamples = 0;
  private sampleRate = 44100;

  // Live waveform: rolling peak buckets
  private liveWave = new Uint8Array(WAVEFORM_BUCKETS);
  private bucketPeak = 0;
  private bucketFill = 0;

  private synth: WebAudioSynth;

  constructor(synth: WebAudioSynth) {
    this.synth = synth;
  }

  /** Handle a rec-control press from the engine's REC page. */
  async toggle(channel: number): Promise<void> {
    if (this.state === REC_IDLE) {
      await this.arm(channel);
    } else if (this.state === REC_ARMED) {
      this.stop(false);
    } else {
      this.stop(true);
    }
  }

  isBusy(): boolean {
    return this.state !== REC_IDLE;
  }

  private async arm(channel: number): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    this.channel = channel;
    this.slot = engine.getSamplerSlot(channel);

    try {
      const ctx = this.synth.getContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!this.captureModuleLoaded) {
        const base = import.meta.env.BASE_URL ?? "/";
        await ctx.audioWorklet.addModule(`${base}capture-worklet.js`);
        this.captureModuleLoaded = true;
      }

      this.sampleRate = ctx.sampleRate;
      this.stream = stream;
      this.source = ctx.createMediaStreamSource(stream);
      this.capture = new AudioWorkletNode(ctx, "sample-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      // Keep the node in the graph without hearing it (no monitoring)
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.capture);
      this.capture.connect(this.sink);
      this.sink.connect(ctx.destination);
      this.capture.port.onmessage = (e) => this.onChunk(e.data as Float32Array);

      this.preroll = [];
      this.take = [];
      this.takeSamples = 0;
      this.silenceSamples = 0;
      this.liveWave.fill(0);
      this.bucketPeak = 0;
      this.bucketFill = 0;
      this.setState(REC_ARMED, 0);
    } catch (e) {
      console.warn("Sample recording unavailable:", e);
      this.teardown();
      this.setState(REC_IDLE, 0);
    }
  }

  /** `finish` = keep the take (recording); false = cancel (armed). */
  private stop(finish: boolean): void {
    const wasRecording = this.state === REC_RECORDING;
    this.teardown();
    if (finish && wasRecording && this.takeSamples > 0) {
      this.finalizeTake();
    }
    this.setState(REC_IDLE, 0);
  }

  private onChunk(chunk: Float32Array): void {
    if (this.state === REC_IDLE) return;

    let peak = 0;
    for (let i = 0; i < chunk.length; i++) {
      const a = Math.abs(chunk[i]);
      if (a > peak) peak = a;
    }
    this.pushLiveWave(chunk, peak);

    if (this.state === REC_ARMED) {
      // Pre-roll ring so the attack that trips the threshold is kept
      this.preroll.push(chunk);
      if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift();
      if (peak >= ARM_THRESHOLD) {
        this.take = [...this.preroll];
        this.takeSamples = this.take.reduce((n, c) => n + c.length, 0);
        this.preroll = [];
        this.silenceSamples = 0;
        this.setState(REC_RECORDING, peak);
      } else {
        this.setState(REC_ARMED, peak);
      }
      return;
    }

    // Recording
    this.take.push(chunk);
    this.takeSamples += chunk.length;
    this.silenceSamples = peak < ARM_THRESHOLD ? this.silenceSamples + chunk.length : 0;
    this.setState(REC_RECORDING, peak);

    const sr = this.sampleRate;
    if (this.silenceSamples >= SILENCE_S * sr || this.takeSamples >= MAX_TAKE_S * sr) {
      this.stop(true);
    }
  }

  private finalizeTake(): void {
    const engine = this.engine;
    if (!engine) return;

    // Assemble, dropping most of the trailing silence (keep a short tail)
    const keepTail = Math.floor(0.1 * this.sampleRate);
    const drop = Math.max(0, this.silenceSamples - keepTail);
    const total = Math.max(1, this.takeSamples - drop);
    const all = new Float32Array(total);
    let w = 0;
    for (const c of this.take) {
      const n = Math.min(c.length, total - w);
      if (n <= 0) break;
      all.set(c.subarray(0, n), w);
      w += n;
    }
    this.take = [];
    this.takeSamples = 0;

    // Peak normalize to -1dB-ish and convert to i16
    let peak = 0;
    for (let i = 0; i < all.length; i++) {
      const a = Math.abs(all[i]);
      if (a > peak) peak = a;
    }
    if (peak < 1e-4) return; // nothing but noise floor — drop the take
    const gain = 0.9 / peak;
    const i16 = new Int16Array(all.length);
    for (let i = 0; i < all.length; i++) {
      i16[i] = Math.max(-32768, Math.min(32767, Math.round(all[i] * gain * 32767)));
    }

    // 16-bucket waveform preview for the SLOT page
    const buckets = new Uint8Array(WAVEFORM_BUCKETS);
    const per = Math.max(1, Math.ceil(all.length / WAVEFORM_BUCKETS));
    for (let b = 0; b < WAVEFORM_BUCKETS; b++) {
      let m = 0;
      const end = Math.min(all.length, (b + 1) * per);
      for (let i = b * per; i < end; i++) {
        const a = Math.abs(all[i]);
        if (a > m) m = a;
      }
      buckets[b] = Math.min(255, Math.round(m * gain * 255));
    }

    const key = detectKey(all, this.sampleRate);

    this.synth.loadSample(this.channel, this.slot, i16);
    engine.setSlotPreview(this.channel, this.slot, buckets);
    engine.setSlotState(this.channel, this.slot, true, key);
    markDirty();
  }

  private pushLiveWave(chunk: Float32Array, peak: number): void {
    // Rolling peak buckets: shift left every LIVE_BUCKET_S of audio
    this.bucketPeak = Math.max(this.bucketPeak, peak);
    this.bucketFill += chunk.length;
    const bucketLen = LIVE_BUCKET_S * this.sampleRate;
    while (this.bucketFill >= bucketLen) {
      this.bucketFill -= bucketLen;
      this.liveWave.copyWithin(0, 1);
      this.liveWave[WAVEFORM_BUCKETS - 1] = Math.min(255, Math.round(this.bucketPeak * 255));
      this.bucketPeak = 0;
    }
    this.engine?.setRecWaveform(this.liveWave);
  }

  private setState(state: number, peak: number): void {
    this.state = state;
    this.engine?.setRecState(state, Math.min(255, Math.round(peak * 255)));
    markDirty();
  }

  private teardown(): void {
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.disconnect();
      this.capture = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.sink?.disconnect();
    this.sink = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
