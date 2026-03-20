<!--
  CommunityContentView — Generic community content view component.
  Handles the shared loading/error/empty/list pattern for any content type.
  Uses Svelte 5 snippets for customizable card rendering and optional FAB.
-->

<script>
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';

  /**
   * @typedef {Object} Props
   * @property {string} communityPubkey
   * @property {any} [communityProfile]
   * @property {(pubkey: string) => { subscriptions: Map<string, any>, cleanup: () => void }} loaderHook
   * @property {(pubkey: string) => (eventStore: any) => import('rxjs').Observable<any[]>} model
   * @property {string} loadingText
   * @property {string} emptyTitle
   * @property {string} emptyDescription
   * @property {(count: number) => string} formatCount - Function to format the item count
   * @property {string} emptyIconPath - SVG path for empty state icon
   */

  /** @type {Props & { content: import('svelte').Snippet<[any[], Map<string, any>]> }} */
  let {
    communityPubkey,
    communityProfile: _communityProfile = null,
    loaderHook,
    model,
    loadingText,
    emptyTitle,
    emptyDescription,
    formatCount,
    emptyIconPath,
    content
  } = $props();

  let items = $state(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let error = $state(/** @type {string | null} */ (null));
  const getAuthorProfiles = useProfileMap(() => items.map((i) => i.pubkey));
  let authorProfiles = $derived(getAuthorProfiles());

  let loaderCleanup = /** @type {(() => void) | null} */ (null);

  $effect(() => {
    items = [];
    isLoading = true;
    error = null;

    if (loaderCleanup) {
      loaderCleanup();
      loaderCleanup = null;
    }

    if (!communityPubkey) {
      isLoading = false;
      return;
    }

    try {
      const { cleanup } = loaderHook(communityPubkey);
      loaderCleanup = cleanup;

      const modelSub = eventStore.model(model, communityPubkey).subscribe({
        next: (loaded) => {
          items = loaded;
          isLoading = false;
        },
        error: (err) => {
          console.error('CommunityContentView: Error loading content:', err);
          error = 'Failed to load content';
          isLoading = false;
        }
      });

      const originalCleanup = cleanup;
      loaderCleanup = () => {
        modelSub.unsubscribe();
        originalCleanup();
      };
    } catch (err) {
      console.error('CommunityContentView: Error setting up loader:', err);
      error = 'Failed to connect to relay';
      isLoading = false;
    }

    return () => {
      if (loaderCleanup) {
        loaderCleanup();
        loaderCleanup = null;
      }
    };
  });
</script>

<div class="community-content-view p-4">
  <!-- Loading State -->
  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-base-content/60">{loadingText}</p>
    </div>
    <!-- Error State -->
  {:else if error}
    <div class="alert alert-error">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-6 w-6 shrink-0 stroke-current"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>{error}</span>
    </div>
    <!-- Empty State -->
  {:else if items.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-200">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12 text-base-content/40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={emptyIconPath} />
        </svg>
      </div>
      <h3 class="mb-2 text-lg font-semibold text-base-content">{emptyTitle}</h3>
      <p class="max-w-md text-base-content/60">{emptyDescription}</p>
    </div>
    <!-- Content -->
  {:else}
    {@render content(items, authorProfiles)}

    <div class="mt-6 text-center text-sm text-base-content/60">
      {formatCount(items.length)}
    </div>
  {/if}
</div>

<style>
  .community-content-view {
    min-height: calc(100vh - 16rem);
  }
</style>
