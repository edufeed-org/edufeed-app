// Which communities a user can SHARE into — reactive half. See
// shareable-communities.js for why this is joined ∪ area-linked rather than
// the follow set alone. Imports concord submodules DIRECTLY, never the
// barrel (src/lib/concord convention).
import { getConcordState } from './client.svelte.js';
import { areaLinkedCommunityPubkeys } from './shareable-communities.js';
import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
import { useJoinedCommunikeyEvents } from '$lib/helpers/joined-communikey-events.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { unique } from '$lib/helpers/unique.js';

/**
 * Drop-in replacement for `useJoinedCommunitiesList()` on share surfaces:
 * follow-set-joined pubkeys plus the pubkeys of communities linked to the
 * user's own Concord areas. The area owners double as fetch candidates — a
 * wizard-founded area's owner IS the community keypair (the same identity
 * /private/[id]'s reverse-lookup redirect leans on), so feeding them to
 * useJoinedCommunikeyEvents pulls exactly the 10222s the pointer match
 * needs. Call during component init.
 * @returns {() => string[]}
 */
export function useShareableCommunities() {
  const getJoined = useJoinedCommunitiesList();
  const getAreaOwners = () =>
    runtimeConfig.concord?.enabled
      ? unique(
          getConcordState()
            .communities.map((/** @type {any} */ c) => c?.material?.owner)
            .filter(Boolean)
        )
      : [];
  const getCommunikeyEvents = useJoinedCommunikeyEvents(() => true, getAreaOwners);

  return () => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- lookup scratch, never rendered
    const areaIds = new Set(
      getConcordState()
        .communities.map((/** @type {any} */ c) => c?.material?.community_id)
        .filter(Boolean)
    );
    const linked = areaLinkedCommunityPubkeys({
      areaIds,
      communikeyEvents: getCommunikeyEvents()
    });
    return unique([...getJoined(), ...linked]);
  };
}
