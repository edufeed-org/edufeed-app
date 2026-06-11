<script>
  import '../app.css';
  import '@fontsource-variable/roboto-condensed';
  import '@fontsource-variable/yanone-kaffeesatz';
  import Navbar from '$lib/components/Navbar.svelte';
  import ModalManager from '$lib/components/ModalManager.svelte';
  import PublishStatusToast from '$lib/components/shared/PublishStatusToast.svelte';
  import GlobalFAB from '$lib/components/shared/GlobalFAB.svelte';
  import ScrollToTopButton from '$lib/components/shared/ScrollToTopButton.svelte';
  import BackupRecoveryBanner from '$lib/components/BackupRecoveryBanner.svelte';
  import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';
  import ContentNavSidebar from '$lib/components/community/layout/ContentNavSidebar.svelte';
  import DashboardNavSidebar from '$lib/components/dashboard/DashboardNavSidebar.svelte';
  import DashboardBottomTabBar from '$lib/components/dashboard/DashboardBottomTabBar.svelte';
  import { initializeConfig, runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { appSettings, initializeAppSettings } from '$lib/stores/app-settings.svelte.js';
  import { warmIdentity } from '$lib/stores/event-cache.svelte.js';
  import {
    initializeAllCuratedAuthors,
    initializeAllWotAuthors
  } from '$lib/services/curated-authors-service.svelte.js';
  import { browser } from '$app/environment';
  import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
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

  // Scroll restoration for the root <main> scroll surface.
  // SvelteKit only restores window scroll — <main> is the only scroll surface
  // after the unified-layout refactor, so we save/restore its scrollTop manually.
  /** @type {HTMLElement | undefined} */
  let mainElement;
  /** @type {Map<string, number>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive state, only used in navigation callbacks
  const scrollPositions = new Map();

  // Random loading quote — picked once per page load
  const loadingQuote = getRandomQuote(getLocale());

  // Sidebar navigation — active state based on current route
  let currentCommunityPubkey = $derived($page.params.pubkey ? $page.data?.pubkey : null);
  let isOnCommunityRoutes = $derived(
    $page.url.pathname === '/c' || $page.url.pathname.startsWith('/c/')
  );
  let isDashboardActive = $derived(isOnCommunityRoutes && !currentCommunityPubkey);
  let isInsideCommunity = $derived(isOnCommunityRoutes && !!currentCommunityPubkey);
  let showDashboardNav = $derived(!!getActiveUser() && !isInsideCommunity);

  // Pages with master/detail patterns (e.g. /c/messages) can opt in to the
  // "own bottom UI" rule reactively, so the bottom nav stays visible on the
  // list view but hides on the detail view where the page draws its own
  // bottom composer.
  /** @type {(() => boolean) | undefined} */
  let getPageHasOwnBottomUI = $state();
  setContext('setPageHasOwnBottomUI', (/** @type {(() => boolean) | undefined} */ getter) => {
    getPageHasOwnBottomUI = getter;
  });

  // Separately, pages can declare they already provide a primary "create"
  // affordance (e.g. /c/messages has a "Neu" button to start a new DM).
  // When set, the global FAB is suppressed but the bottom nav stays visible.
  /** @type {(() => boolean) | undefined} */
  let getPageHasOwnCreateAction = $state();
  setContext('setPageHasOwnCreateAction', (/** @type {(() => boolean) | undefined} */ getter) => {
    getPageHasOwnCreateAction = getter;
  });
  let pageHasOwnCreateAction = $derived(getPageHasOwnCreateAction?.() ?? false);

  // Hide global floating buttons on views that manage their own bottom UI
  // (chat input, DM input, create/edit wizards whose own CTAs sit at the bottom right).
  let hasOwnBottomUI = $derived(
    (() => {
      const pathname = $page.url.pathname;
      if (pathname.startsWith('/create/')) return true;
      if ($page.url.searchParams.get('view') === 'chat') return true;
      if (pathname.startsWith('/c/messages')) {
        // Page reports whether a thread is currently open
        return getPageHasOwnBottomUI?.() ?? false;
      }
      return false;
    })()
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

  // ContentNavSidebar is mounted here in the chrome row. Its data
  // (selectedContentType, communityProfile, restrictedTabs, etc.) is loaded
  // by c/[pubkey]/+layout.svelte and exposed via this context getter so we
  // don't lift community-data loading up to the root layout.
  /** @typedef {import('$lib/types/layout.js').ContentNavData} ContentNavData */
  /** @type {(() => ContentNavData) | undefined} */
  let getContentNavData = $state();
  setContext('setContentNavData', (/** @type {(() => ContentNavData) | undefined} */ getter) => {
    getContentNavData = getter;
  });
  let contentNavData = $derived(getContentNavData?.());

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

  // Save <main> scroll position before leaving a route so we can restore it on back/forward.
  beforeNavigate(({ from }) => {
    if (!from?.url || !mainElement) return;
    const key = from.url.pathname + from.url.search;
    scrollPositions.set(key, mainElement.scrollTop);
  });

  // Track in-app navigation for back button + restore <main> scroll position.
  // Content from EventStore loaders renders asynchronously after navigation, so
  // the target scrollTop may exceed scrollHeight on the first frame and get
  // clamped to 0. We retry across a few frames until the browser accepts the
  // requested position or we exhaust a small budget. `saved ?? 0` preserves
  // SvelteKit's default behavior of landing fresh navigations at the top.
  afterNavigate(({ from, to }) => {
    recordNavigation(from);
    if (!to?.url) return;
    const key = to.url.pathname + to.url.search;
    const saved = scrollPositions.get(key) ?? 0;
    // Yield to the user: if they scroll/touch/key during the retry window,
    // abort the restore loop so we don't fight their input.
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    // Only treat scroll-intent keys as cancel signals — avoids false cancels
    // from users typing in autofocused inputs right after navigation.
    const SCROLL_KEYS = new Set([
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
      'Spacebar'
    ]);
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (SCROLL_KEYS.has(e.key)) cancelled = true;
    };
    const opts = { passive: true, capture: true };
    const cleanup = () => {
      window.removeEventListener('wheel', cancel, opts);
      window.removeEventListener('touchstart', cancel, opts);
      window.removeEventListener('keydown', onKey, opts);
    };
    window.addEventListener('wheel', cancel, opts);
    window.addEventListener('touchstart', cancel, opts);
    window.addEventListener('keydown', onKey, opts);
    let attempts = 0;
    const tryRestore = () => {
      if (cancelled || !mainElement) {
        cleanup();
        return;
      }
      mainElement.scrollTop = saved;
      attempts++;
      // Keep trying while the browser clamps below the target (content not tall
      // enough yet) — bail after ~30 frames (~500ms at 60fps).
      if (mainElement.scrollTop < saved - 1 && attempts < 30) {
        requestAnimationFrame(tryRestore);
      } else {
        cleanup();
      }
    };
    requestAnimationFrame(tryRestore);
  });

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
  // Also warm the persistent event cache with identity data
  $effect(() => {
    if (!browser) return;
    const account = getActiveUser();
    // Warm the persistent event cache with own identity events + followed-users' profiles.
    // Fire-and-forget — internally swallows errors, no-op when account is null.
    warmIdentity({ activeUserPubkey: account?.pubkey ?? null });
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

<div class="flex h-dvh flex-col overflow-hidden">
  <Navbar hideMobileNavbar={!!getActiveUser() && isOnCommunityRoutes} />
  {#if $navigating}
    <progress class="progress h-1 w-full progress-primary"></progress>
  {/if}
  <ModalManager />
  <!-- Chrome row: sidebars + main as flex siblings. -->
  <div class="flex min-h-0 flex-1 overflow-hidden">
    {#if getActiveUser()}
      <!-- lg:contents wrapper keeps the lg:hidden mobile drawer-content branch
           inside CommunitySidebar from rendering as a flex child on mobile. -->
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
    {:else if isInsideCommunity && contentNavData}
      <ContentNavSidebar {...contentNavData} />
    {/if}
    <main
      bind:this={mainElement}
      class="flex min-h-0 flex-1 flex-col overflow-y-auto"
      class:pb-16={showDashboardNav}
      class:pb-20={isInsideCommunity}
      class:lg:pb-0={showDashboardNav || isInsideCommunity}
    >
      {#if curatedReady}
        {#if getActiveUser()}
          <div class="px-4 pt-3 pb-2">
            <BackupRecoveryBanner />
          </div>
        {/if}
        {@render children?.()}
      {/if}
      <!-- Floating buttons — sticky inside main so they sit at the bottom of the scroll surface.
           `mt-auto` pushes the wrapper to the bottom of the flex column on short pages
           (where sticky degrades to static because there's no overflow); on long pages
           sticky takes over normally. Hidden on views with their own bottom UI (chat, DM). -->
      {#if !hasOwnBottomUI}
        <div class="pointer-events-none sticky bottom-0 z-[60] mt-auto h-0 overflow-visible">
          <div class="pointer-events-auto">
            <ScrollToTopButton />
          </div>
        </div>
      {/if}
    </main>
  </div>
</div>
<PublishStatusToast />
{#if !hasOwnBottomUI && !pageHasOwnCreateAction && getActiveUser()}
  <GlobalFAB />
{/if}
{#if showDashboardNav && !hasOwnBottomUI}
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
