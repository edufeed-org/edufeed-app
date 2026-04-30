import { nip19 } from 'nostr-tools';
import { getSeenRelays } from 'applesauce-core/helpers';
import { extractUrlFromEvent, extractEventRefFromHighlight } from '$lib/helpers/urlGrouping.js';
import { encodeEventToNaddr, hexToNpub } from '$lib/helpers/nostrUtils.js';

/**
 * Resolve the community pubkey for an event.
 * First checks the event's own h-tag, then falls back to looking up
 * which community contains this event in a perCommunityItems map.
 * This fallback handles reposted/shared events whose wrapper had
 * the h-tag but the resolved inner event does not.
 * @param {any} event
 * @param {Map<string, any[]>} [perCommunityItems]
 * @returns {string | undefined}
 */
export function resolveCommunityPubkey(event, perCommunityItems) {
  const hTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
  if (hTag) return hTag;
  if (!perCommunityItems) return undefined;
  for (const [pubkey, items] of perCommunityItems.entries()) {
    if (items.some((/** @type {any} */ e) => e.id === event.id)) {
      return pubkey;
    }
  }
  return undefined;
}

/**
 * Get the navigation route for a content event.
 * Pure function — returns a route string or undefined if no route can be determined.
 * @param {any} event
 * @param {{ communityPubkey?: string }} [options]
 * @returns {string | undefined}
 */
export function getContentEventRoute(event, options = {}) {
  const { communityPubkey } = options;

  const isCalendar = event.kind === 31922 || event.kind === 31923;
  const isBookmarkKind = event.kind === 39701 || event.kind === 9802 || event.kind === 1111;

  // Bookmark-related kinds (39701, 9802, 1111)
  if (isBookmarkKind) {
    return getBookmarkRoute(event, communityPubkey);
  }

  // Addressable kinds (30000-39999)
  const isAddressable = event.kind >= 30000 && event.kind < 40000;
  if (isAddressable) {
    const naddr = encodeEventToNaddr(event);
    if (!naddr) return undefined;

    // Community-scoped routes keep the community sidebar visible
    if (communityPubkey) {
      const npub = hexToNpub(communityPubkey);
      if (npub) {
        if (isCalendar) return `/c/${npub}/event/${naddr}`;
        if (event.kind === 30142) return `/c/${npub}/r/${naddr}`;
        if (event.kind === 30301) return `/c/${npub}/board/${naddr}`;
      }
    }

    if (isCalendar) return `/calendar/event/${naddr}`;
    if (event.kind === 30168) return `/forms/${naddr}`;
    return `/${naddr}`;
  }

  // Non-addressable events: encode as nevent (kind 11, kind 1, etc.)
  if (event.id) {
    const relays = getSeenRelays(event);
    const nevent = nip19.neventEncode({
      id: event.id,
      relays: relays ? Array.from(relays).slice(0, 3) : []
    });
    return `/${nevent}`;
  }

  return undefined;
}

/**
 * Get the route for bookmark-related kinds (39701, 9802, 1111).
 * @param {any} event
 * @param {string} [communityPubkey]
 * @returns {string | undefined}
 */
function getBookmarkRoute(event, communityPubkey) {
  // URL-based bookmark/highlight/page-note
  const rawUrl = extractUrlFromEvent(event);
  if (rawUrl && communityPubkey) {
    const displayUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    const npub = hexToNpub(communityPubkey);
    if (!npub) return undefined;
    const fragment = event.kind === 9802 ? `#highlight-${event.id}` : '';
    return `/c/${npub}/bookmarks/${encodeURIComponent(displayUrl)}${fragment}`;
  }

  // Event-ref highlight (a-tag, no r-tag)
  if (event.kind === 9802) {
    const pointer = extractEventRefFromHighlight(event);
    if (pointer && communityPubkey) {
      const npub = hexToNpub(communityPubkey);
      if (!npub) return undefined;
      const routePrefix = pointer.kind === 30818 ? 'wiki' : 'article';
      const naddr = nip19.naddrEncode({
        kind: pointer.kind,
        pubkey: pointer.pubkey,
        identifier: pointer.identifier
      });
      return `/c/${npub}/${routePrefix}/${naddr}#highlight-${event.id}`;
    }
  }

  // Bookmark without community context — fall back to naddr if addressable
  if (event.kind === 39701) {
    const naddr = encodeEventToNaddr(event);
    if (naddr) return `/${naddr}`;
  }

  return undefined;
}
