<script>
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { useCommunityMembership } from '$lib/stores/joined-communities-list.svelte.js';
  import { joinCommunity as joinCommunityHelper } from '$lib/helpers/community';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let { profile, communikeyEvent, communikeyContentTypes, activeTab, onTabChange } = $props();

  // Use the reusable community membership hook with reactive pubkey getter
  const getJoined = useCommunityMembership(() => communikeyEvent?.pubkey);

  // Scroll indicator state (same pattern as BottomTabBar)
  let tabScrollContainer = $state(/** @type {HTMLElement|null} */ (null));
  let showLeftScroll = $state(false);
  let showRightScroll = $state(false);

  /**
   * Check scroll position and update indicators
   */
  function updateScrollIndicators() {
    if (!tabScrollContainer) return;
    const { scrollLeft, scrollWidth, clientWidth } = tabScrollContainer;
    showLeftScroll = scrollLeft > 10;
    showRightScroll = scrollLeft < scrollWidth - clientWidth - 10;
  }

  /**
   * Scroll the tabs left or right
   * @param {'left'|'right'} direction
   */
  function scrollTabs(direction) {
    if (!tabScrollContainer) return;
    const scrollAmount = 150;
    tabScrollContainer.scrollTo({
      left: tabScrollContainer.scrollLeft + (direction === 'left' ? -scrollAmount : scrollAmount),
      behavior: 'smooth'
    });
  }

  onMount(() => {
    if (tabScrollContainer) {
      updateScrollIndicators();
      tabScrollContainer.addEventListener('scroll', updateScrollIndicators);
      window.addEventListener('resize', updateScrollIndicators);

      return () => {
        tabScrollContainer?.removeEventListener('scroll', updateScrollIndicators);
        window.removeEventListener('resize', updateScrollIndicators);
      };
    }
  });

  /**
   * Handle tab click
   * @param {number} kind - The content type kind number
   * @param {boolean} enabled - Whether the content type is enabled
   */
  function handleTabClick(kind, enabled) {
    if (enabled && onTabChange) {
      onTabChange(kind);
    }
  }

  /**
   * Join the community
   */
  async function joinCommunity() {
    const result = await joinCommunityHelper(communikeyEvent.pubkey);
    return result.success;
  }
</script>

<div class="rounded-xl border border-base-200 bg-base-100 shadow-sm">
  <!-- Top Section: Community Info -->
  <div class="flex items-center gap-2 p-3">
    <div class="avatar">
      <div class="mask w-12 mask-hexagon-2 ring-2 ring-base-300">
        <img
          src={getProfilePicture(profile)}
          alt={m.communikey_header_profile_alt()}
          class="object-cover"
        />
      </div>
    </div>

    <div class="min-w-0 flex-1">
      <h1 class="font-community truncate text-base font-bold text-base-content">{profile.name}</h1>
    </div>

    <div class="ml-auto flex items-center gap-2">
      {#if getJoined()}
        <div class="badge gap-1 badge-success">
          <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          {m.communikey_header_joined_badge()}
        </div>
      {:else}
        <div class="badge gap-1 badge-ghost">
          {m.communikey_header_not_joined_badge()}
        </div>
        <button onclick={joinCommunity} class="btn btn-sm btn-primary">
          {m.communikey_header_join_button()}
        </button>
      {/if}
    </div>
  </div>

  <!-- Bottom Section: Interactive Content Type Tabs -->
  {#if communikeyContentTypes?.length > 0}
    <div class="border-t border-base-200">
      <div class="relative">
        <!-- Left scroll indicator -->
        {#if showLeftScroll}
          <button
            onclick={() => scrollTabs('left')}
            class="absolute top-0 bottom-0 left-0 z-10 flex w-8 items-center justify-start bg-gradient-to-r from-base-100 to-transparent pl-1"
            aria-label="Scroll tabs left"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        {/if}

        <!-- Right scroll indicator -->
        {#if showRightScroll}
          <button
            onclick={() => scrollTabs('right')}
            class="absolute top-0 right-0 bottom-0 z-10 flex w-8 items-center justify-end bg-gradient-to-l from-base-100 to-transparent pr-1"
            aria-label="Scroll tabs right"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        {/if}

        <div
          bind:this={tabScrollContainer}
          class="tabs-bordered scrollbar-hide tabs overflow-x-auto"
        >
          {#each communikeyContentTypes as contentType (contentType.kind)}
            <button
              class="tab-bordered tab {activeTab === contentType.kind
                ? 'tab-active'
                : ''} {!contentType.enabled ? 'cursor-not-allowed opacity-50' : ''}"
              onclick={() => handleTabClick(contentType.kind, contentType.enabled)}
              disabled={!contentType.enabled}
              title={contentType.description}
            >
              <svg class="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d={contentType.icon}
                />
              </svg>
              {contentType.name}
              {#if !contentType.enabled}
                <span class="ml-1 text-xs">🔒</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>
