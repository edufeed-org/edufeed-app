// src/lib/groups/root-roster.svelte.js
//
// Reactive roster of a moderated community's ROOT group. Reuses the batched
// useChannelRosters loader (one REQ per relay, debounced, refresh self-heal)
// with a single pointer — no second subscription pattern.
// MUST be called during component init (it wraps a $effect-based hook).
import { useChannelRosters } from './channel-rosters.svelte.js';
import { parseMembershipPointer } from './community-membership.js';
import { rosterView } from './root-roster.js';

/**
 * @param {() => any} getCommunikeyEvent - Getter for the kind 10222 event
 * @returns {() => import('./root-roster.js').RosterView & {
 *   pointer: {id: string, relay: string} | null,
 *   refresh: () => void
 * }}
 */
export function useRootRoster(getCommunikeyEvent) {
  const getRosters = useChannelRosters(() => {
    const pointer = parseMembershipPointer(getCommunikeyEvent());
    return pointer ? [pointer] : [];
  });
  return () => {
    const pointer = parseMembershipPointer(getCommunikeyEvent());
    const { membersByKey, adminsByKey, fetchedKeys, refresh } = getRosters();
    return { pointer, refresh, ...rosterView(pointer, membersByKey, adminsByKey, fetchedKeys) };
  };
}
