/**
 * Relay-backed AppSync for shared channel sessions (spec §4). The append-only
 * contract from local-sync.js is preserved: one sort over the paginated
 * backfill, then arrival order forever — a late 9450 with an older
 * created_at is APPENDED, never spliced (CRDT payloads are commutative;
 * serials must not reshuffle).
 * Auth: relies on the caller's proactive authenticateOnce on the same
 * relayConn (GroupChat does this on mount) — NIP-42 is per-connection. An
 * optional `authenticate` callback lets this module retry ONE auth-shaped
 * read failure itself (paging or the live subscription), for the case where
 * the proactive auth hadn't landed yet when the session's own reads started.
 */
import { isAuthRequiredError, isRestrictedError } from '$lib/groups/relay-auth.js';
import {
  WEBXDC_STATE_KIND,
  WEBXDC_REALTIME_KIND,
  buildStateTemplate,
  buildRealtimeTemplate,
  parseStateEvent,
  parseRealtimeEvent
} from './session-events.js';

/** Page size for the stored-state backfill REQ, and the "did another page
 * exist" signal (a page shorter than this is the last one). */
const PAGE_LIMIT = 500;
/** Hard cap on backfill pages — a relay that never shrinks its page below
 * PAGE_LIMIT would otherwise page forever. */
const MAX_PAGES = 10;
/** Relays that send events but never EOSE/complete are a known failure class
 * in this codebase (see timeline-loader-never-completes) — bound EACH page
 * request so a hanging relay freezes the backfill with whatever it already
 * has instead of hanging the session open forever. */
const PAGE_TIMEOUT_MS = 5000;
/** Drop-to-latest throttle window for realtime frames (finding: unthrottled
 * frames each cost a signature+publish, which is ruinous for NIP-46
 * signers). */
const REALTIME_THROTTLE_MS = 100;
/** The live subscription's `since` starts this many seconds BEHIND the newest
 * backfilled created_at. A peer whose clock runs behind stamps its events
 * older than our newest — `since = newest` would filter them out forever
 * (silent CRDT divergence). seenIds absorbs the replayed overlap. */
const LIVE_OVERLAP_SEC = 300;

/**
 * @param {{relayConn: any, groupId: string, sessionId: string,
 *          publish: (template: any) => Promise<any>,
 *          onError?: (err: unknown, phase: 'read' | 'write') => void,
 *          selfPubkey?: string,
 *          authenticate?: () => Promise<any>}} args
 * @returns {import('./local-sync.js').AppSync & {stop: () => void}}
 */
