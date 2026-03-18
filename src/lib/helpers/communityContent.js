/**
 * Community Content Helper
 * Utilities for filtering content by community associations
 *
 * Content can be associated with communities through:
 * 1. Direct #h tag on the content event
 * 2. Targeted publications (kind 30222) referencing the content
 */
import { getTagValue } from 'applesauce-core/helpers';

/**
 * Get the addressable reference for an event (pure function, no caching)
 * This replaces applesauce-core's getReplaceableAddress which uses internal caching
 * that causes Svelte 5 state_unsafe_mutation errors when called inside $derived()
 * @param {any} event - Nostr event
 * @returns {string | undefined} Address in format "kind:pubkey:d-tag" or undefined
 */
function getAddressableReference(event) {
  // Addressable/parameterized replaceable events have kind 30000-39999
  if (!event || event.kind < 30000 || event.kind >= 40000) return undefined;
  const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
  return `${event.kind}:${event.pubkey}:${dTag}`;
}

/**
 * Build a mapping of content IDs to community pubkeys from targeted publications
 * @param {any[]} targetedPubs - Array of kind 30222 events
 * @returns {Map<string, string[]>} Map of content ID/address → array of community pubkeys
 */
export function buildContentToCommunityMap(targetedPubs) {
  const contentToCommunities = new Map();

  for (const pub of targetedPubs || []) {
    const communityPubkey = getTagValue(pub, 'p');
    const eTag = getTagValue(pub, 'e');
    const aTag = getTagValue(pub, 'a');

    if (!communityPubkey) continue;

    // Index by event ID - using immutable array operations (Svelte 5 compatible)
    if (eTag) {
      const existing = contentToCommunities.get(eTag) || [];
      if (!existing.includes(communityPubkey)) {
        contentToCommunities.set(eTag, [...existing, communityPubkey]);
      }
    }

    // Index by addressable reference - using immutable array operations
    if (aTag) {
      const existing = contentToCommunities.get(aTag) || [];
      if (!existing.includes(communityPubkey)) {
        contentToCommunities.set(aTag, [...existing, communityPubkey]);
      }
    }
  }

  return contentToCommunities;
}

/**
 * Get all community pubkeys that a content event is associated with
 * Checks both direct #h tags and targeted publications
 * @param {any} event - The content event (article, AMB resource, calendar event, etc.)
 * @param {Map<string, string[]>} contentToCommunityMap - Map from buildContentToCommunityMap
 * @returns {string[]} Array of community pubkeys
 */
export function getContentCommunities(event, contentToCommunityMap) {
  // Handle transformed events (like CalendarEvent) that store raw event in originalEvent
  const rawEvent = event.originalEvent || event;

  // Get direct #h tag
  const hTag = getTagValue(rawEvent, 'h');

  // Get from targeted publications by event ID
  const byId = contentToCommunityMap.get(rawEvent.id);

  // Get from targeted publications by addressable reference (using pure function to avoid Svelte 5 mutation errors)
  const address = getAddressableReference(rawEvent);
  const byAddress = address ? contentToCommunityMap.get(address) : undefined;

  // Build array without mutations (Svelte 5 compatible), then dedupe
  const communities = /** @type {string[]} */ (
    [hTag, ...(byId || []), ...(byAddress || [])].filter(Boolean)
  );

  // Return unique values
  return [...new Set(communities)];
}

/**
 * Filter content items by community
 * @param {Array<{type: string, data: any}>} items - Combined content items
 * @param {string | null} communityFilter - Community pubkey, 'joined', or null for all
 * @param {string[]} joinedCommunityPubkeys - Array of joined community pubkeys
 * @param {Map<string, string[]>} contentToCommunityMap - Map from buildContentToCommunityMap
 * @returns {Array<{type: string, data: any}>} Filtered content items
 */
export function filterContentByCommunity(
  items,
  communityFilter,
  joinedCommunityPubkeys,
  contentToCommunityMap
) {
  // No filter - show all
  if (!communityFilter) {
    return items;
  }

  // "joined" filter - show content from any joined community
  if (communityFilter === 'joined') {
    const joinedSet = new Set(joinedCommunityPubkeys);
    return items.filter((item) => {
      const communities = getContentCommunities(item.data, contentToCommunityMap);
      return communities.some((pubkey) => joinedSet.has(pubkey));
    });
  }

  // Specific community filter
  return items.filter((item) => {
    const communities = getContentCommunities(item.data, contentToCommunityMap);
    return communities.includes(communityFilter);
  });
}

/**
 * Get community display info for the filter dropdown
 * @param {any[]} allCommunities - Array of community events (kind 10222)
 * @param {string[]} joinedCommunities - Array of joined community pubkeys
 * @param {Map<string, any>} communityProfiles - Map of community pubkey → profile
 * @returns {{ joined: Array<{pubkey: string, name: string}>, discover: Array<{pubkey: string, name: string}> }}
 */
export function getCommunityFilterOptions(allCommunities, joinedCommunities, communityProfiles) {
  // Get set of joined community pubkeys (already strings from follow set)
  const joinedPubkeys = new Set(joinedCommunities);

  const joined = [];
  const discover = [];

  for (const community of allCommunities) {
    const pubkey = community.pubkey;
    const profile = communityProfiles.get(pubkey);
    const name =
      profile?.name || profile?.display_name || `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;

    const option = { pubkey, name };

    if (joinedPubkeys.has(pubkey)) {
      joined.push(option);
    } else {
      discover.push(option);
    }
  }

  // Sort alphabetically by name
  joined.sort((a, b) => a.name.localeCompare(b.name));
  discover.sort((a, b) => a.name.localeCompare(b.name));

  return { joined, discover };
}
