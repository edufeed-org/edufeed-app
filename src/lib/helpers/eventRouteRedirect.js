import { nip19 } from 'nostr-tools';
import { getSeenRelays } from 'applesauce-core/helpers';
import { getAppManagedRelays } from '$lib/helpers/relay-helper.js';
import { prioritizeRelayHints } from '$lib/helpers/relayHints.js';
import { eventRoutePath, isAddressableKind } from '$lib/helpers/eventRoutePath.js';

/**
 * Encode an event into its naddr (parameterized-replaceable address).
 *
 * @param {{ kind: number, pubkey: string, tags?: string[][] }} event
 * @returns {string|null}
 */
/**
 * @param {{ kind: number, pubkey: string, tags?: string[][] }} event
 * @param {string[]} [inboundHints] - relay hints asserted by the identifier
 *   that led us to this event (e.g. the naddr being redirected). Used after
 *   seen-relays: cache-served events carry no seen-relays, and dropping the
 *   inbound hints here would strip them from the address-bar URL users copy.
 */
function encodeNaddr(event, inboundHints = []) {
  if (!event?.pubkey) return null;
  const identifier = event.tags?.find((t) => t[0] === 'd')?.[1] ?? '';
  // Carry the relays we actually saw the event on — this naddr ends up in the
  // browser address bar (users copy it from there), so without hints the link
  // only resolves on deployments whose lookup relays happen to hold the event.
  const seenRelays = Array.from(getSeenRelays(/** @type {any} */ (event)) ?? []);
  const relays = prioritizeRelayHints(
    [...new Set([...seenRelays, ...inboundHints])],
    getAppManagedRelays()
  );
  try {
    return nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier,
      relays
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
  // Carry the relays we actually saw the event on so the redirect target can
  // refetch it — re-encoding with empty hints leaves the community route
  // dependent solely on lookup relays, which may not hold the event.
  const relays = prioritizeRelayHints(
    getSeenRelays(/** @type {any} */ (event)),
    getAppManagedRelays()
  );
  try {
    return nip19.neventEncode({ id: event.id, relays });
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
 * @param {{ relayHints?: string[] }} [options] - relayHints: hints from the
 *   identifier that resolved this event, preserved in the re-encoded naddr
 * @returns {string|null}
 */
export function getCanonicalEventRoute(event, options = {}) {
  if (!event) return null;
  if (isAddressableKind(event.kind)) {
    return eventRoutePath(event, { naddr: encodeNaddr(event, options.relayHints ?? []) });
  }
  return eventRoutePath(event, { nevent: encodeNevent(event) });
}
