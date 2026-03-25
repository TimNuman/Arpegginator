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
  return (
    (state.ctrl ? MOD_CTRL : 0) |
    (state.shift ? MOD_SHIFT : 0) |
    (state.meta ? MOD_META : 0) |
    (state.alt ? MOD_ALT : 0)
  );
}
