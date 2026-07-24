// Reactive hook wrapping the pure unlinkedConcordAreas/linkedConcordIds
// helpers (unlinked-areas.js) for nav/sidebar components. Imports concord
// submodules directly (client.svelte.js has no top-level package imports) —
// the convention every Concord call site follows (see CLAUDE.md's Concord
// section) — so components stay SSR-clean.
import { getConcordState } from './client.svelte.js';
import { unlinkedConcordAreas, linkedConcordIds } from './unlinked-areas.js';
import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

// Module-level (not per-hook-instance): every mounted instance of this hook
// shares one fetch-once budget per pubkey per session, so re-mounting the
// sidebar (or any other chrome using this hook) never re-fires the same
// one-shot addressLoader request. This only bounds the PROACTIVE fetch below
// — the reactive eventStore.replaceable() subscription still picks up a
// 10222 event from ANY source (this fetch, another loader, a fresh join)
// regardless of what's in this Set.
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal tracking, not reactive state
const requestedPubkeys = new Set();

/**
 * Concord memberships NOT linked to any followed Communikey community —
 * i.e. private areas only reachable at `/private/<communityId>`, not
 * through a community page's channels tab. "Linked" is derived from kind
 * 10222 events resident in the EventStore, kept current by two mechanisms:
 * (1) a reactive `eventStore.replaceable()` subscription per joined pubkey,
 * which self-heals the instant a 10222 lands from ANY source, and (2) a
 * bounded proactive fetch — a one-shot `addressLoader` load per joined
 * pubkey (deduped per session via `requestedPubkeys`) — so a linked area
 * doesn't sit as a duplicate unlinked row until something UNRELATED happens
 * to load that community's 10222. The remaining window is just relay
 * round-trip time for that fetch, not "however long until some other code
 * path loads it". No subscriptions to unsubscribe for the fetch itself: it
 * completes on its own (see the `addressLoader` fire-and-forget pattern in
 * user-emoji-sets.svelte.js).
 * @returns {() => Array<{communityId: string, name: string, dissolved: boolean}>}
 */
export function useUnlinkedConcordAreas() {
  const getJoinedCommunities = useJoinedCommunitiesList();

  // Reset (not reuse) on every effect re-run: joined pubkeys can
  // reorder/change length between runs, and stale entries at old indices
  // must not survive under a new, differently-shaped pubkeys array.
  let communikeyEvents = $state.raw(/** @type {any[]} */ ([]));
  $effect(() => {
    // Flag off: no subscriptions, no fetches. Reads runtimeConfig.concord
    // reactively (it's backed by config.svelte.js's $state), so this effect
    // re-runs and starts fetching the moment /api/config lands the flag on
    // after this hook already mounted.
    if (!runtimeConfig.concord?.enabled) {
      communikeyEvents = [];
      return;
    }

    const pubkeys = getJoinedCommunities();
    if (pubkeys.length === 0) {
      communikeyEvents = [];
      return;
    }

    const relays = getAllLookupRelays();

    // Effect-LOCAL accumulator (CRITICAL): each subscription callback below
    // writes into THIS plain array, then reassigns `communikeyEvents` FROM
    // it. It never reads `communikeyEvents` itself. eventStore.replaceable()
    // replays synchronously when the event is already cached, so a callback
    // reading the $state it also writes would register that state as a
    // dependency of the very effect that's writing it — a self-triggered
    // infinite re-run (`effect_update_depth_exceeded`; CLAUDE.md's "$state
    // inside $effect causes re-triggers"). See
    // concord-unlinked-areas-hook.svelte.test.js for the regression test.
    const events = new Array(pubkeys.length);
    /** @type {import('rxjs').Subscription[]} */
    const subs = pubkeys.map((pubkey, index) => {
      if (!requestedPubkeys.has(pubkey)) {
        requestedPubkeys.add(pubkey);
        // Bounded proactive fetch — CLAUDE.md "addressLoader Relay
        // Configuration": relays MUST be in the pointer, not just loader
        // config, or nothing gets queried.
        addressLoader({ kind: 10222, pubkey, relays }).subscribe();
      }
      return eventStore.replaceable(10222, pubkey).subscribe((event) => {
        events[index] = event;
        communikeyEvents = [...events];
      });
    });
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  return () =>
    unlinkedConcordAreas({
      communities: getConcordState().communities,
      linkedIds: linkedConcordIds(communikeyEvents)
    });
}
