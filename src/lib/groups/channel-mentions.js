// Which NIP-29 channels hold an unread mention of the viewer, and which
// community they belong to. Pure.
//
// The source is the inbox's own notification list — the kind-9 `#p` leg on
// the groups relay (inbox-service.svelte.js) — not a second subscription per
// community: the rail would otherwise open one REQ per joined community just
// to draw a pill. And because the pill reads the inbox's read state, reading
// the row in the Posteingang clears it, and opening the channel (which marks
// those rows read) clears both.
//
// Channels are matched by group id alone, not id@relay: the inbox reads the
// deployment's groups relay only, and group ids are relay-scoped in practice
// (the same assumption GroupChat's `#h` model filter makes).
import { getNotificationType, getMentionSurface } from '$lib/helpers/inbox.js';
import { parseGroupPointers } from './community-pointer.js';
import { parseMembershipPointer } from './community-membership.js';
import { dTagOf, parentOf } from './subtree-channels.js';

const PILL_TYPES = new Set(['mention', 'channelReply']);

/**
 * @param {import('nostr-tools').NostrEvent[]} notifications
 * @param {(event: import('nostr-tools').NostrEvent) => boolean} isUnread
 * @param {string | null} viewer
 * @returns {Map<string, string[]>} channel id → unread mention/reply event ids
 */
export function unreadMentionsByGroup(notifications, isUnread, viewer) {
  /** @type {Map<string, string[]>} */
  const byGroup = new Map();
  for (const event of notifications ?? []) {
    if (event?.kind !== 9 || getMentionSurface(event) !== 'channel') continue;
    if (!PILL_TYPES.has(/** @type {string} */ (getNotificationType(event, viewer)))) continue;
    if (!isUnread(event)) continue;
    const groupId = event.tags?.find((t) => t[0] === 'h')?.[1];
    if (!groupId) continue;
    const ids = byGroup.get(groupId);
    if (ids) ids.push(event.id);
    else byGroup.set(groupId, [event.id]);
  }
  return byGroup;
}

/**
 * The community's root group and every channel it lists, each once.
 * @param {{tags?: string[][]} | null | undefined} communityEvent kind 10222
 * @returns {string[]}
 */
export function communityGroupIds(communityEvent) {
  if (!communityEvent) return [];
  const ids = [
    parseMembershipPointer(communityEvent)?.id,
    ...parseGroupPointers(communityEvent).map((p) => p.id)
  ].filter((id) => typeof id === 'string');
  return [...new Set(ids)];
}

/**
 * Whether a community holds one of the mentioned channels. A channel belongs
 * to it when it is the root group, a legacy `group` pointer on the 10222, or
 * — how channels are made today — a group whose kind 39000 names the root as
 * its `parent` (see subtree-channels.js). The 39000s are the ones the inbox
 * prefetches for every mentioned channel.
 * @param {{tags?: string[][]} | null | undefined} communityEvent kind 10222
 * @param {Map<string, string[]>} byGroup
 * @param {any[]} [groupMetadata] kind 39000 events of the mentioned channels
 */
export function communityHasMention(communityEvent, byGroup, groupMetadata = []) {
  if (!byGroup?.size || !communityEvent) return false;
  const own = new Set(communityGroupIds(communityEvent));
  if ([...byGroup.keys()].some((id) => own.has(id))) return true;
  const rootId = parseMembershipPointer(communityEvent)?.id;
  if (!rootId) return false;
  return (groupMetadata ?? []).some((meta) => {
    const id = dTagOf(meta);
    return Boolean(id) && byGroup.has(/** @type {string} */ (id)) && parentOf(meta) === rootId;
  });
}
