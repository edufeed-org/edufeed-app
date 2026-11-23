// Live "my calls" for the dashboard: for every group the signed-in user is on
// the roster of, the relay-signed kind 39004 (who is in the call) and the
// scheduled meetings (kind 31923, h-tagged, on the group relay only).
//
// One standing subscription per relay for all groups, not one per group.
// Same trust rules as call-presence.svelte.js: a 39004 counts only when the
// relay's NIP-11 key signed it, and nothing is asked before the key race
// settles. Meetings never enter the EventStore here: they are private to
// their channel and every generic calendar surface must stay without them.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { useMyGroupPointers } from './my-groups.svelte.js';
import { raceRelayKey } from './relay-key-race.js';
import { isTrustedSigner } from './relay-directory.js';
import { resubscribing } from './relay-subscription.js';
import { authenticateOnce } from './relay-auth.js';
import { CALL_PRESENCE_KIND, parseCallParticipants } from './call-presence.js';
import { MEETING_KIND } from './meetings.js';
import { channelKey } from './community-pointer.js';

/**
 * Call during component init.
 * @returns {() => {
 *   pointers: Array<{id: string, relay: string}>,
 *   participantsByKey: Record<string, string[]>,
 *   events: any[]
 * }} `events`: the kind 31923 and kind 5 events seen, for `upcomingMeetings`
 */
export function useMyCalls() {
  const getPointers = useMyGroupPointers();
  const getUser = useActiveUser();
  /** @type {Record<string, string[]>} */
  let participantsByKey = $state.raw({});
  /** @type {any[]} */
  let events = $state.raw([]);

  // The roster answers arrive one event at a time; wait until they stop
  // before opening the subscriptions, instead of reopening per event.
  /** @type {Array<{id: string, relay: string}>} */
  let settled = $state.raw([]);
  $effect(() => {
    const pointers = getPointers();
    const timer = setTimeout(() => (settled = pointers), 400);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const pointers = settled;
    const signer = getUser()?.signer;
    participantsByKey = {};
    events = [];
    /** @type {Map<string, string[]>} relay → group ids */
    const byRelay = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- effect-local grouping
    for (const p of pointers) {
      const relay = normalizeURL(p.relay);
      byRelay.set(relay, [...(byRelay.get(relay) ?? []), p.id]);
    }
    /** @type {Array<() => void>} */
    const teardowns = [];
    let disposed = false;

    for (const [relay, ids] of byRelay) {
      /** @type {string[]} */
      let pinned = [];
      let ready = false;
      /** @type {(() => void) | null} */
      let stop = null;
      /** @type {Map<string, number>} group id → created_at of the newest 39004 */
      const newest = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- bookkeeping
      const seen = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- bookkeeping

      const open = () => {
        stop?.();
        if (disposed) return;
        const presence = { kinds: [CALL_PRESENCE_KIND], '#d': ids };
        stop = resubscribing(
          () =>
            pool
              .relay(relay)
              .subscription([
                pinned.length > 0 ? { ...presence, authors: pinned } : presence,
                { kinds: [MEETING_KIND], '#h': ids, limit: 200 },
                { kinds: [5], '#h': ids, limit: 200 }
              ]),
          {
            next: (/** @type {any} */ event) => {
              if (!event || typeof event !== 'object') return;
              if (event.kind === CALL_PRESENCE_KIND) {
                if (!isTrustedSigner(event, pinned)) return;
                const id = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
                const key = channelKey({ id, relay });
                // newest wins: a late older copy must not bring back someone who left
                if (!key || !ids.includes(id) || event.created_at < (newest.get(id) ?? -1)) return;
                newest.set(id, event.created_at);
                participantsByKey = { ...participantsByKey, [key]: parseCallParticipants(event) };
              } else if ((event.kind === MEETING_KIND || event.kind === 5) && !seen.has(event.id)) {
                seen.add(event.id);
                events = [...events, event];
              }
            },
            error: () => {} // an unreachable relay shows nothing, never an error on the dashboard
          },
          { beforeReopen: () => authenticateOnce(pool.relay(relay), signer) }
        );
      };

      // A private channel's 39004 and meetings are withheld (clean, empty
      // EOSE) from an unauthenticated REQ, so the handshake comes first.
      const start = () =>
        Promise.resolve(signer ? authenticateOnce(pool.relay(relay), signer) : null)
          .catch(() => null)
          .then(open);

      teardowns.push(
        raceRelayKey(relay, {
          onAuthors: (authors) => {
            pinned = authors;
            if (ready) open();
          },
          onReady: () => {
            ready = true;
            start();
          }
        }),
        () => stop?.()
      );
    }

    return () => {
      disposed = true;
      teardowns.forEach((fn) => fn());
    };
  });

  return () => ({ pointers: settled, participantsByKey, events });
}
