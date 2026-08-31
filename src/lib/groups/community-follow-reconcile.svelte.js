// src/lib/groups/community-follow-reconcile.svelte.js
//
// Reactive half of community-follow.js: while a moderated community's page is
// open, if its root roster already holds the active account and the kind-30000
// `communities` follow set does not, add it. That is what turns "an admin gave
// me a role" / "my join was accepted" into a rail entry, instead of leaving the
// user to discover the Follow button (laoc, 2026-08-24).
//
// Same shape and the same guard rails as roster-reconcile.svelte.js:
// - Runs once per (community, account) per session — module-level ledger.
// - Only acts on an ANSWERED roster; "no answer" is never "not a member".
// - The write is joinCommunity()'s optimistic ActionRunner, so the /c card
//   appears without a reload.
//
// Two limits worth knowing:
// - It only runs while THAT community's page is open. Mirroring
//   roster-reconcile, which accepts the same bound: a rail-wide version would
//   need every community's roster, and the rosters are what cost.
// - Someone who deliberately unfollows a community they still belong to gets
//   re-followed on a LATER session (within the session the ledger protects the
//   unfollow — see below). If that bites, the fix is an explicit opt-out
//   marker, NOT a longer-lived ledger, which would just make the first follow
//   unreliable instead.
//
// MUST be called during component init (it wraps a $effect-based hook).
import { useRootRoster } from './root-roster.svelte.js';
import { shouldFollowFromRoster } from './community-follow.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
import { joinCommunity } from '$lib/helpers/community.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

const COMMUNITIES_SET_ID = 'communities';

/** Communities already reconciled this session, keyed community+account. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain bookkeeping, never rendered
const followed = new Set();

/** Test-only reset. */
export function __resetCommunityFollowReconcile() {
  followed.clear();
}

/**
 * @param {() => any} getCommunikeyEvent kind 10222 getter
 */
export function useCommunityFollowReconcile(getCommunikeyEvent) {
  const getRoster = useRootRoster(getCommunikeyEvent);
  const getActiveUser = useActiveUser();
  const getJoinedCommunities = useJoinedCommunitiesList();

  $effect(() => {
    const communityEvent = getCommunikeyEvent();
    const user = getActiveUser();
    const roster = getRoster();
    const joinedCommunities = getJoinedCommunities();

    // A follow set edit has to be signed; a read-only viewer just watches.
    if (!user?.signer) return;

    // An empty `joinedCommunities` means BOTH "you follow nothing" and "the
    // list has not loaded yet", and acting on the second is how a kind-30000
    // gets rebuilt from nothing (the follow-set wipe class of bug). Requiring
    // the event to actually be in the store collapses that ambiguity. A user
    // who genuinely has no follow set yet is not auto-followed — an explicit
    // Follow click still bootstraps one via ensureFollowSetExists.
    if (!eventStore.getReplaceable(30000, user.pubkey, COMMUNITIES_SET_ID)) return;

    const ledgerKey = `${communityEvent?.pubkey} ${user.pubkey}`;
    if (followed.has(ledgerKey)) return;

    // Seeing you already follow it counts as handled. Otherwise unfollowing a
    // community you are still a member of would be undone on the spot, and the
    // Unfollow button would look broken. One auto-follow per community per
    // session, and never once we have observed you following it.
    if ((joinedCommunities ?? []).includes(communityEvent?.pubkey)) {
      followed.add(ledgerKey);
      return;
    }

    if (
      !shouldFollowFromRoster({
        communityEvent,
        userPubkey: user.pubkey,
        roster,
        joinedCommunities
      })
    )
      return;

    followed.add(ledgerKey);

    void joinCommunity(communityEvent.pubkey).then((result) => {
      if (result?.success) {
        console.info('groups: followed community from root-roster membership');
      } else {
        // Let a failed write be retried on the next visit rather than
        // pretending it happened.
        followed.delete(ledgerKey);
      }
    });
  });
}
