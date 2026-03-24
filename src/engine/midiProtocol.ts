// midiProtocol.ts — SysEx protocol for Teensy control via Web MIDI
// Must match protocol definitions in teensy/src/main.rs
//
// All messages are SysEx: F0 7D <cmd> [data...] F7
// 7D = educational/development manufacturer ID (no registration needed)
// All data bytes must be 0-127 (7-bit) per MIDI spec

export const SYSEX_MFR = 0x7d;

// ============ Commands (browser → Teensy) ============

export const CMD_PLAY = 0x01;
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
export const CMD_SET_UI_MODE = 0x16; // + mode
export const CMD_SET_SELECTED_EVENT = 0x17; // + idx as 2×7-bit (signed)
export const CMD_SET_MODIFY_SUB_MODE = 0x18; // + sm
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

export function encodePlay(): Uint8Array {
  return sysex(CMD_PLAY);
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

export function encodeSetRowOffset(ch: number, offset: number): Uint8Array {
  // offset is 0.0-1.0, encode as ×1000 in 2×7-bit
  const val = Math.round(offset * 1000);
  return sysex(CMD_SET_ROW_OFFSET, ch, val & 0x7f, (val >> 7) & 0x7f);
}

/** Encode all 6 row offsets in a single SysEx message */
export function encodeSetAllRowOffsets(offsets: number[]): Uint8Array {
  const data: number[] = [CMD_SET_ROW_OFFSET, 0x7f]; // 0x7F = "all channels" flag
  for (let i = 0; i < 6; i++) {
    const val = Math.round((offsets[i] ?? 0) * 1000);
    data.push(val & 0x7f, (val >> 7) & 0x7f);
  }
  return sysex(...data);
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

export function encodeSetUiMode(mode: number): Uint8Array {
  return sysex(CMD_SET_UI_MODE, mode);
}

export function encodeSetSelectedEvent(idx: number): Uint8Array {
  // idx is i16 (-1 = no selection). Encode as unsigned + sign bit
  const unsigned = idx < 0 ? (-idx) : idx;
  const sign = idx < 0 ? 1 : 0;
  return sysex(CMD_SET_SELECTED_EVENT, unsigned & 0x7f, (unsigned >> 7) & 0x7f, sign);
}

export function encodeSetModifySubMode(sm: number): Uint8Array {
  return sysex(CMD_SET_MODIFY_SUB_MODE, sm);
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

    case RSP_STATE:
      return { type: "state" };

    default:
      return null;
  }
}
