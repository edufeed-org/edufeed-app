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
import { useJoinedCommunikeyEvents } from '$lib/helpers/joined-communikey-events.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

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
  // The Concord flag stays THIS side's gate: with it off there is no
  // Concord surface to keep consistent, so nothing needs fetching.
  const getCommunikeyEvents = useJoinedCommunikeyEvents(() => !!runtimeConfig.concord?.enabled);

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
  // The Concord flag stays THIS side's gate: with it off there is no
  // Concord surface to keep consistent, so nothing needs fetching.
  const getCommunikeyEvents = useJoinedCommunikeyEvents(() => !!runtimeConfig.concord?.enabled);

  return () =>
    attachableConcordAreas({
      communities: getConcordState().communities,
      linkedIds: linkedConcordIds(getCommunikeyEvents()),
      ownerPubkey: getOwnerPubkey()
    });
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
