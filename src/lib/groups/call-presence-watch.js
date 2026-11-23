// The one place that watches kind 39004 ("who is in the AV room") on a relay,
// for one group (call-presence.svelte.js) or many (my-calls.svelte.js).
//
// Trust: the event is relay-authored, so it is pinned to the relay's NIP-11
// key — nothing is asked before the key race settles (a forged event
// collected in that gap would be drawn), the request is pinned as soon as the
// key is known and reopened pinned when the key arrives late, and every event
// is re-checked against the pin in case the relay ignores its own `authors`.
// Newest wins per group: the relay replaces the whole list on every change,
// and a late older copy must not bring back someone who already left.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { raceRelayKey } from './relay-key-race.js';
import { isTrustedSigner } from './relay-directory.js';
import { resubscribing } from './relay-subscription.js';
import { authenticateOnce } from './relay-auth.js';
import { CALL_PRESENCE_KIND, parseCallParticipants } from './call-presence.js';

/**
 * @param {string} relay normalised relay url
 * @param {string[]} ids group ids on that relay
 * @param {{
 *   getSigner: () => any,
 *   onParticipants: (groupId: string, pubkeys: string[]) => void,
 *   onAnswered?: () => void,
 *   authFirst?: boolean,
 *   extraFilters?: Record<string, any>[],
 *   onEvent?: (event: any) => void
 * }} options
 *   `onAnswered`: the relay answered (EOSE) or failed — "nobody there" vs "not heard back yet".
 *   `authFirst`: log in (NIP-42) before the first open; a private group's list
 *   is withheld, with a clean empty EOSE, from a connection that has not.
 *   `extraFilters` / `onEvent`: more filters on the same subscription; their
 *   events go to `onEvent` unchecked.
 * @returns {() => void} stop
 */
export function watchRelayCalls(relay, ids, options) {
  const {
    getSigner,
    onParticipants,
    onAnswered,
    authFirst = false,
    extraFilters = [],
    onEvent
  } = options;
  /** @type {string[]} */
  let pinned = [];
  let ready = false;
  let disposed = false;
  /** @type {(() => void) | null} */
  let stop = null;
  /** @type {Map<string, number>} group id → created_at of the newest list */
  const newest = new Map();

  const open = () => {
    stop?.();
    if (disposed) return;
    const presence =
      pinned.length > 0
        ? { kinds: [CALL_PRESENCE_KIND], '#d': ids, authors: pinned }
        : { kinds: [CALL_PRESENCE_KIND], '#d': ids };
    stop = resubscribing(
      () => pool.relay(relay).subscription([presence, ...extraFilters]),
      {
        next: (/** @type {any} */ event) => {
          if (event === 'EOSE') return onAnswered?.();
          if (!event || typeof event !== 'object') return;
          if (event.kind !== CALL_PRESENCE_KIND) return onEvent?.(event);
          if (!isTrustedSigner(event, pinned)) return;
          const id = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
          if (!ids.includes(id) || typeof event.created_at !== 'number') return;
          if (event.created_at < (newest.get(id) ?? -1)) return;
          newest.set(id, event.created_at);
          onParticipants(id, parseCallParticipants(event));
        },
        // Best-effort: an unreachable relay means "unknown", never an error to surface.
        error: () => onAnswered?.()
      },
      // A reopened connection is unauthenticated: the handshake first.
      { beforeReopen: () => authenticateOnce(pool.relay(relay), getSigner()) }
    );
  };

  let authing = false;
  const start = () => {
    const signer = authFirst ? getSigner() : null;
    if (!signer) return open();
    authing = true;
    authenticateOnce(pool.relay(relay), signer)
      .catch(() => null)
      .then(() => {
        authing = false;
        open();
      });
  };

  // The connection became authenticated after the subscription was opened
  // (another component's handshake): a private group's list was withheld
  // until now, so ask again.
  const conn = /** @type {any} */ (pool.relay(relay));
  let wasAuthenticated = conn?.authenticated === true;
  const authSub = conn?.authenticated$?.subscribe?.((/** @type {boolean} */ value) => {
    if (value && !wasAuthenticated && ready && !authing) open();
    wasAuthenticated = value === true;
  });

  const stopRace = raceRelayKey(relay, {
    onAuthors: (authors) => {
      const changed = authors.join() !== pinned.join();
      pinned = authors;
      if (ready && changed) open();
    },
    onReady: () => {
      ready = true;
      start();
    }
  });

  return () => {
    disposed = true;
    stopRace();
    authSub?.unsubscribe();
    stop?.();
  };
}
