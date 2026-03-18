<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';
  import ContentNavSidebar from '$lib/components/community/layout/ContentNavSidebar.svelte';
  import BottomTabBar from '$lib/components/community/layout/BottomTabBar.svelte';
  import { MenuIcon, CloseIcon } from '$lib/components/icons';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { ProfileModel } from 'applesauce-core/models';
  import { profileLoader } from '$lib/loaders/profile.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getProfilePicture } from 'applesauce-core/helpers';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';

  /** @type {{ data: any, children: import('svelte').Snippet }} */
  let { data, children } = $props();

  const activeUser = useActiveUser();

  // State management for content type navigation
  let selectedContentType = $state('home');
  let leftDrawerOpen = $state(false);
  let communikeyEvent = $state(/** @type {any} */ (null));
  let communityProfile = $state(/** @type {any} */ (null));

  // Valid content types for ?view= query param
  const validContentTypes = new Set([
    'home',
    'chat',
    'calendar',
    'learning',
    'boards',
    'articles',
    'forum',
    'wikis',
    'activity',
    'settings'
  ]);

  // Sync selectedContentType from child page data or ?view= param
  $effect(() => {
    // Child pages can set contentView in their page data (e.g., nevent route sets 'forum')
    const childContentView = $page.data.contentView;
    if (childContentView && validContentTypes.has(childContentView)) {
      selectedContentType = childContentView;
      return;
    }

    // Fall back to ?view= query param
    const viewParam = $page.url.searchParams.get('view');
    if (viewParam && validContentTypes.has(viewParam)) {
      selectedContentType = viewParam;
    } else {
      // Default to 'home' when no contentView or ?view= param
      selectedContentType = 'home';
    }
  });

  // Load community's kind:10222 event for content type configuration
  $effect(() => {
    if (data.pubkey) {
      const pointer = {
        kind: 10222,
        pubkey: data.pubkey
      };

      // Fetch from relays so 10222 is available for all child pages
      // (e.g., thread loader needs community relays from 10222)
      const loaderSub = addressLoader({
        ...pointer,
        relays: getCommunikeyRelays()
      }).subscribe();

      const sub = eventStore.replaceable(pointer).subscribe((event) => {
        communikeyEvent = event || null;
      });

      return () => {
        loaderSub.unsubscribe();
        sub.unsubscribe();
      };
    } else {
      communikeyEvent = null;
    }
  });

  // Pre-warm community relays when community event is loaded
  $effect(() => {
    if (communikeyEvent) {
      import('$lib/services/relay-warming-service.svelte.js').then(({ warmCommunityRelays }) => {
        const signer = activeUser()?.signer || null;
        warmCommunityRelays(communikeyEvent, signer);
      });
    }
  });

  // Load community profile for header display
  $effect(() => {
    // Reset profile when community changes
    communityProfile = null;

    if (data.pubkey) {
      // 1. Trigger loader to fetch profile from relays
      const loaderSub = profileLoader({
        kind: 0,
        pubkey: data.pubkey,
        relays: getCommunikeyRelays()
      }).subscribe(() => {
        // Loader automatically populates eventStore
      });

      // 2. Subscribe to model for reactive parsed profile from eventStore
      const modelSub = eventStore.model(ProfileModel, data.pubkey).subscribe((profileContent) => {
        communityProfile = profileContent;
      });

      // Cleanup subscriptions when community changes
      return () => {
        loaderSub.unsubscribe();
        modelSub.unsubscribe();
      };
    }
  });

  // Derive display name and avatar for mobile header
  let displayName = $derived(
    communityProfile?.name || communityProfile?.display_name || 'Community'
  );

  let avatarUrl = $derived(getProfilePicture(communityProfile));

  /**
   * Handle community selection from sidebar
   * @param {string} pubkey
   */
  function handleCommunitySelect(pubkey) {
    const npub = hexToNpub(pubkey);
    if (npub) {
      goto(resolve(`/c/${npub}`));
    }
    leftDrawerOpen = false; // Close drawer on mobile after selection
  }

  /**
   * Handle content type selection — navigates to community home with ?view= param
   * @param {string} type
   */
  function handleContentTypeSelect(type) {
    // Navigate to community home page with ?view= param
    const base = resolve(`/c/${data.npub}`);
    if (type === 'home') {
      goto(base);
    } else {
      goto(`${base}?view=${type}`);
    }
  }

  function toggleDrawer() {
    leftDrawerOpen = !leftDrawerOpen;
  }
