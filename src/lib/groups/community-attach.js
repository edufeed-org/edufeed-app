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
import {
  withGroupPointer,
  withoutGroupPointer,
  channelKey,
  parseGroupPointers
} from './community-pointer.js';
import { parseConcordPointer } from '$lib/concord/pointer.js';
import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';

/**
 * Which kind of protected area this community may still be extended by.
 *
 * A community is extended by EXACTLY ONE protected area — a Concord area or a
 * set of NIP-29 channels, never both (laoc 2026-08-05; see
 * docs/superpowers/specs/2026-08-12-groups-architecture-design.md §1). Both glyphs mean the same thing in
 * either world only because the line above the channel list says who
 * "everyone" is — and a community carrying both would have no such line.
 *
 * Read off the pointers themselves rather than a stored flag, so a tag that
 * carries no usable pointer never locks a community out of attaching anything.
 * @param {{ tags?: string[][] } | null | undefined} communikeyEvent
 * @returns {{ concord: boolean, group: boolean }}
 */
export function attachableAreaModes(communikeyEvent) {
  const hasConcord = !!parseConcordPointer(communikeyEvent);
  const hasGroups = parseGroupPointers(communikeyEvent).length > 0;
  return { concord: !hasGroups, group: !hasConcord };
}

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
