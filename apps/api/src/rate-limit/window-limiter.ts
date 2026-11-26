/** A limit per key in fixed windows, in this process's memory: lost on a restart, not shared. */
export type WindowLimiter = {
  /** Counts one for the key and answers whether it is still within the limit. */
  take(key: string): boolean;
  /** How many keys it holds now. Tests. */
  size(): number;
};

/**
 * At most `max` per key in each window of `windowMs`, starting at a key's first request. Keys
 * whose window has passed are forgotten on the next `take`, at most once per window, so the map
 * holds no more than the keys of the last two windows.
 */
export function createWindowLimiter(options: {
  max: number;
  windowMs: number;
  now?: () => number;
}): WindowLimiter {
  const { max, windowMs } = options;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: number; count: number }>();
  let prunedAt = now();

  return {
    take(key) {
      const at = now();
      if (at - prunedAt >= windowMs) {
        for (const [oldKey, window] of windows) {
          if (at - window.startedAt >= windowMs) windows.delete(oldKey);
        }
        prunedAt = at;
      }
      const window = windows.get(key);
      if (window === undefined || at - window.startedAt >= windowMs) {
        windows.set(key, { startedAt: at, count: 1 });
        return true;
      }
      window.count += 1;
      return window.count <= max;
    },
    size: () => windows.size,
  };
}
