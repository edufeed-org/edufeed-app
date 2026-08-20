// Destructive NIP-29 cleanup for a community owner / admin.
//
// Two levels, both reusing the same primitives:
//   deleteChannelCascade    — remove ONE channel everywhere (the extracted body
//                             of GroupChat.handleGroupDeleted).
//   teardownCommunityGroups — remove ALL channels + the root membership group,
//                             then revert the 10222 to a plain (open) community.
//
// Channels are DISCOVERED from the relay subtree now, not from kind-10222
// `group` pointers, so a channel is gone from every client the moment its 9008
// lands on the relay (the subgroup drops out of the /c/<rootId> subtree) — there
// is no pointer to unlink. The only local tail is the user's own kind-10009.
//
// Relay-side deletes (kind 9008) are best-effort in teardown: a group whose
// relay is down, or that is already gone, must not block the load-bearing 10222
// revert. The 9008 for a single-channel delete IS load-bearing (the caller wants
// that group gone) — its rejection surfaces.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { buildDeleteGroupTemplate, publishToGroupRelay } from './group-management.js';
import { updatePersonalGroupsList } from './personal-groups-list.js';
import { parseGroupPointers } from './community-pointer.js';
import { parseMembershipPointer } from './community-membership.js';
import { buildFlipToOpenTags, communityUpdateTemplate } from './community-flips.js';
import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';
import { clearRootGroupMarker } from './provision-root-group.js';

/**
 * The post-delete tail for a group that is ALREADY gone from its relay:
 * best-effort prune it from the user's own kind-10009. Used both by
 * deleteChannelCascade (right after it fires the 9008) and by GroupChat's own
 * post-delete handler (the group is deleted by GroupSettingsSheet before this
 * runs).
 * @param {{ pointer: {id: string, relay: string}, user: {pubkey: string, signer: any} }} args
 */
export async function unlinkDeletedChannel({ pointer, user }) {
  try {
    await updatePersonalGroupsList(user, { remove: pointer });
  } catch (err) {
    console.error('teardown: 10009 removal failed', err);
  }
}

/**
 * Delete one NIP-29 channel group on its relay (9008 — load-bearing), then run
 * the best-effort 10009 tail. For the channel-rail delete affordance, where the
 * delete is initiated (unlike GroupChat, where the group is already gone). Any
 * admin of the group (or of its parent) may do this — no community key needed.
 * @param {{ pointer: {id: string, relay: string}, user: {pubkey: string, signer: any} }} args
 */
export async function deleteChannelCascade({ pointer, user }) {
  await publishToGroupRelay(pool.relay(pointer.relay), buildDeleteGroupTemplate(pointer.id), user);
  await unlinkDeletedChannel({ pointer, user });
}

/**
 * Remove ALL NIP-29 machinery from a moderated community: delete every channel
 * group + the root membership group on the relay (9008, best-effort), strip all
 * pointers off the 10222 (revert to open — load-bearing), prune the owner's own
 * 10009 of every deleted group, and clear the founding marker.
 * @param {{
 *   communikeyEvent: any,
 *   communitySigner: any,
 *   user: {pubkey: string, signer: any},
 *   channels?: Array<{id: string, relay: string}>
 * }} args `channels`: the community's discovered subtree channels — the caller
 *   passes them (useCommunityChannels), since they no longer live on the 10222.
 *   Falls back to any legacy kind-10222 `group` pointers.
 */
export async function teardownCommunityGroups({
  communikeyEvent,
  communitySigner,
  user,
  channels
}) {
  const chans = channels ?? parseGroupPointers(communikeyEvent);
  const root = parseMembershipPointer(communikeyEvent);
  const targets = [...chans, ...(root ? [root] : [])];

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
