// Reactive wiring for ./groups-list-sync.js: the roster, the kind-10009 list
// and the kind 39000 of each group the list lacks — all three already built.
import { useMyGroups } from './unlinked-groups.svelte.js';
import { useMyGroupPointers } from './my-groups.svelte.js';
import { useChannelMetadata } from './channel-metadata.svelte.js';
import { unlistedMemberships, groupsListAdditions } from './groups-list-sync.js';

/**
 * The entries the active user's groups list lacks. Call during component init.
 * @returns {() => Array<{id: string, relay: string}>}
 */
export function useGroupsListAdditions() {
  const getListed = useMyGroups();
  const getMemberships = useMyGroupPointers();
  const unlisted = $derived(unlistedMemberships(getListed(), getMemberships()));
  const getMetadata = useChannelMetadata(() => unlisted);
  const additions = $derived(groupsListAdditions(getListed(), unlisted, getMetadata().byKey));
  return () => additions;
}
