/**
 * In-memory sliding-window rate limiter, keyed by caller (e.g. client IP).
 *
 * shortcut: per-process memory, resets on restart — fine for one container;
 * revisit with replicas (a shared store, e.g. Redis).
 */

/**
 * @param {{ limit: number, windowMs: number }} opts
 * @returns {{ take: (key: string) => boolean }}
 */
export function createRateLimiter({ limit, windowMs }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  return {
    /** @param {string} key @returns {boolean} true if this call is allowed */
    take(key) {
      const now = Date.now();
      const windowStart = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    }
  };
}
