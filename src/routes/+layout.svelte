<script>
  import '../app.css';
  import '@fontsource-variable/roboto-condensed';
  import '@fontsource-variable/yanone-kaffeesatz';
  import Navbar from '$lib/components/Navbar.svelte';
  import ModalManager from '$lib/components/ModalManager.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import PublishStatusToast from '$lib/components/shared/PublishStatusToast.svelte';
  import GlobalFAB from '$lib/components/shared/GlobalFAB.svelte';
  import { initializeConfig, runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { appSettings, initializeAppSettings } from '$lib/stores/app-settings.svelte.js';
  import { browser } from '$app/environment';
  import { navigating } from '$app/stores';

  let { children, data } = $props();

  const getActiveUser = useActiveUser();

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

  // Check for community membership migration (old kind 30382 → kind 30000)
  $effect(() => {
    if (!browser) return;
    import('$lib/services/migration-check-service.svelte.js').then(
      ({ checkCommunityMigration }) => {
        checkCommunityMigration();
      }
    );
  });

  // Initialize inbox on login, cleanup on logout
  $effect(() => {
    if (!browser) return;
    const account = getActiveUser();
    if (account) {
      import('$lib/services/inbox-service.svelte.js').then(({ initializeInbox }) => {
        initializeInbox(account.pubkey);
      });
    } else {
      import('$lib/services/inbox-service.svelte.js').then(({ cleanup }) => {
        cleanup();
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

{#if $navigating}
  <div class="fixed top-0 right-0 left-0 z-50">
    <progress class="progress h-1 w-full progress-primary"></progress>
  </div>
{/if}

<div class="flex min-h-screen flex-col">
  <Navbar />
  <ModalManager />
  <main class="flex-1">
    {#if curatedReady}
      {@render children?.()}
    {:else}
      <div class="flex min-h-[60vh] items-center justify-center">
        <div class="loading loading-lg loading-spinner text-primary"></div>
      </div>
    {/if}
  </main>
  <Footer />
</div>
<PublishStatusToast />
{#if getActiveUser()}
  <GlobalFAB />
{/if}
