/**
 * useCommunityScopedItems — the discover page's community-filtered feed.
 *
 * With a community filter the page sources items directly from
 * `CommunityActivityModel` (per community) instead of the global
 * curated-author timelines: h-tag membership IS the curation, so no author
 * filtering, and NIP-18 reposts + legacy 30222 references are already
 * resolved by the model. Items of several communities are merged and
 * deduped by id (a direct item beats a reposted copy).
 *
 * Per-community section access (same wiring as DashboardCommunityFeed): a
 * moderated community's `access` rules are write gating enforced by the
 * reader, so a share by a non-member must not surface here either. Until
 * the kind 10222 and the roster arrive the feed renders unfiltered rather
 * than empty.
 *
 * Call during component initialisation (it creates an effect).
 */
import { untrack } from 'svelte';
import { debounceTime } from 'rxjs';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { CommunityActivityModel } from '$lib/models/community-content.js';
import { useCommunityActivityLoader } from '$lib/loaders/community-activity.js';
import { subscribeToCommunityAccess } from '$lib/groups/community-access-subscription.js';
import { filterEventsByAccess } from '$lib/helpers/contentTypes.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

/**
 * @param {() => string[]} getTargets - Community pubkeys to source (reactive); empty = off
 */
export function useCommunityScopedItems(getTargets) {
  let items = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    const targets = getTargets();
    if (targets.length === 0) {
      items = [];
      return;
    }

    /** @type {Array<() => void>} */
    const cleanups = [];
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    /** @type {Map<string, any[]>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local accumulator, not reactive state
    const perCommunity = new Map();
    /** @type {Map<string, {communityEvent: any, access: {isLoading: boolean, getAllowedAuthors: (name: string) => string[] | null} | null}>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local accumulator, not reactive state
    const perCommunityAcl = new Map();

    // The 10222 replaceable (and the access subscription it spawns) can emit
    // synchronously while this effect is still running; the merge writes
    // state, so it runs untracked or the effect would depend on its own output.
    function publish() {
      untrack(() => {
        /** @type {Map<string, any>} */
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local accumulator, not reactive state
        const merged = new Map();
        for (const [pubkey, arr] of perCommunity) {
          const acl = perCommunityAcl.get(pubkey);
          const gated =
            acl?.communityEvent && acl.access
              ? filterEventsByAccess(arr, acl.communityEvent, acl.access)
              : arr;
          for (const item of gated) if (!merged.has(item.id)) merged.set(item.id, item);
        }
        items = Array.from(merged.values());
      });
    }

    for (const pubkey of targets) {
      cleanups.push(useCommunityActivityLoader(pubkey).cleanup);

      subs.push(
        eventStore
          .model(CommunityActivityModel, pubkey)
          .pipe(debounceTime(100))
          .subscribe((communityItems) => {
            perCommunity.set(pubkey, communityItems || []);
            publish();
          })
      );

      /** @type {(() => void) | undefined} */
      let aclCleanup;
      subs.push(
        eventStore.replaceable(10222, pubkey).subscribe((communityEvent) => {
          aclCleanup?.();
          aclCleanup = undefined;
          perCommunityAcl.set(pubkey, { communityEvent: communityEvent ?? null, access: null });
          if (communityEvent) {
            aclCleanup = subscribeToCommunityAccess(
              communityEvent,
              getCommunikeyRelays(),
              (access) => {
                const acl = perCommunityAcl.get(pubkey);
                if (acl) acl.access = access;
                publish();
              }
            ).cleanup;
          }
          publish();
        })
      );
      cleanups.push(() => aclCleanup?.());
    }

    return () => {
      for (const c of cleanups) c();
      for (const s of subs) s.unsubscribe();
      items = [];
    };
  });

  return {
    get items() {
      return items;
    }
  };
}
