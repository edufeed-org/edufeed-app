<!--
  CommunitySelector Component
  Reusable component for selecting communities to share events with
-->

<script>
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';

  /**
   * @typedef {Object} Community
   * @property {string} pubkey - Community pubkey
   * @property {string} [name] - Community name
   */

  let {
    communities = [],
    selectedCommunityIds = $bindable([]),
    communitiesWithShares = new Set(),
    title = 'Select Communities',
    showSelectAll = true
  } = $props();

  /**
   * Toggle community selection
   * @param {string} communityPubkey
   */
  function toggleCommunitySelection(communityPubkey) {
    if (selectedCommunityIds.includes(communityPubkey)) {
      selectedCommunityIds = selectedCommunityIds.filter((id) => id !== communityPubkey);
    } else {
      selectedCommunityIds = [...selectedCommunityIds, communityPubkey];
    }
  }

  /**
   * Select all communities that don't already have shares
   */
  function selectAllCommunities() {
    const availableCommunities = communities.filter(
      (pubkey) => pubkey && !communitiesWithShares.has(pubkey)
    );
    selectedCommunityIds = availableCommunities;
  }

  /**
   * Deselect all communities
   */
  function deselectAllCommunities() {
    selectedCommunityIds = [];
  }
</script>

<div class="mb-3">
  <div class="mb-2 flex items-center justify-between">
    <div class="block text-sm font-medium text-base-content">
      {title}
    </div>
    {#if showSelectAll && communities.length > 1}
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={selectAllCommunities}
          disabled={selectedCommunityIds.length === communities.length}
        >
          Select All
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={deselectAllCommunities}
          disabled={selectedCommunityIds.length === 0}
        >
          Deselect All
        </button>
      </div>
    {/if}
  </div>

  <!-- Community Checkboxes -->
  <div class="max-h-40 overflow-y-auto rounded-lg border border-base-300 p-3">
    {#each communities as communityPubKey (communityPubKey)}
      {@const isAlreadyShared = communitiesWithShares.has(communityPubKey)}
      {@const isSelected = selectedCommunityIds.includes(communityPubKey)}
      {@const getCommunityProfile = useUserProfile(communityPubKey)}
      {@const communityProfile = getCommunityProfile()}
      <label class="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-base-200">
        <input
          type="checkbox"
          class="checkbox checkbox-secondary"
          checked={isSelected || isAlreadyShared}
          onchange={() => toggleCommunitySelection(communityPubKey)}
        />
        <div class="flex-1">
          <span class="text-sm font-medium">
            {getDisplayName(communityProfile) ||
              `${communityPubKey.slice(0, 8)}...${communityPubKey.slice(-4)}`}
          </span>
        </div>
        {#if isAlreadyShared && !isSelected}
          <span class="text-xs font-medium text-success">(Shared - click to unshare)</span>
        {:else if isAlreadyShared && isSelected}
          <span class="text-xs font-medium text-warning">(Will be unshared)</span>
        {:else if isSelected}
          <span class="text-xs font-medium text-info">(Will be shared)</span>
        {/if}
      </label>
    {/each}
    {#if communities.length === 0}
      <div class="py-4 text-center text-base-content/60">No joined communities available</div>
    {/if}
  </div>

  <!-- Selected Communities Summary -->
  {#if selectedCommunityIds.length > 0}
    <div class="mt-2 text-sm text-base-content/70">
      {selectedCommunityIds.length} community{selectedCommunityIds.length > 1 ? 'ies' : ''} selected
    </div>
  {/if}
</div>
