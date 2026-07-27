<!--
  CommunityContentView — Generic community content view component.
  Handles the shared loading/error/empty/list pattern for any content type.
  Uses Svelte 5 snippets for customizable card rendering and optional FAB.
-->

<script>
  import { getContext } from 'svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { matchesEventSearch } from '$lib/helpers/contentSearch.js';
  import { SearchIcon } from '$lib/components/icons';
  import EmptyState from '$lib/components/shared/EmptyState.svelte';
  import * as m from '$lib/paraglide/messages';

  const getAllowedAuthors = getContext('allowedAuthors');

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
   * @property {(items: any[]) => number} [countTransform] - Optional transform to derive display count from items
   * @property {string} [emptyIconPath] - SVG path for empty state icon
   * @property {import('svelte').Snippet} [emptyIcon] - Icon snippet for empty state (takes precedence over emptyIconPath)
   * @property {boolean} [searchable] - Show search input in header
   * @property {string} [searchPlaceholder] - Placeholder text for search input
   */

  /** @type {Props & { content: import('svelte').Snippet<[any[], Map<string, any>]>, headerAction?: import('svelte').Snippet }} */
  let {
    communityPubkey,
    communityProfile: _communityProfile = null,
    loaderHook,
    model,
    loadingText,
    emptyTitle,
    emptyDescription,
    formatCount,
    countTransform = /** @type {any[]} */ (items) => items.length,
    emptyIconPath,
    emptyIcon,
    searchable = false,
    searchPlaceholder = 'Search...',
    content,
    headerAction
  } = $props();

  let searchQuery = $state('');

  let items = $state(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let error = $state(/** @type {string | null} */ (null));
  const getAuthorProfiles = useProfileMap(() => {
    const pubkeys = [];
    for (const i of items) {
      const pk = i.pubkey || i.event?.pubkey;
      if (pk) pubkeys.push(pk);
      if (i._allSharers) {
        for (const pk of i._allSharers) pubkeys.push(pk);
      } else if (i._sharedBy) {
        pubkeys.push(i._sharedBy);
      }
    }
    return pubkeys;
  });
  let authorProfiles = $derived(getAuthorProfiles());

  let accessFilteredItems = $derived.by(() => {
    const allowed = getAllowedAuthors?.();
    if (!allowed) return items;
    return items.filter(
      (item) =>
        allowed.includes(item.pubkey || item.event?.pubkey) ||
        (item._allSharers &&
          item._allSharers.some((/** @type {string} */ pk) => allowed.includes(pk))) ||
        (item._sharedBy && allowed.includes(item._sharedBy))
    );
  });

  let displayedItems = $derived.by(() => {
    if (!searchable || !searchQuery.trim()) return accessFilteredItems;
    return accessFilteredItems.filter((item) =>
      matchesEventSearch(item, searchQuery, authorProfiles)
    );
  });

  let isSearchFiltered = $derived(searchable && searchQuery.trim().length > 0);

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
  {#if searchable || headerAction}
    <div class="mb-4 flex items-center gap-2">
      {#if searchable}
        <div class="relative flex-1">
          <SearchIcon
            class_="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40"
          />
          <input
            type="text"
            bind:value={searchQuery}
            placeholder={searchPlaceholder}
            class="input-bordered input input-sm w-full pl-9"
          />
          {#if searchQuery}
            <button
              class="btn absolute top-1/2 right-2 btn-circle -translate-y-1/2 btn-ghost btn-xs"
              onclick={() => (searchQuery = '')}
              aria-label="Clear search"
            >
              ✕
            </button>
          {/if}
        </div>
      {:else}
        <div class="flex-1"></div>
      {/if}
      {#if headerAction}
        {@render headerAction()}
      {/if}
    </div>
  {/if}

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
    <!-- No search results -->
  {:else if displayedItems.length === 0 && isSearchFiltered}
    <div class="py-8 text-center text-base-content/60">
      {m.community_search_no_results({ query: searchQuery.trim() })}
    </div>
    <!-- Empty State -->
  {:else if displayedItems.length === 0}
    <EmptyState
      title={emptyTitle}
      description={emptyDescription}
      iconPath={emptyIconPath}
      icon={emptyIcon}
    />
    <!-- Content -->
  {:else}
    {@render content(displayedItems, authorProfiles)}

    <div class="mt-6 text-center text-sm text-base-content/60">
      {formatCount(countTransform(displayedItems))}
    </div>
  {/if}
</div>

<style>
  .community-content-view {
    min-height: calc(100vh - 16rem);
  }
</style>