export function createGroupSync({
  relayConn,
  groupId,
  sessionId,
  publish,
  onError,
  selfPubkey,
  authenticate
}) {
  /** @type {Array<{payload:any, info?:*, document?:*, summary?:*}>} */
  let updates = [];
  const seenIds = new Set();
  // No separate "backfill done" flag: the live subscription only opens once
  // fetchBackfill()'s promise settles, so there's no window where a live
  // event could arrive before the backfill has been folded in (unlike the
  // old freeze()-guarded design, which raced live events against an EOSE).
  // The live sub's own EOSE is a no-op, and seenIds absorbs any overlap.
  let stopped = false;
  // One retry total across the whole read path (paging + live subscription):
  // a relay that is STILL unauthenticated/restricted after one authenticate()
  // call is not going to be fixed by asking again.
  let authRetried = false;
  const subscribers = new Set();

  const notify = () => {
    for (const cb of subscribers) {
      try {
        cb();
      } catch (err) {
        console.error('webxdc group-sync subscriber failed:', err);
      }
    }
  };

  /** @param {any} event */
  const append = (event) => {
    if (!event?.id || seenIds.has(event.id)) return false;
    const parsed = parseStateEvent(event);
    if (!parsed) return false;
    seenIds.add(event.id);
    updates = [...updates, parsed];
    return true;
  };

  const stateFilter = () => ({
    kinds: [WEBXDC_STATE_KIND],
    '#h': [groupId],
    '#i': [sessionId]
  });

  const isAuthFamilyError = (/** @type {unknown} */ err) =>
    isAuthRequiredError(err) || isRestrictedError(err);

  /** Claims the one-shot read retry, or refuses if already used/unavailable.
   * @param {unknown} err
   */
  const claimAuthRetry = (err) => {
    if (authRetried || !authenticate || !isAuthFamilyError(err)) return false;
    authRetried = true;
    return true;
  };

  // The in-flight page request's subscription (and its resolver), so stop()
  // can cancel a page that's still waiting and unstick the awaiting
  // fetchBackfill loop instead of leaving it hung forever.
  /** @type {import('rxjs').Subscription | null} */
  let pageSub = null;
  /** @type {((events: any[]) => void) | null} */
  let resolvePendingPage = null;

  /** One page of stored 9450s, bounded above by `until` when given.
   *
   * Bounded below (completion, not just first-event) by an own timer:
   * applesauce's `Relay.request(filter, {timeout})` only bounds time-to-
   * FIRST-event — once one event has arrived, completion depends solely on
   * the relay's own EOSE. A relay that emits events but never EOSEs would
   * otherwise leave this page (and the whole backfill) hanging forever — the
   * same failure class `timedPool` covers elsewhere. The request's own
   * `{timeout}` still covers the zero-event case (errors → caught by the
   * caller → freeze-empty path).
   *
   * Resolves `{events, truncated}` — `truncated` marks a page cut short by
   * OUR timer rather than completed by the relay. A truncated page must not
   * be read as "final short page": a slow-but-healthy relay may hold more
   * history, which the caller keeps paging for.
   * @param {number} [until]
   * @returns {Promise<{events: any[], truncated: boolean}>} */
  function fetchPage(until) {
    const filter = {
      ...stateFilter(),
      limit: PAGE_LIMIT,
      ...(until !== undefined ? { until } : {})
    };
    return /** @type {Promise<{events: any[], truncated: boolean}>} */ (
      new Promise((resolve, reject) => {
        /** @type {any[]} */
        const events = [];
        let settled = false;
        /** @param {{events: any[], truncated: boolean}} result */
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(bound);
          resolve(result);
        };
        const bound = setTimeout(() => {
          pageSub?.unsubscribe();
          finish({ events, truncated: true });
        }, PAGE_TIMEOUT_MS);
        resolvePendingPage = (evts) => finish({ events: evts, truncated: false });
        pageSub = relayConn.request(filter, { timeout: PAGE_TIMEOUT_MS }).subscribe({
          next: (/** @type {any} */ ev) => events.push(ev),
          complete: () => finish({ events, truncated: false }),
          error: (/** @type {any} */ err) => {
            if (settled) return;
            settled = true;
            clearTimeout(bound);
            reject(err);
          }
        });
      }).finally(() => {
        pageSub = null;
        resolvePendingPage = null;
      })
    );
  }

  /** Pages backward through stored state until a short page, an
   * already-fully-seen page (see below), or the page cap. */
  async function fetchBackfill() {
    /** @type {any[]} */
    let collected = [];
    /** @type {number | undefined} */
    let until;
    // Tracks ids across pages within THIS backfill run (separate from the
    // module's `seenIds`, which only fills in once the whole backfill is
    // folded in at the end) — lets a page that returned nothing NEW stop the
    // loop instead of refetching the same page forever.
    const pageSeenIds = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      const { events, truncated } = await fetchPage(until);
      if (events.length === 0) break;
      const newEvents = events.filter((ev) => ev?.id && !pageSeenIds.has(ev.id));
      if (newEvents.length === 0) {
        // `until` didn't advance the window — e.g. more than PAGE_LIMIT
        // events share the exact oldest created_at, so the inclusive
        // boundary below just hands back the same page again.
        break;
      }
      for (const ev of newEvents) pageSeenIds.add(ev.id);
      collected = collected.concat(newEvents);
      // Only a relay-completed short page proves the history is exhausted; a
      // truncated one just means the relay was slow — keep paging.
      if (!truncated && events.length < PAGE_LIMIT) break;
      if (page === MAX_PAGES - 1) {
        console.warn(
          'webxdc group-sync: backfill hit the 10-page cap without exhausting session history'
        );
        break;
      }
      const oldest = events.reduce(
        (/** @type {number} */ min, /** @type {any} */ ev) => Math.min(min, ev.created_at),
        Infinity
      );
      // Inclusive boundary (not `oldest - 1`): a page cut must not skip
      // events sharing the oldest returned created_at. The overlap this
      // creates is absorbed above (this run's pageSeenIds) and again at
      // fold-in time (the module's seenIds).
      until = oldest;
    }
    return collected;
  }

  /** @type {any} */
  let stateSub = null;

  /** @param {number} [since] only set once the backfill collected at least
   *   one event — the live sub then picks up an overlap window behind where
   *   the backfill left off (LIVE_OVERLAP_SEC, clock-skewed peers) instead
   *   of replaying the whole history it just fetched. */
  function openLiveSubscription(since) {
    if (stopped) return;
    const filter = { ...stateFilter(), ...(since !== undefined ? { since } : {}) };
    stateSub = relayConn.subscription([filter]).subscribe({
      next: (/** @type {any} */ response) => {
        // Backfill already ran via fetchBackfill() above; a live-sub EOSE
        // (some relay implementations still send one) is a no-op now.
        if (response === 'EOSE') return;
        if (append(response)) notify();
      },
      error: (/** @type {any} */ err) => {
        if (claimAuthRetry(err)) {
          Promise.resolve(authenticate?.())
            .then(() => openLiveSubscription(since))
            .catch(() => onError?.(err, 'read'));
          return;
        }
        onError?.(err, 'read');
      }
    });
  }

  async function startBackfill() {
    /** @type {any[]} */
    let events;
    try {
      events = await fetchBackfill();
    } catch (err) {
      if (claimAuthRetry(err)) {
        try {
          await authenticate?.();
          events = await fetchBackfill();
        } catch (err2) {
          onError?.(err2, 'read');
          events = [];
        }
      } else {
        onError?.(err, 'read');
        events = [];
      }
    }
    if (stopped) return;
    const newest =
      events.length > 0
        ? events.reduce((/** @type {number} */ max, ev) => Math.max(max, ev.created_at), -Infinity)
        : undefined;
    events.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    for (const ev of events) append(ev);
    notify();
    openLiveSubscription(newest !== undefined ? Math.max(0, newest - LIVE_OVERLAP_SEC) : undefined);
  }

  startBackfill();

  /** @type {import('rxjs').Subscription | null} */
  let realtimeSub = null;
  const realtimeListeners = new Set();

  // Drop-to-latest throttle (leading + trailing edge): the first frame in a
  // burst publishes immediately, everything that arrives inside the 100ms
  // cooldown replaces `realtimePending` (never queues), and the cooldown's
  // own end flushes whatever is pending — at most one publish per 100ms,
  // which is what makes this usable behind a NIP-46 remote signer.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let realtimeCooldown = null;
  /** @type {Uint8Array | null} */
  let realtimePending = null;

  const publishRealtime = (/** @type {Uint8Array} */ bytes) => {
    publish(buildRealtimeTemplate(groupId, sessionId, bytes)).catch((err) =>
      onError?.(err, 'write')
    );
  };

  const flushRealtime = () => {
    if (realtimePending) {
      const bytes = realtimePending;
      realtimePending = null;
      publishRealtime(bytes);
      realtimeCooldown = setTimeout(flushRealtime, REALTIME_THROTTLE_MS);
    } else {
      realtimeCooldown = null;
    }
  };

  return {
    getUpdates: () => [...updates],

    sendState(payload, meta) {
      const template = buildStateTemplate(groupId, sessionId, payload, meta);
      publish(template)
        .then((signed) => {
          if (append(signed)) notify();
        })
        .catch((err) => onError?.(err, 'write'));
    },

    sendRealtime(bytes) {
      if (realtimeCooldown) {
        realtimePending = bytes;
        return;
      }
      publishRealtime(bytes);
      realtimeCooldown = setTimeout(flushRealtime, REALTIME_THROTTLE_MS);
    },

    onRealtime(cb) {
      realtimeListeners.add(cb);
      if (!realtimeSub) {
        realtimeSub = relayConn
          .subscription([{ kinds: [WEBXDC_REALTIME_KIND], '#h': [groupId], '#i': [sessionId] }])
          .subscribe({
            next: (/** @type {any} */ response) => {
              if (response === 'EOSE') return;
              // webxdc semantics: realtime frames go to OTHER peers only, so
              // any frame authored by us (echo or otherwise) is filtered —
              // not just relay echoes of our own publishes.
              if (response?.pubkey === selfPubkey) return;
              const bytes = parseRealtimeEvent(response);
              if (!bytes) return;
              for (const listener of realtimeListeners) listener(bytes);
            },
            error: (/** @type {any} */ err) => onError?.(err, 'read')
          });
      }
      return () => realtimeListeners.delete(cb);
    },

    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    stop() {
      stopped = true;
      if (realtimeCooldown) clearTimeout(realtimeCooldown);
      realtimeCooldown = null;
      realtimePending = null;
      // Cancel an in-flight backfill page and unstick the `await fetchPage`
      // inside fetchBackfill's loop (unsubscribing alone would never
      // settle that promise) — the loop then sees a short/empty page,
      // returns, and startBackfill's own `if (stopped) return;` guard stops
      // it from folding in events or opening the live sub.
      pageSub?.unsubscribe();
      resolvePendingPage?.([]);
      stateSub?.unsubscribe();
      realtimeSub?.unsubscribe();
      realtimeSub = null;
      realtimeListeners.clear();
      subscribers.clear();
    }
  };
}
