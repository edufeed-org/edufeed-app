// "You were added to a group": a NIP-29 kind-9000 put-user that p-tags the
// user. Resolve where it points (a community root → its /c page; a channel or
// foreign group → the group route) and what to call it.
import { parseMembershipPointer } from './community-membership.js';
import { groupHref } from './groups.js';
import { nip19 } from 'nostr-tools';

/** @param {{tags?: string[][]} | null | undefined} event */
export function groupIdOf(event) {
  return event?.tags?.find((t) => t[0] === 'h')?.[1] ?? null;
}

/** @param {{tags?: string[][]} | null | undefined} event */
export function groupNameOf(event) {
  const name = event?.tags?.find((t) => t[0] === 'name')?.[1];
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * @param {{
 *   groupId: string | null,
 *   relay: string | null,
 *   communikeyEvents?: any[],
 *   metadataEvent?: any
 * }} args
 * @returns {{ communityPubkey: string | null, href: string | null, groupName: string | null }}
 */
export function resolveGroupAdded({ groupId, relay, communikeyEvents = [], metadataEvent = null }) {
  if (!groupId) return { communityPubkey: null, href: null, groupName: null };
  const community = communikeyEvents.find((ev) => parseMembershipPointer(ev)?.id === groupId);
  const groupName = groupNameOf(metadataEvent);
  if (community?.pubkey) {
    return {
      communityPubkey: community.pubkey,
      href: `/c/${nip19.npubEncode(community.pubkey)}`,
      groupName
    };
  }
  return {
    communityPubkey: null,
    href: relay ? groupHref({ id: groupId, relay }) : null,
    groupName
  };
}

/**
 * A kind-9 channel message that p-tags the user (an @mention or a reply to
 * them): open the message inside its channel on the group host — the group
 * route scrolls to `?message=` — and call the channel by its kind-39000 name.
 * @param {{
 *   groupId: string | null,
 *   relay: string | null,
 *   messageId: string,
 *   metadataEvent?: any
 * }} args
 * @returns {{ href: string | null, groupName: string | null }}
 */
export function resolveChannelMention({ groupId, relay, messageId, metadataEvent = null }) {
  const groupName = groupNameOf(metadataEvent);
  if (!groupId || !relay) return { href: null, groupName };
  return {
    href: `${groupHref({ relay, id: groupId })}?message=${encodeURIComponent(messageId)}`,
    groupName
  };
}
