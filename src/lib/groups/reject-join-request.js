// Declining a NIP-29 join request for EVERY admin and device: the admin
// delete-event (kind 9005) removes the stored 9021 from the group's relay —
// the pyramid honours a 9005 for any h-tagged event of the group (process-
// event.go), and so does khatru. The local localStorage dismissal the panel
// keeps is the optimistic/offline layer on top; this is the durable one.
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { buildDeleteEventTemplate, publishToGroupRelay } from './group-management.js';
import { rejectionTargets } from './join-requests.js';

/**
 * Delete each of the row's requests on the relay of the group it knocked on.
 * Never throws: a refusing relay for one ask must not stop the others, and the
 * caller reports the failures (the request then stays hidden locally only).
 *
 * @param {{
 *   row: import('./join-requests.js').JoinRequestRow,
 *   rootPointer: {id: string, relay: string} | null | undefined,
 *   channelPointers: Array<{id: string, relay: string}>,
 *   user: {pubkey: string, signer: any}
 * }} args
 * @returns {Promise<{attempted: number, failed: Array<{eventId: string, groupId: string, error: unknown}>}>}
 */
export async function rejectJoinRequest({ row, rootPointer, channelPointers, user }) {
  const targets = rejectionTargets(row, { rootPointer, channelPointers });
  /** @type {Array<{eventId: string, groupId: string, error: unknown}>} */
  const failed = [];
  for (const target of targets) {
    try {
      await publishToGroupRelay(
        pool.relay(target.pointer.relay),
        buildDeleteEventTemplate(target.groupId, target.eventId),
        user
      );
    } catch (error) {
      console.warn('groups: join-request delete-event refused', target.groupId, error);
      failed.push({ eventId: target.eventId, groupId: target.groupId, error });
    }
  }
  return { attempted: targets.length, failed };
}
