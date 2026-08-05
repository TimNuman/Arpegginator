// synth-worklet.js — AudioWorkletProcessor hosting the Rust synth WASM.
//
// Runs on the audio rendering thread. The main thread compiles synth.wasm to
// a WebAssembly.Module and passes it via processorOptions (Modules are
// structured-cloneable); instantiation here is synchronous, which is allowed
// off the main thread and means the processor is ready before the first
// render quantum.
//
// The module has zero imports by design (see synth-wasm/src/lib.rs), so no
// glue code is needed: note events arrive as [type, a, b] arrays on the port,
// process() calls synth_render and copies the mono block to all output
// channels.

class RustSynthProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.exports = null;
    try {
      const instance = new WebAssembly.Instance(options.processorOptions.module, {});
      this.exports = instance.exports;
      this.exports.synth_init(sampleRate);
      this.port.postMessage("ready");
    } catch (e) {
      this.port.postMessage("error: " + e);
    }

    this.port.onmessage = (event) => {
      const [type, a, b, c, d] = event.data;
      if (!this.exports) return;
      if (type === 0) this.exports.synth_note_on(a, b, c);
      else if (type === 1) this.exports.synth_note_off(a, b);
      else if (type === 2) this.exports.synth_all_notes_off();
      else if (type === 3) this.exports.synth_set_param(a, b, c);
      else if (type === 4) this.exports.synth_set_slot_param(a, b, c, d);
      else if (type === 5) this.exports.synth_drum_trigger(a, b, c);
      else if (type === 6) this.exports.synth_drum_release(a, b);
      else if (type === 7) this.loadSample(a, b, c);
    };
  }

  // Copy an Int16Array take into WASM sample memory and activate it (an
  // empty/omitted take clears the slot). Runs between render quanta, so the
  // swap is atomic from the renderer's point of view.
  loadSample(channel, slot, samples) {
    const ex = this.exports;
    if (!samples || samples.length === 0) {
      ex.synth_sample_clear(channel, slot);
      return;
    }
    const ptr = ex.synth_sample_buffer(channel, slot, samples.length);
    if (!ptr) return;
    // Fresh view after synth_sample_buffer — memory.grow detaches buffers
    new Int16Array(ex.memory.buffer, ptr, samples.length).set(samples);
    ex.synth_sample_commit(channel, slot, samples.length);
  }

  process(_inputs, outputs) {
    const ex = this.exports;
    if (!ex) return true;
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    const ptr = ex.synth_render(frames);
    // Fresh view every quantum — cheap, and safe if memory ever grows
    const block = new Float32Array(ex.memory.buffer, ptr, frames);
    for (let ch = 0; ch < out.length; ch++) {
      out[ch].set(block);
    }
    return true;
  }
}

registerProcessor("rust-synth", RustSynthProcessor);
