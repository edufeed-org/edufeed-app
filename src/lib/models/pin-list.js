/**
 * Community Pin List Model
 *
 * Subscribes to kind 10001 in EventStore for a community pubkey.
 * Returns an ordered array of EventPointer and AddressPointer objects
 * parsed from e and a tags, preserving tag order.
 *
 * Usage: eventStore.model(CommunityPinListModel, communityPubkey).subscribe(...)
 */
import { map } from 'rxjs/operators';

/**
 * Parse a Nostr 'a' tag array into an AddressPointer.
 * Handles d-tags containing colons (like URLs).
 * @param {string[]} tag
 * @returns {{kind: number, pubkey: string, identifier: string}|null}
 */
function parseATag(tag) {
  const value = tag[1];
  if (!value) return null;

  const firstColon = value.indexOf(':');
  const secondColon = value.indexOf(':', firstColon + 1);
  if (firstColon === -1 || secondColon === -1) return null;

  return {
    kind: parseInt(value.substring(0, firstColon), 10),
    pubkey: value.substring(firstColon + 1, secondColon),
    identifier: value.substring(secondColon + 1)
  };
}

/**
 * @param {string} communityPubkey
 * @returns {(eventStore: any) => import('rxjs').Observable<Array<any> | undefined>}
 */
export function CommunityPinListModel(communityPubkey) {
  return (eventStore) =>
    eventStore.replaceable(10001, communityPubkey).pipe(
      map((event) => {
        if (!event) return undefined;
        return event.tags
          .filter((/** @type {string[]} */ t) => t[0] === 'e' || t[0] === 'a')
          .map((/** @type {string[]} */ t) => {
            if (t[0] === 'e') {
              return { id: t[1], relays: t[2] ? [t[2]] : [] };
            }
            const pointer = parseATag(t);
            if (!pointer) return null;
            return { ...pointer, relays: t[2] ? [t[2]] : [] };
          })
          .filter(Boolean);
      })
    );
}
