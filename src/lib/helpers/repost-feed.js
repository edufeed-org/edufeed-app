/**
 * Repost feed merge/group helpers.
 *
 * Pure functions for integrating NIP-18 reposts (kind 6/16) into
 * the follows feed with grouping and deduplication.
 */
import { getSharedEventPointer, getSharedAddressPointer } from 'applesauce-common/helpers';
import { kindToFeedCategory } from './profile-feed.js';

/**
 * @typedef {Object} RepostMeta
 * @property {string[]} sharers - Pubkeys of users who reposted
 * @property {number} latestRepostTs - Most recent repost timestamp
 */

/**
 * @typedef {Object} FeedEntry
 * @property {string} type - Feed category (notes, calendar, resources, etc.)
 * @property {any} data - The original event
 * @property {number} ts - Timestamp for sorting
 * @property {RepostMeta} [repost] - Present if item entered feed via repost
 */

/**
 * Resolve a repost event to its target event using the lookup map.
 * Tries e-tag (EventPointer) first, then a-tag (AddressPointer) as fallback.
 *
 * @param {any} repostEvent
 * @param {Map<string, any>} resolvedLookup - eventId or "kind:pubkey:d" → event
 * @returns {any | undefined}
 */
function resolveRepostTarget(repostEvent, resolvedLookup) {
  const eventPointer = getSharedEventPointer(repostEvent);
  if (eventPointer) {
    const found = resolvedLookup.get(eventPointer.id);
    if (found) return found;
  }

  const addrPointer = getSharedAddressPointer(repostEvent);
  if (addrPointer) {
    const coord = `${addrPointer.kind}:${addrPointer.pubkey}:${addrPointer.identifier}`;
    return resolvedLookup.get(coord);
  }

  return undefined;
}

/**
 * Merge repost events into feed entries, grouping by target event.
 *
 * - Reposts whose target is already a direct feed entry get repost metadata attached
 *   without changing the entry's sort position.
 * - Reposts of new content (not in direct entries) create new entries sorted by repost time.
 * - Multiple reposts of the same event are grouped into a single entry.
 *
 * @param {FeedEntry[]} feedEntries - Existing direct feed entries
 * @param {any[]} repostEvents - Kind 6/16 events from followed users
 * @param {Map<string, any>} resolvedLookup - eventId or "kind:pubkey:d" → resolved event
 * @returns {FeedEntry[]} Merged entries (new array, does not mutate input)
 */
export function mergeRepostsIntoFeed(feedEntries, repostEvents, resolvedLookup) {
  // Clone entries so we don't mutate input
  /** @type {FeedEntry[]} */
  const result = feedEntries.map((e) => ({ ...e }));

  // Index direct entries by event ID for dedup lookups
  /** @type {Map<string, FeedEntry>} */
  const entryByEventId = new Map();
  for (const entry of result) {
    if (entry.data?.id) {
      entryByEventId.set(entry.data.id, entry);
    }
  }

  // Track new repost-only entries by target event ID
  /** @type {Map<string, FeedEntry>} */
  const repostEntries = new Map();

  for (const repost of repostEvents) {
    const target = resolveRepostTarget(repost, resolvedLookup);
    if (!target) continue;

    const category = kindToFeedCategory(target.kind);
    if (!category) continue;

    const reposterPubkey = repost.pubkey;

    // Check if target already exists as a direct entry
    const existingDirect = entryByEventId.get(target.id);
    if (existingDirect) {
      // Attach repost metadata to the direct entry (keep its ts)
      if (!existingDirect.repost) {
        existingDirect.repost = { sharers: [], latestRepostTs: repost.created_at };
      }
      if (!existingDirect.repost.sharers.includes(reposterPubkey)) {
        existingDirect.repost.sharers.push(reposterPubkey);
      }
      if (repost.created_at > existingDirect.repost.latestRepostTs) {
        existingDirect.repost.latestRepostTs = repost.created_at;
      }
      continue;
    }

    // Check if we already have a repost entry for this target
    const existingRepost = repostEntries.get(target.id);
    if (existingRepost && existingRepost.repost) {
      if (!existingRepost.repost.sharers.includes(reposterPubkey)) {
        existingRepost.repost.sharers.push(reposterPubkey);
      }
      if (repost.created_at > existingRepost.repost.latestRepostTs) {
        existingRepost.repost.latestRepostTs = repost.created_at;
        existingRepost.ts = repost.created_at;
      }
      continue;
    }

    // New repost-only entry
    /** @type {FeedEntry} */
    const entry = {
      type: category,
      data: target,
      ts: repost.created_at,
      repost: {
        sharers: [reposterPubkey],
        latestRepostTs: repost.created_at
      }
    };
    repostEntries.set(target.id, entry);
  }

  // Append repost-only entries to result
  for (const entry of repostEntries.values()) {
    result.push(entry);
  }

  return result;
}
