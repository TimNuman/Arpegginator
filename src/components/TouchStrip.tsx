import { memo, useRef, useEffect } from 'react';

interface TouchStripProps {
  orientation: 'vertical' | 'horizontal';
  value: number;
  onChange: (value: number) => void;
  onShiftChange?: (delta: number) => void; // Called with relative delta (in items) when shift is held
  onShiftEnd?: () => void; // Called when shift-drag ends
  length?: number;
  thickness?: number;
  totalItems: number; // Total number of items (rows or cols)
  visibleItems: number; // Number of visible items
  itemSize: number; // Size of each item in pixels (button height/width)
}

const FRICTION = 0.94;
const MIN_VELOCITY = 0.0008;

export const TouchStrip = memo(({
  orientation,
  value,
  onChange,
  onShiftChange,
  onShiftEnd,
  length = 300,
  thickness = 28,
  totalItems,
  visibleItems,
  itemSize,
}: TouchStripProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isShiftDragging = useRef(false);
  const lastPos = useRef(0);
  const lastTime = useRef(0);
  const velocity = useRef(0);
  const currentValue = useRef(value);
  const animationId = useRef<number | null>(null);
  const onShiftChangeRef = useRef(onShiftChange);
  onShiftChangeRef.current = onShiftChange;
  const onShiftEndRef = useRef(onShiftEnd);
  onShiftEndRef.current = onShiftEnd;

  // Calculate how many items can be scrolled
  const scrollableItems = totalItems - visibleItems;
  // One item's worth of scroll in value (0-1) terms
  const valuePerItem = scrollableItems > 0 ? 1 / scrollableItems : 0;

  useEffect(() => {
    if (!isDragging.current && animationId.current === null) {
      currentValue.current = value;
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (animationId.current !== null) {
        cancelAnimationFrame(animationId.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stopAnimation = () => {
      if (animationId.current !== null) {
        cancelAnimationFrame(animationId.current);
        animationId.current = null;
      }
    };

    const runInertia = () => {
      const animate = () => {
        if (Math.abs(velocity.current) < MIN_VELOCITY) {
          animationId.current = null;
          return;
        }

        velocity.current *= FRICTION;
        const next = Math.max(0, Math.min(1, currentValue.current + velocity.current));
        currentValue.current = next;
        onChange(next);

        animationId.current = requestAnimationFrame(animate);
      };
      animationId.current = requestAnimationFrame(animate);
    };

    const getPos = (e: MouseEvent | Touch) => {
      return orientation === 'vertical' ? e.clientY : e.clientX;
    };

    const onStart = (pos: number, shiftKey: boolean) => {
      stopAnimation();
      isDragging.current = true;
      isShiftDragging.current = shiftKey && !!onShiftChangeRef.current;
      lastPos.current = pos;
      lastTime.current = performance.now();
      velocity.current = 0;

      // Shift-drag: send zero delta to signal scrub start
      if (isShiftDragging.current) {
        onShiftChangeRef.current!(0);
      }
    };

    const onMove = (pos: number) => {
      if (!isDragging.current) return;

      // Shift-drag: relative delta in pixels → items
      if (isShiftDragging.current) {
        const delta = pos - lastPos.current;
        const itemsDelta = delta / itemSize;
        onShiftChangeRef.current!(itemsDelta);
        lastPos.current = pos;
        return;
      }

      const now = performance.now();
      const dt = now - lastTime.current;
      const delta = pos - lastPos.current;

      // Convert pixel delta to value delta: 1 itemSize = 1 item scroll
      // Negative to reverse direction (touchscreen style)
      const itemsDragged = delta / itemSize;
      const valueDelta = -itemsDragged * valuePerItem;

      if (dt > 0 && dt < 100) {
        velocity.current = valueDelta / dt * 16;
      }

      const next = Math.max(0, Math.min(1, currentValue.current + valueDelta));
      currentValue.current = next;
      onChange(next);

      lastPos.current = pos;
      lastTime.current = now;
    };

    const onEnd = () => {
      if (!isDragging.current) return;
      const wasShift = isShiftDragging.current;
      isDragging.current = false;
      isShiftDragging.current = false;

      if (wasShift) {
        onShiftEndRef.current?.();
      } else if (Math.abs(velocity.current) > MIN_VELOCITY) {
        runInertia();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      onStart(getPos(e), e.shiftKey);
    };

    const handleMouseMove = (e: MouseEvent) => {
      onMove(getPos(e));
    };

    const handleMouseUp = () => {
      onEnd();
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      onStart(getPos(e.touches[0]), e.shiftKey);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging.current) {
        e.preventDefault();
        onMove(getPos(e.touches[0]));
      }
    };

    const handleTouchEnd = () => {
      onEnd();
    };

    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [orientation, length, onChange, itemSize, valuePerItem]);

  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      ref={containerRef}
      style={{
        width: isHorizontal ? length : thickness,
        height: isHorizontal ? thickness : length,
        background: 'linear-gradient(145deg, #2a1a2a, #1a0a1a)',
        borderRadius: thickness / 2,
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    />
  );
});

TouchStrip.displayName = 'TouchStrip';
