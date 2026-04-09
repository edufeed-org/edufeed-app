<script>
  import '../app.css';
  import '@fontsource-variable/roboto-condensed';
  import '@fontsource-variable/yanone-kaffeesatz';
  import Navbar from '$lib/components/Navbar.svelte';
  import ModalManager from '$lib/components/ModalManager.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import PublishStatusToast from '$lib/components/shared/PublishStatusToast.svelte';
  import GlobalFAB from '$lib/components/shared/GlobalFAB.svelte';
  import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';
  import DashboardNavSidebar from '$lib/components/dashboard/DashboardNavSidebar.svelte';
  import DashboardBottomTabBar from '$lib/components/dashboard/DashboardBottomTabBar.svelte';
  import { initializeConfig, runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { appSettings, initializeAppSettings } from '$lib/stores/app-settings.svelte.js';
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { recordNavigation } from '$lib/helpers/navigationHistory.js';
  import { page, navigating } from '$app/stores';
  import { setContext } from 'svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { buildCommunityPath } from '$lib/helpers/communityNavigation.js';

  let { children, data } = $props();

  const getActiveUser = useActiveUser();

  // Sidebar navigation — active state based on current route
  let currentCommunityPubkey = $derived($page.params.pubkey ? $page.data?.pubkey : null);
  let isOnCommunityRoutes = $derived($page.url.pathname.startsWith('/c'));
  let isDashboardActive = $derived(isOnCommunityRoutes && !currentCommunityPubkey);
  let isInsideCommunity = $derived(isOnCommunityRoutes && !!currentCommunityPubkey);
  let showDashboardNav = $derived(!!getActiveUser() && !isInsideCommunity);

  /**
   * Handle community selection from sidebar
   * @param {string} pubkey
   */
  function handleCommunitySelect(pubkey) {
    const npub = hexToNpub(pubkey);
    if (npub) {
      goto(resolve(/** @type {any} */ (buildCommunityPath(npub, $page.url.searchParams))));
    }
  }

  function handleHomeSelect() {
    goto(resolve('/c/'));
  }

  // Signal to child layouts that the root layout provides CommunitySidebar
  setContext('workspaceShell', true);

  // Initialize runtime config synchronously before any child components render.
  // The initialized guard inside initializeConfig() prevents double-initialization.
  // svelte-ignore state_referenced_locally
  if (data.config) {
    initializeConfig(data.config);
  }

  // Re-initialize app settings after config is loaded
  $effect(() => {
    initializeAppSettings();
  });

  // Apply theme to document
  $effect(() => {
    if (browser) {
      document.documentElement.setAttribute('data-theme', appSettings.effectiveTheme);
    }
  });

  // Pre-warm app relays on app init (fire-and-forget)
  $effect(() => {
    if (browser) {
      import('$lib/services/relay-warming-service.svelte.js').then(
        ({ warmAppRelays, startHealthCheck }) => {
          warmAppRelays();
          startHealthCheck();
        }
      );
    }
  });

  // Initialize curated/WoT authors before rendering children.
  // Follow set naddrs require async relay fetches — without awaiting, discover page
  // loaders fire before the cache is populated, causing getCuratedAuthors() to return
  // null and allowing unfiltered content through.
  let curatedReady = $state(!browser);

  $effect(() => {
    if (!browser) return;
    const TIMEOUT_MS = 5_000;
    import('$lib/services/curated-authors-service.svelte.js')
      .then(async ({ initializeAllCuratedAuthors, initializeAllWotAuthors }) => {
        await Promise.race([
          Promise.all([initializeAllCuratedAuthors(), initializeAllWotAuthors()]),
          new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS))
        ]);
        curatedReady = true;
      })
      .catch(() => {
        curatedReady = true;
      });
  });

  // Track in-app navigation for back button
  afterNavigate(({ from }) => recordNavigation(from));

  // Check for community membership migration (old kind 30382 → kind 30000)
  $effect(() => {
    if (!browser) return;
    import('$lib/services/migration-check-service.svelte.js').then(
      ({ checkCommunityMigration }) => {
        checkCommunityMigration();
      }
    );
  });

  // Initialize inbox + wave toasts on login, cleanup on logout
  $effect(() => {
    if (!browser) return;
    const account = getActiveUser();
    if (account) {
      import('$lib/services/inbox-service.svelte.js').then(({ initializeInbox }) => {
        initializeInbox(account.pubkey);
      });
      import('$lib/services/wave-service.svelte.js').then(({ initializeWaveToasts }) => {
        initializeWaveToasts(account.pubkey);
      });
    } else {
      import('$lib/services/inbox-service.svelte.js').then(({ cleanup }) => {
        cleanup();
      });
      import('$lib/services/wave-service.svelte.js').then(({ cleanupWaveToasts }) => {
        cleanupWaveToasts();
      });
    }
  });
</script>

<svelte:head>
  <link rel="icon" type="image/x-icon" href={runtimeConfig.favicon?.ico || '/favicon.ico'} />
  <link rel="icon" type="image/svg+xml" href={runtimeConfig.favicon?.svg || '/favicon.svg'} />
  <link
    rel="icon"
    type="image/png"
    sizes="32x32"
    href={runtimeConfig.favicon?.png32 || '/favicon-32x32.png'}
  />
  <link
    rel="icon"
    type="image/png"
    sizes="16x16"
    href={runtimeConfig.favicon?.png16 || '/favicon-16x16.png'}
  />
</svelte:head>

<div class="flex min-h-screen flex-col">
  <Navbar hideMobileNavbar={!!getActiveUser() && isOnCommunityRoutes} />
  {#if $navigating}
    <progress class="progress h-1 w-full progress-primary"></progress>
  {/if}
  <ModalManager />
  {#if getActiveUser()}
    <div class="hidden lg:contents">
      <CommunitySidebar
        currentCommunityId={currentCommunityPubkey}
        {isDashboardActive}
        onCommunitySelect={handleCommunitySelect}
        onHomeSelect={handleHomeSelect}
      />
    </div>
  {/if}
  {#if showDashboardNav}
    <DashboardNavSidebar />
  {/if}
  <main
    class="flex flex-1 flex-col"
    class:lg:ml-(--sidebar-icon-w)={!!getActiveUser() && !showDashboardNav}
    class:lg:ml-(--sidebar-total-w)={showDashboardNav}
    class:pb-16={showDashboardNav}
    class:lg:pb-0={showDashboardNav}
  >
    {#if curatedReady}
      {@render children?.()}
    {:else}
      <div class="flex min-h-[60vh] items-center justify-center">
        <div class="loading loading-lg loading-spinner text-primary"></div>
      </div>
    {/if}
  </main>
  <div
    class:lg:ml-(--sidebar-icon-w)={!!getActiveUser() && !showDashboardNav}
    class:lg:ml-(--sidebar-total-w)={showDashboardNav}
    class:hidden={!!getActiveUser() && isOnCommunityRoutes}
    class:lg:block={!!getActiveUser() && isOnCommunityRoutes}
  >
    <Footer />
  </div>
</div>
<PublishStatusToast />
{#if getActiveUser()}
  <GlobalFAB />
{/if}
{#if showDashboardNav}
  <DashboardBottomTabBar />
{/if}
