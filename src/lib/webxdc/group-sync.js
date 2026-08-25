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
import { firstValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
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

  /** One page of stored 9450s, bounded above by `until` when given.
   * @param {number} [until] */
  async function fetchPage(until) {
    const filter = {
      ...stateFilter(),
      limit: PAGE_LIMIT,
      ...(until !== undefined ? { until } : {})
    };
    return firstValueFrom(relayConn.request(filter, { timeout: PAGE_TIMEOUT_MS }).pipe(toArray()));
  }

  /** Pages backward through stored state until a short page, or the cap. */
  async function fetchBackfill() {
    /** @type {any[]} */
    let collected = [];
    /** @type {number | undefined} */
    let until;
    for (let page = 0; page < MAX_PAGES; page++) {
      const events = await fetchPage(until);
      collected = collected.concat(events);
      if (events.length < PAGE_LIMIT) break;
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
      until = oldest - 1;
    }
    return collected;
  }

  /** @type {any} */
  let stateSub = null;

  function openLiveSubscription() {
    if (stopped) return;
    stateSub = relayConn.subscription([stateFilter()]).subscribe({
      next: (/** @type {any} */ response) => {
        // Backfill already ran via fetchBackfill() above; a live-sub EOSE
        // (some relay implementations still send one) is a no-op now.
        if (response === 'EOSE') return;
        if (append(response)) notify();
      },
      error: (/** @type {any} */ err) => {
        if (claimAuthRetry(err)) {
          Promise.resolve(authenticate?.())
            .then(openLiveSubscription)
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
    events.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    for (const ev of events) append(ev);
    notify();
    openLiveSubscription();
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
      stateSub?.unsubscribe();
      realtimeSub?.unsubscribe();
      realtimeSub = null;
      realtimeListeners.clear();
      subscribers.clear();
    }
  };
}
