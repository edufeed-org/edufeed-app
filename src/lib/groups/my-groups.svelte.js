// Which NIP-29 groups the signed-in user is on the roster of.
//
// There is no self-signed record of this: an admin adds you with a kind-9000
// and the relay materialises the 39001/39002 lists, so neither your kind-10009
// groups list nor your kind-30000 follow set learns about it. The only source
// of truth is the relay's own roster events, asked for by `#p`:
//
//   {kinds: [39001, 39002], '#p': [me]}
//
// Verified anonymously against wss://groups.edufeed.org — these lists are
// world-readable on our relay, so this needs no NIP-42 auth. A relay that
// does gate them simply yields nothing, and every consumer of this treats an
// empty result as "no extra communities", never as a restriction.
//
// Used to answer "which communities can I share into" (./shareable-communities.js).
import { GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND } from 'applesauce-common/helpers/groups';
import { normalizeURL } from 'applesauce-core/helpers/url';
import { pool, eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { storeEvents } from 'applesauce-relay/operators';
import { getGroupsRelays } from '$lib/helpers/relay-helper.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';

/** @param {any} event @returns {string | undefined} */
function dTagOf(event) {
  return event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1];
}

/**
 * Reactive pointers to every group the active user is on the roster of.
 * Call during component init.
 * @returns {() => Array<{id: string, relay: string}>}
 */
export function useMyGroupPointers() {
  const getActiveUser = useActiveUser();

  // $state.raw: replaced wholesale, and the values are plain pointer objects.
  let pointers = $state.raw(/** @type {Array<{id: string, relay: string}>} */ ([]));

  $effect(() => {
    // Read the reactive dependency BEFORE any early return, or the effect
    // captures nothing and never re-runs (CLAUDE.md: "Svelte effect
    // early-return goes dead").
    const pubkey = getActiveUser()?.pubkey;
    // Reset on EVERY re-run, not only when signed out: a direct A→B account
    // switch re-enters here with the new pubkey and no null in between
    // (applesauce setActive), and B must not inherit A's roster.
    pointers = [];
    if (!pubkey) return;

    const relays = [...new Set(getGroupsRelays().map(normalizeURL))]; // eslint-disable-line svelte/prefer-svelte-reactivity -- dedup scratch
    if (relays.length === 0) return;

    /** @type {Map<string, Set<string>>} relay -> group ids */
    const byRelay = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- effect-local accumulator
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    for (const relay of relays) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- effect-local dedup, never rendered
      byRelay.set(relay, new Set());
      try {
        subs.push(
          pool
            .relay(relay)
            .request(
              { kinds: [GROUP_ADMINS_KIND, GROUP_MEMBERS_KIND], '#p': [pubkey] },
              { timeout: 8000 }
            )
            // Into the store as well: the roster events we just pulled are
            // exactly what useChannelRosters would otherwise re-request.
            .pipe(storeEvents(eventStore))
            .subscribe({
              next: (event) => {
                const id = dTagOf(event);
                if (!id) return;
                const ids = byRelay.get(relay);
                if (!ids || ids.has(id)) return;
                ids.add(id);
                pointers = [...pointers, { id, relay }];
              },
              // A relay that is down, or that walls these lists behind
              // NIP-42, contributes nothing. Never a reason to drop the
              // pointers another relay already yielded.
              error: () => {}
            })
        );
      } catch {
        // pool.relay can throw on a malformed url — skip that relay.
      }
    }

    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  return () => pointers;
}
