/**
 * URL grouping helpers for Social Bookmarks.
 * Groups bookmark (39701), highlight (9802), and page note (1111) events by URL.
 * Also groups event-ref highlights (kind 9802 with a-tag) by address pointer.
 */

import { getHighlightSourceUrl } from 'applesauce-common/helpers';
import { getSeenRelays } from 'applesauce-core/helpers';

/**
 * @typedef {Object} UrlGroup
 * @property {string} url - Normalized URL (canonical key)
 * @property {string} displayUrl - Original URL for display/linking
 * @property {string} title - From bookmark title tag, or URL
 * @property {string} description - From bookmark content
 * @property {any[]} bookmarks - Kind 39701 events
 * @property {any[]} highlights - Kind 9802 events (r-tag only)
 * @property {any[]} pageNotes - Kind 1111 events (K=web)
 * @property {number} latestActivity - Most recent created_at
 * @property {string[]} contributors - Unique pubkeys
 */

/**
 * Normalize a URL for grouping. Strips scheme, www., trailing slash, lowercases hostname.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  if (!url) return '';

  let normalized = url;

  // Strip scheme
  normalized = normalized.replace(/^https?:\/\//, '');

  // Strip www.
  normalized = normalized.replace(/^www\./, '');

  // Lowercase hostname (everything before first /)
  const slashIndex = normalized.indexOf('/');
  if (slashIndex > 0) {
    const hostname = normalized.slice(0, slashIndex).toLowerCase();
    const rest = normalized.slice(slashIndex);
    normalized = hostname + rest;
  } else {
    normalized = normalized.toLowerCase();
  }

  // Strip trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Extract URL from a social bookmark event based on its kind.
 * Returns undefined if event doesn't qualify as a social bookmark.
 * @param {any} event
 * @returns {string | undefined}
 */
export function extractUrlFromEvent(event) {
  if (!event || !event.tags) return undefined;

  if (event.kind === 39701) {
    // Bookmark: d-tag is the URL without scheme
    const dTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd');
    return dTag?.[1] || undefined;
  }

  if (event.kind === 9802) {
    // Highlight: r-tag is the source URL. Only URL highlights qualify.
    const rTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'r');
    return rTag?.[1] || undefined;
  }

  if (event.kind === 1111) {
    // Page note: I-tag is the URL, K-tag must be 'web'
    const kTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'K');
    if (kTag?.[1] !== 'web') return undefined;
    const iTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'I');
    return iTag?.[1] || undefined;
  }

  return undefined;
}

/**
 * Filter events to only social bookmark-eligible ones.
 * - Kind 39701: always included
 * - Kind 9802: only with r-tag (URL highlights, not Nostr event highlights)
 * - Kind 1111: only with K=web (page notes, not event comments)
 * @param {any[]} events
 * @returns {any[]}
 */
export function filterSocialBookmarks(events) {
  return events.filter((event) => extractUrlFromEvent(event) !== undefined);
}

/**
 * Group filtered social bookmark events by normalized URL.
 * @param {any[]} events - Already-filtered events (use filterSocialBookmarks first, or raw events)
 * @returns {UrlGroup[]} Sorted by latestActivity descending
 */
export function groupByUrl(events) {
  /** @type {Map<string, { bookmarks: any[], highlights: any[], pageNotes: any[], displayUrl: string, title: string, description: string, latestActivity: number, contributorSet: Set<string> }>} */
  const groups = new Map();

  for (const event of events) {
    const rawUrl = extractUrlFromEvent(event);
    if (!rawUrl) continue;

    const normalized = normalizeUrl(rawUrl);
    if (!normalized) continue;

    if (!groups.has(normalized)) {
      groups.set(normalized, {
        bookmarks: [],
        highlights: [],
        pageNotes: [],
        displayUrl: '',
        title: '',
        description: '',
        latestActivity: 0,
        contributorSet: new Set()
      });
    }

    const group = /** @type {NonNullable<ReturnType<typeof groups.get>>} */ (
      groups.get(normalized)
    );

    // Categorize by kind
    if (event.kind === 39701) {
      group.bookmarks.push(event);
      // Extract title from bookmark's title tag
      const titleTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'title');
      if (titleTag?.[1] && !group.title) {
        group.title = titleTag[1];
      }
      // Extract description from bookmark content
      if (event.content && !group.description) {
        group.description = event.content;
      }
    } else if (event.kind === 9802) {
      group.highlights.push(event);
    } else if (event.kind === 1111) {
      group.pageNotes.push(event);
    }

    // Track display URL (prefer full URL with scheme)
    if (rawUrl.startsWith('http') && !group.displayUrl) {
      group.displayUrl = rawUrl;
    }

    // Track latest activity
    if (event.created_at > group.latestActivity) {
      group.latestActivity = event.created_at;
    }

    // Track contributors
    if (event.pubkey) {
      group.contributorSet.add(event.pubkey);
    }
  }

  // Convert to UrlGroup array
  return Array.from(groups.entries())
    .map(([url, data]) => ({
      url,
      displayUrl: data.displayUrl || `https://${url}`,
      title: data.title || url,
      description: data.description,
      bookmarks: data.bookmarks,
      highlights: data.highlights,
      pageNotes: data.pageNotes,
      latestActivity: data.latestActivity,
      contributors: Array.from(data.contributorSet)
    }))
    .sort((a, b) => b.latestActivity - a.latestActivity);
}

