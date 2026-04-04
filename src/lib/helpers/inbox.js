import { nip19 } from 'nostr-tools';
import { formCoordinateToNaddr } from '$lib/helpers/forms.js';
import { getReactionAddressPointer, getReactionEventPointer } from 'applesauce-common/helpers';

import { getRSVPAddressPointer } from 'applesauce-common/helpers';
import { encodePointer } from 'applesauce-core/helpers';
import { isWave } from '$lib/helpers/waves.js';

/** @type {Record<number, string>} */
const KIND_TO_TYPE = {
  1070: 'formRequest',
  1069: 'formResponse',
  7: 'reaction',
  1111: 'comment',
  9: 'mention',
  31925: 'rsvp'
};

/**
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string | null}
 */
export function getNotificationType(event) {
  if (event.kind === 7 && isWave(event)) return 'wave';
  return KIND_TO_TYPE[event.kind] ?? null;
}

/**
 * @param {import('nostr-tools').NostrEvent} event
 * @param {Record<string, number> | null} readMarkers
 * @returns {boolean}
 */
export function isUnread(event, readMarkers) {
  if (!readMarkers) return true;
  const type = getNotificationType(event);
  const marker = /** @type {number} */ ((type && readMarkers[type]) ?? readMarkers.global ?? 0);
  return event.created_at > marker;
}

/**
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {string} userPubkey
 * @returns {import('nostr-tools').NostrEvent[]}
 */
export function filterSelfNotifications(events, userPubkey) {
  return events.filter((e) => e.pubkey !== userPubkey);
}

/**
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string | null}
 */
export function getNotificationUrl(event) {
  const type = getNotificationType(event);

  if (type === 'formRequest' || type === 'formResponse') {
    const addr = event.tags.find((t) => t[0] === 'a')?.[1];
    if (!addr) return null;
    try {
      const naddr = formCoordinateToNaddr(addr, []);
      if (type === 'formRequest') return `/forms/${naddr}/respond`;
      return `/forms/${naddr}?tab=responses#response-${event.id}`;
    } catch {
      return null;
    }
  }

  if (type === 'mention') {
    const community = event.tags.find((t) => t[0] === 'h')?.[1];
    return community ? `/c/${community}` : null;
  }

  // Waves — link to waver's profile
  if (type === 'wave') {
    return `/p/${event.pubkey}`;
  }

  // Reactions — use last e/a tag per NIP-25
  if (type === 'reaction') {
    const addr = getReactionAddressPointer(event);
    if (addr) return `/${encodePointer(addr)}`;
    const evt = getReactionEventPointer(event);
    if (evt) return `/${encodePointer(evt)}`;
    return null;
  }

  // Comments — encode the comment event itself; resolveThreadContext will resolve root + set focusCommentId
  if (type === 'comment') {
    return `/${encodePointer({ id: event.id, relays: [] })}`;
  }

  // RSVPs — always address pointer (calendar events are addressable)
  if (type === 'rsvp') {
    const addr = getRSVPAddressPointer(event);
    if (addr) return `/${encodePointer(addr)}`;
    return null;
  }

  return null;
}

/**
 * Extract pubkeys from nostr:npub1... mentions in text content.
 * @param {string} content
 * @returns {string[]} hex pubkeys
 */
export function extractMentionPubkeys(content) {
  const matches = content.matchAll(/nostr:(npub1[a-z0-9]{58})/g);
  const pubkeys = [];
  for (const match of matches) {
    try {
      const decoded = nip19.decode(match[1]);
      if (decoded.type === 'npub') pubkeys.push(decoded.data);
    } catch {
      /* skip invalid */
    }
  }
  return [...new Set(pubkeys)];
}
