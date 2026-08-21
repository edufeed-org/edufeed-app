// src/lib/groups/section-override.svelte.js
//
// Reactive half of the kind-30223 content-section override (see
// ./section-override.js for the data model and why it exists).
//
// Returns the community event as the app should DISPLAY it — the 10222 with
// its section block swapped for the effective one — so every existing
// consumer keeps taking a single community event. Callers that SIGN or EDIT
// the community must keep using the raw 10222.
import { createTimelineLoader } from 'applesauce-loaders/loaders';
import { TimelineModel } from 'applesauce-core/models';
import { timedPool } from '$lib/loaders/base.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { getCommunityGlobalRelays } from '$lib/helpers/communityRelays.js';
import { unique } from '$lib/helpers/unique.js';
import { useRootRoster } from './root-roster.svelte.js';
import { deriveCommunityType } from './community-membership.js';
import { SECTION_OVERRIDE_KIND, applySectionOverride } from './section-override.js';

/**
 * @param {() => any} getCommunityEvent getter for the kind 10222 event
 * @returns {() => {event: any, source: 'community'|'override', author: string | null}}
 */
export function useEffectiveCommunity(getCommunityEvent) {
  // $state.raw: these are Nostr events carrying Symbol-based relay
  // provenance, and the array is always replaced wholesale.
  let overrides = $state.raw(/** @type {any[]} */ ([]));

  const getRoster = useRootRoster(getCommunityEvent);

  /** @type {import('rxjs').Subscription | undefined} */
  let loaderSub;
  /** @type {import('rxjs').Subscription | undefined} */
  let modelSub;

  $effect(() => {
    // Read the reactive dependency BEFORE any early return, or the effect
    // captures no dependencies and never re-runs (CLAUDE.md: "Svelte effect
    // early-return goes dead").
    const communityEvent = getCommunityEvent();
    const communityPubkey = communityEvent?.pubkey;

    loaderSub?.unsubscribe();
    modelSub?.unsubscribe();
    loaderSub = undefined;
    modelSub = undefined;

    // Only moderated communities have a roster to judge an override's author
    // against, so nothing else is worth fetching.
    if (!communityPubkey || deriveCommunityType(communityEvent) !== 'moderated') {
      overrides = [];
      return;
    }

    // Never the group relay: the section config has to be readable by the
    // logged-out visitors who need it to see the community's tabs at all.
    const relays = unique([...getCommunikeyRelays(), ...getCommunityGlobalRelays(communityEvent)]);
    const filter = { kinds: [SECTION_OVERRIDE_KIND], '#d': [communityPubkey] };

    loaderSub = createTimelineLoader(timedPool, relays, filter, { eventStore })().subscribe();
    // eventStore.model(TimelineModel) rather than eventStore.timeline: a
    // withdrawn override is deleted (kind 5), and only the model filters
    // deleted events out.
    modelSub = eventStore.model(TimelineModel, filter).subscribe((events) => {
      overrides = events ?? [];
    });

    return () => {
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  // An array, not a Set: resolveCommunitySections builds the lookup itself,
  // which keeps this reactive module free of mutable built-ins.
  return () =>
    applySectionOverride(
      getCommunityEvent(),
      overrides,
      getRoster().admins.map((admin) => admin.pubkey)
    );
}