/**
 * @typedef {Object} EventRefGroup
 * @property {string} aTagValue - Raw a-tag value (e.g. "30023:pubkey:identifier")
 * @property {number} kind - Event kind from the address pointer
 * @property {string} pubkey - Author pubkey from the address pointer
 * @property {string} identifier - d-tag identifier from the address pointer
 * @property {string[]} relayHints - Relay hints from a-tag position [2]
 * @property {any[]} highlights - Kind 9802 events referencing this event
 * @property {number} latestActivity - Most recent created_at
 * @property {string[]} contributors - Unique pubkeys
 */

/**
 * Extract an AddressPointer from a kind 9802 highlight that references
 * a Nostr event (via a-tag) rather than a URL (via r-tag).
 * @param {any} event
 * @returns {import('nostr-tools/nip19').AddressPointer | undefined}
 */
export function extractEventRefFromHighlight(event) {
  if (!event || event?.kind !== 9802) return undefined;
  // URL highlights have an r-tag — those belong in URL groups, not here
  if (getHighlightSourceUrl(event)) return undefined;
  // Manual a-tag parsing to avoid getOrComputeCachedValue mutation
  // (causes state_unsafe_mutation in Svelte 5 template expressions)
  const aTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'a');
  if (!aTag?.[1]) return undefined;
  const value = aTag[1];
  const firstColon = value.indexOf(':');
  const secondColon = value.indexOf(':', firstColon + 1);
  if (firstColon === -1 || secondColon === -1) return undefined;
  const kind = parseInt(value.substring(0, firstColon), 10);
  const pubkey = value.substring(firstColon + 1, secondColon);
  const identifier = value.substring(secondColon + 1);
  if (isNaN(kind) || !pubkey) return undefined;
  return { kind, pubkey, identifier };
}

/**
 * Group kind 9802 event-ref highlights by their a-tag address pointer.
 * @param {any[]} events - All events (will be filtered internally)
 * @returns {EventRefGroup[]} Sorted by latestActivity descending
 */
export function groupByEventRef(events) {
  /** @type {Map<string, { kind: number, pubkey: string, identifier: string, highlights: any[], latestActivity: number, contributorSet: Set<string>, relayHintSet: Set<string> }>} */
  const groups = new Map();

  for (const event of events) {
    const pointer = extractEventRefFromHighlight(event);
    if (!pointer) continue;

    const key = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}`;

    if (!groups.has(key)) {
      groups.set(key, {
        kind: pointer.kind,
        pubkey: pointer.pubkey,
        identifier: pointer.identifier,
        highlights: [],
        latestActivity: 0,
        contributorSet: new Set(),
        relayHintSet: new Set()
      });
    }

    const group = /** @type {NonNullable<ReturnType<typeof groups.get>>} */ (groups.get(key));
    group.highlights.push(event);

    // Collect relay hint from a-tag position [2]
    const aTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'a');
    if (aTag?.[2]) {
      group.relayHintSet.add(aTag[2]);
    }

    // Fallback: collect relays this highlight was seen on (relay provenance)
    const seenRelays = getSeenRelays(event);
    if (seenRelays) {
      for (const relay of seenRelays) {
        group.relayHintSet.add(relay);
      }
    }

    if (event.created_at > group.latestActivity) {
      group.latestActivity = event.created_at;
    }
    if (event.pubkey) {
      group.contributorSet.add(event.pubkey);
    }
  }

  return Array.from(groups.entries())
    .map(([aTagValue, data]) => ({
      aTagValue,
      kind: data.kind,
      pubkey: data.pubkey,
      identifier: data.identifier,
      relayHints: Array.from(data.relayHintSet),
      highlights: data.highlights,
      latestActivity: data.latestActivity,
      contributors: Array.from(data.contributorSet)
    }))
    .sort((a, b) => b.latestActivity - a.latestActivity);
}
