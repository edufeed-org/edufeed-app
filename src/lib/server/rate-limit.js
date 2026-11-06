/**
 * In-memory sliding-window rate limiter, keyed by caller (e.g. client IP).
 *
 * shortcut: per-process memory, resets on restart — fine for one container;
 * revisit with replicas (a shared store, e.g. Redis).
 */

/** Sweep at most this often, and also once a map gets this big — keeps a
 * public, unauthenticated endpoint (rotating IPv6 callers) from growing the
 * key set without bound. */
const SWEEP_SIZE_THRESHOLD = 10_000;

/**
 * @param {{ limit: number, windowMs: number }} opts
 * @returns {{ take: (key: string) => boolean, size: () => number }}
 */
export function createRateLimiter({ limit, windowMs }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  let lastSweep = Date.now();

  /** @param {number} now */
  function sweep(now) {
    const windowStart = now - windowMs;
    for (const [key, timestamps] of hits) {
      const newest = timestamps[timestamps.length - 1];
      if (newest === undefined || newest <= windowStart) hits.delete(key);
    }
    lastSweep = now;
  }

  return {
    /** @param {string} key @returns {boolean} true if this call is allowed */
    take(key) {
      const now = Date.now();
      if (now - lastSweep >= windowMs || hits.size > SWEEP_SIZE_THRESHOLD) {
        sweep(now);
      }

      const windowStart = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    /** @returns {number} number of keys currently tracked (test hook) */
    size() {
      return hits.size;
    }
  };
}
