import { nip19 } from 'nostr-tools';

/**
 * Encode a hex pubkey as npub. Returns null for malformed input so callers
 * can degrade gracefully (e.g. fall back to a non-community route).
 *
 * @param {string} hex
 * @returns {string|null}
 */
function hexToNpub(hex) {
  if (!hex || typeof hex !== 'string') return null;
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  try {
    return nip19.npubEncode(hex);
  } catch {
    return null;
  }
}

/**
 * Map of addressable kinds with dedicated community-scoped routes.
 * Kinds not in this map fall through to the generic /[naddr] route
 * (or to /[nevent] for non-addressables) — but still get community-scoped
 * to /c/<npub>/<nevent> when h-tagged and non-addressable.
 *
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
 * Calendar kinds that have dedicated top-level routes outside /[naddr].
 * Maps kind → top-level route prefix.
 *
 * @type {Record<number, string>}
 */
const CALENDAR_TOP_LEVEL_PATHS = {
  31922: '/calendar/event',
  31923: '/calendar/event',
  31924: '/calendar'
};

/**
 * Pure check for parameterized-replaceable (addressable) kinds.
 * Avoids applesauce-core helpers that mutate via internal caching, which would
 * break when this is called inside a Svelte $derived block.
 *
 * @param {number} kind
 */
function isAddressableKind(kind) {
  return kind >= 30000 && kind < 40000;
}

/**
 * Encode an event into its naddr (parameterized-replaceable address).
 *
 * @param {{ kind: number, pubkey: string, tags?: string[][] }} event
 * @returns {string|null}
 */
function encodeNaddr(event) {
  if (!event?.pubkey) return null;
  const identifier = event.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
  try {
    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier,
      relays: []
    });
  } catch {
    return null;
  }
}

/**
 * Encode an event id as nevent.
 *
 * @param {{ id: string }} event
 * @returns {string|null}
 */
function encodeNevent(event) {
  if (!event?.id) return null;
  try {
    return nip19.neventEncode({ id: event.id, relays: [] });
  } catch {
    return null;
  }
}

/**
 * Compute the canonical app route for an event.
 *
 * Resolution rules:
 *  - 31922 / 31923 → /calendar/event/<naddr>, or /c/<npub>/event/<naddr> when h-tagged
 *  - 31924         → /calendar/<naddr> (no community variant exists)
 *  - 30023, 30142, 30301, 30818 with h-tag → /c/<npub>/<type>/<naddr>
 *  - other addressables → /<naddr>
 *  - non-addressables with h-tag → /c/<npub>/<nevent>
 *  - non-addressables without h-tag → /<nevent>
 *
 * Returns null when the event lacks the data needed to encode a route.
 *
 * @param {any} event
 * @returns {string|null}
 */
export function getCanonicalEventRoute(event) {
  if (!event) return null;

  const hHex = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
  const communityNpub = hHex ? hexToNpub(hHex) : null;

  if (isAddressableKind(event.kind)) {
    const naddr = encodeNaddr(event);
    if (!naddr) return null;

    // Calendar collection — top-level only, no community variant.
    if (event.kind === 31924) {
      return `${CALENDAR_TOP_LEVEL_PATHS[31924]}/${naddr}`;
    }

    // Community-scoped path takes precedence when h-tag is present.
    if (communityNpub && COMMUNITY_ADDRESSABLE_PATHS[event.kind]) {
      return `/c/${communityNpub}/${COMMUNITY_ADDRESSABLE_PATHS[event.kind]}/${naddr}`;
    }

    // Calendar events fall back to dedicated top-level route.
    if (CALENDAR_TOP_LEVEL_PATHS[event.kind]) {
      return `${CALENDAR_TOP_LEVEL_PATHS[event.kind]}/${naddr}`;
    }

    // Generic addressable rendering.
    return `/${naddr}`;
  }

  // Non-addressable — encode as nevent and optionally scope to community.
  const nevent = encodeNevent(event);
  if (!nevent) return null;

  return communityNpub ? `/c/${communityNpub}/${nevent}` : `/${nevent}`;
}
