// src/lib/groups/content-removal.svelte.js
//
// Reactive half of removing content from a community (data model and the
// reasoning in ./content-removal.js). One subscription per community page:
// the layout calls this once and hands the result down through context, so
// every section view and detail menu filters against the same set.
import { TimelineModel } from 'applesauce-core/models';
import { fetchEvents } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getCommunikeyRelays, getAllLookupRelays } from '$lib/helpers/relay-helper.js';
import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';
import { unique } from '$lib/helpers/unique.js';
import { useRootRoster } from './root-roster.svelte.js';
import {
  CONTENT_REMOVAL_KIND,
  CONTENT_REMOVAL_NAMESPACE,
  removalAuthorities,
  validContentRemovals,
  removedTargets
} from './content-removal.js';

/**
 * @param {() => any} getCommunityEvent getter for the kind 10222 event
 * @returns {() => {labels: any[], removed: import('./content-removal.js').RemovedTargets}}
 *   `labels` are the VALID removals, newest first; `removed` their targets.
 */
export function useContentRemovals(getCommunityEvent) {
  // $state.raw: Nostr events carry Symbol-based relay provenance, and the
  // array is always replaced wholesale.
  let labels = $state.raw(/** @type {any[]} */ ([]));

  const getRoster = useRootRoster(getCommunityEvent);

  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSub;

  $effect(() => {
    // Read the reactive dependency BEFORE any early return (CLAUDE.md:
    // "Svelte effect early-return goes dead").
    const communityEvent = getCommunityEvent();
    const communityPubkey = communityEvent?.pubkey;

    loaderSub?.unsubscribe();
    modelSub?.unsubscribe();
    loaderSub = undefined;
    modelSub = undefined;

    if (!communityPubkey) {
      labels = [];
      return;
    }

    // Public relays only: a removal must be visible to the logged-out
    // readers the community page serves, so it never lives on the auth-gated
    // group relay. Labels are published to the community's relays and the
    // signer's outbox, so the broad lookup set covers moderators whose
    // NIP-65 write relays differ from the community's.
    const relays = unique([
      ...getCommunikeyRelays(),
      ...getCommunityGlobalRelays(communityEvent),
      ...getAllLookupRelays()
    ]);
    const filter = {
      kinds: [CONTENT_REMOVAL_KIND],
      '#h': [communityPubkey],
      '#L': [CONTENT_REMOVAL_NAMESPACE]
    };

    loaderSub = fetchEvents(relays, filter).subscribe();
    // eventStore.model(TimelineModel), not eventStore.timeline: a restored
    // item is an undone (kind-5-deleted) label, and only the model drops
    // deleted events.
    modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      labels = events ?? [];
    });

    return () => {
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  return () => {
    const communityEvent = getCommunityEvent();
    const authorities = removalAuthorities(communityEvent, getRoster().admins);
    const valid = validContentRemovals(labels, communityEvent?.pubkey, authorities);
    return { labels: valid, removed: removedTargets(valid) };
  };
}
