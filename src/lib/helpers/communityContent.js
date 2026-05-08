/**
 * Community Content Helper
 * Utilities for community-related content shaping on the discover page.
 *
 * Note: post-filtering by community has been replaced by sourcing content
 * directly from CommunityActivityModel when a community filter is active.
 * `mapCommunityItemsToRawItems` shapes that model's output for the discover
 * pipeline.
 */
import { formatAMBResource } from '$lib/helpers/educational/index.js';
import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';

/**
 * Reattach repost-provenance fields the per-kind transforms drop.
 * @param {any} transformed
 * @param {any} source
 * @returns {any}
 */
function preserveRepostMeta(transformed, source) {
  if (source._sharedBy !== undefined) transformed._sharedBy = source._sharedBy;
  if (source._allSharers !== undefined) transformed._allSharers = source._allSharers;
  return transformed;
}

/**
 * Map an event to a discover rawItems entry, applying per-kind transforms.
 * @param {any} event
 * @returns {{type: string, data: any} | null}
 */
function mapEventToRawItem(event) {
  switch (event.kind) {
    case 30142:
      return { type: 'amb', data: preserveRepostMeta(formatAMBResource(event), event) };
    case 31922:
    case 31923:
      return { type: 'event', data: preserveRepostMeta(getCalendarEventMetadata(event), event) };
    case 30023:
      return { type: 'article', data: event };
    case 30301:
      return { type: 'board', data: event };
    default:
      return null;
  }
}

/** Kinds shown for each discover content type. */
const KINDS_BY_CONTENT_TYPE = {
  all: new Set([30142, 31922, 31923, 30023, 30301]),
  learning: new Set([30142]),
  events: new Set([31922, 31923]),
  articles: new Set([30023]),
  boards: new Set([30301])
};

/**
 * Convert CommunityActivityModel output into discover-page rawItems
 * (`{type, data}` entries with per-kind transforms applied), filtered by
 * the active content type.
 *
 * Per-kind transforms must be reapplied here because CommunityActivityModel
 * is constructed without a transform (it spans multiple kinds).
 *
 * @param {any[]} items - Output of CommunityActivityModel for one or more communities
 * @param {'all'|'events'|'learning'|'articles'|'boards'} contentType
 * @returns {Array<{type: string, data: any}>}
 */
export function mapCommunityItemsToRawItems(items, contentType) {
  const allowedKinds = KINDS_BY_CONTENT_TYPE[contentType] || KINDS_BY_CONTENT_TYPE.all;
  const out = [];
  for (const event of items || []) {
    if (!allowedKinds.has(event.kind)) continue;
    const mapped = mapEventToRawItem(event);
    if (mapped) out.push(mapped);
  }
  return out;
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
