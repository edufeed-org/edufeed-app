// Which communities a user can SHARE into — reactive half.
//
// THREE membership signals, because this app has three ways to belong to a
// community and only the first of them is a self-signed public record:
//
//   1. the kind-30000 follow set (d=communities) — "I joined", public;
//   2. Concord area membership — private, so members deliberately never
//      follow-set-join (see concord/shareable-communities.js);
//   3. NIP-29 root-group roster — granted BY AN ADMIN via kind-9000, and an
//      admin cannot write the grantee's kind-30000, so the follow set can
//      never learn about it (see groups/shareable-communities.js).
//
// Listing only (1) meant a publisher could hold explicit publish rights and
// still find their community missing from every picker.
//
// Lived under src/lib/concord/ until 2026-08-21; moved out when signal (3)
// arrived, since that directory is lint-enforced for Concord-only imports and
// nothing here is Concord-specific. Concord submodules are still imported
// DIRECTLY, never through the barrel (src/lib/concord convention).
import { getConcordState } from '$lib/concord/client.svelte.js';
import { areaLinkedCommunityPubkeys } from '$lib/concord/shareable-communities.js';
import { rosterLinkedCommunityPubkeys } from '$lib/groups/shareable-communities.js';
import { useMyGroupPointers } from '$lib/groups/my-groups.svelte.js';
import { useChannelRosters } from '$lib/groups/channel-rosters.svelte.js';
import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
import { useJoinedCommunikeyEvents } from '$lib/helpers/joined-communikey-events.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { unique } from '$lib/helpers/unique.js';

/**
 * Drop-in replacement for `useJoinedCommunitiesList()` on share surfaces:
 * follow-set-joined pubkeys, plus the communities linked to the user's own
 * Concord areas, plus the communities whose root group the user is on the
 * roster of.
 *
 * Both extra lanes need the same trick to find their 10222s: a set of
 * candidate pubkeys to fetch, which are then matched by pointer. For Concord
 * the candidates are the area owners (a wizard-founded area's owner IS the
 * community keypair). For NIP-29 they are the group's 39001 admins —
 * provisionRootGroup seats the community pubkey itself as an admin, so the
 * community is always among them. A group created outside our wizard may not
 * carry it; that community then stays discoverable only via the follow set.
 *
 * Call during component init.
 * @returns {() => string[]}
 */
export function useShareableCommunities() {
  const getJoined = useJoinedCommunitiesList();

  // --- Concord lane -------------------------------------------------------
  const getAreaOwners = () =>
    runtimeConfig.concord?.enabled
      ? unique(
          getConcordState()
            .communities.map((/** @type {any} */ c) => c?.material?.owner)
            .filter(Boolean)
        )
      : [];

  // --- NIP-29 lane --------------------------------------------------------
  const getMyGroupPointers = useMyGroupPointers();
  // The `#p` query only returns the lists that name me, so a group where I am
  // an ordinary member yields its 39002 but not its 39001 — and the community
  // pubkey lives in the 39001. This second, `#d`-keyed batch fills that in
  // (one REQ per relay for all of them, the loader already does the batching).
  const getRosters = useChannelRosters(getMyGroupPointers);
  const getRosterAdminCandidates = () => {
    const { adminsByKey } = getRosters();
    return unique(
      Object.values(adminsByKey).flatMap((admins) =>
        (admins ?? []).map((/** @type {any} */ a) => a.pubkey)
      )
    );
  };

  const getCommunikeyEvents = useJoinedCommunikeyEvents(
    () => true,
    () => unique([...getAreaOwners(), ...getRosterAdminCandidates()])
  );

  return () => {
    const communikeyEvents = getCommunikeyEvents();

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- lookup scratch, never rendered
    const areaIds = new Set(
      getConcordState()
        .communities.map((/** @type {any} */ c) => c?.material?.community_id)
        .filter(Boolean)
    );
    const linked = areaLinkedCommunityPubkeys({ areaIds, communikeyEvents });

    const rosterLinked = rosterLinkedCommunityPubkeys({
      groupIds: getMyGroupPointers().map((pointer) => pointer.id),
      communikeyEvents
    });

    return unique([...getJoined(), ...linked, ...rosterLinked]);
  };
}
