<!--
  LearningView Component
  Displays educational resources (AMB/kind:30142) shared with a community.
  Uses model-based intersection: browse loader populates EventStore,
  CommunityAMBResourceModel resolves all sharing mechanisms (h-tag, repost, legacy),
  NIP-50 search results are intersected with community items for scoped search.
-->

<script>
  import { getContext } from 'svelte';
  import { useAMBCommunityLoader } from '$lib/loaders/amb.js';
  import { CommunityAMBResourceModel } from '$lib/models/community-content.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import SharedByLine from '$lib/components/shared/SharedByLine.svelte';
  import LearningContentFilters from '$lib/components/educational/LearningContentFilters.svelte';
  import { ambSearchLoader } from '$lib/loaders/amb-search.js';
  import {
    createEmptyFilters,
    hasActiveFilters
  } from '$lib/helpers/educational/searchQueryBuilder.js';
  import { SearchIcon } from '$lib/components/icons';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getPreferredFormForKind } from '$lib/helpers/communityRelays.js';
  import { formCoordinateToNaddr } from '$lib/helpers/forms.js';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ communityPubkey: string, communityProfile?: any, communikeyEvent?: any }} */
  let {
    communityPubkey,
    communityProfile: _communityProfile = null,
    communikeyEvent = null
  } = $props();

  // Phase C: derive a "New resource (form)" CTA from the community's preferred form.
  let preferredFormNaddr = $derived.by(() => {
    const pref = getPreferredFormForKind(communikeyEvent, 30142);
    if (!pref) return null;
    const relays = pref.relay ? [pref.relay] : [];
    return formCoordinateToNaddr(pref.address, relays);
  });

  const getAllowedAuthors = getContext('allowedAuthors');

  // Community items from model (all 3 sharing mechanisms)
  let communityItems = $state.raw(/** @type {any[]} */ ([]));
  let isLoading = $state(true);
  let error = $state(/** @type {string | null} */ (null));

  // Search state
  let searchText = $state('');
  let showFilters = $state(false);
  let isSearching = $state(false);
  let isSearchActive = $state(false);

  // Track NIP-50 result IDs for intersection
  /** @type {Set<string>} */
  let nip50ResultIds = $state.raw(new Set());

  // Current SKOS filter selections
  let currentFilters = createEmptyFilters();

  // Profile loading for all community items
  // $state.raw() reassignment triggers reactivity, no trigger counter needed
  const getAuthorProfiles = useProfileMap(() => {
    const pubkeys = [];
    for (const e of communityItems) {
      pubkeys.push(e.pubkey);
      if (e._allSharers) {
        for (const pk of e._allSharers) pubkeys.push(pk);
      } else if (e._sharedBy) {
        pubkeys.push(e._sharedBy);
      }
    }
    return pubkeys;
  });
  let authorProfiles = $derived(getAuthorProfiles());

  // Subscription management (plain let, not $state)
  /** @type {import('rxjs').Subscription | null} */
  let currentSearchSub = null;

  // Access-filtered community items
  let accessFilteredItems = $derived.by(() => {
    const allowed = getAllowedAuthors?.();
    if (!allowed) return communityItems;
    return communityItems.filter(
      (item) =>
        allowed.includes(item.pubkey) ||
        (item._allSharers &&
          item._allSharers.some((/** @type {string} */ pk) => allowed.includes(pk))) ||
        (item._sharedBy && allowed.includes(item._sharedBy))
    );
  });

  // Display items: intersection when searching, full list when browsing
  let displayedItems = $derived.by(() => {
    if (!isSearchActive) return accessFilteredItems;
    return accessFilteredItems.filter((item) => nip50ResultIds.has(item.id));
  });

  // Browse loader + model subscription
  let loaderCleanup = /** @type {(() => void) | null} */ (null);

  $effect(() => {
    communityItems = [];
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
      const { cleanup } = useAMBCommunityLoader(communityPubkey);

      const modelSub = eventStore.model(CommunityAMBResourceModel, communityPubkey).subscribe({
        next: (loaded) => {
          communityItems = loaded;
          isLoading = false;
        },
        error: (err) => {
          console.error('LearningView: Error loading content:', err);
          error = 'Failed to load content';
          isLoading = false;
        }
      });

      loaderCleanup = () => {
        modelSub.unsubscribe();
        cleanup();
      };
    } catch (err) {
      console.error('LearningView: Error setting up loader:', err);
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

  /**
   * Execute NIP-50 search and track result IDs for intersection.
   * @param {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} filters
   */
  function executeSearch(filters) {
    if (currentSearchSub) {
      currentSearchSub.unsubscribe();
      currentSearchSub = null;
    }

    if (hasActiveFilters(filters)) {
      isSearchActive = true;
      isSearching = true;
      nip50ResultIds = new Set();

      /** @type {Set<string>} */
      const ids = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity -- local accumulator, not reactive state

      currentSearchSub = ambSearchLoader(filters, 100).subscribe({
        next: (/** @type {import('nostr-tools').Event} */ event) => {
          ids.add(event.id);
          nip50ResultIds = new Set(ids);
        },
        error: (/** @type {any} */ err) => {
          console.error('LearningView: NIP-50 search error:', err);
          isSearching = false;
        },
        complete: () => {
          isSearching = false;
        }
      });
    } else {
      isSearchActive = false;
      isSearching = false;
      nip50ResultIds = new Set();
    }
  }

  /**
   * Handle filter changes from LearningContentFilters (SKOS dropdown changes only).
   * Merges LearningView's current searchText.
   * @param {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} filters
   */
  function handleFilterChange(filters) {
    const merged = { ...filters, searchText };
    currentFilters = merged;
    executeSearch(merged);
  }

  // Debounced search text trigger
  let debounceTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let previousSearchText = '';

  $effect(() => {
    const text = searchText;

    if (text === previousSearchText) return;
    previousSearchText = text;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      handleFilterChange({
        searchText: '',
        learningResourceType: currentFilters.learningResourceType || [],
        about: currentFilters.about || [],
        audience: currentFilters.audience || []
      });
    }, 300);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  // Cleanup search sub on destroy
  $effect(() => {
    return () => {
      if (currentSearchSub) {
        currentSearchSub.unsubscribe();
        currentSearchSub = null;
      }
    };
  });
</script>

<!-- Search bar + preferred-form CTA (always visible) -->
<div class="flex flex-wrap items-center gap-2 px-4 pt-4">
  {#if preferredFormNaddr}
    <a
      class="btn btn-sm btn-primary"
      href={resolve(`/forms/${preferredFormNaddr}/create-resource`)}
      data-testid="community-new-resource-form-cta"
    >
      + {m.community_learning_new_resource_form()}
    </a>
  {/if}
  <div class="relative flex-1">
    <SearchIcon class_="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40" />
    <input
      type="text"
      bind:value={searchText}
      placeholder={m.community_learning_search_placeholder()}
      class="input-bordered input input-sm w-full pl-9"
    />
    {#if searchText}
      <button
        class="btn absolute top-1/2 right-2 btn-circle -translate-y-1/2 btn-ghost btn-xs"
        onclick={() => (searchText = '')}
        aria-label="Clear search"
      >
        ✕
      </button>
    {/if}
  </div>
  <button
    class="btn btn-sm"
    class:btn-primary={showFilters}
    class:btn-ghost={!showFilters}
    onclick={() => (showFilters = !showFilters)}
  >
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
        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
      />
    </svg>
    {m.community_learning_filters_toggle()}
  </button>
</div>

<!-- SKOS filter panel -->
{#if showFilters}
  <div class="px-4 pt-4">
    <LearningContentFilters {searchText} {isSearching} onfilterchange={handleFilterChange} />
  </div>
{/if}

<!-- Unified content area -->
<div class="learning-content-view p-4">
  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16">
      <span class="loading loading-lg loading-spinner text-primary"></span>
      <p class="mt-4 text-base-content/60">{m.community_learning_loading()}</p>
    </div>
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
  {:else if displayedItems.length === 0 && isSearchActive}
    <div class="py-8 text-center text-base-content/60">
      {m.community_search_no_results({ query: searchText.trim() })}
    </div>
  {:else if displayedItems.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-base-200">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12 text-base-content/40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222"
          />
        </svg>
      </div>
      <h3 class="mb-2 text-lg font-semibold text-base-content">
        {m.community_learning_empty_title()}
      </h3>
      <p class="max-w-md text-base-content/60">{m.community_learning_empty_description()}</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each displayedItems as resource (resource.id)}
        <div>
          {#if resource._sharedBy}
            <SharedByLine sharers={resource._allSharers || [resource._sharedBy]} {authorProfiles} />
          {/if}
          <AMBResourceCard
            {resource}
            authorProfile={authorProfiles.get(resource.pubkey) || null}
            compact={false}
          />
        </div>
      {/each}
    </div>
    {#if isSearching}
      <div class="mt-4 flex justify-center">
        <span class="loading loading-sm loading-spinner text-primary"></span>
      </div>
    {/if}
    <div class="mt-6 text-center text-sm text-base-content/60">
      {m.community_learning_count({ count: displayedItems.length })}
    </div>
  {/if}
</div>

<style>
  .learning-content-view {
    min-height: calc(100vh - 16rem);
  }
</style>
