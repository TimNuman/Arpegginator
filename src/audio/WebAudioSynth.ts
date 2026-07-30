// WebAudioSynth — built-in sounds for running without MIDI hardware (e.g. iPad).
//
// Two instruments, routed by the caller per engine channel type:
//   - 808-style drum kit: synthesized from oscillators/noise, mapped by
//     General MIDI drum note numbers (36 kick, 38 snare, 42 hat, ...) to match
//     the note numbers the Rust engine uses for drum channels.
//   - Melodic: the Rust WASM synth (arp3-synth via AudioWorklet — the same
//     DSP that will run on the Teensy). While the worklet is still loading,
//     or on browsers without AudioWorklet support, melodic notes fall back to
//     the JS piano (additive partials + velocity-scaled lowpass).
//
// The AudioContext is created lazily and must be resume()d from a user
// gesture on iOS — App wires that to pointerdown/keydown.

import { RustSynth } from "./RustSynth";

const midiToFreq = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

// TR-808 hi-hat/cymbal oscillator bank ratios (Hz)
const METAL_FREQS = [263, 400, 421, 474, 587, 845];

const MAX_PIANO_VOICES = 24;

interface PianoVoice {
  /** Damper release — quick fade then stop */
  release: (when: number) => void;
  /** Immediate kill (all-notes-off / voice steal) */
  kill: (when: number) => void;
  startedAt: number;
}

