// Reactive hook wrapping the pure unlinkedConcordAreas/linkedConcordIds
// helpers (unlinked-areas.js) for nav/sidebar components. Imports concord
// submodules directly (client.svelte.js has no top-level package imports) —
// the convention every Concord call site follows (see CLAUDE.md's Concord
// section) — so components stay SSR-clean.
import { of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { getConcordState, getConcordClient } from './client.svelte.js';
import {
  unlinkedConcordAreas,
  attachableConcordAreas,
  linkedConcordIds
} from './unlinked-areas.js';
import { useObservable } from './bridge.svelte.js';
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
 * @returns {() => import('./unlinked-areas.js').UnlinkedArea[]}
 */
export function useUnlinkedConcordAreas() {
  const getCommunikeyEvents = useJoinedCommunikeyEvents();

  return () =>
    unlinkedConcordAreas({
      communities: getConcordState().communities,
      linkedIds: linkedConcordIds(getCommunikeyEvents())
    });
}

/**
 * Concord areas the active user OWNS, as candidates for the "attach existing
 * area" picker (settings card / founding pane). Same joined-10222 input as
 * {@link useUnlinkedConcordAreas} so `linkedToJoined` disabling and the
 * unlinked sidebar list can never disagree about what counts as linked.
 * @param {() => string | null | undefined} getOwnerPubkey reactive getter for the active user's pubkey
 * @returns {() => import('./unlinked-areas.js').AttachableArea[]}
 */
export function useAttachableConcordAreas(getOwnerPubkey) {
  const getCommunikeyEvents = useJoinedCommunikeyEvents();

  return () =>
    attachableConcordAreas({
      communities: getConcordState().communities,
      linkedIds: linkedConcordIds(getCommunikeyEvents()),
      ownerPubkey: getOwnerPubkey()
    });
}

/**
 * Shared source for both hooks above: the kind-10222 events of every joined
 * community, kept current reactively + via the bounded proactive fetch (see
 * the module doc comment on `requestedPubkeys`).
 * @returns {() => any[]}
 */
function useJoinedCommunikeyEvents() {
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

  return () => communikeyEvents;
}

/**
 * Whether the user's Concord Community List (kind 13302) is still locked —
 * present in the event store but not yet decrypted with the signer
 * (`autoUnlock: false` means this is the normal state right after sync).
 * Sidebars use this to show the "Sync private areas" unlock affordance
 * (client.svelte.js's `unlockConcordLists()`), which must be offered even
 * when `useUnlinkedConcordAreas()` currently reports zero areas — a locked
 * list is exactly the case where remote-only memberships haven't hydrated
 * yet, so the area list looks empty until the user unlocks.
 *
 * Mirrors applesauce-concord's own internal `watchLists()` reconcile chain
 * (dist/client/client.js) rather than the outer `communityList$` alone:
 * `.unlock()` re-emits via the cast's OWN `communities$`, not necessarily a
 * new cast instance from the outer switchMap, so subscribing one level
 * deeper is what actually observes the unlock.
 *
 * CRITICAL: the piped observable must emit the derived BOOLEAN, not the cast
 * itself. `useObservable` assigns emissions straight into a `$state.raw` —
 * Svelte's strict-equality bail-out means reassigning the SAME cast
 * reference (which is exactly what `.unlock()`'s re-emission is: the same
 * cast, now with `.unlocked` flipped) never triggers a re-render, so any
 * `$derived` reading this hook's getter would cache the pre-unlock value
 * forever. Mapping to a primitive boolean sidesteps that entirely — a
 * changed boolean is never reference-equal to the old one.
 * @returns {() => boolean}
 */
export function useConcordListLocked() {
  const getLocked = useObservable(() => {
    const _tick = getConcordState().communities; // re-subscribe when the client (re)starts
    const client = getConcordClient();
    if (!client) return undefined;
    return client.communityList$.pipe(
      switchMap((/** @type {any} */ cast) =>
        cast ? cast.communities$.pipe(map(() => !cast.unlocked)) : of(false)
      )
    );
  }, /** @type {any} */ (false));

  return () => getLocked();
}
