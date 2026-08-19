// Owner/admin-side roster reconcile for moderated communities.
//
// Every channel is a standalone NIP-29 group: the relay checks THEIR roster,
// not the community's root roster, and plain NIP-29 has no cross-group
// membership. ChannelCreateWizard pre-joins the root group's admins into a
// channel at CREATION time (A3), but an admin granted afterwards — or one
// added while a channel roster hadn't answered yet — is not covered. This
// hook closes that gap: whenever an admin has the community open, it diffs
// the root roster's ADMINS against every channel roster (any tier) and
// silently put-users the missing, with role ['admin'].
//
// Ordinary members get NO blanket fan-out here (A4, 2026-08-19): they join
// member-tier channels themselves via their own kind-9021 — instantly
// admitted on relays carrying the parent-tag patch, a pending application
// elsewhere.
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
import { reconcilePlan } from './area-members.js';
import { channelKey, parseGroupPointers } from './community-pointer.js';
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
  const getRosters = useChannelRosters(() => parseGroupPointers(getCommunikeyEvent()));
  const getActiveUser = useActiveUser();

  $effect(() => {
    const communikeyEvent = getCommunikeyEvent();
    const user = getActiveUser();
    const roster = getRoster();
    const { membersByKey, adminsByKey } = getRosters();
    if (!communikeyEvent?.pubkey || !user?.signer || !roster.pointer) return;

    const pointers = parseGroupPointers(communikeyEvent);
    if (pointers.length === 0) return;

    const ledgerKey = `${communikeyEvent.pubkey} ${user.pubkey}`;
    if (reconciled.has(ledgerKey)) return;

    // Channel-admin rights: the owner or a root-group admin. Anyone else
    // couldn't sign the put-users anyway.
    const admins = roster.admins.map((admin) => admin.pubkey);
    const isAdmin = isCommunityOwner(communikeyEvent.pubkey) || admins.includes(user.pubkey);
    if (!isAdmin) return;

    // Wait for EVERY channel roster to have answered — a partial diff would
    // re-add on the next visit, but worse, it would mark the ledger done
    // while channels were still unanswered.
    const allAnswered = pointers.every((pointer) => {
      const key = channelKey(pointer);
      return key !== null && membersByKey[key] !== undefined;
    });
    if (!allAnswered || roster.isLoading || admins.length === 0) return;

    const plan = reconcilePlan({
      admins,
      pointers,
      membersByKey,
      adminsByKey
    });
    reconciled.add(ledgerKey);
    if (plan.length === 0) return;

    void fanOut(
      plan,
      (item) => `${channelKey(item.pointer)} ${item.pubkey}`,
      (item) => putUserOn(item.pointer, item.pubkey, ['admin'], /** @type {any} */ (user))
    ).then((aggregate) => {
      if (aggregate.ok.length > 0) {
        console.info(
          `groups: reconciled ${aggregate.ok.length} admin roster entr${aggregate.ok.length === 1 ? 'y' : 'ies'} across channels`
        );
      }
    });
  });
}
