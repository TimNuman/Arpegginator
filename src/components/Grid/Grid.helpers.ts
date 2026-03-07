import { MOD_CTRL, MOD_SHIFT, MOD_META, MOD_ALT } from "./Grid.config";

export const noop = () => {};

/** Convert uint32 packed 0xRRGGBB to "#RRGGBB" hex string */
export function uint32ToHex(val: number): string {
  const r = (val >> 16) & 0xff;
  const g = (val >> 8) & 0xff;
  const b = val & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Encode modifier keys into bit flags matching engine_input */
export function encodeModifiers(state: {
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  alt: boolean;
}): number {
  let flags = 0;
  if (state.ctrl) flags |= MOD_CTRL;
  if (state.shift) flags |= MOD_SHIFT;
  if (state.meta) flags |= MOD_META;
  if (state.alt) flags |= MOD_ALT;
  return flags;
}
