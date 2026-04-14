import { getNip10References } from 'applesauce-common/helpers';
import { getReactionAddressPointer, getReactionEventPointer } from 'applesauce-common/helpers';
import { getRSVPAddressPointer } from 'applesauce-common/helpers';
import {
  getCommentRootPointer,
  isCommentAddressPointer,
  isCommentEventPointer
} from 'applesauce-common/helpers';
import { encodePointer } from 'applesauce-core/helpers';
import { nip19 } from 'nostr-tools';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * Convert a CommentPointer (from getCommentRootPointer) to a NIP-19 encoded string.
 * @param {import('applesauce-common/helpers').CommentPointer} pointer
 * @returns {string}
 */
function encodeCommentPointerToNip19(pointer) {
  if (isCommentAddressPointer(pointer)) {
    return nip19.naddrEncode({
      kind: pointer.kind,
      pubkey: pointer.pubkey,
      identifier: pointer.identifier,
      relays: pointer.relay ? [pointer.relay] : []
    });
  }
  if (isCommentEventPointer(pointer)) {
    return nip19.neventEncode({
      id: pointer.id,
      relays: pointer.relay ? [pointer.relay] : []
    });
  }
  return '';
}

/**
 * @typedef {Object} ThreadContext
 * @property {import('nostr-tools').NostrEvent} event - The resolved root/target event
 * @property {string} [focusCommentId] - Comment ID to auto-focus (when navigating from a comment)
 * @property {string} [scrollTo] - Section to scroll to (e.g. 'reactions')
 * @property {string} [parentPointer] - NIP-19 encoded pointer to parent when it couldn't be fetched
 */

/**
 * Resolves thread context for an event:
 * - Kind 1111 (comment): follows A/E root tags to find the root thread event
 * - Kind 1 (text note): resolves root event via NIP-10 references
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
        // Check EventStore first
        const cached = eventStore.getEvent(eTag[1]);
        if (cached) {
          rootEvent = cached;
        } else {
          const relayHint = eTag[2] || '';
          const nevent = nip19.neventEncode({ id: eTag[1], relays: relayHint ? [relayHint] : [] });
          rootEvent = await fetchFn(nevent);
        }
      }
    }

    if (rootEvent) {
      return { event: rootEvent, focusCommentId: event.id };
    }
    // Could not resolve — return original comment with pointer for fallback link
    const rootPointer = getCommentRootPointer(event);
    const parentPointer = rootPointer ? encodeCommentPointerToNip19(rootPointer) : undefined;
    return { event, parentPointer: parentPointer || undefined };
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

  // Kind 1 text note: resolve root event (like kind 1111)
  if (event.kind === 1) {
    const refs = getNip10References(event);
    const root = refs?.root?.e;
    if (root?.id) {
      // Check EventStore first — avoid network round-trip for cached events
      const cached = eventStore.getEvent(root.id);
      if (cached) {
        return { event: cached, focusCommentId: event.id };
      }
      const rootNevent = nip19.neventEncode({
        id: root.id,
        relays: root.relays?.[0] ? [root.relays[0]] : []
      });
      const rootEvent = await fetchFn(rootNevent);
      if (rootEvent) {
        return { event: rootEvent, focusCommentId: event.id };
      }
      return { event, parentPointer: rootNevent };
    }
  }

  return { event };
}
