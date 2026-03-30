/* eslint-disable svelte/prefer-svelte-reactivity -- $state.raw() with native Map/Set avoids proxy issues */
/**
 * Profile List Access Hook
 * Reactive checker for community section membership via kind 30000 profile lists.
 * Replaces the old badge-based access control (useBadgeAccess).
 */
import { getProfilePointersFromList } from 'applesauce-common/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { manager } from '$lib/stores/accounts.svelte';
import { untrack } from 'svelte';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

/**
 * @typedef {Object} ProfileListAccess
 * @property {(sectionName: string) => boolean} canPublish - Whether current user can publish to a section
 * @property {(sectionName: string) => string[]} getMembers - Get member pubkeys for a section
 * @property {(sectionName: string) => string[] | null} getAllowedAuthors - Get allowed pubkeys for filtering, or null if open
 * @property {(sectionName: string) => string | null} getFormRef - Get form/application URL from profile list
 * @property {boolean} isLoading
 */

/**
 * Reactive profile-list access checker for community sections.
 * For each section with a profileList a-tag, fetches the kind 30000 event
 * and checks if the current user's pubkey is in the p-tag list.
 *
 * Sections without a profileList are open access (canPublish returns true).
 *
 * @param {() => any} getCommunityEvent - Getter for kind 10222 event
 * @param {() => string[]} getRelays - Getter for relay URLs to fetch profile lists from
 * @returns {ProfileListAccess}
 */
export function useProfileListAccess(getCommunityEvent, getRelays) {
  /** @type {Map<string, Set<string>>} section name → member pubkeys */
  let memberMap = $state.raw(new Map());
  /** @type {Map<string, string | null>} section name → form ref URL */
  let formRefMap = $state.raw(new Map());
  let isLoading = $state(true);

  $effect(() => {
    const communityEvent = getCommunityEvent();
    if (!communityEvent) {
      memberMap = new Map();
      formRefMap = new Map();
      isLoading = false;
      return;
    }

    const contentTypes = parseCommunityContentTypes(communityEvent);
    const sectionsWithLists = contentTypes.filter((ct) => ct.profileList);

    if (sectionsWithLists.length === 0) {
      memberMap = new Map();
      formRefMap = new Map();
      isLoading = false;
      return;
    }

    isLoading = true;
    const relays = getRelays();
    let pendingCount = sectionsWithLists.length;

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];

    for (const section of sectionsWithLists) {
      const address = section.profileList;
      if (!address) continue;

      // Parse "30000:pubkey:d-tag"
      const parts = address.split(':');
      if (parts.length < 3) {
        pendingCount--;
        if (pendingCount === 0) isLoading = false;
        continue;
      }

      const [, pubkey, ...identifierParts] = parts;
      const identifier = identifierParts.join(':');

      // Determine relays: use profile list relay hint if available, plus passed relays
      const fetchRelays = section.profileListRelay ? [section.profileListRelay, ...relays] : relays;

      // Fetch the profile list event
      const loaderSub = addressLoader({
        kind: 30000,
        pubkey,
        identifier,
        relays: fetchRelays
      }).subscribe();
      subs.push(loaderSub);

      // Subscribe for reactive updates
      const modelSub = eventStore.replaceable(30000, pubkey, identifier).subscribe((event) => {
        const newMemberMap = new Map(untrack(() => memberMap));
        const newFormRefMap = new Map(untrack(() => formRefMap));

        if (event) {
          const pointers = getProfilePointersFromList(event);
          newMemberMap.set(section.name, new Set(pointers.map((p) => p.pubkey)));

          // Extract form reference from tags (e.g., ["form", "https://..."])
          const formTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'form');
          newFormRefMap.set(section.name, formTag?.[1] || null);
        } else {
          newMemberMap.set(section.name, new Set());
          newFormRefMap.set(section.name, null);
        }

        memberMap = newMemberMap;
        formRefMap = newFormRefMap;
        pendingCount--;
        if (pendingCount <= 0) isLoading = false;
      });
      subs.push(modelSub);
    }

    return () => {
      for (const sub of subs) sub.unsubscribe();
    };
  });

  return {
    get isLoading() {
      return isLoading;
    },
    /**
     * Check if current user can publish to a section.
     * Returns true for sections without a profile list (open access).
     * @param {string} sectionName
     * @returns {boolean}
     */
    canPublish(sectionName) {
      const userPubkey = manager.active?.pubkey;
      if (!userPubkey) return false;

      // Community owner always has access to all sections
      const communityEvent = getCommunityEvent();
      if (communityEvent?.pubkey === userPubkey) return true;

      const members = memberMap.get(sectionName);
      // No profile list for this section → open access
      if (!members) return true;
      // Empty set means list exists but no members loaded yet
      if (members.size === 0 && isLoading) return false;
      return members.has(userPubkey);
    },
    /**
     * Get member pubkeys for a section
     * @param {string} sectionName
     * @returns {string[]}
     */
    getMembers(sectionName) {
      const members = memberMap.get(sectionName);
      return members ? Array.from(members) : [];
    },
    /**
     * Get allowed author pubkeys for read-side filtering.
     * Returns null for open sections (no profile list → no filtering).
     * Returns string[] for restricted sections (only these pubkeys' content shown).
     * @param {string} sectionName
     * @returns {string[] | null}
     */
    getAllowedAuthors(sectionName) {
      const members = memberMap.get(sectionName);
      if (!members) return null;
      return Array.from(members);
    },
    /**
     * Get form/application reference URL from the profile list event
     * @param {string} sectionName
     * @returns {string | null}
     */
    getFormRef(sectionName) {
      return formRefMap.get(sectionName) || null;
    }
  };
}
