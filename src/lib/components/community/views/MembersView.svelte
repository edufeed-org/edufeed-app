<script>
  import { getContext } from 'svelte';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { deriveCommunityType } from '$lib/groups/community-membership.js';
  import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
  import { unique } from '$lib/helpers/unique.js';
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import * as m from '$lib/paraglide/messages';

  let { communikeyEvent } = $props();

  /** @type {import('$lib/stores/profile-list-access.svelte.js').ProfileListAccess} */
  const profileAccess = getContext('profileAccess');

  let memberData = $derived(getVerifiedMembers(profileAccess, communikeyEvent));

  const getProfiles = useProfileMap(() => memberData.allMembers);
  let profiles = $derived(getProfiles());

  // Moderated communities show role chips sourced from the root-group NIP-29
  // roster (kind 39001 admins). Rosters are public, so this is visible to
  // visitors too, same as the rest of the member list — display only, no
  // management (that lives in GroupMembersModal inside channel views).
  // useRootRoster wraps a $effect-based hook, so it's called unconditionally
  // here at component init; open/closed communities just never read it.
  let communityType = $derived(deriveCommunityType(communikeyEvent));
  let isModerated = $derived(communityType === 'moderated');
  const getRootRoster = useRootRoster(() => communikeyEvent);

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
  <h2 class="mb-6 text-xl font-bold">{m.community_members_title()}</h2>

  {#if profileAccess.isLoading}
    <div class="flex flex-col items-center justify-center py-12">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-sm text-base-content/60">{m.community_members_loading()}</p>
    </div>
  {:else if memberData.allMembers.length <= 1 && memberData.perSection.size === 0}
    <!-- Only owner, no gated sections. A CLOSED community also lands here
      (its 10222 has no gated sections) — it must not claim to be open
      (journey-test bug #8). -->
    <div class="card bg-base-100">
      <div class="card-body text-center">
        <p class="text-base-content/60">
          {communityType === 'closed'
            ? m.community_members_closed_community()
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
                <span class="badge badge-ghost badge-sm" data-testid="member-role-chip">{role}</span
                >
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
  {:else}
    <p class="mb-4 text-sm text-base-content/60">
      {m.community_members_count({ count: memberData.allMembers.length })}
    </p>

    <div class="flex max-w-2xl flex-col gap-2">
      {#each memberData.allMembers as pubkey (pubkey)}
        {@const sections = getSectionsForPubkey(pubkey)}
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
                <span class="badge badge-ghost badge-sm" data-testid="member-role-chip">{role}</span
                >
              {/each}
            </div>
          </div>
          {#if sections.length > 0}
            <div class="mt-1.5 flex flex-wrap gap-1 px-2 pb-1">
              {#if isInAllSections(sections)}
                <span class="badge badge-outline badge-xs">
                  {m.community_members_all_sections()}
                </span>
              {:else}
                {#each sections as section (section)}
                  <span class="badge badge-outline badge-xs">{section}</span>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
