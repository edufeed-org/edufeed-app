// Breakout rooms — the relay round-trips (no Svelte). Every call goes to the
// channel's group relay only, through publishToGroupRelay (NIP-42 answered
// in flight, "too old" re-stamped once). The orchestration — who gets which
// room, following rosters, the deadline — lives in breakout.svelte.js.
import {
  buildCreateGroupTemplate,
  buildEditGroupMetadataTemplate,
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  buildDeleteGroupTemplate,
  publishToGroupRelay,
  confirmGroupMetadata
} from './group-management.js';
import { breakoutRoomMetadata, isParentRoleRejection } from './breakout.js';

/**
 * Create one breakout room: 9007 create → 9002 metadata → confirm the
 * relay's 39000 (createGroupOnRelay's handshake, with one twist). The 9002
 * first declares the channel as the room's `parent`; pyramid accepts that
 * only from an account with a role in the channel ("restricted: must be an
 * admin of the parent group"), so a host who is a plain member gets the
 * same room without the parent tag — the `about` marker names the channel
 * either way, which is all the client needs.
 * @param {any} relayConn a pool.relay(url) connection
 * @param {{id: string, parentId: string, channelName: string, index: number, until?: number | null}} room
 * @param {{pubkey: string, signer: any}} user
 * @param {{confirmDelayMs?: number}} [opts]
 * @returns {Promise<any>} the relay's kind 39000 for the room
 */
export async function createBreakoutRoom(relayConn, room, user, opts = {}) {
  const { id, parentId, channelName, index, until } = room;
  const withParent = breakoutRoomMetadata({
    parentId,
    channelName,
    index,
    until,
    withParent: true
  });
  await publishToGroupRelay(relayConn, buildCreateGroupTemplate(id, withParent), user);
  try {
    await publishToGroupRelay(relayConn, buildEditGroupMetadataTemplate(id, withParent), user);
  } catch (err) {
    if (!isParentRoleRejection(err)) throw err;
    const withoutParent = breakoutRoomMetadata({
      parentId,
      channelName,
      index,
      until,
      withParent: false
    });
    await publishToGroupRelay(relayConn, buildEditGroupMetadataTemplate(id, withoutParent), user);
  }
  // Give the relay a beat to materialise its addressables before we ask.
  const delay = opts.confirmDelayMs ?? 500;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  const confirmed = await confirmGroupMetadata(relayConn, id);
  if (!confirmed) throw new Error('breakout room not confirmed by relay');
  return confirmed;
}

/**
 * Publish, treating the relay's "nothing to do" answers as success so a
 * repeated move is idempotent.
 * @param {any} relayConn @param {any} template @param {{pubkey: string, signer: any}} user
 * @param {RegExp} noop
 */
async function publishIdempotent(relayConn, template, user, noop) {
  try {
    await publishToGroupRelay(relayConn, template, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noop.test(message)) throw err;
  }
}

/** Seat `pubkey` in a room (kind 9000, no roles). @param {any} relayConn @param {string} roomId @param {string} pubkey @param {{pubkey: string, signer: any}} user */
export function seatInRoom(relayConn, roomId, pubkey, user) {
  return publishIdempotent(
    relayConn,
    buildPutUserTemplate(roomId, pubkey),
    user,
    /members already/i
  );
}

/** Take `pubkey` out of a room (kind 9001). @param {any} relayConn @param {string} roomId @param {string} pubkey @param {{pubkey: string, signer: any}} user */
export function unseatFromRoom(relayConn, roomId, pubkey, user) {
  return publishIdempotent(
    relayConn,
    buildRemoveUserTemplate(roomId, pubkey),
    user,
    /left already/i
  );
}

/** Delete a room (kind 9008); a room that is already gone counts as deleted. @param {any} relayConn @param {string} roomId @param {{pubkey: string, signer: any}} user */
export function deleteBreakoutRoom(relayConn, roomId, user) {
  return publishIdempotent(relayConn, buildDeleteGroupTemplate(roomId), user, /doesn't exist/i);
}
