// Attach/detach a NIP-29 channel to a kind-10222 community by rewriting the
// community's `group` pointer list. The group itself is never touched — a
// pointer is pure 10222 metadata, so detaching is fully reversible and the
// group keeps living on its relay, reachable from the personal 10009 list.
//
// Mirrors src/lib/concord/attach.js, with one difference that matters: the
// concord pointer is SINGULAR (attaching replaces), a channel pointer is one
// of MANY (attaching adds, detaching removes exactly one).
//
// Only pointer helpers at the top level — SSR-safe, no package imports. The
// publish path is a dynamic import inside the shared helper, so components can
// import this without adding a static edge into the publish dep tree.
import { withGroupPointer, withoutGroupPointer, channelKey } from './community-pointer.js';
import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';

/**
 * @param {any} communikeyEvent
 * @param {string[][]} tags
 */
function templateWith(communikeyEvent, tags) {
  return {
    kind: 10222,
    content: communikeyEvent?.content ?? '',
    tags,
    // A replaceable event only wins if it is newer than the one it replaces.
    created_at: Math.max(Math.floor(Date.now() / 1000), (communikeyEvent?.created_at ?? 0) + 1)
  };
}

/**
 * Unsigned kind-10222 with this channel listed. Every other tag — including a
 * concord pointer — is preserved.
 * @param {any} communikeyEvent
 * @param {{id: string, relay: string, name?: string, access?: 'members'|'invited'}} pointer
 */
export function buildGroupAttachTemplate(communikeyEvent, pointer) {
  if (!channelKey(pointer)) throw new Error('Invalid group channel pointer');
  return templateWith(communikeyEvent, withGroupPointer(communikeyEvent?.tags ?? [], pointer));
}

/**
 * Unsigned kind-10222 with this channel removed. Sibling channels stay.
 * @param {any} communikeyEvent
 * @param {{id: string, relay: string}} pointer
 */
export function buildGroupDetachTemplate(communikeyEvent, pointer) {
  return templateWith(communikeyEvent, withoutGroupPointer(communikeyEvent?.tags ?? [], pointer));
}

/**
 * Link an existing NIP-29 group to a community as one of its channels.
 * @param {{communikeyEvent: any, pointer: any, communitySigner: any}} args
 */
export async function attachGroupChannel({ communikeyEvent, pointer, communitySigner }) {
  if (!communitySigner) throw new Error('No signer available for this community');
  return publishCommunityUpdate(
    buildGroupAttachTemplate(communikeyEvent, pointer),
    communitySigner
  );
}

/**
 * Unlist a channel. The group survives on its relay.
 * @param {{communikeyEvent: any, pointer: any, communitySigner: any}} args
 */
export async function detachGroupChannel({ communikeyEvent, pointer, communitySigner }) {
  if (!communitySigner) throw new Error('No signer available for this community');
  return publishCommunityUpdate(
    buildGroupDetachTemplate(communikeyEvent, pointer),
    communitySigner
  );
}
