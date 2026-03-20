<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { joinCommunity } from '$lib/helpers/community';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { communityId, communikeyEvent, profileEvent, onNavigateToAbout } = $props();

  const getJoined = useCommunityMembership(() => communityId);

  let isJoining = $state(false);

  async function handleJoin() {
    if (isJoining) return;
    isJoining = true;
    try {
      const result = await joinCommunity(communityId);
      if (result.success) {
        showToast(m.communikey_header_join_button() + ' ✓', 'success');
      } else {
        showToast(result.error || 'Failed to join', 'error');
      }
    } catch {
      showToast('An error occurred', 'error');
    } finally {
      isJoining = false;
    }
  }

  let displayName = $derived(getDisplayName(profileEvent) || 'Community');
  let avatarUrl = $derived(getProfilePicture(profileEvent));
  let bannerUrl = $derived(profileEvent?.banner || null);
  let description = $derived(communikeyEvent?.content || '');
</script>

<!-- Banner -->
<div class="relative overflow-hidden rounded-t-xl">
  {#if bannerUrl}
    <div class="h-20 md:h-24">
      <img
        src={bannerUrl}
        alt=""
        class="h-full w-full object-cover"
        onerror={(e) => {
          const img = /** @type {HTMLImageElement} */ (/** @type {unknown} */ (e.target));
          if (img) img.style.display = 'none';
        }}
      />
    </div>
  {:else}
    <div class="h-20 bg-gradient-to-r from-primary/20 to-secondary/20 md:h-24"></div>
  {/if}
</div>

<!-- Identity Section -->
<div class="px-4 pb-4">
  <div class="-mt-6 flex items-start gap-3">
    <!-- Avatar -->
    <div class="avatar">
      <div class="w-14 rounded-full ring-2 ring-base-100 md:w-12">
        {#if avatarUrl}
          <img src={avatarUrl} alt={displayName} class="object-cover" />
        {:else}
          <div
            class="flex h-full w-full items-center justify-center bg-primary/20 text-lg font-bold text-primary"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        {/if}
      </div>
    </div>

    <!-- Name + Meta -->
    <div class="mt-7 min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h2 class="truncate text-lg font-bold text-base-content">{displayName}</h2>
        {#if getJoined()}
          <div class="badge gap-1 badge-sm badge-success">
            <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clip-rule="evenodd"
              />
            </svg>
            {m.communikey_header_joined_badge()}
          </div>
        {/if}
      </div>
    </div>

    <!-- Join Button (non-members) -->
    {#if !getJoined()}
      <div class="mt-7">
        <button onclick={handleJoin} disabled={isJoining} class="btn btn-sm btn-primary">
          {#if isJoining}
            <span class="loading loading-xs loading-spinner"></span>
          {:else}
            {m.communikey_header_join_button()}
          {/if}
        </button>
      </div>
    {/if}
  </div>

  <!-- Description (truncated) -->
  {#if description}
    <p class="mt-2 line-clamp-2 text-sm text-base-content/70 lg:line-clamp-1">
      {description}
    </p>
    {#if description.length > 100 && onNavigateToAbout}
      <button onclick={onNavigateToAbout} class="mt-1 text-sm text-primary hover:underline">
        {m.community_profile_hero_more()}
      </button>
    {/if}
  {/if}
</div>
