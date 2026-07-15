/**
 * Page-loading state machine for the relay feed. Wraps a timeline loader
 * whose observable may never complete (timedPool cuts the request at 2s but
 * completion is not propagated) — each page finalizes via complete/error or
 * a safety timeout, and an in-flight page can be cancelled (relay switch,
 * unmount) without corrupting pagination state.
 *
 * @param {object} opts
 * @param {number} [opts.timeout] - Safety timeout per page in ms
 * @param {(state: {loading: boolean, exhausted: boolean, settled: boolean}) => void} opts.onChange
 *   Called on every state transition. `settled: true` marks a page that
 *   finished naturally (complete/error/timeout) — cancellation never settles.
 * @returns {{ loadPage: (loaderFn: (() => import('rxjs').Observable<any>) | undefined) => void, reset: () => void, cancel: () => void }}
 */
export function createRelayPageLoader({ timeout = 4000, onChange }) {
  let loading = false;
  let exhausted = false;
  /** @type {(() => void) | undefined} */
  let cancelCurrent;

  /** @param {(() => import('rxjs').Observable<any>) | undefined} loaderFn */
  function loadPage(loaderFn) {
    if (!loaderFn || loading || exhausted) return;
    loading = true;
    onChange({ loading, exhausted, settled: false });

    let received = 0;
    let finished = false;
    // Declared before subscribe: complete/error can fire synchronously,
    // running finalize before sub/timer are assigned.
    /** @type {import('rxjs').Subscription | undefined} */
    let sub;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;

    function finalize() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      sub?.unsubscribe();
      loading = false;
      // A page with zero events means the relay has nothing older
      if (received === 0) exhausted = true;
      onChange({ loading, exhausted, settled: true });
    }

    cancelCurrent = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      sub?.unsubscribe();
      loading = false;
      // Cancellation must not settle or mark exhaustion — the page's
      // received count belongs to the relay that was just switched away.
      onChange({ loading, exhausted, settled: false });
    };

    sub = loaderFn().subscribe({
      next: () => {
        received++;
      },
      complete: finalize,
      error: finalize
    });
    // Already finalized synchronously — don't arm a stray timer or hold the sub
    if (finished) {
      sub.unsubscribe();
      return;
    }
    timer = setTimeout(finalize, timeout);
  }

  function cancel() {
    cancelCurrent?.();
  }

  function reset() {
    cancel();
    loading = false;
    exhausted = false;
  }

  return { loadPage, reset, cancel };
}
