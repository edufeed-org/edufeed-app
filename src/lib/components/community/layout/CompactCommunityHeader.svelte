<script>
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {any} communityProfile - Community profile data with name, avatar, etc.
   * @property {string} communityPubkey - Community pubkey for membership status
   * @property {boolean} [hideJoinedBadge] - Optional: Hide the "Joined" badge
   */

  /** @type {Props} */
  let { communityProfile, communityPubkey, hideJoinedBadge = false } = $props();

  // Use the reusable community membership hook with reactive pubkey getter
  const getJoined = useCommunityMembership(() => communityPubkey);

  // Derive display name and avatar
  let displayName = $derived(
    communityProfile?.name || communityProfile?.display_name || 'Community'
  );

  let avatarUrl = $derived(getProfilePicture(communityProfile));
</script>

<div class="flex items-center gap-3 bg-base-200 px-4 py-3">
  <!-- Community Avatar -->
  <div class="avatar">
    <div class="w-10 rounded-full ring-2 ring-base-300">
      <ImageWithFallback
        src={avatarUrl || `https://robohash.org/${communityPubkey}`}
        alt={displayName}
        fallbackType="community"
        class="h-full w-full object-cover"
      />
    </div>
  </div>

  <!-- Community Name -->
  <div class="min-w-0 flex-1">
    <h2 class="font-community truncate text-sm font-semibold text-base-content">
      {displayName}
    </h2>
  </div>

  <!-- Joined Badge (optional) -->
  {#if !hideJoinedBadge && getJoined()}
    <div class="badge gap-1 badge-sm badge-success">
      <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fill-rule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clip-rule="evenodd"
        />
      </svg>
      {m.community_layout_compact_header_joined_badge()}
    </div>
  {/if}
</div>
