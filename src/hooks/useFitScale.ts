import { useLayoutEffect, useState } from "react";

export interface FitScale {
  /** Scale factor to fit the stage in the viewport (capped at 1). */
  scale: number;
  /** Natural (unscaled) stage size in px. */
  width: number;
  height: number;
}

/**
 * Uniformly scale fixed-size "hardware panel" content to fit the viewport —
 * needed for small screens like a landscape phone. Measures the stage's
 * natural layout size (CSS transforms don't affect offsetWidth/Height) and
 * the container's content box (whose padding resolves safe-area insets).
 */
export const useFitScale = (
  containerRef: React.RefObject<HTMLElement | null>,
  stageRef: React.RefObject<HTMLElement | null>,
  ready: boolean,
): FitScale => {
  const [fit, setFit] = useState<FitScale>({ scale: 1, width: 0, height: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!ready || !container || !stage) return;

    const update = () => {
      const w = stage.offsetWidth;
      const h = stage.offsetHeight;
      if (!w || !h) return;
      const cs = getComputedStyle(container);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      // visualViewport tracks iOS Safari's collapsing toolbars
      const availW = (window.visualViewport?.width ?? window.innerWidth) - padX;
      const availH =
        (window.visualViewport?.height ?? window.innerHeight) - padY;
      const scale = Math.min(1, availW / w, availH / h);
      setFit((prev) =>
        prev.scale === scale && prev.width === w && prev.height === h
          ? prev
          : { scale, width: w, height: h },
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [containerRef, stageRef, ready]);

  return fit;
};
