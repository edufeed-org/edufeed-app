// Private in-group sharing — pure half. A member (publisher or not) shares
// content WITH the community by posting it into the E2E private area, where
// only members can decrypt it and authorship is member-verified by
// construction — the honest counterpart to the publisher window's public
// sharing (design discussion, laoc 2026-08-17).
//
// No applesauce-concord imports (src/lib/concord convention: pure modules
// stay dependency-free so any call site can import them SSR-safely).
import { nip19 } from 'nostr-tools';
import { parseConcordPointer } from './pointer.js';

/**
 * The nostr: URI that carries this event into a chat message — naddr for
 * addressable kinds (the d-tag identity survives edits), nevent otherwise.
 * @param {any} event
 * @returns {string | null}
 */
export function nostrShareUri(event) {
  try {
    if (event?.kind >= 30000 && event.kind < 40000 && event.pubkey) {
      const identifier = event.tags?.find((/** @type {any} */ t) => t[0] === 'd')?.[1] ?? '';
      return `nostr:${nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier })}`;
    }
    if (event?.id) return `nostr:${nip19.neventEncode({ id: event.id })}`;
  } catch {
    // fall through
  }
  return null;
}

/**
 * The Concord area id behind a community IF the viewer is a member of it:
 * the community's 10222 names the area, and the viewer's own (decrypted)
 * community list contains it. No roster lookup — membership here is the
 * viewer's own state, which is exactly what E2E permits knowing.
 * @param {any} communikeyEvent kind 10222 (or null)
 * @param {Array<{material?: {community_id?: string}, dissolved?: boolean}>} myAreas
 *   the Concord client's community states (getConcordState().communities)
 * @returns {string | null}
 */
export function memberAreaIdFor(communikeyEvent, myAreas) {
  const pointer = parseConcordPointer(communikeyEvent);
  if (!pointer) return null;
  const mine = (myAreas ?? []).find(
    (area) => area?.material?.community_id === pointer.communityId && !area.dissolved
  );
  return mine ? pointer.communityId : null;
}

/**
 * The channels a private share can go into: readable ones, no tombstones.
 * @param {Array<{channel_id: string, name?: string, accessible?: boolean, deleted?: boolean}>} channels
 */
export function shareableChannels(channels) {
  return (channels ?? []).filter((c) => c && !c.deleted && c.accessible !== false);
}
