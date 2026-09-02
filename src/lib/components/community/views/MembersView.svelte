<script>
  import { getContext } from 'svelte';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { deriveCommunityType } from '$lib/groups/community-membership.js';
  import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
  // Concord submodules imported DIRECTLY (never the barrel) — the convention
  // every Concord call site follows (see CLAUDE.md's Concord section).
  import { useConcordCommunity } from '$lib/concord/community.svelte.js';
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import { parseConcordPointer } from '$lib/concord/pointer.js';
  import { memberTier } from '$lib/concord/roles.js';
  import ChannelMembersModal from '$lib/components/community/channels/ChannelMembersModal.svelte';
  import { unique } from '$lib/helpers/unique.js';
  import { roleLabel } from '$lib/groups/role-labels.js';
  import { contentSectionLabel } from '$lib/helpers/content-section-label.js';
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import JoinRequestsPanel from '$lib/components/community/settings/JoinRequestsPanel.svelte';
  import MemberActionsMenu from '$lib/components/groups/MemberActionsMenu.svelte';
  import AddMemberControl from '$lib/components/groups/AddMemberControl.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { isCommunityOwner } from '$lib/helpers/community-signer.js';
  import { roleOptionsFromAdmins, isPublisherOnly } from '$lib/groups/roles.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent, communityProfile = null } = $props();

  /** @type {import('$lib/stores/profile-list-access.svelte.js').ProfileListAccess} */
  const profileAccess = getContext('profileAccess');

  let memberData = $derived(getVerifiedMembers(profileAccess, communikeyEvent));

  // A linked private area's members (journey-test 2026-08-17: the channel
  // header said 2 members, this view said 1). `members$` is E2E — it only
  // populates when the VIEWER is an area member themselves; visitors get an
  // empty set and the explanatory note below instead of a fake count.
  let hasArea = $derived(!!parseConcordPointer(communikeyEvent));
  const getConcordArea = useConcordCommunity(() => communikeyEvent);
  const getAreaMemberSet = useObservable(
    () => getConcordArea().community?.members$,
    /** @type {Set<string>} */ (new Set())
  );
  let areaMembers = $derived([...getAreaMemberSet()]);

  // CORD-04 tiers for the same rows (issues 2+3 of the groups epic): the
  // machinery was already loaded by useConcordCommunity, only never read
  // here. Like members$, roles$/grants$ are E2E — visitors see no tiers.
  const getAreaRoles = useObservable(
    () => getConcordArea().community?.roles$,
    /** @type {any[]} */ ([])
  );
  const getAreaGrants = useObservable(
    () => getConcordArea().community?.grants$,
    /** @type {Map<string, string[]>} */ (new Map())
  );

  /** @returns {'owner'|'admin'|'moderator'|null} */
  function getAreaTier(/** @type {string} */ pubkey) {
    if (!hasArea) return null;
    return memberTier(
      getAreaRoles(),
      getAreaGrants(),
      getConcordArea().community?.material?.owner,
      pubkey
    );
  }

  /** @param {'owner'|'admin'|'moderator'} tier */
  function areaTierLabel(tier) {
    return tier === 'owner'
      ? m.concord_role_owner()
      : tier === 'admin'
        ? m.concord_role_admin()
        : m.concord_role_moderator();
  }

  // Area role management from this page too, mirroring the NIP-29 manage
  // button below: ChannelMembersModal without a channel is the community-wide
  // role surface (kick/ban need a channel and stay hidden there).
  let showAreaModal = $state(false);
  const areaCanManage = $derived(hasArea && !!getConcordArea().canManageRoles);

  const getProfiles = useProfileMap(() => mergedMembers);
  let profiles = $derived(getProfiles());

  // Moderated communities show role chips sourced from the root-group NIP-29
  // roster (kind 39001 admins). Rosters are public, so this is visible to
  // visitors too, same as the rest of the member list; management lives in
  // GroupMembersModal, opened via the manage button below (and from Settings'
  // MembershipPane).
  // useRootRoster wraps a $effect-based hook, so it's called unconditionally
  // here at component init; open/closed communities just never read it.
  let communityType = $derived(deriveCommunityType(communikeyEvent));
  let isModerated = $derived(communityType === 'moderated');
  const getRootRoster = useRootRoster(() => communikeyEvent);

  // Beitrittsanfragen ride along for whoever can act on them — the
  // key-holding owner or a root-group admin (laoc, 2026-08-19: "I would
  // expect it also for relevant actors under Mitglieder").
  const getActiveUserForQueue = useActiveUser();
  const canModerateJoins = $derived.by(() => {
    if (!isModerated) return false;
    const me = getActiveUserForQueue()?.pubkey;
    if (!me) return false;
    return (
      isCommunityOwner(communikeyEvent?.pubkey) ||
      getRootRoster().admins.some((admin) => admin.pubkey === me)
    );
  });

  // Inline roster management (issue 7ca94a65): the members list itself
  // carries the admin actions — per-row MemberActionsMenu kebabs plus an
  // inline add-member section — instead of the separate GroupMembersModal
  // surface this page used to open. Same actor gate as the join queue
  // (owner or root-39001 admin) plus a resolvable root pointer. Settings'
  // MembershipPane keeps the modal for its compact layout.
  const rosterPointer = $derived(getRootRoster().pointer);
  const roleOptions = $derived(roleOptionsFromAdmins(getRootRoster().admins));
  const canManageRoster = $derived(canModerateJoins && !!rosterPointer);

  /** Root-roster roles of a pubkey ([] for plain members / non-roster rows). */
  function rosterRolesOf(/** @type {string} */ pubkey) {
    return getRootRoster().admins.find((a) => a.pubkey === pubkey)?.roles ?? [];
  }

  /**
   * Action set for a row's kebab, mirroring GroupMembersModal's sections:
   * admins get demote, publisher-only holders and plain members get
   * promote + remove; everyone gets the publisher toggle. Rows outside the
   * root roster (section-only or area-only members) and the viewer's own row
   * get no menu.
   * @param {string} pubkey
   * @returns {{togglePublisher?: boolean, promote?: boolean, demote?: boolean, remove?: boolean} | null}
   */
  function getRosterRowActions(pubkey) {
    if (!canManageRoster || pubkey === getActiveUserForQueue()?.pubkey) return null;
    const roster = getRootRoster();
    const admin = roster.admins.find((a) => a.pubkey === pubkey);
    if (admin && !isPublisherOnly(admin.roles)) return { togglePublisher: true, demote: true };
    if (admin || roster.members.has(pubkey))
      return { togglePublisher: true, promote: true, remove: true };
    return null;
  }

  // Member search (issue 7ca94a65): a flat list does not scale. Matches the
  // profile display name, the hex pubkey, and — when the query looks like
  // one — the npub encoding.
  let searchQuery = $state('');
  const normalizedQuery = $derived(searchQuery.trim().toLowerCase());

  function matchesSearch(/** @type {string} */ pubkey) {
    if (getUserDisplayName(pubkey, profiles.get(pubkey)).toLowerCase().includes(normalizedQuery))
      return true;
    if (pubkey.toLowerCase().includes(normalizedQuery)) return true;
    if (normalizedQuery.startsWith('npub')) {
      try {
        return nip19.npubEncode(pubkey).includes(normalizedQuery);
      } catch {
        return false;
      }
    }
    return false;
  }

  // Moderated: the ROOT-group roster IS the community membership — it must
  // be listed even when no content section is gated (laoc, 2026-08-19: an
  // all-"Alle" moderated community showed only the owner and claimed to be
  // an open community).
  let rosterMembers = $derived(isModerated ? [...getRootRoster().members] : []);
  let mergedMembers = $derived(
    unique([...memberData.allMembers, ...areaMembers, ...rosterMembers])
  );
  let visibleMembers = $derived(
    normalizedQuery ? mergedMembers.filter(matchesSearch) : mergedMembers
  );

  /**
   * Role chips for a pubkey in a moderated community (bare admins show
   * 'admin'). `admin.roles` comes straight off a kind 39001 event's tags —
   * untrusted network input a malformed event can repeat — so it's run
   * through `unique()` before it feeds the keyed {#each} below; a
   * duplicated role string would otherwise crash the whole page
   * (each_key_duplicate).
   */
  function getRoleChips(/** @type {string} */ pubkey) {
    if (!isModerated) return [];
    const admin = getRootRoster().admins.find((a) => a.pubkey === pubkey);
    if (!admin) return [];
    return unique(admin.roles.length > 0 ? admin.roles : ['admin']);
  }

  /** Get section names a pubkey belongs to */
  function getSectionsForPubkey(/** @type {string} */ pubkey) {
    /** @type {string[]} */
    const sections = [];
    for (const [name, members] of memberData.perSection) {
      if (members.includes(pubkey)) sections.push(name);
    }
    return sections;
  }

  let isOwner = (/** @type {string} */ pubkey) => communikeyEvent?.pubkey === pubkey;

  /**
   * A roster member of a fully members-gated community is in EVERY section —
   * one chip per section sprawled across the row (8 identical chips in the
   * default community). Collapse to a single "all sections" chip when the
   * member is in all of them and there is more than one.
   * @param {string[]} sections
   */
  function isInAllSections(sections) {
    return memberData.perSection.size > 1 && sections.length === memberData.perSection.size;
  }
