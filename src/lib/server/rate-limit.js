/**
 * Fixed-window rate limit per client key, in process memory.
 *
 * shortcut: per-process state — fine for the single Node container we run;
 * several replicas would each allow `max` per window.
 *
 * Keys are client addresses from `event.getClientAddress()`, which is only the
 * real client when adapter-node knows the proxy header (ADDRESS_HEADER /
 * XFF_DEPTH in the deployment env); otherwise every visitor shares the proxy's
 * address and one bucket.
 *
 * @param {{ max: number, windowMs: number, now?: () => number }} options
 */
export function createRateLimiter({ max, windowMs, now = Date.now }) {
  /** @type {Map<string, { start: number, count: number }>} */
  const windows = new Map();
  let lastSweep = now();

  /**
   * Record one hit for `key`.
   * @param {string} key
   * @returns {number} 0 when allowed, else the seconds until the window resets
   */
  function hit(key) {
    const t = now();
    if (t - lastSweep >= windowMs) {
      for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
      lastSweep = t;
    }
    let w = windows.get(key);
    if (!w || t - w.start >= windowMs) {
      w = { start: t, count: 0 };
      windows.set(key, w);
    }
    w.count++;
    if (w.count <= max) return 0;
    return Math.max(1, Math.ceil((w.start + windowMs - t) / 1000));
  }

  hit.size = () => windows.size;
  return hit;
}

/**
 * 429 response for a refused hit.
 * @param {number} retryAfter - seconds
 */
export function tooManyRequests(retryAfter) {
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) }
  });
}

/**
 * Rate-limit key for a request: the client address, or one shared bucket when
 * the adapter can't tell (dev server quirks, unit tests).
 * @param {{ getClientAddress?: () => string }} event
 */
export function clientKey(event) {
  try {
    return event.getClientAddress?.() || 'unknown';
  } catch {
    return 'unknown';
  }
}
