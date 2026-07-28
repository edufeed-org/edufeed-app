<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  // Directly from the concord submodule, never the $lib/concord barrel —
  // convention every Concord call site follows (see CLAUDE.md's Concord
  // section) so this stays SSR-clean.
  import {
    useUnlinkedConcordAreas,
    useConcordListLocked
  } from '$lib/concord/unlinked-areas.svelte.js';
  import { getConcordState, unlockConcordLists } from '$lib/concord/client.svelte.js';
  import { areaUnreadState } from '$lib/concord/notifications.svelte.js';
  import { HomeIcon, LockOpenIcon, ChevronDownIcon } from '$lib/components/icons';
  import { resolve } from '$app/paths';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  let { currentCommunityId, onCommunitySelect, isDashboardActive = false, onHomeSelect } = $props();

  const getJoinedCommunities = useJoinedCommunitiesList();
  const joinedCommunities = $derived(getJoinedCommunities());

  // Create non-mutating copy to avoid Svelte 5 state mutation error
  const sortedCommunities = $derived([...joinedCommunities]);

  const getUnlinkedAreas = useUnlinkedConcordAreas();
  const unlinkedAreas = $derived(
    runtimeConfig.concord?.enabled ? getUnlinkedAreas() : /** @type {any[]} */ ([])
  );

  // "Sync private areas" affordance (Fix 2) — see the matching comment in
  // Sidebar.svelte for the full rationale. Shown even with zero unlinked
  // areas: a locked list is exactly why the list looks empty.
  const getListLocked = useConcordListLocked();
  const listLocked = $derived(runtimeConfig.concord?.enabled ? getListLocked() : false);
  const concordReady = $derived(getConcordState().phase === 'ready');
  const signerHasNip44 = $derived(!!getConcordState().client?.signer?.nip44);
  const unlocking = $derived(getConcordState().unlocking);
  const showUnlockAffordance = $derived(
    runtimeConfig.concord?.enabled && concordReady && listLocked
  );

  async function handleUnlockAreas() {
    const ok = await unlockConcordLists();
    if (!ok) showToast(m.concord_unlock_failed(), 'error');
  }

  /**
   * Handle community selection - uses route-based navigation
   * @param {string} pubkey
   */
  function handleCommunityClick(pubkey) {
    if (onCommunitySelect) {
      onCommunitySelect(pubkey);
    }
  }

  // Scroll affordance for the hidden-scrollbar rail (design page "Rail Fix"):
  // edge fades + a chevron appear only while more content exists in that
  // direction. `railEl` is $state so the effect below re-runs once bind:this
  // lands (project gotcha: bind:this as DOM-ready signal).
  /** @type {HTMLElement | undefined} */
  let railEl = $state();
  let canScrollUp = $state(false);
  let canScrollDown = $state(false);

  function updateScrollHints() {
    if (!railEl) return;
    canScrollUp = railEl.scrollTop > 4;
    canScrollDown = railEl.scrollTop + railEl.clientHeight < railEl.scrollHeight - 4;
  }

  $effect(() => {
    // Read list lengths first so the effect re-runs when entries are added or
    // removed (avatars/areas loading in changes scrollHeight without a scroll
    // or resize event).
    void sortedCommunities.length;
    void unlinkedAreas.length;
    const el = railEl;
    if (!el) return;
    updateScrollHints();
    const observer = new ResizeObserver(updateScrollHints);
    observer.observe(el);
    return () => observer.disconnect();
  });
</script>

<!-- Desktop: Flex sibling in chrome row -->
<div
  data-testid="community-sidebar"
  class="scrollbar-none hidden w-(--sidebar-icon-w) flex-col overflow-x-hidden overflow-y-auto bg-base-200 lg:flex"
  bind:this={railEl}
  onscroll={updateScrollHints}
