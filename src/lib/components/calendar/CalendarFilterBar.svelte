<script>
  import RelaySelector from './RelaySelector.svelte';
  import FollowListSelector from './FollowListSelector.svelte';
  import TagSelector from './TagSelector.svelte';
  import SearchInput from './SearchInput.svelte';
  import FeaturedAuthors from './FeaturedAuthors.svelte';
  import { SearchIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {any[]} validEvents
   * @property {string[]} featuredAuthors
   * @property {string[]} selectedAuthors
   * @property {number} selectedTagsCount
   * @property {number} selectedRelaysCount
   * @property {number} selectedFollowListsCount
   * @property {string} searchQuery
   * @property {number} eventCount
   * @property {(relays: string[]) => void} onRelayFilterChange
   * @property {(listIds: string[]) => void} onFollowListFilterChange
   * @property {(query: string) => void} onSearchQueryChange
   * @property {(tags: string[]) => void} onTagFilterChange
   * @property {(pubkeys: string[]) => void} onAuthorsChange
   * @property {() => void} onClearAll
   */

  /** @type {Props} */
  let {
    validEvents,
    featuredAuthors,
    selectedAuthors,
    selectedTagsCount,
    selectedRelaysCount,
    selectedFollowListsCount,
    searchQuery,
    eventCount,
    onRelayFilterChange,
    onFollowListFilterChange,
    onSearchQueryChange,
    onTagFilterChange,
    onAuthorsChange,
    onClearAll
  } = $props();

  const anyActive = $derived(
    selectedTagsCount > 0 ||
      selectedRelaysCount > 0 ||
      selectedFollowListsCount > 0 ||
      selectedAuthors.length > 0 ||
      searchQuery.trim().length > 0
  );

  function toggleAuthor(/** @type {string} */ pubkey) {
    if (selectedAuthors.includes(pubkey)) {
      onAuthorsChange(selectedAuthors.filter((p) => p !== pubkey));
    } else {
      onAuthorsChange([...selectedAuthors, pubkey]);
    }
  }
</script>

<div class="flex flex-wrap items-center gap-2 py-2">
  <!-- Tags -->
  <div class="dropdown">
    <button type="button" tabindex="0" class="btn gap-1 btn-ghost btn-sm" data-filter-trigger>
      <span>+ Tags</span>
      {#if selectedTagsCount > 0}
        <span class="badge badge-sm badge-primary" data-filter-count>{selectedTagsCount}</span>
      {/if}
    </button>
    <div
      tabindex="-1"
      class="dropdown-content z-10 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
    >
      <TagSelector events={validEvents} {onTagFilterChange} />
    </div>
  </div>

  <!-- Authors (only if featured list non-empty) -->
  {#if featuredAuthors.length > 0}
    <div class="dropdown">
      <button type="button" tabindex="0" class="btn gap-1 btn-ghost btn-sm" data-filter-trigger>
        <span>Autoren</span>
        {#if selectedAuthors.length > 0}
          <span class="badge badge-sm badge-primary" data-filter-count
            >{selectedAuthors.length}</span
          >
        {/if}
        <span aria-hidden="true">▾</span>
      </button>
      <div
        tabindex="-1"
        class="dropdown-content z-10 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
      >
        <FeaturedAuthors
          pubkeys={featuredAuthors}
          selected={selectedAuthors}
          onToggle={toggleAuthor}
          variant="compact"
        />
      </div>
    </div>
  {/if}

  <!-- Relays -->
  <div class="dropdown">
    <button type="button" tabindex="0" class="btn gap-1 btn-ghost btn-sm" data-filter-trigger>
      <span>Relays</span>
      {#if selectedRelaysCount > 0}
        <span class="badge badge-sm badge-primary" data-filter-count>{selectedRelaysCount}</span>
      {/if}
      <span aria-hidden="true">▾</span>
    </button>
    <div
      tabindex="-1"
      class="dropdown-content z-10 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
    >
      <RelaySelector onApplyFilters={onRelayFilterChange} />
    </div>
  </div>

  <!-- Follow lists -->
  <div class="dropdown">
    <button type="button" tabindex="0" class="btn gap-1 btn-ghost btn-sm" data-filter-trigger>
      <span>Follow-Listen</span>
      {#if selectedFollowListsCount > 0}
        <span class="badge badge-sm badge-primary" data-filter-count
          >{selectedFollowListsCount}</span
        >
      {/if}
      <span aria-hidden="true">▾</span>
    </button>
    <div
      tabindex="-1"
      class="dropdown-content z-10 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
    >
      <FollowListSelector onApplyFilters={onFollowListFilterChange} />
    </div>
  </div>

  <!-- Search -->
  <div class="dropdown">
    <button type="button" tabindex="0" class="btn gap-1 btn-ghost btn-sm" data-filter-trigger>
      <SearchIcon class_="w-4 h-4" />
      {#if searchQuery.trim()}
        <span class="badge badge-sm badge-primary" data-filter-count>1</span>
      {/if}
    </button>
    <div
      tabindex="-1"
      class="dropdown-content z-10 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
    >
      <SearchInput {onSearchQueryChange} />
    </div>
  </div>

  <span class="ms-auto text-xs text-base-content/60">{eventCount} Events</span>
  {#if anyActive}
    <button type="button" class="btn text-primary btn-ghost btn-xs" onclick={onClearAll}>
      Filter zurücksetzen
    </button>
  {/if}
</div>
