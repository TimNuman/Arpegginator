// midiProtocol.ts — SysEx protocol for Teensy control via Web MIDI
// Must match protocol definitions in teensy/src/main.rs
//
// All messages are SysEx: F0 7D <cmd> [data...] F7
// 7D = educational/development manufacturer ID (no registration needed)
// All data bytes must be 0-127 (7-bit) per MIDI spec

export const SYSEX_MFR = 0x7d;

// ============ Commands (browser → Teensy) ============

export const CMD_PLAY = 0x01; // + tick as 5×7-bit — play from tick position
export const CMD_STOP = 0x02;
export const CMD_SET_BPM = 0x03; // + BPM×100 as 3×7-bit
export const CMD_SET_SWING = 0x04; // + swing value (50-75)
export const CMD_SET_PATTERN = 0x05; // + ch, pat
export const CMD_SET_MUTE = 0x06; // + ch, muted
export const CMD_SET_SOLO = 0x07; // + ch, soloed
export const CMD_BUTTON_PRESS = 0x10; // + row, col, mods
export const CMD_KEY_ACTION = 0x11; // + action_id
export const CMD_SET_ROW_OFFSET = 0x12; // + ch, offset×1000 as 2×7-bit
export const CMD_SET_CHANNEL_TYPES = 0x13; // + 6 bytes
export const CMD_SET_ZOOM = 0x14; // + zoom as 3×7-bit
export const CMD_SET_CURRENT_CHANNEL = 0x15; // + ch
export const CMD_CLEAR_PATTERN = 0x19; // no payload — clears current channel's current pattern
export const CMD_ARROW_PRESS = 0x1a; // + direction, mods
export const CMD_STRIP_START = 0x1b; // + strip, pos(2×7b), shift, time_ms(3×7b)
export const CMD_STRIP_MOVE = 0x1c; // + strip, pos(2×7b), time_ms(3×7b)
export const CMD_STRIP_END = 0x1d; // + strip
export const CMD_RESET = 0x1e; // stop playback + reset tick to 0
export const CMD_GET_STATE = 0x20;
export const CMD_PING = 0x7e;

// ============ Responses (Teensy → browser) ============

export const RSP_PONG = 0x7e;
export const RSP_TICK = 0x40; // + 5×7-bit encoded i32
export const RSP_STATE = 0x41;

// ============ 7-bit Encoding Helpers ============

/** Encode a u16 as 3 × 7-bit bytes */
function encodeU16(val: number): [number, number, number] {
  return [val & 0x7f, (val >> 7) & 0x7f, (val >> 14) & 0x03];
}

/** Decode i32 from 5 × 7-bit bytes */
export function decodeI32(data: Uint8Array, offset: number): number {
  const v =
    data[offset] |
    (data[offset + 1] << 7) |
    (data[offset + 2] << 14) |
    (data[offset + 3] << 21) |
    (data[offset + 4] << 28);
  return v | 0; // convert to signed i32
}

// ============ Encoders (return full SysEx including F0/F7) ============

function sysex(...data: number[]): Uint8Array {
  return new Uint8Array([0xf0, SYSEX_MFR, ...data, 0xf7]);
}

export function encodePlay(tick: number = 0): Uint8Array {
  const t = tick & 0xffffffff;
  return sysex(
    CMD_PLAY,
    t & 0x7f,
    (t >> 7) & 0x7f,
    (t >> 14) & 0x7f,
    (t >> 21) & 0x7f,
    (t >> 28) & 0x0f,
  );
}

export function encodeStop(): Uint8Array {
  return sysex(CMD_STOP);
}

export function encodeSetBpm(bpm: number): Uint8Array {
  const bpmX100 = Math.round(bpm * 100);
  const [b0, b1, b2] = encodeU16(bpmX100);
  return sysex(CMD_SET_BPM, b0, b1, b2, 0);
}

export function encodeSetSwing(swing: number): Uint8Array {
  return sysex(CMD_SET_SWING, swing & 0x7f);
}

export function encodeSetPattern(ch: number, pat: number): Uint8Array {
  return sysex(CMD_SET_PATTERN, ch, pat);
}

export function encodeSetMute(ch: number, muted: boolean): Uint8Array {
  return sysex(CMD_SET_MUTE, ch, muted ? 1 : 0);
}

export function encodeSetSolo(ch: number, soloed: boolean): Uint8Array {
  return sysex(CMD_SET_SOLO, ch, soloed ? 1 : 0);
}

export function encodeButtonPress(
  row: number,
  col: number,
  mods: number,
): Uint8Array {
  return sysex(CMD_BUTTON_PRESS, row, col, mods);
}

export function encodeKeyAction(actionId: number): Uint8Array {
  return sysex(CMD_KEY_ACTION, actionId);
}

export function encodeArrowPress(
  direction: number,
  mods: number,
): Uint8Array {
  return sysex(CMD_ARROW_PRESS, direction, mods);
}

export function encodeStripStart(
  strip: number,
  pos: number,
  shift: boolean,
  timeMs: number,
): Uint8Array {
  const t = Math.round(timeMs) & 0x1fffff; // 21 bits
  return sysex(
    CMD_STRIP_START,
    strip,
    pos & 0x7f, (pos >> 7) & 0x7f,
    shift ? 1 : 0,
    t & 0x7f, (t >> 7) & 0x7f, (t >> 14) & 0x7f,
  );
}

