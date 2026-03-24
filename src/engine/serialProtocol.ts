// serialProtocol.ts — Binary protocol for Teensy USB serial communication
// Must match protocol definitions in teensy/src/main.rs

// ============ Commands (JS → Teensy) ============

export const CMD_PLAY = 0x01;
export const CMD_STOP = 0x02;
export const CMD_SET_BPM = 0x03; // + f32le (4 bytes)
export const CMD_SET_SWING = 0x04; // + i32le (4 bytes)
export const CMD_SET_PATTERN = 0x05; // + ch:u8, pat:u8
export const CMD_SET_MUTE = 0x06; // + ch:u8, muted:u8
export const CMD_SET_SOLO = 0x07; // + ch:u8, soloed:u8
export const CMD_BUTTON_PRESS = 0x10; // + row:u8, col:u8, mods:u8
export const CMD_KEY_ACTION = 0x11; // + action_id:u8
export const CMD_PING = 0xfe;
export const CMD_GET_STATE = 0xff;

// ============ Responses (Teensy → JS) ============

export const RSP_PONG = 0xfe;
export const RSP_TICK = 0x80; // + tick:i32le (4 bytes)
export const RSP_STATE = 0x81; // + 32-byte state dump

// ============ Encoders ============

export function encodePlay(): Uint8Array {
  return new Uint8Array([CMD_PLAY]);
}

export function encodeStop(): Uint8Array {
  return new Uint8Array([CMD_STOP]);
}

export function encodeSetBpm(bpm: number): Uint8Array {
  const buf = new ArrayBuffer(5);
  const view = new DataView(buf);
  view.setUint8(0, CMD_SET_BPM);
  view.setFloat32(1, bpm, true); // little-endian
  return new Uint8Array(buf);
}

export function encodeSetSwing(swing: number): Uint8Array {
  const buf = new ArrayBuffer(5);
  const view = new DataView(buf);
  view.setUint8(0, CMD_SET_SWING);
  view.setInt32(1, swing, true);
  return new Uint8Array(buf);
}

export function encodeSetPattern(ch: number, pat: number): Uint8Array {
  return new Uint8Array([CMD_SET_PATTERN, ch, pat]);
}

export function encodeSetMute(ch: number, muted: boolean): Uint8Array {
  return new Uint8Array([CMD_SET_MUTE, ch, muted ? 1 : 0]);
}

export function encodeSetSolo(ch: number, soloed: boolean): Uint8Array {
  return new Uint8Array([CMD_SET_SOLO, ch, soloed ? 1 : 0]);
}

export function encodeButtonPress(
  row: number,
  col: number,
  mods: number,
): Uint8Array {
  return new Uint8Array([CMD_BUTTON_PRESS, row, col, mods]);
}

export function encodeKeyAction(actionId: number): Uint8Array {
  return new Uint8Array([CMD_KEY_ACTION, actionId]);
}

export function encodePing(): Uint8Array {
  return new Uint8Array([CMD_PING]);
}

export function encodeGetState(): Uint8Array {
  return new Uint8Array([CMD_GET_STATE]);
}

// ============ Response Decoder ============

export interface TickResponse {
  type: "tick";
  tick: number;
}

export interface StateResponse {
  type: "state";
  isPlaying: boolean;
  bpm: number;
  currentTick: number;
  swing: number;
  currentPatterns: number[];
  muted: boolean[];
  soloed: boolean[];
}

export interface PongResponse {
  type: "pong";
}

export type TeensyResponse = TickResponse | StateResponse | PongResponse;

/**
 * Try to decode one response from the buffer.
 * Returns [response, bytesConsumed] or null if incomplete.
 */
export function decodeResponse(
  buf: Uint8Array,
  offset: number,
  length: number,
): [TeensyResponse, number] | null {
  if (length === 0) return null;
  const cmd = buf[offset];

  switch (cmd) {
    case RSP_PONG:
      return [{ type: "pong" }, 1];

    case RSP_TICK: {
      if (length < 5) return null;
      const view = new DataView(
        buf.buffer,
        buf.byteOffset + offset + 1,
        4,
      );
      const tick = view.getInt32(0, true);
      return [{ type: "tick", tick }, 5];
    }

    case RSP_STATE: {
      if (length < 33) return null; // 1 + 32 bytes
      const d = buf;
      const o = offset + 1;
      const view = new DataView(d.buffer, d.byteOffset + o, 32);
      const isPlaying = d[o] !== 0;
      const bpm = view.getFloat32(1, true);
      const currentTick = view.getInt32(5, true);
      const swing = view.getInt32(9, true);
      const currentPatterns = Array.from(d.slice(o + 13, o + 19));
      const muted = Array.from(d.slice(o + 19, o + 25)).map((v) => v !== 0);
      const soloed = Array.from(d.slice(o + 25, o + 31)).map((v) => v !== 0);
      return [
        { type: "state", isPlaying, bpm, currentTick, swing, currentPatterns, muted, soloed },
        33,
      ];
    }

    default:
      // Unknown byte, skip
      return null;
  }
}
