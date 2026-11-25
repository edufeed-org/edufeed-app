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
import { normalizeURL } from 'applesauce-core/helpers/url';

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
 *   metadataEvent?: any,
 *   joinedPubkeys?: string[]
 * }} args `joinedPubkeys`: the communities the user joined
 * @returns {{
 *   communityPubkey: string | null,
 *   href: string | null,
 *   groupName: string | null,
 *   channel: boolean
 * }} `channel`: the group is a channel (its 39000 has a parent) rather than a
 *   community root — the row then names the channel, not just the community.
 */
export function resolveGroupAdded({
  groupId,
  relay,
  communikeyEvents = [],
  metadataEvent = null,
  joinedPubkeys = []
}) {
  if (!groupId) return { communityPubkey: null, href: null, groupName: null, channel: false };
  const groupName = groupNameOf(metadataEvent);
  const channel = !!parentOf(metadataEvent);
  const home = communityHome({ groupId, relay, communikeyEvents, metadataEvent, joinedPubkeys });
  if (home) {
    return {
      communityPubkey: home.communityPubkey,
      href: home.isRoot ? home.communityHref : channelHref(home, groupId),
      groupName,
      channel: !home.isRoot
    };
  }
  return {
    communityPubkey: null,
    href: relay ? groupHref({ id: groupId, relay }) : null,
    groupName,
    channel
  };
}

/**
 * The community a group belongs to: the one whose membership root IS the
 * group, or whose root the group's kind 39000 names as its `parent`.
 *
 * A kind 10222 is self-declared, so anyone can publish one naming a group
 * that is not theirs. A claim counts only when it names the group's own
 * relay; among several claims the community the user joined wins, and with
 * none joined nobody does. A single claim is followed even when not joined:
 * "you were added" usually arrives before the community is on the user's list.
 * @param {{
 *   groupId: string,
 *   relay?: string | null,
 *   communikeyEvents: any[],
 *   metadataEvent?: any,
 *   joinedPubkeys?: string[]
 * }} args
 * @returns {{ communityPubkey: string, communityHref: string, isRoot: boolean } | null}
 */
function communityHome({
  groupId,
  relay = null,
  communikeyEvents,
  metadataEvent,
  joinedPubkeys = []
}) {
  const host = relay ? normalizeURL(relay) : null;
  const claims = (/** @type {string} */ rootId) =>
    communikeyEvents.filter((ev) => {
      const root = parseMembershipPointer(ev);
      return !!ev?.pubkey && root?.id === rootId && (!host || normalizeURL(root.relay) === host);
    });
  // Root and parent claims are weighed together: a stranger naming my
  // channel as its own root must not beat the joined community it belongs to.
  const parent = parentOf(metadataEvent);
  const found = [
    ...claims(groupId).map((ev) => ({ ev, isRoot: true })),
    ...(parent ? claims(parent).map((ev) => ({ ev, isRoot: false })) : [])
  ];
  const pick =
    found.find((c) => joinedPubkeys.includes(c.ev.pubkey)) ??
    (found.length === 1 ? found[0] : null);
  if (!pick) return null;
  const { ev: community, isRoot } = pick;
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
 * Where a channel opens: inside its community when the channel (or root)
 * belongs to a known one — a root group is that community's first channel —
 * else on the group host.
 * @param {{
 *   pointer: { id: string, relay: string },
 *   communikeyEvents?: any[],
 *   metadataEvent?: any
 * }} args `communikeyEvents`: the communities the user joined
 */
export function resolveChannelHref({ pointer, communikeyEvents = [], metadataEvent = null }) {
  // Callers pass the user's JOINED communities, never the whole store.
  const home = communityHome({
    groupId: pointer.id,
    relay: pointer.relay,
    communikeyEvents,
    metadataEvent,
    joinedPubkeys: communikeyEvents.map((ev) => ev?.pubkey)
  });
  return home ? channelHref(home, pointer.id) : groupHref(pointer);
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
 *   metadataEvent?: any,
 *   joinedPubkeys?: string[]
 * }} args
 * @returns {{ href: string | null, groupName: string | null }}
 */
export function resolveChannelMention({
  groupId,
  relay,
  messageId,
  communikeyEvents = [],
  metadataEvent = null,
  joinedPubkeys = []
}) {
  const groupName = groupNameOf(metadataEvent);
  if (!groupId || !relay) return { href: null, groupName };
  const message = `message=${encodeURIComponent(messageId)}`;
  const home = communityHome({ groupId, relay, communikeyEvents, metadataEvent, joinedPubkeys });
  if (home) return { href: `${channelHref(home, groupId)}&${message}`, groupName };
  return { href: `${groupHref({ relay, id: groupId })}?${message}`, groupName };
}
