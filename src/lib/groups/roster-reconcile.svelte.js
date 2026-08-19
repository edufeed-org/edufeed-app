// Owner/admin-side roster reconcile for moderated communities.
//
// Members-tier ("Alle in dieser Community") channels are ordinary NIP-29
// groups: the relay checks THEIR roster, not the community's root roster,
// and plain NIP-29 has no cross-group membership. The community roster is
// mirrored into each channel at channel creation and on admin member-adds —
// but invite-CODE joiners are added to the root group by the relay itself,
// with no admin present to fan them out (laoc, 2026-08-19: an invited user
// stood before a locked 'willkommen'). This hook closes that gap: whenever
// an admin has the community open, it diffs the root roster against every
// members-tier channel roster and silently put-users the missing.
//
// Guard rails:
// - Runs once per (community, account) per session — module-level ledger.
// - Only plans against ANSWERED channel rosters (reconcilePlan/fanOutPlan:
//   "no answer" is not "not a member").
// - Only acts when the active account is the community owner or on the root
//   group's admin list — the put-users need channel-admin rights; a relay
//   still refusing one is swallowed per item (fanOut's tryOnce).
// MUST be called during component init ($effect + wrapped hooks inside).
import { useRootRoster } from './root-roster.svelte.js';
import { useChannelRosters } from './channel-rosters.svelte.js';
import { stufe2Pointers, reconcilePlan } from './area-members.js';
import { channelKey } from './community-pointer.js';
import { putUserOn, fanOut } from './roster-fanout.js';
import { useActiveUser } from '$lib/stores/accounts.svelte';
import { isCommunityOwner } from '$lib/helpers/community-signer.js';

/** Communities already reconciled this session, keyed community+account. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain bookkeeping, never rendered
const reconciled = new Set();

/** Test-only reset. */
export function __resetRosterReconcile() {
  reconciled.clear();
}

/**
 * @param {() => any} getCommunikeyEvent kind 10222 getter
 */
export function useRosterReconcile(getCommunikeyEvent) {
  const getRoster = useRootRoster(getCommunikeyEvent);
  const getRosters = useChannelRosters(() => stufe2Pointers(getCommunikeyEvent()));
  const getActiveUser = useActiveUser();

  $effect(() => {
    const communikeyEvent = getCommunikeyEvent();
    const user = getActiveUser();
    const roster = getRoster();
    const { membersByKey, adminsByKey } = getRosters();
    if (!communikeyEvent?.pubkey || !user?.signer || !roster.pointer) return;

    const pointers = stufe2Pointers(communikeyEvent);
    if (pointers.length === 0) return;

    const ledgerKey = `${communikeyEvent.pubkey} ${user.pubkey}`;
    if (reconciled.has(ledgerKey)) return;

    // Channel-admin rights: the owner or a root-group admin. Anyone else
    // couldn't sign the put-users anyway.
    const isAdmin =
      isCommunityOwner(communikeyEvent.pubkey) ||
      roster.admins.some((admin) => admin.pubkey === user.pubkey);
    if (!isAdmin) return;

    // Wait for EVERY members-tier roster to have answered — a partial diff
    // would re-add on the next visit, but worse, it would mark the ledger
    // done while channels were still unanswered.
    const allAnswered = pointers.every((pointer) => {
      const key = channelKey(pointer);
      return key !== null && membersByKey[key] !== undefined;
    });
    if (!allAnswered || roster.isLoading || roster.members.size === 0) return;

    const plan = reconcilePlan({
      members: [...roster.members],
      pointers,
      membersByKey,
      adminsByKey
    });
    reconciled.add(ledgerKey);
    if (plan.length === 0) return;

    void fanOut(
      plan,
      (item) => `${channelKey(item.pointer)} ${item.pubkey}`,
      (item) => putUserOn(item.pointer, item.pubkey, [], /** @type {any} */ (user))
    ).then((aggregate) => {
      if (aggregate.ok.length > 0) {
        console.info(
          `groups: reconciled ${aggregate.ok.length} roster entr${aggregate.ok.length === 1 ? 'y' : 'ies'} into members-tier channels`
        );
      }
    });
  });
}
