// Live "my calls" for the dashboard: for every group the signed-in user is on
// the roster of, the relay-signed kind 39004 (who is in the call) and the
// scheduled meetings (kind 31923, h-tagged, on the group relay only).
//
// One standing subscription per relay for all groups, not one per group; the
// trust rules for the 39004 live in call-presence-watch.js. Meetings never
// enter the EventStore here: they are private to their channel and every
// generic calendar surface must stay without them.
import { normalizeURL } from 'applesauce-core/helpers/url';
import { DELETE_EVENT_KIND } from 'applesauce-common/helpers/groups';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { useMyGroupPointers } from './my-groups.svelte.js';
import { watchRelayCalls } from './call-presence-watch.js';
import { MEETING_KIND } from './meetings.js';
import { channelKey } from './community-pointer.js';

/**
 * Call during component init.
 * @returns {{
 *   readonly pointers: Array<{id: string, relay: string}>,
 *   readonly participantsByKey: Record<string, string[]>,
 *   readonly events: any[]
 * }} reactive getters; `events`: the meetings (31923) and their deletions (5 by the author,
 *   9005 by an admin) seen, for `upcomingMeetings`
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
    const seen = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- bookkeeping
    const teardowns = [...byRelay].map(([relay, ids]) =>
      watchRelayCalls(relay, ids, {
        getSigner: () => signer,
        // A private channel's 39004 and meetings are withheld from a
        // connection that has not logged in, so the handshake comes first.
        authFirst: true,
        onParticipants: (id, pubkeys) => {
          const key = channelKey({ id, relay });
          if (key) participantsByKey = { ...participantsByKey, [key]: pubkeys };
        },
        extraFilters: [
          // shortcut: the relay returns the 200 most recently created, so a
          // meeting scheduled long ago falls out once 200 newer ones exist in
          // my channels; page by channel when an account gets near that.
          { kinds: [MEETING_KIND], '#h': ids, limit: 200 },
          { kinds: [5, DELETE_EVENT_KIND], '#h': ids, limit: 200 }
        ],
        onEvent: (event) => {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          events = [...events, event];
        }
      })
    );

    return () => teardowns.forEach((stop) => stop());
  });

  // Getters, not one snapshot object: reading `pointers` must not subscribe
  // the reader to every call and meeting event (the name lookup keyed on the
  // pointers re-asked the relay once per event).
  return {
    get pointers() {
      return settled;
    },
    get participantsByKey() {
      return participantsByKey;
    },
    get events() {
      return events;
    }
  };
}
