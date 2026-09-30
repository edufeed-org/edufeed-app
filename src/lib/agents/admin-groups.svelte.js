/**
 * The groups the active user may add an agent to: every group on their
 * roster, annotated with whether they hold a moderation role there (only
 * admins/moderators may put-user) and whether that roster has been fetched
 * yet — a group whose roster is still loading is shown as loading, never
 * silently treated as "not admin".
 */
import { useMyGroupPointers } from '$lib/groups/my-groups.svelte.js';
import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
import { metadataName } from '$lib/groups/unlinked-groups.js';
import { channelKey } from '$lib/groups/community-pointer.js';
import { isModerator } from '$lib/groups/roles.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';

/**
 * @typedef {{id: string, relay: string, key: string, name: string, isAdmin: boolean, loaded: boolean, members: Set<string>}} AdminGroup
 * @returns {() => {groups: AdminGroup[], loading: boolean}}
 */
export function useAdminGroups() {
  const getActiveUser = useActiveUser();
  const getPointers = useMyGroupPointers();
  const getRosters = useChannelRosters(getPointers);
  const getMetadata = useChannelMetadata(getPointers);

  const view = $derived.by(() => {
    const me = getActiveUser()?.pubkey;
    const rosters = getRosters();
    const meta = getMetadata();
    /** @type {AdminGroup[]} */
    const groups = [];
    for (const pointer of getPointers()) {
      const key = channelKey(pointer);
      if (!key) continue;
      const loaded = rosters.fetchedKeys.has(key);
      groups.push({
        ...pointer,
        key,
        name: metadataName(meta.byKey[key]) || pointer.id,
        isAdmin: loaded && isModerator(rosters.adminsByKey[key], me),
        loaded,
        members: rosters.membersByKey[key] ?? new Set() // eslint-disable-line svelte/prefer-svelte-reactivity -- plain fallback, not itself reactive state
      });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
    return { groups, loading: groups.some((g) => !g.loaded) };
  });
  return () => view;
}
