import { getNip10References } from 'applesauce-common/helpers';
import { getReactionAddressPointer, getReactionEventPointer } from 'applesauce-common/helpers';
import { getRSVPAddressPointer } from 'applesauce-common/helpers';
import { encodePointer } from 'applesauce-core/helpers';
import { nip19 } from 'nostr-tools';

/**
 * Returns the parent event pointer for a note, or null if standalone.
 * Prefers the direct parent (reply marker) over root.
 * @param {import('nostr-tools').Event} event
 * @returns {{ id: string, relayHint?: string } | null}
 */
export function getParentEventPointer(event) {
  const refs = getNip10References(event);
  // Prefer direct parent (reply), fall back to root
  const parent = refs?.reply?.e ?? refs?.root?.e ?? null;
  if (!parent?.id) return null;
  return { id: parent.id, relayHint: parent.relays?.[0] || undefined };
}

/**
 * @typedef {Object} ThreadContext
 * @property {import('nostr-tools').NostrEvent} event - The resolved root/target event
 * @property {import('nostr-tools').NostrEvent} [parentEvent] - Parent event for kind 1 replies
 * @property {string} [focusCommentId] - Comment ID to auto-focus (when navigating from a comment)
 * @property {string} [scrollTo] - Section to scroll to (e.g. 'reactions')
 */

/**
 * Resolves thread context for an event:
 * - Kind 1111 (comment): follows A/E root tags to find the root thread event
 * - Kind 1 (text note): resolves parent event via NIP-10 references
 * - Kind 7 (reaction): resolves target event via address/event pointer
 * - Kind 31925 (RSVP): resolves target calendar event via address pointer
 * - Other kinds: returns the event as-is
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @param {(neventOrNaddr: string) => Promise<import('nostr-tools').NostrEvent|null>} fetchFn
 * @returns {Promise<ThreadContext>}
 */
export async function resolveThreadContext(event, fetchFn) {
  // Kind 1111 comment: resolve root thread via A/E tags
  if (event.kind === 1111) {
    /** @type {import('nostr-tools').NostrEvent | null} */
    let rootEvent = null;

    // Try A tag first (addressable root events like kind 30xxx)
    const aTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'A');
    if (aTag?.[1]) {
      const [kind, pubkey, ...rest] = aTag[1].split(':');
      const identifier = rest.join(':');
      const relays = aTag[2] ? [aTag[2]] : [];
      const naddr = nip19.naddrEncode({ kind: parseInt(kind), pubkey, identifier, relays });
      rootEvent = await fetchFn(naddr);
    }

    // Fallback: try E tag (regular root events like kind 11)
    if (!rootEvent) {
      const eTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'E');
      if (eTag?.[1]) {
        const relayHint = eTag[2] || '';
        const nevent = nip19.neventEncode({ id: eTag[1], relays: relayHint ? [relayHint] : [] });
        rootEvent = await fetchFn(nevent);
      }
    }

    if (rootEvent) {
      return { event: rootEvent, focusCommentId: event.id };
    }
    // Could not resolve — return original comment
    return { event };
  }

  // Kind 7 reaction: resolve target event
  if (event.kind === 7) {
    const addrPointer = getReactionAddressPointer(event);
    if (addrPointer) {
      const encoded = encodePointer(addrPointer);
      if (encoded) {
        const target = await fetchFn(encoded);
        if (target) return { event: target, scrollTo: 'reactions' };
      }
    }

    const eventPointer = getReactionEventPointer(event);
    if (eventPointer) {
      const encoded = encodePointer(eventPointer);
      if (encoded) {
        const target = await fetchFn(encoded);
        if (target) return { event: target, scrollTo: 'reactions' };
      }
    }

    return { event };
  }

  // Kind 31925 RSVP: resolve target calendar event
  if (event.kind === 31925) {
    const addrPointer = getRSVPAddressPointer(event);
    if (addrPointer) {
      const encoded = encodePointer(addrPointer);
      if (encoded) {
        const target = await fetchFn(encoded);
        if (target) return { event: target };
      }
    }
    return { event };
  }

  // Kind 1 text note: resolve parent event
  if (event.kind === 1) {
    const parentPointer = getParentEventPointer(event);
    if (parentPointer) {
      const parentNevent = nip19.neventEncode({
        id: parentPointer.id,
        relays: parentPointer.relayHint ? [parentPointer.relayHint] : []
      });
      const parentEvent = await fetchFn(parentNevent);
      return { event, parentEvent: parentEvent ?? undefined };
    }
  }

  return { event };
}
