// Actions on an existing channel meeting (MeetingCard). Plain module, tested
// in node.
import { publishToGroupRelay, buildDeleteEventTemplate } from './group-management.js';
import { listCallPasses, revokeCallPass } from './call-passes.js';
import { MEETING_KIND, meetingCoordinate } from './meetings.js';

/**
 * Delete a meeting from its channel. Its guest passes (call passes whose `a`
 * tag names the meeting) are revoked FIRST, so a deleted meeting never
 * leaves a working guest link behind; if a revocation fails the meeting
 * stays and the error propagates (retrying is safe). Then the author signs a
 * NIP-09 kind 5 (e + a + h + k), a moderator deleting someone else's
 * meeting a NIP-29 kind 9005 — both to the group relay only.
 *
 * @param {{relayConn: any, event: any, user: {pubkey: string, signer: any},
 *   asAdmin?: boolean}} p
 * @returns {Promise<any>} the signed deletion event (add it to the eventStore)
 */
export async function deleteMeeting({ relayConn, event, user, asAdmin = false }) {
  const groupId = event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
  if (!groupId) throw new Error('meeting without h tag');
  const isAuthor = event.pubkey === user.pubkey;
  if (!isAuthor && !asAdmin) throw new Error('only the author or a moderator can delete this');

  const coordinate = meetingCoordinate(event);
  const passes = await listCallPasses(relayConn, groupId, user);
  for (const pass of passes) {
    const aTag = pass.tags?.find((/** @type {string[]} */ t) => t[0] === 'a');
    if (aTag?.[1] === coordinate) await revokeCallPass(relayConn, pass, user, { asAdmin });
  }

  const template = isAuthor
    ? {
        kind: 5,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', event.id],
          ['a', coordinate],
          ['h', groupId],
          ['k', String(MEETING_KIND)]
        ]
      }
    : buildDeleteEventTemplate(groupId, event.id);
  return publishToGroupRelay(relayConn, template, user);
}
