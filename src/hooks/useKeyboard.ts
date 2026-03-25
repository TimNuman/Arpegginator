import { useState, useEffect, useRef } from 'react';

export interface KeyboardState {
  // Currently pressed keys (lowercase)
  pressedKeys: Set<string>;

  // Modifier states
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

interface UseKeyboardOptions {
  /**
   * Called on keydown, return true to prevent default
   */
  onKeyDown?: (key: string, code: string, event: KeyboardEvent, state: KeyboardState) => boolean | void;

  /**
   * Called on keyup
   */
  onKeyUp?: (key: string, code: string, event: KeyboardEvent, state: KeyboardState) => void;

  /**
   * Whether the hook is active
   */
  enabled?: boolean;
}

const createInitialState = (): KeyboardState => ({
  pressedKeys: new Set(),
  shift: false,
  alt: false,
  ctrl: false,
  meta: false,
});

export function useKeyboard(options: UseKeyboardOptions = {}): KeyboardState {
  const { onKeyDown, onKeyUp, enabled = true } = options;

  const [state, setState] = useState<KeyboardState>(createInitialState);

  // Use refs to avoid stale closures in event handlers
  const stateRef = useRef(state);
  const onKeyDownRef = useRef(onKeyDown);
  const onKeyUpRef = useRef(onKeyUp);

  useEffect(() => {
    stateRef.current = state;
    onKeyDownRef.current = onKeyDown;
    onKeyUpRef.current = onKeyUp;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const code = e.code;

      // Update modifier states
      const newState: KeyboardState = {
        pressedKeys: new Set(stateRef.current.pressedKeys),
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
      };

      // Track the key
      newState.pressedKeys.add(key);

      setState(newState);

      // Call user callback
      if (onKeyDownRef.current) {
        const shouldPrevent = onKeyDownRef.current(key, code, e, newState);
        if (shouldPrevent) {
          e.preventDefault();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const code = e.code;

      const newState: KeyboardState = {
        pressedKeys: new Set(stateRef.current.pressedKeys),
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
      };

      newState.pressedKeys.delete(key);
      setState(newState);

      // Call user callback
      if (onKeyUpRef.current) {
        onKeyUpRef.current(key, code, e, newState);
      }
    };

    // Handle blur - reset all keys when window loses focus
    const handleBlur = () => {
      setState(createInitialState());
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      // Reset state when listeners are removed (disabled or unmount)
      setState(createInitialState());
    };
  }, [enabled]);

  return state;
}
