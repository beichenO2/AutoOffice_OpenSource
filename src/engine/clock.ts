/** Injectable clock so timestamps are deterministic in tests. */
export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

/** Monotonic fixed clock starting at `startMs`, advancing `stepMs` per call. */
export function fixedClock(startMs = 0, stepMs = 1000): Clock {
  let t = startMs;
  return () => {
    const iso = new Date(t).toISOString();
    t += stepMs;
    return iso;
  };
}
