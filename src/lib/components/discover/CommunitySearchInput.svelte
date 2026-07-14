<!--
  CommunitySearchInput Component
  Provides text search for communities by name and description
-->

<script>
  import * as m from '$lib/paraglide/messages';

  // Props
  let { onSearchChange = () => {} } = $props();

  // Local state
  let searchQuery = $state('');
  let debounceTimer = $state(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

  /**
   * Handle input changes with debouncing
   * @param {Event} event
   */
  function handleInput(event) {
    const target = /** @type {HTMLInputElement} */ (event.target);
    searchQuery = target.value;

    // Clear existing timer
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    // Debounce the search - wait 300ms after user stops typing
    debounceTimer = setTimeout(() => {
      onSearchChange(searchQuery);
    }, 300);
  }

  /**
   * Clear search query
   */
  function clearSearch() {
    searchQuery = '';
    onSearchChange('');

    // Clear debounce timer if active
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  // Derived state
  let hasQuery = $derived(searchQuery.trim().length > 0);
</script>

<div class="border-b border-base-300 bg-base-100 px-6 py-4">
  <!-- Header -->
  <div class="mb-3 flex items-center gap-3">
    <svg class="h-5 w-5 text-base-content/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
    <span class="font-medium text-base-content">{m.discover_search_header()}</span>
    {#if hasQuery}
      <span class="badge badge-sm badge-primary">{m.discover_search_active_badge()}</span>
    {/if}
  </div>

  <!-- Search input -->
  <div class="relative">
    <input
      type="text"
      class="input-bordered input w-full pr-10"
      placeholder={m.discover_search_placeholder()}
      value={searchQuery}
      oninput={handleInput}
      aria-label={m.discover_search_aria_label()}
    />

    <!-- Clear button -->
    {#if hasQuery}
      <button
        class="btn absolute top-1/2 right-2 btn-circle -translate-y-1/2 btn-ghost btn-sm"
        onclick={clearSearch}
        aria-label={m.discover_search_clear_button()}
        title={m.discover_search_clear_button()}
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Helper text -->
  <p class="mt-2 text-xs text-base-content/60">
    {#if hasQuery}
      {m.discover_search_helper_with_query()}
    {:else}
      {m.discover_search_helper_without_query()}
    {/if}
  </p>
</div>
