<!--
  CommunitySelector Component
  Reusable component for selecting communities to share events with
-->

<script>
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Community
   * @property {string} pubkey - Community pubkey
   * @property {string} [name] - Community name
   */

  let {
    communities = [],
    selectedCommunityIds = $bindable([]),
    communitiesWithShares = new Set(),
    // Communities where the caller knows the share would never render
    // (profile-list-gated section, user not listed) — drawn disabled.
    restrictedCommunities = /** @type {Set<string>} */ (new Set()),
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

  // Selection entries the selector doesn't render (e.g. h-tags of communities
  // the user hasn't joined, pre-selected when editing) must survive the bulk
  // actions — replacing them would silently un-share the event there.
  function hiddenSelections() {
    return selectedCommunityIds.filter((id) => !communities.includes(id));
  }

  /**
   * Select all communities that don't already have shares
   */
  function selectAllCommunities() {
    const availableCommunities = communities.filter(
      (pubkey) => pubkey && !communitiesWithShares.has(pubkey) && !restrictedCommunities.has(pubkey)
    );
    selectedCommunityIds = [...new Set([...hiddenSelections(), ...availableCommunities])];
  }

  /**
   * Deselect all communities
   */
  function deselectAllCommunities() {
    selectedCommunityIds = hiddenSelections();
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
          {m.community_selector_select_all()}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={deselectAllCommunities}
          disabled={selectedCommunityIds.length === 0}
        >
          {m.community_selector_deselect_all()}
        </button>
      </div>
    {/if}
  </div>

  <!-- Community Checkboxes -->
  <div class="max-h-40 overflow-y-auto rounded-lg border border-base-300 p-3">
    {#each communities as communityPubKey (communityPubKey)}
      {@const isAlreadyShared = communitiesWithShares.has(communityPubKey)}
      {@const isSelected = selectedCommunityIds.includes(communityPubKey)}
      {@const isRestricted = restrictedCommunities.has(communityPubKey)}
      {@const getCommunityProfile = useUserProfile(communityPubKey)}
      {@const communityProfile = getCommunityProfile()}
      <label
        class="flex items-center gap-3 rounded p-2 {isRestricted
          ? 'opacity-50'
          : 'cursor-pointer hover:bg-base-200'}"
        title={isRestricted ? m.share_restricted_hint() : undefined}
      >
        <input
          type="checkbox"
          class="checkbox checkbox-secondary"
          checked={isSelected || isAlreadyShared}
          disabled={isRestricted}
          onchange={() => toggleCommunitySelection(communityPubKey)}
        />
        <div class="flex-1">
          <span class="text-sm font-medium">
            {getDisplayName(communityProfile) ||
              `${communityPubKey.slice(0, 8)}...${communityPubKey.slice(-4)}`}
          </span>
        </div>
        {#if isRestricted}
          <span class="text-xs text-base-content/60" data-testid="share-restricted-badge"
            >🔒 {m.share_restricted_label()}</span
          >
        {/if}
        {#if isAlreadyShared && !isSelected}
          <span class="text-xs font-medium text-success">{m.community_selector_shared()}</span>
        {:else if isAlreadyShared && isSelected}
          <span class="text-xs font-medium text-warning">{m.community_selector_will_unshare()}</span
          >
        {:else if isSelected}
          <span class="text-xs font-medium text-info">{m.community_selector_will_share()}</span>
        {/if}
      </label>
    {/each}
    {#if communities.length === 0}
      <div class="py-4 text-center text-base-content/60">
        {m.community_selector_no_communities()}
      </div>
    {/if}
  </div>

  <!-- Selected Communities Summary -->
  {#if selectedCommunityIds.length > 0}
    <div class="mt-2 text-sm text-base-content/70">
      {m.community_selector_count({ count: String(selectedCommunityIds.length) })}
    </div>
  {/if}
</div>
