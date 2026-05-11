import { nip19 } from 'nostr-tools';
import { getSeenRelays } from 'applesauce-core/helpers';
import { getCommentRootPointer, isCommentExternalPointer } from 'applesauce-common/helpers';
import { extractUrlFromEvent, extractEventRefFromHighlight } from '$lib/helpers/urlGrouping.js';
import { encodeEventToNaddr, hexToNpub } from '$lib/helpers/nostrUtils.js';

/**
 * A kind 1111 (NIP-22 Comment) acts as a bookmark only when it's a page note —
 * a URL-rooted comment per NIP-73 (K=web). Event/address-rooted replies fall
 * through to the generic nevent fallback so they can be rendered as threads.
 * @param {any} event
 * @returns {boolean}
 */
function is1111PageNote(event) {
  if (event.kind !== 1111) return false;
  const root = getCommentRootPointer(event);
  return isCommentExternalPointer(root) && root.kind === 'web';
}

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
  // A kind 1111 is bookmark-shaped only when it's a page note (URL-rooted comment).
  // Reply-shaped 1111s (event/address-rooted) fall through to the nevent fallback below.
  const isBookmarkKind = event.kind === 39701 || event.kind === 9802 || is1111PageNote(event);

  // Bookmark-related kinds (39701, 9802, 1111-page-note)
  if (isBookmarkKind) {
    const route = getBookmarkRoute(event, communityPubkey);
    if (route) return route;
    // Fall through: e.g. a kind 1111 page-note without community context still
    // deserves a clickable destination — let the nevent fallback handle it.
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

  // Non-addressable events: encode as nevent (kind 11, kind 1, kind 1068, etc.)
  if (event.id) {
    const relays = getSeenRelays(event);
    const nevent = nip19.neventEncode({
      id: event.id,
      relays: relays ? Array.from(relays).slice(0, 3) : []
    });
    // Polls (kind 1068) need a community-scoped detail route so the community
    // sidebar stays visible. Other non-addressable kinds (1, 11, 1111, …) use
    // the global /nevent route — the global detail page handles h-tag redirects.
    if (event.kind === 1068 && communityPubkey) {
      const npub = hexToNpub(communityPubkey);
      if (npub) return `/c/${npub}/${nevent}`;
    }
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
