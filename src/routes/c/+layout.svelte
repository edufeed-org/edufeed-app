<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { setContext } from 'svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { buildCommunityPath } from '$lib/helpers/communityNavigation.js';
  import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';
  import { MenuIcon, CloseIcon } from '$lib/components/icons';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ children: import('svelte').Snippet }} */
  let { children } = $props();

  const activeUser = useActiveUser();

  let leftDrawerOpen = $state(false);

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
</script>

<!-- Desktop Layout -->
{#if activeUser()}
  <div class="hidden h-[calc(100vh-8rem)] lg:flex">
    <CommunitySidebar
      currentCommunityId={currentCommunityPubkey}
      {isDashboardActive}
      onCommunitySelect={handleCommunitySelect}
      onHomeSelect={handleHomeSelect}
    />
    {@render children()}
  </div>
{:else}
  <div class="hidden h-[calc(100vh-8rem)] lg:flex">
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
      <div class="drawer-content flex h-[calc(100vh-8rem)] flex-col pt-16">
        <!-- Mobile Header with Menu Button -->
        <div class="flex items-center justify-between border-b border-base-300 bg-base-200 p-4">
          <button onclick={toggleDrawer} class="btn btn-circle btn-ghost">
            <MenuIcon class_="w-6 h-6" />
          </button>

          {#if mobileHeaderAvatarUrl && !isDashboardActive}
            <div class="mx-3 flex min-w-0 flex-1 items-center gap-2">
              <div class="avatar">
                <div class="w-8 rounded-full ring-1 ring-base-300">
                  <img src={mobileHeaderAvatarUrl} alt={mobileHeaderTitle} class="object-cover" />
                </div>
              </div>
              <h1 class="truncate text-base font-semibold text-base-content">
                {mobileHeaderTitle}
              </h1>
            </div>
          {:else}
            <h1 class="text-lg font-semibold">
              {isDashboardActive ? runtimeConfig.appName : mobileHeaderTitle}
            </h1>
          {/if}

          <div class="w-10"></div>
        </div>

        <!-- Main Content (child layout renders here) -->
        <div class="flex-1 overflow-auto">
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
          <div class="h-[calc(100vh-8rem)] overflow-y-auto">
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
  <div class="flex h-[calc(100vh-8rem)] flex-col pt-16 lg:hidden">
    {@render children()}
  </div>
{/if}
