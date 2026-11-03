/**
 * useJoinedCommunityItems — content items of the user's joined communities.
 *
 * One address loader (kind 10222, for relay discovery), one activity loader
 * and one social-bookmark loader per community, their two models merged and
 * ACL-filtered per community, then merged across communities newest-first
 * (`mergeCommunityActivity`). Extracted from DashboardCommunityFeed so the
 * phone Communities list can mount the same wiring: feed and list are
 * mutually exclusive dashboard views, so nothing runs twice at once, and the
 * IDB cache seeds the loaders on every mount.
 *
 * Call during component init; the subscriptions follow the pubkeys the
 * getter returns and are torn down on change and on unmount.
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- Map used intentionally for non-reactive internal tracking */
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
import { mergeCommunityActivity } from '$lib/helpers/dashboardFilters.js';
import { filterEventsByAccess } from '$lib/helpers/contentTypes.js';
import { subscribeToCommunityAccess } from '$lib/groups/community-access-subscription.js';
import { useCommunityActivityLoader } from '$lib/loaders/community-activity.js';
import { useSocialBookmarksCommunityLoader } from '$lib/loaders/social-bookmarks.js';
import {
  CommunityActivityModel,
  CommunitySocialBookmarkModel
} from '$lib/models/community-content.js';

/**
 * @typedef {{ items: any[], perCommunity: Map<string, any[]>, isLoading: boolean }} JoinedCommunityItems
 */

/**
 * @param {() => string[]} getPubkeys - joined community pubkeys (hex)
 * @returns {() => JoinedCommunityItems}
 */
export function useJoinedCommunityItems(getPubkeys) {
  let items = $state.raw(/** @type {any[]} */ ([]));
  let perCommunity = $state.raw(/** @type {Map<string, any[]>} */ (new Map()));
  let isLoading = $state(true);

  $effect(() => {
    const communities = getPubkeys();

    /** @type {Map<string, () => void>} */
    const cleanupMap = new Map();
    /** @type {Map<string, any[]>} */
    const perCommunityItems = new Map();
    /** @type {Map<string, { communityEvent: any, access: { isLoading: boolean, getAllowedAuthors: (name: string) => string[] | null } | null }>} */
    const perCommunityAcl = new Map();

    if (communities.length === 0) {
      items = [];
      perCommunity = new Map();
      isLoading = false;
      return;
    }

    isLoading = true;

    for (const pubkey of communities) {
      // Ensure community kind 10222 event is in EventStore for relay discovery
      const addrSub = addressLoader({
        kind: 10222,
        pubkey,
        relays: getCommunikeyRelays()
      }).subscribe();

      // Load all content sources (direct + reposts + legacy 30222)
      const { cleanup: activityCleanup } = useCommunityActivityLoader(pubkey);
      const { cleanup: bookmarkCleanup } = useSocialBookmarksCommunityLoader(pubkey);

      /** @type {any[]} */
      let activityItems = [];
      /** @type {any[]} */
      let bookmarkItems = [];

      function mergeAndUpdate() {
        const seen = new Set();
        let merged = [...activityItems, ...bookmarkItems].filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        });

        // Apply ACL filtering if community event and access data are available
        const acl = perCommunityAcl.get(pubkey);
        if (acl?.communityEvent && acl.access) {
          merged = filterEventsByAccess(merged, acl.communityEvent, acl.access);
        }

        perCommunityItems.set(pubkey, merged);
        perCommunity = new Map(perCommunityItems);
        items = mergeCommunityActivity(perCommunityItems);
        isLoading = false;
      }

      /** @type {(() => void) | undefined} */
      let aclCleanup;
      const communitySub = eventStore.replaceable(10222, pubkey).subscribe((communityEvent) => {
        if (aclCleanup) aclCleanup();

        if (!communityEvent) {
          perCommunityAcl.set(pubkey, { communityEvent: null, access: null });
          mergeAndUpdate();
          return;
        }

        perCommunityAcl.set(pubkey, { communityEvent, access: null });

        const { cleanup: accessCleanup, hasRestrictedSections } = subscribeToCommunityAccess(
          communityEvent,
          getCommunikeyRelays(),
          (access) => {
            const acl = perCommunityAcl.get(pubkey);
            if (acl) acl.access = access;
            mergeAndUpdate();
          }
        );

        if (!hasRestrictedSections) mergeAndUpdate();

        aclCleanup = accessCleanup;
      });

      const activitySub = eventStore.model(CommunityActivityModel, pubkey).subscribe({
        next: (loaded) => {
          activityItems = loaded || [];
          mergeAndUpdate();
        },
        error: (err) => {
          console.error(`useJoinedCommunityItems: Activity error for ${pubkey}:`, err);
        }
      });

      const bookmarkSub = eventStore.model(CommunitySocialBookmarkModel, pubkey).subscribe({
        next: (loaded) => {
          bookmarkItems = loaded || [];
          mergeAndUpdate();
        },
        error: (err) => {
          console.error(`useJoinedCommunityItems: Bookmark error for ${pubkey}:`, err);
        }
      });

      cleanupMap.set(pubkey, () => {
        addrSub.unsubscribe();
        communitySub.unsubscribe();
        if (aclCleanup) aclCleanup();
        activitySub.unsubscribe();
        bookmarkSub.unsubscribe();
        activityCleanup();
        bookmarkCleanup();
      });
    }

    return () => {
      for (const cleanup of cleanupMap.values()) cleanup();
      cleanupMap.clear();
    };
  });

  return () => ({ items, perCommunity, isLoading });
}