>
  <!-- Sticky edge fades: pinned to the visible top/bottom of the scroll
    container, negative margins keep them out of the layout flow. They replace
    the (hidden) scrollbar as the "there is more" signal. -->
  <div
    class="pointer-events-none sticky top-0 z-10 -mb-7 h-7 shrink-0 bg-gradient-to-b from-base-200 to-transparent transition-opacity duration-200 {canScrollUp
      ? 'opacity-100'
      : 'opacity-0'}"
  ></div>
  <div class="flex flex-col items-center space-y-3 py-4">
    <!-- Home button -->
    <div class="tooltip tooltip-right" data-tip={m.dashboard_home_tooltip()}>
      <button
        onclick={() => onHomeSelect?.()}
        class="btn btn-circle h-12 w-12 p-0 btn-ghost transition-transform duration-200 hover:scale-110 {isDashboardActive
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200'
          : ''}"
      >
        <HomeIcon class_="w-6 h-6" />
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
              <ImageWithFallback
                src={getProfilePicture(communityProfile) ||
                  `https://robohash.org/${communityPubKey}`}
                alt={getDisplayName(communityProfile)}
                fallbackType="community"
                class="h-full w-full rounded-full object-cover"
              />
            </div>
          </div>
        </button>
      </div>
    {/each}

    {#if unlinkedAreas.length > 0 || showUnlockAffordance}
      <!-- Aligned one-rail model (design spec 2026-07-28): unlinked areas flow
        directly after the communities at the same size — the badge's corner
        lock chip carries the distinction, not a separate divider/section.
        Only the unlock TOOL keeps a divider, since it's an action, not an
        entry. -->
      {#if showUnlockAffordance}
        <div class="w-8 border-b border-base-300"></div>
        <div
          class="tooltip tooltip-right"
          data-tip={signerHasNip44 ? m.concord_unlock_areas() : m.concord_direct_needs_nip44()}
        >
          <button
            class="btn btn-circle h-12 w-12 p-0 btn-ghost transition-transform duration-200 hover:scale-110"
            data-testid="concord_unlock_areas"
            disabled={!signerHasNip44 || unlocking}
            onclick={handleUnlockAreas}
          >
            {#if unlocking}
              <span class="loading loading-sm loading-spinner"></span>
            {:else}
              <LockOpenIcon class_="h-5 w-5" />
            {/if}
          </button>
        </div>
      {/if}
      {#each unlinkedAreas as area (area.communityId)}
        {@const areaFlags = areaUnreadState(area.communityId)}
        <div
          class="tooltip tooltip-right"
          data-tip="{area.name} · {m.concord_sidebar_area_tooltip()}"
        >
          <a
            href={resolve(`/private/${area.communityId}`)}
            class="btn btn-circle h-12 w-12 p-0 btn-ghost transition-transform duration-200 hover:scale-110 {area.dissolved
              ? 'opacity-50'
              : ''}"
          >
            <span class="relative shrink-0">
              <ConcordAreaBadge
                name={area.name}
                communityId={area.communityId}
                iconPointer={area.iconPointer}
                class="h-12 w-12"
              />
              <span class="absolute -top-0.5 -right-0.5">
                <ConcordUnreadDot unread={areaFlags.unread} mentioned={areaFlags.mentioned} />
              </span>
            </span>
          </a>
        </div>
      {/each}
    {/if}
  </div>
  <div
    class="pointer-events-none sticky bottom-0 z-10 -mt-7 flex h-7 shrink-0 items-end justify-center bg-gradient-to-t from-base-200 to-transparent transition-opacity duration-200 {canScrollDown
      ? 'opacity-100'
      : 'opacity-0'}"
  >
    <ChevronDownIcon class_="h-3.5 w-3.5 text-base-content/50" />
  </div>
</div>

<!-- Mobile: Drawer content (will be used inside drawer in AppLayout) -->
<div class="flex h-full w-full flex-col bg-base-200 lg:hidden">
  <div class="flex-1 space-y-2 overflow-y-auto p-4">
    <!-- Home button -->
    <button
      onclick={() => onHomeSelect?.()}
      class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 {isDashboardActive
        ? 'bg-primary text-primary-content'
        : 'hover:bg-base-300'}"
    >
      <HomeIcon class_="w-5 h-5" />
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
            <ImageWithFallback
              src={getProfilePicture(communityProfile) || `https://robohash.org/${communityPubKey}`}
              alt={getDisplayName(communityProfile)}
              fallbackType="community"
              class="h-full w-full rounded-full object-cover"
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

    {#if unlinkedAreas.length > 0 || showUnlockAffordance}
      <div class="border-b border-base-300"></div>
      <p class="px-3 pt-1 text-xs font-semibold tracking-wider text-base-content/50 uppercase">
        {m.concord_sidebar_private_areas()}
      </p>
      {#if showUnlockAffordance}
        <button
          class="btn btn-block gap-2 btn-outline btn-sm"
          data-testid="concord_unlock_areas"
          disabled={!signerHasNip44 || unlocking}
          title={signerHasNip44 ? undefined : m.concord_direct_needs_nip44()}
          onclick={handleUnlockAreas}
        >
          {#if unlocking}
            <span class="loading loading-xs loading-spinner"></span>
          {:else}
            <LockOpenIcon class_="h-4 w-4" />
          {/if}
          {m.concord_unlock_areas()}
        </button>
      {/if}
      {#each unlinkedAreas as area (area.communityId)}
        {@const areaFlags = areaUnreadState(area.communityId)}
        <a
          href={resolve(`/private/${area.communityId}`)}
          class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 hover:bg-base-300 {area.dissolved
            ? 'opacity-50'
            : ''}"
        >
          <span class="relative shrink-0">
            <ConcordAreaBadge
              name={area.name}
              communityId={area.communityId}
              iconPointer={area.iconPointer}
              class="h-8 w-8 shrink-0"
            />
            <span class="absolute -top-0.5 -right-0.5">
              <ConcordUnreadDot unread={areaFlags.unread} mentioned={areaFlags.mentioned} />
            </span>
          </span>
          <span class="flex-1 truncate text-left text-sm font-medium">{area.name}</span>
        </a>
      {/each}
    {/if}
  </div>
</div>
