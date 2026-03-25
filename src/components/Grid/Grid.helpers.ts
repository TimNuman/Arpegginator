import { MOD_CTRL, MOD_SHIFT, MOD_META, MOD_ALT } from "./Grid.config";

export const noop = () => {};

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
