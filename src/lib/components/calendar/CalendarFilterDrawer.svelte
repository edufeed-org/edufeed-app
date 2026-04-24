<script>
  import RelaySelector from './RelaySelector.svelte';
  import FollowListSelector from './FollowListSelector.svelte';
  import SearchInput from './SearchInput.svelte';
  import TagSelector from './TagSelector.svelte';
  import FeaturedAuthors from './FeaturedAuthors.svelte';

  /**
   * @typedef {Object} Props
   * @property {boolean} isDrawerOpen
   * @property {any[]} validEvents
   * @property {string[]} featuredAuthors
   * @property {string[]} selectedAuthors
   * @property {number} activeFilterCount
   * @property {(relays: string[]) => void} onRelayFilterChange
   * @property {(listIds: string[]) => void} onFollowListFilterChange
   * @property {(query: string) => void} onSearchQueryChange
   * @property {(tags: string[]) => void} onTagFilterChange
   * @property {(pubkeys: string[]) => void} onAuthorsChange
   * @property {() => void} onClose
   */

  /** @type {Props} */
  let {
    isDrawerOpen,
    validEvents,
    featuredAuthors,
    selectedAuthors,
    activeFilterCount,
    onRelayFilterChange,
    onFollowListFilterChange,
    onSearchQueryChange,
    onTagFilterChange,
    onAuthorsChange,
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

  function toggleAuthor(/** @type {string} */ pubkey) {
    if (selectedAuthors.includes(pubkey)) {
      onAuthorsChange(selectedAuthors.filter((p) => p !== pubkey));
    } else {
      onAuthorsChange([...selectedAuthors, pubkey]);
    }
  }
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

      <section class="mb-4">
        <h3 class="mb-2 text-sm font-semibold">Tags</h3>
        <TagSelector events={validEvents} {onTagFilterChange} />
      </section>

      {#if featuredAuthors.length > 0}
        <section class="mb-4">
          <h3 class="mb-2 text-sm font-semibold">Autoren</h3>
          <FeaturedAuthors
            pubkeys={featuredAuthors}
            selected={selectedAuthors}
            onToggle={toggleAuthor}
            variant="compact"
          />
        </section>
      {/if}

      <section class="mb-4">
        <h3 class="mb-2 text-sm font-semibold">Relays</h3>
        <RelaySelector onApplyFilters={onRelayFilterChange} />
      </section>

      <section class="mb-4">
        <h3 class="mb-2 text-sm font-semibold">Follow-Listen</h3>
        <FollowListSelector onApplyFilters={onFollowListFilterChange} />
      </section>

      <section class="mb-4">
        <h3 class="mb-2 text-sm font-semibold">Suche</h3>
        <SearchInput {onSearchQueryChange} />
      </section>

      <!-- Footer close button -->
      <div class="mt-4 border-t border-base-300 pt-4">
        <button class="btn btn-block" onclick={onClose}>Schließen</button>
      </div>
    </div>
  </div>
{/if}