</script>

<div class="container mx-auto max-w-4xl px-4 py-8">
  <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <h2 class="text-xl font-bold">{m.community_members_title()}</h2>
    {#if areaCanManage}
      <button
        class="btn btn-outline btn-sm"
        data-testid="members-manage-area-button"
        onclick={() => (showAreaModal = true)}
      >
        {m.community_membership_pane_manage()}
      </button>
    {/if}
  </div>

  {#if canModerateJoins && communikeyEvent?.pubkey}
    <div class="mb-6">
      <JoinRequestsPanel communityId={communikeyEvent.pubkey} roster={getRootRoster()} />
    </div>
  {/if}

  {#if profileAccess.isLoading}
    <div class="flex flex-col items-center justify-center py-12">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-sm text-base-content/60">{m.community_members_loading()}</p>
    </div>
  {:else if mergedMembers.length <= 1 && memberData.perSection.size === 0}
    <!-- Only owner, no gated sections. A CLOSED community also lands here
      (its 10222 has no gated sections) — it must not claim to be open
      (journey-test bug #8). A community with a linked private area gets the
      area note instead of "jeder kann beitragen" — its membership is real,
      just private (journey-test 2026-08-17). -->
    <div class="card bg-base-100">
      <div class="card-body text-center">
        <p class="text-base-content/60">
          {communityType === 'closed'
            ? m.community_members_closed_community()
            : hasArea
              ? m.community_members_area_note()
              : isModerated
                ? m.community_members_moderated_community()
                : m.community_members_open_community()}
        </p>
      </div>
    </div>

    <!-- Still show owner -->
    {#if communikeyEvent?.pubkey}
      <div class="mt-6 flex max-w-2xl flex-col gap-2">
        <div
          class="rounded-lg bg-base-100 p-2"
          data-testid="member-row"
          data-pubkey={communikeyEvent.pubkey}
        >
          <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <ProfileCard
                pubkey={communikeyEvent.pubkey}
                profile={profiles.get(communikeyEvent.pubkey)}
                size="sm"
                showNpub={false}
                showIcon={false}
              />
            </div>
            <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
              <span class="badge badge-sm badge-primary">
                {m.community_members_owner_badge()}
              </span>
              {#each getRoleChips(communikeyEvent.pubkey) as role (role)}
                <span class="badge badge-ghost badge-sm" data-testid="member-role-chip"
                  >{roleLabel(role)}</span
                >
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
  {:else}
    <div class="mb-4 flex max-w-2xl flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-base-content/60">
        {mergedMembers.length === 1
          ? m.community_members_count_one()
          : m.community_members_count({ count: mergedMembers.length })}
      </p>
      <input
        type="search"
        class="input-bordered input input-sm w-full sm:max-w-xs"
        placeholder={m.community_members_search_placeholder()}
        aria-label={m.community_members_search_placeholder()}
        data-testid="members-search"
        value={searchQuery}
        oninput={(e) => (searchQuery = /** @type {HTMLInputElement} */ (e.target).value)}
      />
    </div>
    {#if hasArea && areaMembers.length === 0}
      <!-- The viewer cannot decrypt the area's roster (not a member) — say
        why the count may look smaller than the channel header's. -->
      <p class="mb-4 text-sm text-base-content/60">{m.community_members_area_note()}</p>
    {/if}

    {#if visibleMembers.length === 0}
      <p class="text-sm text-base-content/60" data-testid="members-search-empty">
        {m.community_members_search_empty()}
      </p>
    {/if}
    <div class="flex max-w-2xl flex-col gap-2">
      {#each visibleMembers as pubkey (pubkey)}
        {@const sections = getSectionsForPubkey(pubkey)}
        {@const areaTier = getAreaTier(pubkey)}
        {@const rowActions = getRosterRowActions(pubkey)}
        <div class="rounded-lg bg-base-100 p-2" data-testid="member-row" data-pubkey={pubkey}>
          <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <ProfileCard
                {pubkey}
                profile={profiles.get(pubkey)}
                size="sm"
                showNpub={false}
                showIcon={false}
              />
            </div>
            <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
              {#if isOwner(pubkey)}
                <span class="badge badge-sm badge-primary">{m.community_members_owner_badge()}</span
                >
              {/if}
              {#each getRoleChips(pubkey) as role (role)}
                <span class="badge badge-ghost badge-sm" data-testid="member-role-chip"
                  >{roleLabel(role)}</span
                >
              {/each}
              {#if areaMembers.includes(pubkey)}
                <span class="badge badge-outline badge-sm" data-testid="member-area-chip"
                  >🔒 {m.community_members_area_chip()}</span
                >
              {/if}
              <!-- Skip the redundant 'owner' tier chip when the row already
                carries the community Owner badge (the normal wizard-founded
                case, where the area owner IS the community keypair). -->
              {#if areaTier && !(areaTier === 'owner' && isOwner(pubkey))}
                <span class="badge badge-ghost badge-sm" data-testid="member-area-tier-chip"
                  >{areaTierLabel(areaTier)}</span
                >
              {/if}
            </div>
            {#if rowActions && rosterPointer}
              <MemberActionsMenu
                pointer={rosterPointer}
                {pubkey}
                name={getUserDisplayName(pubkey, profiles.get(pubkey))}
                roles={rosterRolesOf(pubkey)}
                actions={rowActions}
                {roleOptions}
                onRosterChanged={getRootRoster().refresh}
              />
            {/if}
          </div>
          {#if sections.length > 0}
            <div class="mt-1.5 flex flex-wrap gap-1 px-2 pb-1">
              {#if isInAllSections(sections)}
                <span class="badge badge-outline badge-xs">
                  {m.community_members_all_sections()}
                </span>
              {:else}
                {#each sections as section (section)}
                  <span class="badge badge-outline badge-xs">{contentSectionLabel(section)}</span>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if canManageRoster && rosterPointer}
    <div class="mt-6 max-w-2xl" data-testid="members-add-section">
      <div class="card bg-base-100">
        <div class="card-body">
          <h3 class="card-title text-base">{m.community_members_add_title()}</h3>
          <AddMemberControl
            pointer={rosterPointer}
            metadata={{ name: getDisplayName(communityProfile) }}
            communityId={communikeyEvent?.pubkey}
            members={getRootRoster().members}
            onRosterChanged={getRootRoster().refresh}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

{#if showAreaModal}
  <ChannelMembersModal
    community={getConcordArea().community}
    signerHasNip44={getConcordArea().signerHasNip44}
    canManageRoles={getConcordArea().canManageRoles}
    canPromoteAdmin={getConcordArea().canPromoteAdmin}
    myTier={getConcordArea().myTier}
    onClose={() => (showAreaModal = false)}
  />
{/if}
