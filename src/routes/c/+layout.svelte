<script>
  import { goto, beforeNavigate, afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { getContext, setContext } from 'svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { buildCommunityPath } from '$lib/helpers/communityNavigation.js';
  import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';
  import MobileNavMenu from '$lib/components/shared/MobileNavMenu.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { MenuIcon, CloseIcon, ChevronRightIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ children: import('svelte').Snippet }} */
  let { children } = $props();

  const activeUser = useActiveUser();
  const hasWorkspaceShell = getContext('workspaceShell');

  let leftDrawerOpen = $state(false);

  // Scroll restoration for custom scroll containers (SvelteKit only restores window scroll)
  /** @type {HTMLDivElement | undefined} */
  let desktopScrollContainer = $state(undefined);
  /** @type {HTMLDivElement | undefined} */
  let mobileScrollContainer = $state(undefined);
  /** @type {Map<string, number>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive state, only used in navigation callbacks
  const scrollPositions = new Map();

  // Feed state cache: preserves display limit + filters across back-navigation
  const feedStateCache = new Map();
  setContext('feedStateCache', feedStateCache);

  beforeNavigate(({ from }) => {
    if (!from?.url) return;
    const key = from.url.pathname + from.url.search;
    const container = desktopScrollContainer ?? mobileScrollContainer;
    if (container) {
      scrollPositions.set(key, container.scrollTop);
    }
  });

  afterNavigate(({ to }) => {
    if (!to?.url) return;
    const key = to.url.pathname + to.url.search;
    const saved = scrollPositions.get(key);
    if (saved == null) return;

    // Wait for DOM to populate from EventStore cache before restoring
    requestAnimationFrame(() => {
      const container = desktopScrollContainer ?? mobileScrollContainer;
      if (container) {
        container.scrollTop = saved;
      }
    });
  });

  // Mobile header info — child layouts can update this via context
  let mobileHeaderTitle = $state(runtimeConfig.appName);
  let mobileHeaderAvatarUrl = $state(/** @type {string | null} */ (null));

  // Detect mode from route params
  let currentCommunityPubkey = $derived($page.params.pubkey ? $page.data?.pubkey : null);
  let isDashboardActive = $derived(!currentCommunityPubkey);

  /**
   * Handle community selection from sidebar
   * @param {string} pubkey
   */
  function handleCommunitySelect(pubkey) {
    const npub = hexToNpub(pubkey);
    if (npub) {
      goto(resolve(/** @type {any} */ (buildCommunityPath(npub, $page.url.searchParams))));
    }
    leftDrawerOpen = false;
  }

  function handleHomeSelect() {
    goto(resolve('/c/'));
    leftDrawerOpen = false;
  }

  function toggleDrawer() {
    leftDrawerOpen = !leftDrawerOpen;
  }

  // Provide context for child layouts to update mobile header
  setContext(
    'setMobileHeader',
    (/** @type {{ title: string, avatarUrl?: string | null }} */ info) => {
      mobileHeaderTitle = info.title;
      mobileHeaderAvatarUrl = info.avatarUrl ?? null;
    }
  );

  // Provide toggleDrawer for child layouts if needed
  setContext('toggleDrawer', toggleDrawer);

  function closeDropdown() {
    const dropdownTrigger = /** @type {HTMLElement} */ (document.activeElement);
    if (dropdownTrigger && dropdownTrigger.closest('.dropdown')) {
      dropdownTrigger.blur();
    }
  }
</script>

<!-- Desktop Layout -->
{#if activeUser()}
  <div class="hidden h-[calc(100vh-8rem)] overflow-auto lg:flex" bind:this={desktopScrollContainer}>
    {#if !hasWorkspaceShell}
      <CommunitySidebar
        currentCommunityId={currentCommunityPubkey}
        {isDashboardActive}
        onCommunitySelect={handleCommunitySelect}
        onHomeSelect={handleHomeSelect}
      />
    {/if}
    {@render children()}
  </div>
{:else}
  <div class="hidden h-[calc(100vh-8rem)] overflow-auto lg:flex" bind:this={desktopScrollContainer}>
    {@render children()}
  </div>
{/if}

<!-- Mobile Layout -->
{#if activeUser()}
  <div class="lg:hidden">
    <div class="drawer">
      <input
        id="community-drawer"
        type="checkbox"
        class="drawer-toggle"
        bind:checked={leftDrawerOpen}
      />
      <div class="drawer-content flex h-dvh flex-col">
        <!-- Unified Mobile Header -->
        <div class="flex items-center justify-between border-b border-base-300 bg-base-200 p-4">
          <!-- Left: Community avatar / App logo + chevron → opens drawer -->
          <button onclick={toggleDrawer} class="btn gap-0 rounded-full px-1 btn-ghost">
            {#if isDashboardActive}
              <div class="avatar">
                <div class="w-8 rounded-full">
                  <img
                    src={runtimeConfig.appLogo}
                    alt={m.community_layout_title()}
                    class="object-cover"
                  />
                </div>
              </div>
            {:else if mobileHeaderAvatarUrl}
              <div class="avatar">
                <div class="w-8 rounded-full ring-1 ring-base-300">
                  <ImageWithFallback
                    src={mobileHeaderAvatarUrl}
                    alt={mobileHeaderTitle || ''}
                    size="avatar_sm"
                    class="h-full w-full rounded-full object-cover"
                  />
                </div>
              </div>
            {:else}
              <MenuIcon class_="w-6 h-6" />
            {/if}
            <ChevronRightIcon class_="w-4 h-4 opacity-50" />
          </button>

          <!-- Center: Community name / App name -->
          <h1 class="min-w-0 flex-1 truncate text-center text-base font-semibold">
            {isDashboardActive ? runtimeConfig.appName : mobileHeaderTitle}
          </h1>

          <!-- Right: User avatar → global nav dropdown -->
          {#if activeUser()}
            <div class="dropdown dropdown-end">
              <div tabindex="0" role="button" class="btn btn-circle btn-ghost">
                <ProfileAvatar pubkey={activeUser().pubkey} size="sm" fallbackType="robohash" />
              </div>
              <ul
                class="dropdown-content menu z-[60] mt-3 w-56 rounded-box bg-base-100 p-2 shadow-lg"
              >
                <MobileNavMenu onClose={closeDropdown} />
              </ul>
            </div>
          {:else}
            <div class="w-10"></div>
          {/if}
        </div>

        <!-- Main Content (child layout renders here) -->
        <div class="flex-1 overflow-auto" bind:this={mobileScrollContainer}>
          {@render children()}
        </div>
      </div>

      <!-- Drawer Side (Community List) -->
      <div class="drawer-side z-50">
        <label
          for="community-drawer"
          aria-label={m.community_layout_close_sidebar()}
          class="drawer-overlay"
        ></label>
        <div class="min-h-full w-80 bg-base-200">
          <div class="flex items-center justify-between border-b border-base-300 p-4">
            <h2 class="text-lg font-semibold">{m.community_layout_title()}</h2>
            <button onclick={toggleDrawer} class="btn btn-circle btn-ghost btn-sm">
              <CloseIcon class_="w-5 h-5" />
            </button>
          </div>
          <div class="h-[calc(100dvh-4rem)] overflow-y-auto">
            <CommunitySidebar
              currentCommunityId={currentCommunityPubkey}
              {isDashboardActive}
              onCommunitySelect={handleCommunitySelect}
              onHomeSelect={handleHomeSelect}
            />
          </div>
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="flex h-[calc(100vh-4rem)] flex-col lg:hidden">
    {@render children()}
  </div>
{/if}
