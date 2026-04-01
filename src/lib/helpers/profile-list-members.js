/**
 * Profile List Members — framework-agnostic helper for subscribing to
 * profile list member data for community ACL restrictions.
 *
 * Extracted from useProfileListAccess so both the Svelte hook and
 * non-reactive code (e.g. DashboardCommunityFeed) can reuse it.
 */
import { getProfilePointersFromList } from 'applesauce-common/helpers';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { addressLoader } from '$lib/loaders/base.js';
import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';

/**
 * Subscribe to profile list member data for a community's restricted sections.
 * Loads kind 30000 events via addressLoader and subscribes to eventStore for updates.
 *
 * @param {any} communityEvent - kind 10222 event
 * @param {string[]} relays - relays to fetch profile lists from
 * @param {(memberMap: Map<string, Set<string>>, formRefMap: Map<string, string|null>) => void} onUpdate
 * @returns {{ cleanup: () => void, hasRestrictedSections: boolean }}
 */
export function subscribeToProfileListMembers(communityEvent, relays, onUpdate) {
  const contentTypes = parseCommunityContentTypes(communityEvent);
  const sectionsWithLists = contentTypes.filter((ct) => ct.profileList);

  if (sectionsWithLists.length === 0) {
    return { cleanup: () => {}, hasRestrictedSections: false };
  }

  /** @type {Map<string, Set<string>>} section name → member pubkeys */
  const memberMap = new Map();
  /** @type {Map<string, string | null>} section name → form ref URL */
  const formRefMap = new Map();

  /** @type {import('rxjs').Subscription[]} */
  const subs = [];

  for (const section of sectionsWithLists) {
    const address = section.profileList;
    if (!address) continue;

    const parts = address.split(':');
    if (parts.length < 3) continue;

    const [, pubkey, ...identifierParts] = parts;
    const identifier = identifierParts.join(':');

    const fetchRelays = section.profileListRelay ? [section.profileListRelay, ...relays] : relays;

    const loaderSub = addressLoader({
      kind: 30000,
      pubkey,
      identifier,
      relays: fetchRelays
    }).subscribe();
    subs.push(loaderSub);

    const modelSub = eventStore.replaceable(30000, pubkey, identifier).subscribe((event) => {
      if (event) {
        const pointers = getProfilePointersFromList(event);
        memberMap.set(section.name, new Set(pointers.map((p) => p.pubkey)));
        const formTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'form');
        formRefMap.set(section.name, formTag?.[1] || null);
      } else {
        memberMap.set(section.name, new Set());
        formRefMap.set(section.name, null);
      }
      onUpdate(memberMap, formRefMap);
    });
    subs.push(modelSub);
  }

  return {
    cleanup: () => {
      for (const sub of subs) sub.unsubscribe();
    },
    hasRestrictedSections: true
  };
}

/**
 * Build a profileAccess-compatible object from a member map.
 * Compatible with filterEventsByAccess() in contentTypes.js.
 *
 * @param {Map<string, Set<string>>} memberMap
 * @param {boolean} isLoading
 * @returns {{ getAllowedAuthors: (name: string) => string[]|null, isLoading: boolean }}
 */
export function buildProfileAccess(memberMap, isLoading) {
  return {
    isLoading,
    getAllowedAuthors(sectionName) {
      const members = memberMap.get(sectionName);
      if (!members) return null;
      return Array.from(members);
    }
  };
}
