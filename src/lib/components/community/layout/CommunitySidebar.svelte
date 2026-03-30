<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { PlusIcon, DashboardIcon } from '$lib/components/icons';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';

  let { currentCommunityId, onCommunitySelect, isDashboardActive = false, onHomeSelect } = $props();

  const getJoinedCommunities = useJoinedCommunitiesList();
  const joinedCommunities = $derived(getJoinedCommunities());

  // Create non-mutating copy to avoid Svelte 5 state mutation error
  const sortedCommunities = $derived([...joinedCommunities]);

  /**
   * Handle community selection - uses route-based navigation
   * @param {string} pubkey
   */
  function handleCommunityClick(pubkey) {
    if (onCommunitySelect) {
      onCommunitySelect(pubkey);
    }
  }

  function handleCreateCommunity() {
    modalStore.openModal('createCommunity');
  }
</script>

<!-- Desktop: Fixed left sidebar -->
<div
  class="fixed top-16 left-0 hidden h-[calc(100vh-8rem)] w-16 flex-col overflow-x-hidden overflow-y-auto border-r border-base-300 bg-base-200 lg:flex"
>
  <div class="flex flex-col items-center space-y-3 py-4">
    <!-- Home button -->
    <div class="tooltip tooltip-right" data-tip={m.dashboard_home_tooltip()}>
      <button
        onclick={() => onHomeSelect?.()}
        class="btn btn-circle h-12 w-12 p-0 btn-ghost transition-transform duration-200 hover:scale-110 {isDashboardActive
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200'
          : ''}"
      >
        <DashboardIcon class_="w-6 h-6" />
      </button>
    </div>
    <div class="w-8 border-b border-base-300"></div>

    {#each sortedCommunities as communityPubKey (communityPubKey)}
      {@const getCommunityProfile = useUserProfile(communityPubKey)}
      {@const communityProfile = getCommunityProfile()}
      {@const isActive = !isDashboardActive && currentCommunityId === communityPubKey}

      <div class="tooltip tooltip-right" data-tip={getDisplayName(communityProfile)}>
        <button
          onclick={() => handleCommunityClick(communityPubKey)}
          class="btn btn-circle h-12 w-12 p-0 btn-ghost transition-transform duration-200 hover:scale-110 {isActive
            ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200'
            : ''}"
        >
          <div class="avatar">
            <div class="h-12 w-12 rounded-full">
              <img
                src={getProfilePicture(communityProfile) ||
                  `https://robohash.org/${communityPubKey}`}
                alt={getDisplayName(communityProfile)}
                class="rounded-full object-cover"
                onerror={(e) => {
                  const img = /** @type {HTMLImageElement} */ (/** @type {unknown} */ (e.target));
                  if (img) img.src = `https://robohash.org/${communityPubKey}`;
                }}
              />
            </div>
          </div>
        </button>
      </div>
    {/each}
  </div>

  <!-- Spacer to push buttons to bottom -->
  <div class="flex-1"></div>

  <!-- Action Buttons -->
  <div class="flex flex-col items-center gap-2 border-t border-base-300 py-3">
    <!-- Discover Communities Button -->
    <div class="tooltip tooltip-right" data-tip={m.community_layout_sidebar_discover_communities()}>
      <a
        href={resolve('/discover?type=communities')}
        class="btn btn-circle h-10 w-10 btn-ghost btn-sm"
        aria-label={m.community_layout_sidebar_discover_communities()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </a>
    </div>

    <!-- Create Community Button -->
    <div class="tooltip tooltip-right" data-tip={m.community_layout_sidebar_create_community()}>
      <button onclick={handleCreateCommunity} class="btn btn-circle h-10 w-10 btn-sm btn-primary">
        <PlusIcon class_="w-5 h-5" />
      </button>
    </div>
  </div>
</div>

<!-- Mobile: Drawer content (will be used inside drawer in AppLayout) -->
<div class="flex h-full w-full flex-col bg-base-200 lg:hidden">
  <div class="border-b border-base-300 p-4">
    <h2 class="text-lg font-semibold">{m.community_layout_sidebar_title()}</h2>
  </div>

  <div class="flex-1 space-y-2 overflow-y-auto p-4">
    <!-- Home button -->
    <button
      onclick={() => onHomeSelect?.()}
      class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 {isDashboardActive
        ? 'bg-primary text-primary-content'
        : 'hover:bg-base-300'}"
    >
      <DashboardIcon class_="w-5 h-5" />
      <span class="flex-1 truncate text-left text-sm font-medium">
        {m.dashboard_home_tooltip()}
      </span>
    </button>
    <div class="border-b border-base-300"></div>

    {#each sortedCommunities as communityPubKey (communityPubKey)}
      {@const getCommunityProfile = useUserProfile(communityPubKey)}
      {@const communityProfile = getCommunityProfile()}
      {@const isActive = !isDashboardActive && currentCommunityId === communityPubKey}

      <button
        onclick={() => handleCommunityClick(communityPubKey)}
        class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 {isActive
          ? 'bg-primary text-primary-content'
          : 'hover:bg-base-300'}"
      >
        <div class="avatar">
          <div class="h-10 w-10 rounded-full">
            <img
              src={getProfilePicture(communityProfile) || `https://robohash.org/${communityPubKey}`}
              alt={getDisplayName(communityProfile)}
              class="rounded-full object-cover"
              onerror={(e) => {
                const img = /** @type {HTMLImageElement} */ (/** @type {unknown} */ (e.target));
                if (img) img.src = `https://robohash.org/${communityPubKey}`;
              }}
            />
          </div>
        </div>
        <span class="font-community flex-1 truncate text-left text-sm font-medium">
          {getDisplayName(communityProfile)}
        </span>
      </button>
    {/each}

    {#if joinedCommunities.length === 0}
      <div class="py-8 text-center text-base-content/60">
        <p class="mb-3 text-sm">{m.community_layout_sidebar_no_communities()}</p>
        <a href={resolve('/discover?type=communities')} class="btn btn-sm btn-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {m.community_layout_sidebar_discover_button()}
        </a>
      </div>
    {/if}
  </div>

  <!-- Action Buttons -->
  <div class="space-y-2 border-t border-base-300 p-4">
    <a href={resolve('/discover?type=communities')} class="btn w-full gap-2 btn-outline">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {m.community_layout_sidebar_discover_button()}
    </a>
    <button onclick={handleCreateCommunity} class="btn w-full btn-primary">
      <PlusIcon class_="w-5 h-5" />
      {m.community_layout_sidebar_create_button()}
    </button>
  </div>
</div>
