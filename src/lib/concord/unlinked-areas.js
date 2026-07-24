// Pure helpers for the "Private areas" sidebar/route (Concord follow-up 1):
// which Concord memberships are NOT anchored to a followed Communikey
// community (joined via another client like Armada, or via a bare invite
// link with no 10222 pointer on this platform). No package imports — safe
// for node-env unit tests and any SSR-adjacent call site.
import { parseConcordPointer } from './pointer.js';

/**
 * @typedef {{communityId: string, name: string, dissolved: boolean}} UnlinkedArea
 */

/**
 * Concord community ids that a followed Communikey community's kind 10222
 * event already points at, via the `concord` pointer tag. Best-effort: only
 * reflects 10222 events the caller actually passed in (e.g. whatever is
 * already resident in the EventStore) — it does not fetch anything.
 * @param {any[] | null | undefined} communikeyEvents kind 10222 events
 * @returns {Set<string>}
 */
export function linkedConcordIds(communikeyEvents) {
  const ids = new Set();
  for (const event of communikeyEvents ?? []) {
    const pointer = parseConcordPointer(event);
    if (pointer) ids.add(pointer.communityId);
  }
  return ids;
}

/**
 * Display name fallback chain for one CommunityState (client.svelte.js's
 * `communities` array): metadata (CORD community-profile plane) > material
 * (the locally-known name at founding/join time) > a short id fragment.
 * Shared by {@link unlinkedConcordAreas} and the standalone `/private/<id>`
 * page header, which needs the same name for a community that may not even
 * be "unlinked" in the caller's sense (e.g. the owner opening their own
 * area's raw-id link).
 * @param {any} communityState one entry of getConcordState().communities
 * @returns {string}
 */
export function concordAreaDisplayName(communityState) {
  const communityId = communityState?.material?.community_id ?? '';
  return (
    communityState?.metadata?.name || communityState?.material?.name || communityId.slice(0, 12)
  );
}

/**
 * Concord memberships with no corresponding linked pointer — i.e. private
 * areas only reachable by their raw community id, not through a Communikey
 * community page. Dissolved areas are included (not filtered out) so the
 * standalone page can still show their tombstone state; hiding them would
 * strand chat history the user can otherwise still read.
 * @param {{communities: any[] | null | undefined, linkedIds: Set<string>}} args
 * @returns {UnlinkedArea[]} sorted by name
 */
export function unlinkedConcordAreas({ communities, linkedIds }) {
  /** @type {Map<string, UnlinkedArea>} */
  const byId = new Map();
  for (const state of communities ?? []) {
    const communityId = state?.material?.community_id;
    if (!communityId || linkedIds.has(communityId) || byId.has(communityId)) continue;
    byId.set(communityId, {
      communityId,
      name: concordAreaDisplayName(state),
      dissolved: !!state.dissolved
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
