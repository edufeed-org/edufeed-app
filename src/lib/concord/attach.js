// Attach/detach: link an EXISTING Concord area to a kind-10222 community (or
// remove the link) by rewriting the community's `concord` pointer tag. The
// area itself is never touched — a pointer is pure 10222 metadata, so detach
// is fully reversible and the area keeps living in the owner's sidebar.
//
// Mirrors founding.js's structure: only pointer.js at the top level (SSR-safe,
// no package imports); publish-service/eventStore/communityRelays are
// dynamically imported so components can import this module without adding a
// new static edge into the concord dep tree.
import { withoutConcordPointer } from './pointer.js';
import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';

/**
 * Unsigned kind-10222 template with the concord pointer removed. Preserves
 * all other tags + content; bumps created_at past the source event.
 * @param {any} communikeyEvent
 */
export function buildPointerRemoval(communikeyEvent) {
  return {
    kind: 10222,
    content: communikeyEvent.content ?? '',
    tags: withoutConcordPointer(communikeyEvent.tags ?? []),
    created_at: Math.max(Math.floor(Date.now() / 1000), (communikeyEvent.created_at ?? 0) + 1)
  };
}

// The sign-and-publish path moved to helpers/publishCommunityUpdate.js so the
// NIP-29 channel pointers use exactly this path rather than a second copy.
// Behaviour is unchanged; only the home of the function moved.
const signAndPublish = publishCommunityUpdate;

/**
 * Remove the concord pointer from a Communikey community. The area survives —
 * members keep reaching it via the sidebar's private-areas list.
 * @param {{communikeyEvent: any, communitySigner: any}} args
 */
export async function detachConcordArea({ communikeyEvent, communitySigner }) {
  if (!communitySigner) throw new Error('No signer available for this community');
  return signAndPublish(buildPointerRemoval(communikeyEvent), communitySigner);
}
