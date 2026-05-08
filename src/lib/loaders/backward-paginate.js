/**
 * Backward pagination over a single relay by `created_at`.
 *
 * Background: when a relay receives a bulk-dump from one author within a
 * narrow `created_at` window, a single REQ with `limit: N` returns N events
 * from that window — events from other authors with older `created_at` never
 * surface server-side. Paging backward with `until = oldestSeen - 1` walks
 * past the dump and lets older events through.
 *
 * Stops when:
 *   - the relay returns fewer than `pageSize` events on a page (exhausted), or
 *   - `maxRounds` rounds completed.
 */
import { Observable } from 'rxjs';
import { timedPool } from './base.js';

/**
 * @param {string} relay
 * @param {import('nostr-tools').Filter} baseFilter - filter WITHOUT `until` or `limit`
 * @param {{ maxRounds?: number, pageSize?: number }} [opts]
 * @returns {Observable<import('nostr-tools').NostrEvent>}
 */
export function backwardPaginateRelay(relay, baseFilter, opts = {}) {
  const { maxRounds = 10, pageSize = 100 } = opts;

  return new Observable((subscriber) => {
    let round = 0;
    /** @type {number | undefined} */
    let oldestCreatedAt;
    /** @type {import('rxjs').Subscription | undefined} */
    let currentSub;
    let torndown = false;

    function startRound() {
      if (torndown || round >= maxRounds) {
        subscriber.complete();
        return;
      }
      round++;
      /** @type {any} */
      const filter = { ...baseFilter, limit: pageSize };
      if (oldestCreatedAt !== undefined) filter.until = oldestCreatedAt - 1;

      let received = 0;
      let roundOldest = Infinity;

      currentSub = timedPool([relay], filter).subscribe({
        next: (e) => {
          received++;
          if (e.created_at < roundOldest) roundOldest = e.created_at;
          subscriber.next(e);
        },
        error: (err) => subscriber.error(err),
        complete: () => {
          if (torndown) return;
          if (received < pageSize) {
            subscriber.complete(); // relay exhausted
            return;
          }
          oldestCreatedAt = roundOldest;
          startRound();
        }
      });
    }

    startRound();
    return () => {
      torndown = true;
      currentSub?.unsubscribe();
    };
  });
}
