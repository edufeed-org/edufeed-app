<script>
  import '../app.css';
  import '@fontsource-variable/roboto-condensed';
  import '@fontsource-variable/yanone-kaffeesatz';
  import Navbar from '$lib/components/Navbar.svelte';
  import ModalManager from '$lib/components/ModalManager.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import PublishStatusToast from '$lib/components/shared/PublishStatusToast.svelte';
  import GlobalFAB from '$lib/components/shared/GlobalFAB.svelte';
  import ScrollToTopButton from '$lib/components/shared/ScrollToTopButton.svelte';
  import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';
  import DashboardNavSidebar from '$lib/components/dashboard/DashboardNavSidebar.svelte';
  import DashboardBottomTabBar from '$lib/components/dashboard/DashboardBottomTabBar.svelte';
  import { initializeConfig, runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { appSettings, initializeAppSettings } from '$lib/stores/app-settings.svelte.js';
  import {
    initializeAllCuratedAuthors,
    initializeAllWotAuthors
  } from '$lib/services/curated-authors-service.svelte.js';
  import { browser } from '$app/environment';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { recordNavigation } from '$lib/helpers/navigationHistory.js';
  import { page, navigating } from '$app/stores';
  import { setContext } from 'svelte';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { buildCommunityPath } from '$lib/helpers/communityNavigation.js';
  import { getRandomQuote } from '$lib/data/loading-quotes.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  let { children, data } = $props();

  const getActiveUser = useActiveUser();

  // Random loading quote — picked once per page load
  const loadingQuote = getRandomQuote(getLocale());

  // Sidebar navigation — active state based on current route
  let currentCommunityPubkey = $derived($page.params.pubkey ? $page.data?.pubkey : null);
  let isOnCommunityRoutes = $derived($page.url.pathname.startsWith('/c'));
  let isDashboardActive = $derived(isOnCommunityRoutes && !currentCommunityPubkey);
  let isInsideCommunity = $derived(isOnCommunityRoutes && !!currentCommunityPubkey);
  let showDashboardNav = $derived(!!getActiveUser() && !isInsideCommunity);

  // Hide global floating buttons on views that manage their own bottom UI (chat input, DM input)
  let hasOwnBottomUI = $derived(
    $page.url.pathname.startsWith('/c/messages') || $page.url.searchParams.get('view') === 'chat'
  );

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

  // Apply theme to document (supplements the inline script in app.html which handles initial load)
  $effect(() => {
    if (browser) {
      document.documentElement.setAttribute('data-theme', appSettings.effectiveTheme);
    }
  });

  // Hide the static HTML loader once Svelte takes over (replaced by Svelte loading view with quote)
  if (browser) {
    const loader = document.getElementById('app-loader');
    if (loader) loader.style.display = 'none';
  }

  // Reveal the app once initialization is complete (see app.html CSS hide-until-ready)
  $effect(() => {
    if (browser && curatedReady) {
      document.body.classList.add('app-ready');
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
  // Uses localStorage cache for near-instant repeat visits, with background relay refresh.
  let curatedReady = $state(!browser);

  $effect(() => {
    if (!browser) return;
    const TIMEOUT_MS = 3_000;
    Promise.race([
      Promise.all([initializeAllCuratedAuthors(), initializeAllWotAuthors()]),
      new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS))
    ])
      .then(() => {
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
    {/if}
    <!-- Floating buttons — sticky inside main so they sit above footer.
         Hidden on views with their own bottom UI (chat input, DM input). -->
    {#if !hasOwnBottomUI}
      <div class="pointer-events-none sticky bottom-0 z-[60] h-0 overflow-visible">
        <div class="pointer-events-auto">
          <ScrollToTopButton />
          {#if getActiveUser()}
            <GlobalFAB />
          {/if}
        </div>
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
{#if showDashboardNav}
  <DashboardBottomTabBar />
{/if}

<!-- Loading overlay with quote — fixed position so it's visible despite parent opacity:0 -->
{#if !curatedReady}
  <div class="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-6 bg-base-100">
    <img src={runtimeConfig.appLogo || '/icon-192x192.png'} alt="" width="64" height="64" />
    <div class="loading loading-lg loading-spinner text-primary"></div>
    <figure class="max-w-sm px-4 text-center">
      <blockquote class="text-base-content/60 italic">
        "{loadingQuote.text}"
      </blockquote>
      <figcaption class="mt-2 text-sm text-base-content/40">
        — {loadingQuote.author}
      </figcaption>
    </figure>
  </div>
{/if}
