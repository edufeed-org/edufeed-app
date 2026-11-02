/**
 * Quote pointers: the relay hint and author a quoting event's q tags carry
 * (`["q", id, relay, pubkey]`, NIP-18) for the notes it references inline.
 *
 * An inline `nostr:note1…` has neither, and an `nevent` may lack them; the
 * q tag is then the only place the quoted author is named, and without the
 * author `loadReferencedEvent` cannot fall back to the author's outboxes.
 * `NostrContentRenderer` shares the map with the previews it renders through
 * context (`QUOTE_POINTERS`); `NotePreview` merges the matching entry into
 * its reference with `withQuoteHint`. Pure functions — safe in `$derived`.
 */
import { getEventPointerFromQTag } from 'applesauce-core/helpers';
import { unique } from '$lib/helpers/unique.js';

/** Context key: a getter `() => Map<string, EventPointer>` for the rendered event. */
export const QUOTE_POINTERS = Symbol('quote-pointers');

/**
 * @param {{ tags?: string[][] } | null | undefined} event
 * @returns {Map<string, { id: string, relays?: string[], author?: string }>}
 */
export function quotePointersOf(event) {
  /** @type {Map<string, { id: string, relays?: string[], author?: string }>} */
  const map = new Map();
  for (const tag of event?.tags ?? []) {
    if (tag[0] !== 'q') continue;
    const pointer = getEventPointerFromQTag(tag);
    if (pointer && !map.has(pointer.id)) map.set(pointer.id, pointer);
  }
  return map;
}

/**
 * The decoded reference with the q-tag relay hint and author added; the
 * reference's own hints come first and its own author wins. A `note` becomes
 * an `nevent` so the hint and author travel with it.
 *
 * @template {{ success: boolean, type?: string, data?: any, identifier?: string }} D
 * @param {D} decoded
 * @param {{ relays?: string[], author?: string } | undefined} hint
 * @returns {D}
 */
export function withQuoteHint(decoded, hint) {
  if (!hint || !decoded?.success) return decoded;
  if (decoded.type === 'note') {
    return {
      ...decoded,
      type: 'nevent',
      data: { id: decoded.data, relays: hint.relays ?? [], author: hint.author }
    };
  }
  if (decoded.type === 'nevent') {
    return {
      ...decoded,
      data: {
        ...decoded.data,
        relays: unique([...(decoded.data.relays ?? []), ...(hint.relays ?? [])]),
        author: decoded.data.author || hint.author
      }
    };
  }
  return decoded;
}
