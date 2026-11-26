<!--
  CommunitySelector Component
  Reusable component for selecting communities to share content with.
  The community being visited (currentCommunity) is pinned on top; the other
  communities sit behind one toggle, so "share here" needs no interaction.
-->

<script>
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { ChevronDownIcon, ChevronRightIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communities?: string[],
   *   selectedCommunityIds?: string[],
   *   communitiesWithShares?: Set<string>,
   *   restrictedCommunities?: Set<string>,
   *   currentCommunity?: string,
   *   title?: string
   * }}
   */
  let {
    communities = [],
    selectedCommunityIds = $bindable([]),
    communitiesWithShares = new Set(),
    // Communities where the caller knows the share would never render
    // (profile-list-gated section, user not listed) — drawn disabled.
    restrictedCommunities = new Set(),
    // Hex pubkey of the community the dialog was opened in, '' elsewhere.
    currentCommunity = '',
    title = 'Select Communities'
  } = $props();

  let expanded = $state(false);

  const pinned = $derived(
    currentCommunity && communities.includes(currentCommunity) ? currentCommunity : ''
  );
  const others = $derived(communities.filter((pubkey) => pubkey !== pinned));
  const othersSelected = $derived(others.filter((id) => selectedCommunityIds.includes(id)).length);

  /** @param {string} communityPubkey */
  function toggleCommunitySelection(communityPubkey) {
    if (selectedCommunityIds.includes(communityPubkey)) {
      selectedCommunityIds = selectedCommunityIds.filter((id) => id !== communityPubkey);
    } else {
      selectedCommunityIds = [...selectedCommunityIds, communityPubkey];
    }
  }
</script>

{#snippet row(/** @type {string} */ communityPubKey)}
  {@const isAlreadyShared = communitiesWithShares.has(communityPubKey)}
  {@const isSelected = selectedCommunityIds.includes(communityPubKey)}
  {@const isRestricted = restrictedCommunities.has(communityPubKey)}
  {@const isPinned = communityPubKey === pinned}
  {@const getCommunityProfile = useUserProfile(communityPubKey)}
  {@const communityProfile = getCommunityProfile()}
  <label
    data-testid="community-row"
    class="flex min-h-12 items-center gap-3 rounded-xl px-3 py-1 {isPinned
      ? 'bg-primary/10'
      : ''} {isRestricted ? 'opacity-50' : 'cursor-pointer'}"
    title={isRestricted ? m.share_restricted_hint() : undefined}
  >
    <ProfileAvatar pubkey={communityPubKey} profile={communityProfile ?? null} size="sm" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium">
        {getDisplayName(communityProfile) ||
          `${communityPubKey.slice(0, 8)}...${communityPubKey.slice(-4)}`}
      </span>
      {#if isPinned}
        <span class="block text-xs text-base-content/70">
          {m.community_selector_this_community()}
        </span>
      {/if}
    </span>
    {#if isRestricted}
      <span class="badge badge-ghost badge-sm" data-testid="share-restricted-badge"
        >{m.share_restricted_label()}</span
      >
    {/if}
    {#if isAlreadyShared && !isSelected}
      <span class="text-xs font-medium text-success">{m.community_selector_shared()}</span>
    {:else if isAlreadyShared && isSelected}
      <span class="text-xs font-medium text-warning">{m.community_selector_will_unshare()}</span>
    {/if}
    <input
      type="checkbox"
      class="checkbox checkbox-primary"
      checked={isSelected || isAlreadyShared}
      disabled={isRestricted}
      onchange={() => toggleCommunitySelection(communityPubKey)}
    />
  </label>
{/snippet}

<div class="mb-3">
  <div class="mb-2 block text-sm font-medium text-base-content">{title}</div>

  {#if communities.length === 0}
    <div class="py-4 text-center text-base-content/60">
      {m.community_selector_no_communities()}
    </div>
  {/if}

  {#if pinned}
    {@render row(pinned)}
    {#if others.length > 0}
      <button
        type="button"
        class="btn mt-1 w-full justify-between px-3 text-primary btn-ghost btn-sm"
        aria-expanded={expanded}
        data-testid="community-more-toggle"
        onclick={() => (expanded = !expanded)}
      >
        {othersSelected > 0
          ? m.community_selector_more_count({
              selected: String(othersSelected),
              total: String(others.length)
            })
          : m.community_selector_more()}
        {#if expanded}<ChevronDownIcon class_="h-4 w-4" />{:else}<ChevronRightIcon
            class_="h-4 w-4"
          />{/if}
      </button>
    {/if}
  {/if}

  {#if !pinned || expanded}
    <div class={pinned ? 'mt-1 border-t border-base-300 pt-1' : ''}>
      {#each others as communityPubKey (communityPubKey)}
        {@render row(communityPubKey)}
      {/each}
    </div>
  {/if}
</div>
