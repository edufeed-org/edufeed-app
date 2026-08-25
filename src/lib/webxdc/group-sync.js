/**
 * Relay-backed AppSync for shared channel sessions (spec §4). The append-only
 * contract from local-sync.js is preserved: one sort at EOSE, then arrival
 * order forever — a late 9450 with an older created_at is APPENDED, never
 * spliced (CRDT payloads are commutative; serials must not reshuffle).
 * Auth: relies on the caller's proactive authenticateOnce on the same
 * relayConn (GroupChat does this on mount) — NIP-42 is per-connection.
 */
import {
  WEBXDC_STATE_KIND,
  WEBXDC_REALTIME_KIND,
  buildStateTemplate,
  buildRealtimeTemplate,
  parseStateEvent,
  parseRealtimeEvent
} from './session-events.js';

/**
 * @param {{relayConn: any, groupId: string, sessionId: string,
 *          publish: (template: any) => Promise<any>,
 *          onError?: (err: unknown) => void}} args
 * @returns {import('./local-sync.js').AppSync & {stop: () => void}}
 */
export function createGroupSync({ relayConn, groupId, sessionId, publish, onError }) {
  /** @type {Array<{payload:any, info?:*, document?:*, summary?:*}>} */
  let updates = [];
  const seenIds = new Set();
  /** @type {any[]} */
  let pending = [];
  let synced = false;
  const subscribers = new Set();
  const sentRealtimeIds = new Set();

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

  const stateSub = relayConn
    .subscription([{ kinds: [WEBXDC_STATE_KIND], '#h': [groupId], '#i': [sessionId] }])
    .subscribe({
      next: (response) => {
        if (response === 'EOSE') {
          if (synced) return;
          synced = true;
          pending.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
          for (const ev of pending) append(ev);
          pending = [];
          notify();
          return;
        }
        if (!synced) {
          pending.push(response);
          return;
        }
        if (append(response)) notify();
      },
      error: (err) => onError?.(err)
    });

  /** @type {import('rxjs').Subscription | null} */
  let realtimeSub = null;
  const realtimeListeners = new Set();

  return {
    getUpdates: () => [...updates],

    sendState(payload, meta) {
      const template = buildStateTemplate(groupId, sessionId, payload, meta);
      publish(template)
        .then((signed) => {
          if (append(signed)) notify();
        })
        .catch((err) => onError?.(err));
    },

    sendRealtime(bytes) {
      publish(buildRealtimeTemplate(groupId, sessionId, bytes))
        .then((signed) => signed?.id && sentRealtimeIds.add(signed.id))
        .catch((err) => onError?.(err));
    },

    onRealtime(cb) {
      realtimeListeners.add(cb);
      if (!realtimeSub) {
        realtimeSub = relayConn
          .subscription([{ kinds: [WEBXDC_REALTIME_KIND], '#h': [groupId], '#i': [sessionId] }])
          .subscribe({
            next: (response) => {
              if (response === 'EOSE') return;
              if (response?.id && sentRealtimeIds.has(response.id)) return;
              const bytes = parseRealtimeEvent(response);
              if (!bytes) return;
              for (const listener of realtimeListeners) listener(bytes);
            },
            error: (err) => onError?.(err)
          });
      }
      return () => realtimeListeners.delete(cb);
    },

    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    stop() {
      stateSub.unsubscribe();
      realtimeSub?.unsubscribe();
      realtimeSub = null;
      realtimeListeners.clear();
      subscribers.clear();
    }
  };
}
