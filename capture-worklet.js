// capture-worklet.js — mic capture for the drum sampler.
//
// Trivial by design: batch input frames into ~46ms Float32Array chunks and
// post them to the main thread, which owns the whole recorder state machine
// (arming threshold, pre-roll, take assembly, level/waveform feedback).
// Nothing is played back — the design has no input monitoring.

const CHUNK = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const mono = input[0];
    let i = 0;
    while (i < mono.length) {
      const n = Math.min(mono.length - i, CHUNK - this.fill);
      this.buf.set(mono.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === CHUNK) {
        const out = this.buf;
        this.buf = new Float32Array(CHUNK);
        this.fill = 0;
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("sample-capture", CaptureProcessor);
