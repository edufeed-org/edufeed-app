// Destructive NIP-29 cleanup for a community owner.
//
// Two levels, both reusing the same primitives:
//   deleteChannelCascade    — remove ONE channel everywhere (the extracted body
//                             of GroupChat.handleGroupDeleted).
//   teardownCommunityGroups — remove ALL channels + the root membership group,
//                             then revert the 10222 to a plain (open) community.
//
// Relay-side deletes (kind 9008) are best-effort: a group whose relay is down,
// or that is already gone, must not block the load-bearing 10222 revert or the
// per-channel cascade's local cleanup. The 9008 for a single-channel delete IS
// load-bearing (the caller wants that group gone) — its rejection surfaces.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { buildDeleteGroupTemplate, publishToGroupRelay } from './group-management.js';
import { updatePersonalGroupsList } from './personal-groups-list.js';
import { detachGroupChannel } from './community-attach.js';
import { parseGroupPointers, channelKey } from './community-pointer.js';
import { parseMembershipPointer } from './community-membership.js';
import { buildFlipToOpenTags, communityUpdateTemplate } from './community-flips.js';
import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';
import { clearRootGroupMarker } from './provision-root-group.js';

/**
 * The post-delete tail — for a group that is ALREADY gone from its relay:
 * best-effort prune it from the user's own kind-10009 and unlink its pointer
 * from every joined community that lists it and the user can sign for. Every
 * step is best-effort (logged, never fatal). Used both by deleteChannelCascade
 * (right after it fires the 9008) and by GroupChat's own post-delete handler
 * (the group is deleted by GroupSettingsSheet before this runs).
 * @param {{
 *   pointer: {id: string, relay: string},
 *   user: {pubkey: string, signer: any},
 *   joinedCommunities?: any[],
 *   getCommunitySigner: (pubkey: string) => any
 * }} args
 */
export async function unlinkDeletedChannel({
  pointer,
  user,
  joinedCommunities = [],
  getCommunitySigner
}) {
  try {
    await updatePersonalGroupsList(user, { remove: pointer });
  } catch (err) {
    console.error('teardown: 10009 removal failed', err);
  }
  const target = channelKey(pointer);
  for (const ck of joinedCommunities) {
    const listed = parseGroupPointers(ck).some((p) => channelKey(p) === target);
    const communitySigner = getCommunitySigner?.(ck.pubkey);
    if (!listed || !communitySigner) continue;
    try {
      await detachGroupChannel({ communikeyEvent: ck, pointer, communitySigner });
    } catch (err) {
      console.error('teardown: detach failed', err);
    }
  }
}

/**
 * Delete one NIP-29 channel group on its relay (9008 — load-bearing), then run
 * the best-effort unlink tail. For the channel-rail delete affordance, where
 * the delete is initiated (unlike GroupChat, where the group is already gone).
 * @param {{
 *   pointer: {id: string, relay: string},
 *   user: {pubkey: string, signer: any},
 *   joinedCommunities?: any[],
 *   getCommunitySigner: (pubkey: string) => any
 * }} args
 */
export async function deleteChannelCascade({
  pointer,
  user,
  joinedCommunities = [],
  getCommunitySigner
}) {
  await publishToGroupRelay(pool.relay(pointer.relay), buildDeleteGroupTemplate(pointer.id), user);
  await unlinkDeletedChannel({ pointer, user, joinedCommunities, getCommunitySigner });
}

/**
 * Remove ALL NIP-29 machinery from a moderated community: delete every channel
 * group + the root membership group on the relay (9008, best-effort), strip all
 * pointers off the 10222 (revert to open — load-bearing), prune the owner's own
 * 10009 of every deleted group, and clear the founding marker.
 * @param {{
 *   communikeyEvent: any,
 *   communitySigner: any,
 *   user: {pubkey: string, signer: any}
 * }} args
 */
export async function teardownCommunityGroups({ communikeyEvent, communitySigner, user }) {
  const channels = parseGroupPointers(communikeyEvent);
  const root = parseMembershipPointer(communikeyEvent);
  const targets = [...channels, ...(root ? [root] : [])];

  // 1. Best-effort: delete each group on its relay.
  for (const t of targets) {
    try {
      await publishToGroupRelay(pool.relay(t.relay), buildDeleteGroupTemplate(t.id), user);
    } catch (err) {
      console.error('teardown: delete group failed', t.id, err);
    }
  }

  // 2. Load-bearing: strip membership + every group/concord/access pointer off
  //    the 10222, reverting the community to plain/open.
  await publishCommunityUpdate(
    communityUpdateTemplate(communikeyEvent, buildFlipToOpenTags(communikeyEvent.tags ?? [])),
    communitySigner
  );

  // 3. Best-effort: prune the owner's own 10009 (root + channels). Other
  //    members' lists can't be touched from here.
  if (targets.length) {
    try {
      await updatePersonalGroupsList(user, { remove: targets });
    } catch (err) {
      console.error('teardown: 10009 prune failed', err);
    }
  }

  // 4. Clear the localStorage founding marker so a later re-flip starts fresh.
  clearRootGroupMarker(communikeyEvent.pubkey);
}
