/**
 * Route shape of an event's canonical page — pure, no stores, safe on the server.
 *
 * The client (eventRouteRedirect.js) feeds it an naddr carrying the relays the
 * event was seen on; the server (canonical links, sitemap) feeds it a
 * deterministic naddr, so both agree on the path while differing in hints.
 */
import { nip19 } from 'nostr-tools';

/**
 * Addressable kinds with dedicated community-scoped routes.
 * @type {Record<number, string>}
 */
const COMMUNITY_ADDRESSABLE_PATHS = {
  31922: 'event',
  31923: 'event',
  30023: 'article',
  30142: 'r',
  30301: 'board',
  30818: 'wiki'
};

/**
 * Calendar kinds with dedicated top-level routes outside /[naddr].
 * @type {Record<number, string>}
 */
const CALENDAR_TOP_LEVEL_PATHS = {
  31922: '/calendar/event',
  31923: '/calendar/event',
  31924: '/calendar'
};

/** @param {number} kind */
export function isAddressableKind(kind) {
  return kind >= 30000 && kind < 40000;
}

/**
 * npub of the event's community h-tag, or null when absent/malformed.
 * @param {{ tags?: string[][] }} event
 * @returns {string | null}
 */
function communityNpubOf(event) {
  const hex = event.tags?.find((t) => t[0] === 'h')?.[1];
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return null;
  try {
    return nip19.npubEncode(hex);
  } catch {
    return null;
  }
}

/**
 * Resolution rules:
 *  - 31922 / 31923 → /calendar/event/<naddr>, or /c/<npub>/event/<naddr> when h-tagged
 *  - 31924         → /calendar/<naddr> (no community variant exists)
 *  - 30023, 30142, 30301, 30818 with h-tag → /c/<npub>/<type>/<naddr>
 *  - other addressables → /<naddr>
 *  - non-addressables with h-tag → /c/<npub>/<nevent>
 *  - non-addressables without h-tag → /<nevent>
 *
 * @param {{ kind: number, tags?: string[][] } | null | undefined} event
 * @param {{ naddr?: string | null, nevent?: string | null }} ids - encoded identifiers
 * @returns {string | null} null when the identifier the kind needs is missing
 */
export function eventRoutePath(event, { naddr, nevent }) {
  if (!event) return null;
  const communityNpub = communityNpubOf(event);

  if (isAddressableKind(event.kind)) {
    if (!naddr) return null;
    if (event.kind === 31924) return `${CALENDAR_TOP_LEVEL_PATHS[31924]}/${naddr}`;
    if (communityNpub && COMMUNITY_ADDRESSABLE_PATHS[event.kind]) {
      return `/c/${communityNpub}/${COMMUNITY_ADDRESSABLE_PATHS[event.kind]}/${naddr}`;
    }
    if (CALENDAR_TOP_LEVEL_PATHS[event.kind]) {
      return `${CALENDAR_TOP_LEVEL_PATHS[event.kind]}/${naddr}`;
    }
    return `/${naddr}`;
  }

  if (!nevent) return null;
  return communityNpub ? `/c/${communityNpub}/${nevent}` : `/${nevent}`;
}
