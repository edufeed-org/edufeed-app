// Owner/admin-side roster reconcile for moderated communities.
//
// Every channel is a standalone NIP-29 group: the relay checks THEIR roster,
// not the community's root roster, and plain NIP-29 has no cross-group
// membership. ChannelCreateWizard pre-joins the root group's admins into a
// channel at CREATION time (A3), but an admin granted afterwards — or one
// added while a channel roster hadn't answered yet — is not covered. This
// hook closes that gap: whenever an admin has the community open, it diffs
// the root roster's MODERATION-role holders (never publisher-only or
// custom-role 39001 entries — roles.js) against every channel roster (any
// tier) and silently put-users the missing, with role ['admin']. It also
// reverts admin grants the pre-fix fan-outs wrongly wrote for publisher-only
// entries (demotePlan in area-members.js).
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
import { reconcilePlan, demotePlan } from './area-members.js';
import { moderationPubkeys } from './roles.js';
import { channelKey } from './community-pointer.js';
import { parseMembershipPointer } from './community-membership.js';
import { useCommunityChannels } from './community-channels.svelte.js';
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
  // Channels are DISCOVERED from the relay subtree, not the kind-10222.
  const getCommunityChannels = useCommunityChannels(() =>
    parseMembershipPointer(getCommunikeyEvent())
  );
  const channelPointersOf = () =>
    getCommunityChannels().channels.map((c) => ({ id: c.id, relay: c.relay }));
  const getRosters = useChannelRosters(channelPointersOf);
  const getActiveUser = useActiveUser();

  $effect(() => {
    const communikeyEvent = getCommunikeyEvent();
    const user = getActiveUser();
    const roster = getRoster();
    const { membersByKey, adminsByKey } = getRosters();
    if (!communikeyEvent?.pubkey || !user?.signer || !roster.pointer) return;

    const pointers = channelPointersOf();
    if (pointers.length === 0) return;

    const ledgerKey = `${communikeyEvent.pubkey} ${user.pubkey}`;
    if (reconciled.has(ledgerKey)) return;

    // Channel-admin rights: the owner or a root-group MODERATION-role holder.
    // The root 39001 also lists publisher-only and custom-role entries
    // (roles.js) — those have no channel-admin rights and get no fan-out:
    // treating them as admins put-users them with the literal 'admin' role,
    // which the pyramid relay honours as real moderation rights (privilege
    // escalation, issue 12e124f4).
    const admins = moderationPubkeys(roster.admins);
    const isAdmin = isCommunityOwner(communikeyEvent.pubkey) || admins.includes(user.pubkey);
    if (!isAdmin) return;

    // Wait for EVERY channel roster to have answered — a partial diff would
    // re-add on the next visit, but worse, it would mark the ledger done
    // while channels were still unanswered.
    const allAnswered = pointers.every((pointer) => {
      const key = channelKey(pointer);
      return key !== null && membersByKey[key] !== undefined;
    });
    if (!allAnswered || roster.isLoading) return;

    // Grants for missing moderators, plus reverts of the admin role the
    // pre-fix fan-outs wrongly wrote for publisher-only entries (demotePlan).
    const plan = [
      ...reconcilePlan({
        admins,
        pointers,
        membersByKey,
        adminsByKey
      }).map((item) => ({ ...item, roles: ['admin'] })),
      ...demotePlan({ rootAdmins: roster.admins, pointers, adminsByKey })
    ];
    reconciled.add(ledgerKey);
    if (plan.length === 0) return;

    void fanOut(
      plan,
      (item) => `${channelKey(item.pointer)} ${item.pubkey}`,
      (item) => putUserOn(item.pointer, item.pubkey, item.roles, /** @type {any} */ (user))
    ).then((aggregate) => {
      if (aggregate.ok.length > 0) {
        console.info(
          `groups: reconciled ${aggregate.ok.length} admin roster entr${aggregate.ok.length === 1 ? 'y' : 'ies'} across channels`
        );
      }
    });
  });
}