export function encodeStripMove(
  strip: number,
  pos: number,
  timeMs: number,
): Uint8Array {
  const t = Math.round(timeMs) & 0x1fffff;
  return sysex(
    CMD_STRIP_MOVE,
    strip,
    pos & 0x7f, (pos >> 7) & 0x7f,
    t & 0x7f, (t >> 7) & 0x7f, (t >> 14) & 0x7f,
  );
}

export function encodeStripEnd(strip: number): Uint8Array {
  return sysex(CMD_STRIP_END, strip);
}

export function encodeReset(): Uint8Array {
  return sysex(CMD_RESET);
}

export function encodeClearPattern(): Uint8Array {
  return sysex(CMD_CLEAR_PATTERN);
}

export function encodeSetRowOffset(ch: number, offset: number): Uint8Array {
  // offset is 0.0-1.0, encode as ×1000 in 2×7-bit
  const val = Math.round(offset * 1000);
  return sysex(CMD_SET_ROW_OFFSET, ch, val & 0x7f, (val >> 7) & 0x7f);
}

export function encodeSetChannelTypes(types: number[]): Uint8Array {
  return sysex(CMD_SET_CHANNEL_TYPES, ...types.slice(0, 6));
}

export function encodeSetZoom(zoom: number): Uint8Array {
  const [b0, b1, b2] = encodeU16(zoom);
  return sysex(CMD_SET_ZOOM, b0, b1, b2);
}

export function encodeSetCurrentChannel(ch: number): Uint8Array {
  return sysex(CMD_SET_CURRENT_CHANNEL, ch);
}


export function encodeGetState(): Uint8Array {
  return sysex(CMD_GET_STATE);
}

export function encodePing(): Uint8Array {
  return sysex(CMD_PING);
}

// ============ Response Types ============

export interface TickResponse {
  type: "tick";
  tick: number;
}

export interface PongResponse {
  type: "pong";
  rowOffset0?: number;
  scaleCount?: number;
  scaleZeroIndex?: number;
  sysexCount?: number;
  lastCmd?: number;
  lastReadLen?: number;
  isPlaying?: number;
}

export interface StateResponse {
  type: "state";
  bpm: number;
  swing: number;
  zoom: number;
  currentChannel: number;
  channelTypes: number[];
  rowOffsets: number[];
  isPlaying: boolean;
}

export type TeensyResponse = TickResponse | PongResponse | StateResponse;

// ============ Response Decoder ============

/**
 * Decode a SysEx message received via Web MIDI.
 * Web MIDI delivers complete SysEx messages including F0 and F7.
 */
export function decodeSysex(data: Uint8Array): TeensyResponse | null {
  // Expect: F0 7D <cmd> [payload...] F7
  if (data.length < 3) return null;
  if (data[0] !== 0xf0) return null;
  if (data[1] !== SYSEX_MFR) return null;

  const cmd = data[2];
  // payload is data[3..length-1] (excluding F7)
  const payloadStart = 3;

  switch (cmd) {
    case RSP_PONG: {
      const pong: PongResponse = { type: "pong" };
      // Diagnostic data if present
      if (data.length >= payloadStart + 6 + 1) {
        pong.rowOffset0 = ((data[payloadStart] | (data[payloadStart + 1] << 7)) / 1000);
        pong.scaleCount = data[payloadStart + 2] | (data[payloadStart + 3] << 7);
        pong.scaleZeroIndex = data[payloadStart + 4] | (data[payloadStart + 5] << 7);
      }
      if (data.length >= payloadStart + 9 + 1) {
        pong.sysexCount = data[payloadStart + 6];
        pong.lastCmd = data[payloadStart + 7];
        pong.lastReadLen = data[payloadStart + 8];
      }
      if (data.length >= payloadStart + 10 + 1) {
        pong.isPlaying = data[payloadStart + 9];
      }
      return pong;
    }

    case RSP_TICK: {
      if (data.length < payloadStart + 5 + 1) return null;
      const tick = decodeI32(data, payloadStart);
      return { type: "tick", tick };
    }

    case RSP_STATE: {
      // Format: is_playing, bpm×100 (3b), swing, zoom (3b), current_ch, ch_types×6, row_offsets×6 (2b each)
      // Total payload: 1+3+1+3+1+6+12 = 27 bytes
      if (data.length < payloadStart + 27 + 1) return null;
      const p = payloadStart;
      const isPlaying = data[p] !== 0;
      const bpmX100 = data[p+1] | (data[p+2] << 7) | ((data[p+3] & 0x03) << 14);
      const bpm = bpmX100 / 100;
      const swing = data[p+4];
      const zoom = data[p+5] | (data[p+6] << 7) | ((data[p+7] & 0x03) << 14);
      const currentChannel = data[p+8];
      const channelTypes = Array.from(data.slice(p+9, p+15));
      const rowOffsets = Array.from({ length: 6 }, (_, i) => {
        const off = data[p+15+i*2] | (data[p+16+i*2] << 7);
        return off / 1000;
      });
      return { type: "state", bpm, swing, zoom, currentChannel, channelTypes, rowOffsets, isPlaying };
    }

    default:
      return null;
  }
}
