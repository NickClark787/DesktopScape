import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly animates a numeric display from its current value to `target`
 * using requestAnimationFrame (no animation library needed). Each change in
 * `target` re-aims the tween from wherever the number currently sits, so a
 * value that updates mid-flight glides instead of snapping.
 *
 * - First mount counts up from 0 → target (the DPS "reveal" moment).
 * - Non-finite targets (e.g. ∞ TTK) are shown immediately.
 * - prefers-reduced-motion: jumps straight to the target, no tween.
 */
const prefersReduced = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export function useCountUp(target: number, durationMs = 650): number {
  const [value, setValue] = useState(() => (prefersReduced || !isFinite(target) ? target : 0));
  // Mirror the latest rendered value so a new tween starts from the on-screen
  // number rather than a stale closure capture.
  const valueRef = useRef(value);
  valueRef.current = value;
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!isFinite(target) || prefersReduced) {
      setValue(target);
      return undefined;
    }
    const from = valueRef.current;
    if (from === target) return undefined;

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(from + (target - from) * easeOutCubic(t));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return value;
}
