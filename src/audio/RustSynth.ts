// RustSynth — main-thread handle for the Rust WASM synth AudioWorklet.
//
// This is the browser half of the shared-DSP setup: the same arp3-synth crate
// that will render into the Teensy's audio DMA buffer is compiled to
// synth.wasm and run inside an AudioWorklet (see public/synth-worklet.js).
// The main thread only compiles the module, spins up the node, and forwards
// note events over the worklet port.
//
// Message protocol (kept as flat arrays — cheap to clone on the audio
// thread): [0, channel, note, velocity] noteOn, [1, channel, note] noteOff,
// [2] allNotesOff, [3, channel, param, value] setParam (Sound mode edits,
// param ids from arp3_synth::patch), [4, channel, slot, param, value]
// setSlotParam (sampler, ids from arp3_synth::sampler), [5, channel, note,
// velocity] drumTrigger, [6, channel, note] drumRelease, [7, channel, slot,
// Int16Array] loadSample (buffer transferred; empty array clears the slot).

export class RustSynth {
  private node: AudioWorkletNode | null = null;
  private loadStarted = false;

  /**
   * Compile synth.wasm, register the worklet and connect its node to
   * `destination`. Resolves true when the synth is producing audio, false if
   * anything is unsupported/missing (caller falls back to the JS piano).
   * Only the first call does work; later calls are no-ops.
   */
  async load(ctx: AudioContext, destination: AudioNode): Promise<boolean> {
    if (this.loadStarted) return this.node !== null;
    this.loadStarted = true;

    try {
      if (!ctx.audioWorklet) return false; // e.g. old Safari

      const base = import.meta.env.BASE_URL ?? "/";
      const [module] = await Promise.all([
        WebAssembly.compileStreaming(fetch(`${base}wasm-rust/synth.wasm`)),
        ctx.audioWorklet.addModule(`${base}synth-worklet.js`),
      ]);

      const node = new AudioWorkletNode(ctx, "rust-synth", {
        numberOfInputs: 0,
        outputChannelCount: [2],
        processorOptions: { module },
      });

      // The processor instantiates synchronously in its constructor and
      // reports back; only accept the node once it confirms.
      const ready = await new Promise<boolean>((resolve) => {
        node.port.onmessage = (e) => resolve(e.data === "ready");
      });
      if (!ready) {
        node.disconnect();
        return false;
      }

      node.connect(destination);
      this.node = node;
      console.log("Rust synth worklet loaded");
      return true;
    } catch (e) {
      console.warn("Rust synth unavailable, using JS piano fallback:", e);
      return false;
    }
  }

  /** True once the worklet is running — callers route melodic notes here. */
  isReady(): boolean {
    return this.node !== null;
  }

  noteOn(channel: number, note: number, velocity: number): void {
    this.node?.port.postMessage([0, channel, note, velocity]);
  }

  noteOff(channel: number, note: number): void {
    this.node?.port.postMessage([1, channel, note]);
  }

  allNotesOff(): void {
    this.node?.port.postMessage([2]);
  }

  setParam(channel: number, param: number, value: number): void {
    this.node?.port.postMessage([3, channel, param, value]);
  }

  // ---- Drum sampler ----

  setSlotParam(channel: number, slot: number, param: number, value: number): void {
    this.node?.port.postMessage([4, channel, slot, param, value]);
  }

  drumTrigger(channel: number, note: number, velocity: number): void {
    this.node?.port.postMessage([5, channel, note, velocity]);
  }

  drumRelease(channel: number, note: number): void {
    this.node?.port.postMessage([6, channel, note]);
  }

  /** Upload a recorded take into a sampler slot (empty array clears it). */
  loadSample(channel: number, slot: number, samples: Int16Array): void {
    this.node?.port.postMessage([7, channel, slot, samples], [samples.buffer]);
  }
}
