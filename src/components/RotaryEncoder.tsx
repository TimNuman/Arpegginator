import { memo, useCallback, useRef } from "react";
import { css } from "@emotion/react";
import { chrome } from "../theme/chrome";
import { dims, px } from "../theme/dimensions";

// Rotation/steps tuning
const TOUCH_DEG_PER_STEP = 44; // ~8 steps per full circle
const MOUSE_PX_PER_STEP = 28; // vertical drag distance per step
const MOUSE_DEG_PER_PX = 1.6; // visual spin feedback for mouse drags

const encoderStyles = (size: number) => css`
  width: ${size}px;
  height: ${size}px;
  border-radius: 50%;
  /* The collar the knob turns in — a ring cut into the case */
  background: ${chrome.case};
  border: 1px solid ${chrome.caseShadow};
  box-shadow:
    inset 1px 1px 2px rgba(0, 0, 0, 0.35),
    inset -1px -1px 0 ${chrome.caseLight},
    0 1px 0 ${chrome.caseLight};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  position: relative;
  touch-action: none;
  user-select: none;

  &:active {
    cursor: grabbing;
  }

  /* Short screens (landscape phone): the UI is scaled down, so a larger
     natural size keeps circular drags comfortable under a finger */
  @media (max-height: 520px) {
    width: 110px;
    height: 110px;
  }
`;

/** Milled grip around a moulded centre cap. The cap carries the axis color
    this encoder drives, matching the button it lights up on the panel — so
    the yellow knob and the yellow button on screen are the same yellow.
    Everything in the cap is radially symmetric, because the knob spins. */
const knobStyles = (tint: string) => css`
  width: 75%;
  height: 75%;
  border-radius: 50%;
  background:
    radial-gradient(
      circle closest-side,
      rgba(255, 255, 255, 0.3) 0 24%,
      rgba(255, 255, 255, 0) 54%
    ),
    radial-gradient(
      circle closest-side,
      ${tint} 0 64%,
      rgba(0, 0, 0, 0.34) 64% 68%,
      rgba(0, 0, 0, 0) 68%
    ),
    radial-gradient(circle at 34% 26%, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0) 54%),
    repeating-conic-gradient(${chrome.capMid} 0deg 6deg, ${chrome.capTop} 6deg 12deg);
  border: 1px solid ${chrome.caseDark};
  box-shadow:
    inset 0 0 0 2px ${chrome.capTop},
    inset 0 0 4px rgba(0, 0, 0, 0.28),
    0 2px 3px rgba(0, 0, 0, 0.4);
  position: relative;
  will-change: transform;

  /* Position indicator, sitting in the grip band outside the cap */
  &::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 7%;
    width: 3px;
    height: 17%;
    margin-left: -1.5px;
    background: ${chrome.caseDark};
    border-radius: 2px;
  }
`;

const labelStyles = css`
  margin-top: ${px(1)}px;
  font-size: ${px(2.2)}px;
  letter-spacing: 2px;
  color: ${chrome.inkDim};
  text-align: center;
  user-select: none;
`;

interface RotaryEncoderProps {
  /**
   * Called once per detent step. +1 for clockwise / upward mouse drag,
   * -1 for counterclockwise / downward mouse drag. Fast drags fire it
   * multiple times in a row.
   */
  onStep: (direction: 1 | -1) => void;
  /** Small caption under the knob (e.g. arrow glyphs) */
  label?: string;
  /** Centre-cap color; use a chrome.panel value so it matches the display */
  tint?: string;
  /** Knob diameter in px — dims.encoder is the real 16 mm part */
  size?: number;
}

interface DragState {
  pointerId: number;
  /** Circular (touch/pen) vs vertical (mouse) tracking */
  circular: boolean;
  lastAngle: number;
  lastY: number;
  /** Accumulated degrees (circular) or px (vertical) toward the next step */
  accum: number;
}

/**
 * A functional rotary encoder emitting detent steps:
 * - touch/pen: drag in circles around the knob — clockwise = +1 steps
 * - mouse: drag vertically — up = +1 steps, down = -1
 */
export const RotaryEncoder = memo(
  ({ onStep, label, tint = chrome.capTop, size = dims.encoder }: RotaryEncoderProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const knobRef = useRef<HTMLDivElement>(null);
    const drag = useRef<DragState | null>(null);
    const rotation = useRef(0); // visual knob angle in degrees

    const spinTo = useCallback((deltaDeg: number) => {
      rotation.current += deltaDeg;
      if (knobRef.current) {
        knobRef.current.style.transform = `rotate(${rotation.current}deg)`;
      }
    }, []);

    const angleAt = useCallback((clientX: number, clientY: number): number => {
      const r = containerRef.current!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI;
    }, []);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        containerRef.current?.setPointerCapture(e.pointerId);
        drag.current = {
          pointerId: e.pointerId,
          circular: e.pointerType !== "mouse",
          lastAngle: angleAt(e.clientX, e.clientY),
          lastY: e.clientY,
          accum: 0,
        };
      },
      [angleAt],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.pointerId) return;

        if (d.circular) {
          // Angular delta, normalized to (-180, 180] to survive the ±180° wrap
          const a = angleAt(e.clientX, e.clientY);
          let delta = a - d.lastAngle;
          if (delta > 180) delta -= 360;
          if (delta <= -180) delta += 360;
          d.lastAngle = a;
          d.accum += delta;
          spinTo(delta);

          while (d.accum >= TOUCH_DEG_PER_STEP) {
            d.accum -= TOUCH_DEG_PER_STEP;
            onStep(1);
          }
          while (d.accum <= -TOUCH_DEG_PER_STEP) {
            d.accum += TOUCH_DEG_PER_STEP;
            onStep(-1);
          }
        } else {
          // Mouse: vertical drag, up = clockwise
          const dy = d.lastY - e.clientY;
          d.lastY = e.clientY;
          d.accum += dy;
          spinTo(dy * MOUSE_DEG_PER_PX);

          while (d.accum >= MOUSE_PX_PER_STEP) {
            d.accum -= MOUSE_PX_PER_STEP;
            onStep(1);
          }
          while (d.accum <= -MOUSE_PX_PER_STEP) {
            d.accum += MOUSE_PX_PER_STEP;
            onStep(-1);
          }
        }
      },
      [angleAt, onStep, spinTo],
    );

    const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      drag.current = null;
      containerRef.current?.releasePointerCapture(e.pointerId);
    }, []);

    return (
      <div>
        <div
          ref={containerRef}
          css={encoderStyles(size)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div ref={knobRef} css={knobStyles(tint)} />
        </div>
        {label && <div css={labelStyles}>{label}</div>}
      </div>
    );
  },
);

RotaryEncoder.displayName = "RotaryEncoder";
