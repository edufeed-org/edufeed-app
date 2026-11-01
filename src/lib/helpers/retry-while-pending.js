/**
 * Spaced retries for a lookup that may miss while the page is still busy
 * connecting relays (see referenced-event.svelte.js / list-items.svelte.js).
 * Dependency-free on purpose: hooks import it beside loaders that tests mock.
 */
/** Delays before re-asking the network after a miss (one retry per entry). */
export const RETRY_DELAYS_MS = [3000, 10000];

/**
 * Run `load()` now and, each time it completes while `pending()` still holds,
 * once more after the next delay. A miss while a page is busy opening dozens
 * of relay connections is no evidence the event is gone; a few spaced
 * retries are what turns that miss into the event. Nothing runs when nothing
 * is pending (a store hit). Returns the teardown: it stops the running load
 * and any scheduled retry.
 *
 * @param {() => import('rxjs').Observable<any>} load
 * @param {() => boolean} pending
 * @param {number[]} [delaysMs]
 * @returns {() => void}
 */
export function retryWhilePending(load, pending, delaysMs = RETRY_DELAYS_MS) {
  /** @type {import('rxjs').Subscription | undefined} */
  let sub;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let stopped = false;
  /** @param {number} attempt */
  const run = (attempt) => {
    if (stopped || !pending()) return;
    sub = load().subscribe({
      complete: () => {
        const delay = delaysMs[attempt];
        if (!stopped && pending() && delay !== undefined) {
          timer = setTimeout(() => run(attempt + 1), delay);
        }
      },
      error: () => {}
    });
  };
  run(0);
  return () => {
    stopped = true;
    sub?.unsubscribe();
    clearTimeout(timer);
  };
}
