import { memo, useRef, useEffect } from "react";
import type { WasmEngine } from "../engine/WasmEngine";
import { markDirty } from "../store/renderStore";

interface TouchStripProps {
  orientation: "vertical" | "horizontal";
  strip: number; // 0=vertical, 1=horizontal
  wasmEngine: WasmEngine;
  length?: number;
  thickness?: number;
}

// If no pointermove arrives within this time, assume the finger/button lifted.
// Works around macOS trackpad delaying pointerup by ~600ms.
const IDLE_TIMEOUT_MS = 80;

export const TouchStrip = memo(
  ({
    orientation,
    strip,
    wasmEngine,
    length = 300,
    thickness = 28,
  }: TouchStripProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const idleTimer = useRef(0);
    const pointerId = useRef(-1);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const toRawPointer = (e: PointerEvent): number => {
        const rect = container.getBoundingClientRect();
        const pos =
          orientation === "vertical"
            ? (e.clientY - rect.top) / rect.height
            : (e.clientX - rect.left) / rect.width;
        return Math.round(Math.max(0, Math.min(1, pos)) * 1024);
      };

      const endDrag = () => {
        if (!isDragging.current) return;
        if (pointerId.current >= 0) {
          container.releasePointerCapture(pointerId.current);
        }
        isDragging.current = false;
        clearTimeout(idleTimer.current);
        wasmEngine.stripEnd(strip);
        markDirty();
      };

      const resetIdleTimer = () => {
        clearTimeout(idleTimer.current);
        idleTimer.current = window.setTimeout(() => {
          endDrag();
        }, IDLE_TIMEOUT_MS);
      };

      const handlePointerDown = (e: PointerEvent) => {
        e.preventDefault();
        container.setPointerCapture(e.pointerId);
        pointerId.current = e.pointerId;
        isDragging.current = true;
        wasmEngine.stripStart(
          strip,
          toRawPointer(e),
          e.shiftKey,
          performance.now(),
        );
        markDirty();
        resetIdleTimer();
      };

      const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging.current) return;
        if (e.buttons === 0) {
          endDrag();
          return;
        }
        wasmEngine.stripMove(strip, toRawPointer(e), performance.now());
        markDirty();
        resetIdleTimer();
      };

      const handlePointerUp = () => {
        endDrag();
      };

      container.addEventListener("pointerdown", handlePointerDown);
      container.addEventListener("pointermove", handlePointerMove);
      container.addEventListener("pointerup", handlePointerUp);
      container.addEventListener("pointercancel", handlePointerUp);

      return () => {
        clearTimeout(idleTimer.current);
        container.removeEventListener("pointerdown", handlePointerDown);
        container.removeEventListener("pointermove", handlePointerMove);
        container.removeEventListener("pointerup", handlePointerUp);
        container.removeEventListener("pointercancel", handlePointerUp);
      };
    }, [orientation, strip, wasmEngine]);

    const isHorizontal = orientation === "horizontal";

    return (
      <div
        ref={containerRef}
        style={{
          width: isHorizontal ? length : thickness,
          height: isHorizontal ? thickness : length,
          background: "linear-gradient(145deg, #2a1a2a, #1a0a1a)",
          borderRadius: thickness / 2,
          cursor: "grab",
          touchAction: "none",
          userSelect: "none",
          boxShadow: "inset 0 2px 8px rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      />
    );
  },
);

TouchStrip.displayName = "TouchStrip";
