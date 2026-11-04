// "You were added to a group": a NIP-29 kind-9000 put-user that p-tags the
// user. Resolve where it points (a community root → its /c page; one of its
// channels → the community's channels view with that channel open; a foreign
// group → the group route on the host) and what to call it.
//
// A community is a root group plus the channels carrying ["parent", rootId]
// (subtree-channels.js), so a channel is matched through its kind 39000's
// parent — the put-user itself names only the channel.
import { parseMembershipPointer } from './community-membership.js';
import { groupHref } from './groups.js';
import { parentOf } from './subtree-channels.js';
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
  const groupName = groupNameOf(metadataEvent);
  const home = communityHome({ groupId, communikeyEvents, metadataEvent });
  if (home) {
    return {
      communityPubkey: home.communityPubkey,
      href: home.isRoot ? home.communityHref : channelHref(home, groupId),
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
 * The community a group belongs to: the one whose membership root IS the
 * group, or whose root the group's kind 39000 names as its `parent`.
 * @param {{ groupId: string, communikeyEvents: any[], metadataEvent?: any }} args
 * @returns {{ communityPubkey: string, communityHref: string, isRoot: boolean } | null}
 */
function communityHome({ groupId, communikeyEvents, metadataEvent }) {
  const rootOf = (/** @type {any} */ ev) => parseMembershipPointer(ev)?.id;
  let community = communikeyEvents.find((ev) => rootOf(ev) === groupId);
  let isRoot = true;
  if (!community) {
    const parent = parentOf(metadataEvent);
    if (!parent) return null;
    community = communikeyEvents.find((ev) => rootOf(ev) === parent);
    isRoot = false;
  }
  if (!community?.pubkey) return null;
  return {
    communityPubkey: community.pubkey,
    communityHref: `/c/${nip19.npubEncode(community.pubkey)}`,
    isRoot
  };
}

/**
 * The community's channels view with one channel open — the same URL shape
 * PrivateChannelsView reads (`?channel=` picks a NIP-29 channel by group id).
 * @param {{ communityHref: string }} home
 * @param {string} groupId
 */
function channelHref(home, groupId) {
  return `${home.communityHref}?view=channels&channel=${encodeURIComponent(groupId)}`;
}

/**
 * A kind-9 channel message that p-tags the user (an @mention or a reply to
 * them): open the message inside its channel — on the community page when
 * the channel (or root) belongs to a known community, else on the group host
 * — both scroll to `?message=` — and call the channel by its kind-39000 name.
 * @param {{
 *   groupId: string | null,
 *   relay: string | null,
 *   messageId: string,
 *   communikeyEvents?: any[],
 *   metadataEvent?: any
 * }} args
 * @returns {{ href: string | null, groupName: string | null }}
 */
export function resolveChannelMention({
  groupId,
  relay,
  messageId,
  communikeyEvents = [],
  metadataEvent = null
}) {
  const groupName = groupNameOf(metadataEvent);
  if (!groupId || !relay) return { href: null, groupName };
  const message = `message=${encodeURIComponent(messageId)}`;
  const home = communityHome({ groupId, communikeyEvents, metadataEvent });
  if (home) return { href: `${channelHref(home, groupId)}&${message}`, groupName };
  return { href: `${groupHref({ relay, id: groupId })}?${message}`, groupName };
}