export class WebAudioSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** Active piano voices keyed by channel * 128 + note */
  private pianoVoices = new Map<number, PianoVoice>();
  private unlocked = false;
  private silentLoop: HTMLAudioElement | null = null;
  /** Rust WASM synth (AudioWorklet) for melodic channels */
  private rustSynth = new RustSynth();

  /** Create (or return) the AudioContext. Safe to call any time. */
  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;

    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();

    // master gain -> soft compressor -> speakers
    const master = ctx.createGain();
    master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    master.connect(comp);
    comp.connect(ctx.destination);

    // 1s of white noise, reused by all noise-based drums
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.ctx = ctx;
    this.master = master;
    this.noiseBuffer = buf;

    // Load the Rust synth worklet in the background; melodic notes use the
    // JS piano until it's ready (or forever, if the browser can't run it)
    void this.rustSynth.load(ctx, master);

    return ctx;
  }

  /**
   * Resume/unlock the AudioContext. Must be called from a user gesture at
   * least once on iOS/Safari before any sound can play. Cheap no-op when
   * already running and unlocked.
   */
  resume(): void {
    const ctx = this.ensure();
    // iOS also reports a non-standard "interrupted" state after phone calls
    // or app switches — resume() recovers from that too
    if (ctx.state !== "running") {
      void ctx.resume();
    }
    if (!this.unlocked) {
      // Classic iOS unlock: play a silent one-sample buffer from the gesture
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
        this.unlocked = true;
      } catch {
        // ignore — retried on the next gesture
      }
    }
    this.startSilentMediaLoop();
  }

  /**
   * Loop a silent <audio> element. This flips iOS's audio session into
   * "playback" mode, so Web Audio output is NOT muted by the ring/silent
   * switch — without it an iPhone with the switch on silent hears nothing.
   * Must be started from a user gesture; retried until play() succeeds.
   */
  private startSilentMediaLoop(): void {
    if (this.silentLoop) return;
    try {
      const audio = document.createElement("audio");
      audio.setAttribute("playsinline", "");
      audio.loop = true;
      audio.src = URL.createObjectURL(new Blob([buildSilentWav()], { type: "audio/wav" }));
      // Keep it in the DOM (hidden) — iOS can stop detached media elements
      audio.style.display = "none";
      document.body.appendChild(audio);
      const p = audio.play();
      if (p) {
        p.then(() => {
          this.silentLoop = audio;
        }).catch(() => {
          // Not a valid gesture yet — remove and retry on the next resume()
          audio.remove();
        });
      } else {
        this.silentLoop = audio;
      }
    } catch {
      // ignore — audio element is a best-effort enhancement
    }
  }

  // ============ Public API ============

  noteOn(channel: number, note: number, velocity: number, isDrum: boolean): void {
    const ctx = this.ensure();
    if (ctx.state !== "running") {
      // Try to recover (e.g. iOS "interrupted" after an app switch); drop the
      // note if the context still isn't running
      void ctx.resume();
      if ((ctx.state as string) !== "running") return;
    }
    const vel = Math.max(0, Math.min(1, velocity / 127));
    if (isDrum) {
      this.playDrum(note, vel);
    } else if (this.rustSynth.isReady()) {
      this.rustSynth.noteOn(channel, note, velocity);
    } else {
      this.pianoOn(channel, note, vel);
    }
  }

  noteOff(channel: number, note: number): void {
    // Drums are one-shots; this only affects melodic voices. Send to both
    // melodic instruments — a note may have started on the piano right
    // before the Rust synth finished loading (each ignores unknown notes).
    this.rustSynth.noteOff(channel, note);
    const key = channel * 128 + note;
    const voice = this.pianoVoices.get(key);
    if (voice && this.ctx) {
      this.pianoVoices.delete(key);
      voice.release(this.ctx.currentTime);
    }
  }

  allNotesOff(): void {
    if (!this.ctx) return;
    this.rustSynth.allNotesOff();
    const now = this.ctx.currentTime;
    for (const voice of this.pianoVoices.values()) {
      voice.kill(now);
    }
    this.pianoVoices.clear();
  }

  // ============ Piano ============

  private pianoOn(channel: number, note: number, vel: number): void {
    const ctx = this.ctx!;
    const key = channel * 128 + note;
    const now = ctx.currentTime;

    // Retrigger: fade out any existing voice on the same key
    const existing = this.pianoVoices.get(key);
    if (existing) {
      this.pianoVoices.delete(key);
      existing.kill(now);
    }
    // Voice cap: steal the oldest voice
    if (this.pianoVoices.size >= MAX_PIANO_VOICES) {
      let oldestKey = -1;
      let oldestTime = Infinity;
      for (const [k, v] of this.pianoVoices) {
        if (v.startedAt < oldestTime) {
          oldestTime = v.startedAt;
          oldestKey = k;
        }
      }
      const oldest = this.pianoVoices.get(oldestKey);
      if (oldest) {
        this.pianoVoices.delete(oldestKey);
        oldest.kill(now);
      }
    }

    const freq = midiToFreq(note);
    const level = 0.28 * Math.pow(vel, 1.4);

    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.4;
    // Brighter when hit harder / higher; hammer softens as the note rings
    const cutoff = Math.min(11000, freq * (3 + 7 * vel));
    filter.frequency.setValueAtTime(cutoff, now);
    filter.frequency.setTargetAtTime(Math.max(freq * 1.5, cutoff * 0.3), now, 0.9);
    filter.connect(amp);
    amp.connect(this.master!);

    // Lower notes ring longer: ~5s at A0 down to ~0.6s at the top
    const decayTau = 1.6 * Math.pow(0.5, (note - 33) / 30);
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(level, now + 0.003);
    amp.gain.setTargetAtTime(0, now + 0.003, decayTau);

    // Partials: fundamental (slightly detuned pair for warmth) + 2nd + 3rd
    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1.0, "triangle"],
      [1.0035, 0.5, "triangle"],
      [2, 0.22, "sine"],
      [3, 0.09, "sine"],
    ];
    const oscs = partials.map(([ratio, gainVal, type]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.value = gainVal;
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      return osc;
    });

    // Natural end of the voice if no noteOff arrives (setTarget ~inaudible
    // after 8 time constants)
    const naturalStop = now + decayTau * 8 + 0.2;
    oscs.forEach((o) => o.stop(naturalStop));

    let ended = false;
    const stopAll = (when: number, fadeTau: number) => {
      if (ended) return;
      ended = true;
      amp.gain.cancelScheduledValues(when);
      amp.gain.setTargetAtTime(0, when, fadeTau);
      const stopAt = when + fadeTau * 8 + 0.05;
      oscs.forEach((o) => {
        try {
          o.stop(stopAt);
        } catch {
          // already stopped
        }
      });
    };

    oscs[0].onended = () => {
      amp.disconnect();
      if (this.pianoVoices.get(key)?.startedAt === now) {
        this.pianoVoices.delete(key);
      }
    };

    this.pianoVoices.set(key, {
      startedAt: now,
      release: (when) => stopAll(when, 0.06),
      kill: (when) => stopAll(when, 0.015),
    });
  }

  // ============ Drums ============

  /** Route a GM drum note number to an 808-style recipe. */
  private playDrum(note: number, vel: number): void {
    switch (note) {
      case 35:
      case 36:
        this.kick(vel);
        break;
      case 37: // rimshot
        this.rim(vel);
        break;
      case 39: // hand clap
        this.clap(vel);
        break;
      case 38:
      case 40:
        this.snare(vel);
        break;
      case 42: // closed hat
        this.hat(vel, 0.05);
        break;
      case 44: // pedal hat
        this.hat(vel, 0.09);
        break;
      case 46: // open hat
        this.hat(vel, 0.45);
        break;
      case 41:
      case 43:
      case 45:
      case 47:
      case 48:
      case 50:
        this.tom(vel, note);
        break;
      case 49:
      case 57: // crash
        this.cymbal(vel, 1.4, 0.5);
        break;
      case 51:
      case 53:
      case 59: // ride
        this.cymbal(vel, 0.8, 0.3);
        break;
      case 52:
      case 55: // china / splash
        this.cymbal(vel, 1.0, 0.4);
        break;
      case 56: // cowbell
        this.cowbell(vel);
        break;
      case 54:
      case 69:
      case 70:
      case 82: // tambourine / cabasa / maracas / shaker
        this.shaker(vel);
        break;
      case 75:
      case 76:
      case 77: // claves / woodblocks
        this.claves(vel);
        break;
      case 62:
      case 63:
      case 64: // congas
        this.tom(vel * 0.9, 45 + (64 - note) * 2);
        break;
      default:
        // Unmapped percussion: short mid blip
        this.perc(vel);
        break;
    }
  }

  /** One-shot output gain that cleans itself up when the anchor source ends. */
  private drumOut(anchor: AudioScheduledSourceNode): GainNode {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.connect(this.master!);
    anchor.addEventListener("ended", () => out.disconnect());
    return out;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  private kick(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const out = this.drumOut(osc);

    // Long 808 boom: fast pitch sweep into a low sustained sine
    osc.type = "sine";
    osc.frequency.setValueAtTime(165, t0);
    osc.frequency.exponentialRampToValueAtTime(52, t0 + 0.09);
    osc.frequency.exponentialRampToValueAtTime(44, t0 + 0.5);

    out.gain.setValueAtTime(1.1 * vel, t0);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);

    osc.connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.6);

    // Click transient
    const click = this.noiseSource();
    const clickGain = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    clickGain.gain.setValueAtTime(0.5 * vel, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.02);
    click.connect(hp);
    hp.connect(clickGain);
    clickGain.connect(out);
    click.start(t0);
    click.stop(t0 + 0.03);
  }

  private snare(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const noise = this.noiseSource();
    const out = this.drumOut(noise);

    // Snappy noise burst
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7 * vel, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    noise.connect(hp);
    hp.connect(noiseGain);
    noiseGain.connect(out);
    noise.start(t0);
    noise.stop(t0 + 0.25);

    // Two-tone body (808 snare uses ~180 + ~330 Hz)
    for (const [freq, dur, level] of [
      [185, 0.14, 0.5],
      [330, 0.09, 0.3],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level * vel, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
    out.gain.value = 1;
  }

  /** Square-bank metallic source shared by hats/cymbals. */
  private metalBank(t0: number, dest: AudioNode, stopAt: number): OscillatorNode[] {
    const ctx = this.ctx!;
    return METAL_FREQS.map((f) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = f * 2;
      osc.connect(dest);
      osc.start(t0);
      osc.stop(stopAt);
      return osc;
    });
  }

  private hat(vel: number, decay: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 10000;
    bp.Q.value = 1.2;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.35 * vel, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + decay);

    const oscs = this.metalBank(t0, bp, t0 + decay + 0.05);
    const out = this.drumOut(oscs[0]);
    bp.connect(hp);
    hp.connect(env);
    env.connect(out);
  }

  private cymbal(vel: number, decay: number, level: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 8500;
    bp.Q.value = 0.8;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5500;

    const env = ctx.createGain();
    env.gain.setValueAtTime(level * vel, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + decay);

    const oscs = this.metalBank(t0, bp, t0 + decay + 0.05);
    const out = this.drumOut(oscs[0]);
    bp.connect(hp);
    hp.connect(env);
    env.connect(out);

    // Noise wash under the metallic bank
    const noise = this.noiseSource();
    const nHp = ctx.createBiquadFilter();
    nHp.type = "highpass";
    nHp.frequency.value = 6000;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(level * 0.6 * vel, t0);
    nGain.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
    noise.connect(nHp);
    nHp.connect(nGain);
    nGain.connect(out);
    noise.start(t0);
    noise.stop(t0 + decay + 0.05);
  }

  private clap(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const noise = this.noiseSource();
    const out = this.drumOut(noise);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1100;
    bp.Q.value = 1.6;

    // Three fast bursts then a tail — classic 808 clap envelope
    const env = ctx.createGain();
    const g = env.gain;
    g.setValueAtTime(0, t0);
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.011;
      g.setValueAtTime(0.8 * vel, t);
      g.exponentialRampToValueAtTime(0.1 * vel, t + 0.01);
    }
    g.setValueAtTime(0.6 * vel, t0 + 0.033);
    g.exponentialRampToValueAtTime(0.001, t0 + 0.25);

    noise.connect(bp);
    bp.connect(env);
    env.connect(out);
    noise.start(t0);
    noise.stop(t0 + 0.3);
  }

  private rim(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const out = this.drumOut(osc);
    osc.type = "triangle";
    osc.frequency.value = 1750;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * vel, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.06);
  }

  private tom(vel: number, note: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    // Map GM tom notes (41..50) onto an 80–180 Hz range
    const base = 80 + Math.max(0, Math.min(9, note - 41)) * 11;
    const osc = ctx.createOscillator();
    const out = this.drumOut(osc);
    osc.type = "sine";
    osc.frequency.setValueAtTime(base * 1.6, t0);
    osc.frequency.exponentialRampToValueAtTime(base, t0 + 0.08);
    out.gain.setValueAtTime(0.8 * vel, t0);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    osc.connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  }

  private cowbell(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200;
    bp.Q.value = 1.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.55 * vel, t0);
    env.gain.exponentialRampToValueAtTime(0.15 * vel, t0 + 0.03);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);

    // The two classic 808 cowbell squares
    const oscs = [540, 800].map((f) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = f;
      osc.connect(bp);
      osc.start(t0);
      osc.stop(t0 + 0.32);
      return osc;
    });
    const out = this.drumOut(oscs[0]);
    bp.connect(env);
    env.connect(out);
  }

  private shaker(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const noise = this.noiseSource();
    const out = this.drumOut(noise);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3 * vel, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    noise.connect(hp);
    hp.connect(g);
    g.connect(out);
    noise.start(t0);
    noise.stop(t0 + 0.1);
  }

  private claves(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const out = this.drumOut(osc);
    osc.type = "sine";
    osc.frequency.value = 2500;
    out.gain.setValueAtTime(0.5 * vel, t0);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
    osc.connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.05);
  }

  private perc(vel: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const noise = this.noiseSource();
    const out = this.drumOut(noise);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2000;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 * vel, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    noise.connect(bp);
    bp.connect(g);
    g.connect(out);
    noise.start(t0);
    noise.stop(t0 + 0.12);
  }
}

/** Build a minimal valid WAV file of silence (~0.1s, 8kHz mono 16-bit). */
function buildSilentWav(): ArrayBuffer {
  const sampleRate = 8000;
  const numSamples = 800;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  // samples stay zero — silence
  return buf;
}

/** Shared synth instance — context is created lazily on first use. */
export const synth = new WebAudioSynth();
