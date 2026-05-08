<script>
  import RelaySelector from './RelaySelector.svelte';
  import SearchInput from './SearchInput.svelte';
  import TagSelector from './TagSelector.svelte';
  import PeopleFilter from './PeopleFilter.svelte';
  import ActiveFilterChips from './ActiveFilterChips.svelte';
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {boolean} isDrawerOpen
   * @property {any[]} validEvents
   * @property {string[]} [featuredAuthors]
   * @property {number} activeFilterCount
   * @property {(relays: string[]) => void} [onRelayFilterChange]
   * @property {(query: string) => void} [onSearchQueryChange]
   * @property {(tags: string[]) => void} [onTagFilterChange]
   * @property {() => void} [onPeopleChange]
   * @property {() => void} onClose
   */

  /** @type {Props} */
  let {
    isDrawerOpen,
    validEvents,
    featuredAuthors = [],
    activeFilterCount,
    onRelayFilterChange = (/** @type {string[]} */ _r) => {},
    onSearchQueryChange = (/** @type {string} */ _q) => {},
    onTagFilterChange = (/** @type {string[]} */ _t) => {},
    onPeopleChange = () => {},
    onClose
  } = $props();

  /** @type {HTMLButtonElement | undefined} */
  let closeBtn = $state();

  $effect(() => {
    if (!isDrawerOpen) return;
    /** @param {KeyboardEvent} e */
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    if (isDrawerOpen && closeBtn) {
      closeBtn.focus();
    }
  });
</script>

{#if isDrawerOpen}
  <div class="fixed inset-0 z-50 lg:hidden">
    <!-- Backdrop -->
    <div class="absolute inset-0 bg-base-300/70" onclick={onClose} aria-hidden="true"></div>

    <div
      class="absolute inset-y-0 left-0 w-80 max-w-[85vw] overflow-y-auto bg-base-100 p-4 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-drawer-title"
    >
      <header class="mb-4 flex items-center justify-between">
        <h2 id="filter-drawer-title" class="text-lg font-semibold">
          Filter {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
        </h2>
        <button
          type="button"
          bind:this={closeBtn}
          class="btn btn-ghost btn-sm"
          onclick={onClose}
          aria-label="Schließen">✕</button
        >
      </header>

      <!-- Search (top, matching desktop) -->
      <section class="mb-4">
        <SearchInput
          value={calendarFilters.searchQuery}
          debounceMs={300}
          onChange={(/** @type {string} */ v) => {
            calendarFilters.setSearchQuery(v);
            onSearchQueryChange(v);
          }}
        />
      </section>

      <section class="mb-4">
        <h3 class="mb-2 text-sm font-semibold">Tags</h3>
        <TagSelector events={validEvents} {onTagFilterChange} />
      </section>

      <section class="mb-4">
        <h3 class="mb-2 text-sm font-semibold">{m.people_filter_title()}</h3>
        <PeopleFilter {featuredAuthors} onChange={onPeopleChange} />
      </section>

      <!-- Advanced (Relays) - collapsed by default -->
      <details class="mb-4 rounded-lg border border-base-300">
        <summary class="cursor-pointer px-3 py-2 text-sm font-semibold select-none">
          {m.calendar_advanced_title()}
        </summary>
        <div class="px-3 pb-3">
          <h4 class="mb-2 text-xs font-medium text-base-content/60 uppercase">
            {m.calendar_advanced_relays_heading()}
          </h4>
          <RelaySelector onApplyFilters={onRelayFilterChange} />
        </div>
      </details>

      <!-- Active filter chips -->
      <section class="mb-4">
        <ActiveFilterChips />
      </section>

      <!-- Footer close button -->
      <div class="mt-4 border-t border-base-300 pt-4">
        <button class="btn btn-block" onclick={onClose}>Schließen</button>
      </div>
    </div>
  </div>
{/if}
