/**
 * A standing relay subscription that outlives the pool's patience.
 *
 * `pool.relay(url).subscription(filters)` (applesauce-relay) retries the
 * websocket a few times and then errors the observable for good — after a
 * longer outage of the groups relay the breakout rosters, the call presence
 * and the broadcasts went silent for the rest of the call, while the stage
 * kept showing rooms that were long gone. `resubscribing` reopens such a
 * subscription after a delay that doubles up to a cap, and starts over at
 * the short delay once events flow again. Stopping cancels the subscription
 * and any pending reopen.
 */

export const RESUBSCRIBE_DELAY_MS = 5_000;
export const RESUBSCRIBE_MAX_DELAY_MS = 60_000;

/**
 * @template T
 * @param {() => {subscribe: (observer: {next: (value: T) => void, error: (err: unknown) => void, complete: () => void}) => {unsubscribe: () => void}}} open
 *   opens a fresh subscription (an observable); called again on every reopen
 * @param {{next: (value: T) => void, error?: (err: unknown) => void}} observer
 *   `error` is told about every failure (before the reopen is scheduled)
 * @param {{delayMs?: number, maxDelayMs?: number, beforeReopen?: () => Promise<unknown>}} [opts]
 *   `beforeReopen`: awaited before every reopen (never before the first
 *   open) — the place to authenticate the fresh connection (NIP-42): a relay
 *   that gates a private group's events answers an unauthenticated REQ with
 *   a clean, empty EOSE, so a blind reopen would watch nothing. Its failure
 *   is ignored; the reopen happens either way.
 * @returns {() => void} stop
 */
export function resubscribing(open, observer, opts = {}) {
  const base = opts.delayMs ?? RESUBSCRIBE_DELAY_MS;
  const max = opts.maxDelayMs ?? RESUBSCRIBE_MAX_DELAY_MS;
  let delay = base;
  let stopped = false;
  /** @type {{unsubscribe: () => void} | null} */
  let sub = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;

  const reopenLater = () => {
    if (stopped) return;
    const wait = delay;
    delay = Math.min(delay * 2, max);
    timer = setTimeout(() => {
      if (stopped) return;
      const before = opts.beforeReopen;
      if (!before) {
        start();
        return;
      }
      Promise.resolve()
        .then(before)
        .catch(() => {})
        .then(() => start());
    }, wait);
  };

  const start = () => {
    if (stopped) return;
    let current = /** @type {{unsubscribe: () => void} | null} */ (null);
    current = open().subscribe({
      next: (value) => {
        // A real event: the relay is back, the next outage starts short again.
        if (value && typeof value === 'object') delay = base;
        observer.next(value);
      },
      error: (err) => {
        if (sub === current) sub = null;
        observer.error?.(err);
        reopenLater();
      },
      // A relay that closes the subscription (CLOSED) is as good as an error
      // for a standing watch: open it again.
      complete: () => {
        if (sub === current) sub = null;
        reopenLater();
      }
    });
    sub = current;
  };

  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    sub?.unsubscribe();
    sub = null;
  };
}