</script>

<!-- Desktop Layout -->
{#if activeUser()}
  <!-- Logged-in: Show all three sidebars -->
  <div class="hidden h-[calc(100vh-8rem)] lg:flex">
    <CommunitySidebar currentCommunityId={data.pubkey} onCommunitySelect={handleCommunitySelect} />
    <ContentNavSidebar
      bind:selectedContentType
      onContentTypeSelect={handleContentTypeSelect}
      communitySelected={true}
      {communityProfile}
      communityPubkey={data.pubkey}
    />
    {@render children()}
  </div>
{:else}
  <!-- Logged-out: Just content nav + main -->
  <div class="hidden h-[calc(100vh-8rem)] lg:flex">
    <ContentNavSidebar
      bind:selectedContentType
      onContentTypeSelect={handleContentTypeSelect}
      communitySelected={true}
      {communityProfile}
      communityPubkey={data.pubkey}
    />
    {@render children()}
  </div>
{/if}

<!-- Mobile Layout -->
{#if activeUser()}
  <!-- Logged-in: Drawer + Bottom Tab Bar -->
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

          <!-- Community Identity -->
          {#if communityProfile}
            <div class="mx-3 flex min-w-0 flex-1 items-center gap-2">
              <div class="avatar">
                <div class="w-8 rounded-full ring-1 ring-base-300">
                  <img src={avatarUrl} alt={displayName} class="object-cover" />
                </div>
              </div>
              <h1 class="truncate text-base font-semibold text-base-content">
                {displayName}
              </h1>
            </div>
          {:else}
            <h1 class="text-lg font-semibold">{runtimeConfig.appName}</h1>
          {/if}

          <div class="w-10"></div>
          <!-- Spacer for balance -->
        </div>

        <!-- Main Content -->
        <div class="flex-1 overflow-auto">
          {@render children()}
        </div>

        <!-- Bottom Tab Bar -->
        <BottomTabBar
          bind:selectedContentType
          onContentTypeSelect={handleContentTypeSelect}
          communityEvent={communikeyEvent}
        />
      </div>

      <!-- Drawer Side (Community List) -->
      <div class="drawer-side z-50">
        <label for="community-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
        <div class="min-h-full w-80 bg-base-200">
          <!-- Drawer Header -->
          <div class="flex items-center justify-between border-b border-base-300 p-4">
            <h2 class="text-lg font-semibold">Communities</h2>
            <button onclick={toggleDrawer} class="btn btn-circle btn-ghost btn-sm">
              <CloseIcon class_="w-5 h-5" />
            </button>
          </div>

          <!-- Community List -->
          <div class="h-[calc(100vh-8rem)] overflow-y-auto">
            <CommunitySidebar
              currentCommunityId={data.pubkey}
              onCommunitySelect={handleCommunitySelect}
            />
          </div>
        </div>
      </div>
    </div>
  </div>
{:else}
  <!-- Logged-out: Simple layout -->
  <div class="flex h-[calc(100vh-8rem)] flex-col pt-16 lg:hidden">
    <!-- Community Identity Header -->
    <div class="flex items-center justify-center border-b border-base-300 bg-base-200 p-4">
      {#if communityProfile}
        <div class="flex items-center gap-2">
          <div class="avatar">
            <div class="w-8 rounded-full ring-1 ring-base-300">
              <img src={avatarUrl} alt={displayName} class="object-cover" />
            </div>
          </div>
          <h1 class="truncate text-base font-semibold text-base-content">{displayName}</h1>
        </div>
      {:else}
        <h1 class="text-lg font-semibold">{runtimeConfig.appName}</h1>
      {/if}
    </div>
    <div class="flex-1 overflow-auto pb-16">
      {@render children()}
    </div>
    <BottomTabBar
      bind:selectedContentType
      onContentTypeSelect={handleContentTypeSelect}
      communityEvent={communikeyEvent}
    />
  </div>
{/if}
