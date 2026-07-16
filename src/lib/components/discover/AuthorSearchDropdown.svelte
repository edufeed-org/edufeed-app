<script>
  import { searchProfileMap } from '$lib/helpers/contentSearch.js';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';

  /**
   * @typedef {{pubkey: string, name: string, display_name: string, picture?: string, nip05?: string}} AuthorResult
   */

  let {
    searchTerm = '',
    profileMap = new Map(),
    onselect = (/** @type {AuthorResult} */ _author) => {},
    visible = false
  } = $props();

  let selectedIndex = $state(-1);

  // Merge profile map results with contacts search, deduped by pubkey
  const matches = $derived.by(() => {
    if (!visible || searchTerm.length < 2) return [];

    const profileResults = searchProfileMap(searchTerm, profileMap, 8);
    const contactResults = contactsStore.searchContacts(searchTerm, 8);

    /** @type {Map<string, AuthorResult>} */
    const deduped = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity -- local dedup, not reactive

    // Profile map results first (they have relay-seen context)
    for (const r of profileResults) {
      deduped.set(r.pubkey, r);
    }

    // Add contacts that aren't already in the map
    for (const c of contactResults) {
      if (!deduped.has(c.pubkey)) {
        deduped.set(c.pubkey, {
          pubkey: c.pubkey,
          name: c.name || '',
          display_name: c.display_name || '',
          picture: c.picture || '',
          nip05: c.nip05 || ''
        });
      }
    }

    return Array.from(deduped.values()).slice(0, 8);
  });

  // Reset selected index when matches change
  $effect(() => {
    if (matches.length > 0) {
      selectedIndex = 0;
    } else {
      selectedIndex = -1;
    }
  });

  /**
   * Handle keyboard navigation
   * @param {KeyboardEvent} event
   */
  export function handleKeydown(event) {
    if (!visible || matches.length === 0) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % matches.length;
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
      return true;
    }
    if (event.key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault();
      onselect(matches[selectedIndex]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onselect(/** @type {any} */ (null));
      return true;
    }
    return false;
  }
</script>

{#if visible && matches.length > 0}
  <div
    class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
    style="top: 100%;"
    role="listbox"
    data-testid="author-search-dropdown"
  >
    {#each matches as match, index (match.pubkey)}
      <button
        type="button"
        role="option"
        aria-selected={index === selectedIndex}
        class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200"
        class:bg-base-200={index === selectedIndex}
        onclick={() => onselect(match)}
        data-testid="author-option"
      >
        {#snippet authorInitial()}
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full bg-neutral text-sm text-neutral-content"
          >
            {(match.display_name || match.name || '?')[0]?.toUpperCase()}
          </div>
        {/snippet}
        {#if match.picture}
          <ImageWithFallback
            src={match.picture}
            alt=""
            loading="lazy"
            fallbackType="avatar"
            robohash={false}
            class="h-8 w-8 rounded-full object-cover"
            fallback={authorInitial}
          />
        {:else}
          {@render authorInitial()}
        {/if}
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">
            {match.display_name || match.name || 'Anonymous'}
          </div>
          {#if match.nip05}
            <div class="truncate text-xs text-base-content/60">{match.nip05}</div>
          {/if}
        </div>
      </button>
    {/each}
  </div>
{/if}
