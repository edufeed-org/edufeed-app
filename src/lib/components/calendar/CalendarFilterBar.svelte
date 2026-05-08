<script>
  import TagSelector from './TagSelector.svelte';
  import SearchInput from './SearchInput.svelte';
  import PeopleFilter from './PeopleFilter.svelte';
  import AdvancedFiltersDropdown from './AdvancedFiltersDropdown.svelte';
  import ActiveFilterChips from './ActiveFilterChips.svelte';
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';

  /**
   * @typedef {Object} Props
   * @property {any[]} validEvents
   * @property {string[]} [featuredAuthors]
   * @property {(relays: string[]) => void} [onRelayFilterChange]
   * @property {(query: string) => void} [onSearchQueryChange]
   * @property {(tags: string[]) => void} [onTagFilterChange]
   * @property {() => void} [onPeopleChange]
   * @property {() => void} [onClearAll]
   */

  /** @type {Props} */
  let {
    validEvents,
    featuredAuthors = [],
    onRelayFilterChange = (/** @type {string[]} */ _r) => {},
    onSearchQueryChange = (/** @type {string} */ _q) => {},
    onTagFilterChange = (/** @type {string[]} */ _t) => {},
    onPeopleChange = () => {},
    onClearAll = () => {}
  } = $props();
</script>

<div class="flex flex-col gap-2">
  <div class="flex flex-wrap items-center gap-2">
    <!-- Always-visible search (takes available width) -->
    <div class="min-w-[16rem] flex-1">
      <SearchInput
        value={calendarFilters.searchQuery}
        debounceMs={300}
        onChange={(/** @type {string} */ v) => {
          calendarFilters.setSearchQuery(v);
          onSearchQueryChange(v);
        }}
      />
    </div>

    <!-- Tags -->
    <div class="dropdown">
      <button type="button" tabindex="0" class="btn gap-1 btn-outline btn-sm" data-filter-trigger>
        <span>Tags</span>
        {#if validEvents && validEvents.length >= 0}
          <!-- count badge rendered by TagSelector internals -->
        {/if}
        <span aria-hidden="true">▾</span>
      </button>
      <div
        tabindex="-1"
        class="dropdown-content z-30 mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg"
      >
        <TagSelector events={validEvents} {onTagFilterChange} />
      </div>
    </div>

    <!-- People (replaces Authors + Follow-Listen) -->
    <PeopleFilter {featuredAuthors} onChange={onPeopleChange} />

    <!-- Advanced (Relays) — pushed right -->
    <div class="ms-auto">
      <AdvancedFiltersDropdown {onRelayFilterChange} />
    </div>
  </div>

  <!-- Active filter chip strip -->
  <ActiveFilterChips onChange={onClearAll} />
</div>
