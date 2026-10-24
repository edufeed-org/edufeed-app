<!--
  DiscoverSearchBar — the /discover search input with its author
  autocomplete and the selected-author badges. Owns the input focus, the
  dropdown's open state (click outside, Escape, tab change) and the keyboard
  routing; the page owns the query, the author filter and what a search does.
-->
<script>
  import { onMount } from 'svelte';
  import AuthorSearchDropdown from '$lib/components/discover/AuthorSearchDropdown.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { SearchIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   value: string,
   *   contentType: string,
   *   authorProfiles: Map<string, any>,
   *   authorFilter: string[],
   *   isSearching?: boolean,
   *   onsearch: () => void,
   *   onclear: () => void,
   *   onauthorselect: (author: any) => void,
   *   onauthorremove: (pubkey: string) => void,
   *   onauthorsclear: () => void
   * }}
   */
  let {
    value = $bindable(''),
    contentType,
    authorProfiles,
    authorFilter,
    isSearching = false,
    onsearch,
    onclear,
    onauthorselect,
    onauthorremove,
    onauthorsclear
  } = $props();

  let inputRef = $state(/** @type {HTMLInputElement | null} */ (null));
  let showDropdown = $state(false);
  /** @type {import('$lib/components/discover/AuthorSearchDropdown.svelte').default | undefined} */
  let dropdownRef;

  // Author autocomplete only where authors can be filtered
  const canSuggestAuthors = $derived(contentType !== 'communities' && contentType !== 'people');

  // A tab switch closes the dropdown
  $effect(() => {
    void contentType;
    showDropdown = false;
  });

  function maybeOpen() {
    showDropdown = value.length >= 2 && canSuggestAuthors;
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    // Let the author dropdown handle keyboard events first
    if (showDropdown && dropdownRef?.handleKeydown(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      showDropdown = false;
      onsearch();
    }
    if (event.key === 'Escape') showDropdown = false;
  }

  function clear() {
    value = '';
    showDropdown = false;
    onclear();
  }

  /** @param {any} author */
  function selectAuthor(author) {
    showDropdown = false;
    if (!author) return;
    value = '';
    onauthorselect(author);
  }

  // Auto-focus + click-outside for the dropdown
  onMount(() => {
    inputRef?.focus();
    function handleClickOutside(/** @type {MouseEvent} */ e) {
      if (
        showDropdown &&
        inputRef &&
        !inputRef.closest('.relative')?.contains(/** @type {Node} */ (e.target))
      ) {
        showDropdown = false;
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });
</script>

<div class="flex w-full gap-2">
  <div class="relative flex-1">
    <div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
      {#if isSearching}
        <span class="loading loading-sm loading-spinner text-primary"></span>
      {:else}
        <SearchIcon class_="h-5 w-5 text-base-content/50" />
      {/if}
    </div>
    <input
      bind:this={inputRef}
      type="text"
      placeholder={contentType === 'people'
        ? m.people_search_placeholder()
        : m.discover_content_search_placeholder()}
      bind:value
      onkeydown={handleKeydown}
      oninput={maybeOpen}
      onfocus={() => {
        if (value.length >= 2 && canSuggestAuthors) showDropdown = true;
      }}
      class="input-bordered input w-full pr-10 pl-9"
      aria-label={m.discover_content_search_aria()}
    />
    {#if value}
      <button
        type="button"
        class="btn absolute top-1/2 right-2 btn-circle -translate-y-1/2 btn-ghost btn-sm"
        onclick={clear}
        aria-label={m.discover_content_clear_search()}
      >
        ✕
      </button>
    {/if}
    <AuthorSearchDropdown
      bind:this={dropdownRef}
      searchTerm={value}
      profileMap={authorProfiles}
      onselect={selectAuthor}
      visible={showDropdown}
    />
  </div>
  <button type="button" class="btn btn-primary" onclick={onsearch}>
    <SearchIcon class_="h-5 w-5" />
    <span class="sr-only sm:not-sr-only">{m.discover_search_button()}</span>
  </button>
</div>

{#if authorFilter.length > 0}
  <div class="flex flex-wrap items-center gap-2" data-testid="author-filter-badge">
    {#each authorFilter as pubkey (pubkey)}
      {@const profile = authorProfiles.get(pubkey)}
      <div class="badge gap-2 badge-lg badge-primary">
        <ProfileAvatar {pubkey} {profile} size="xs" fallbackType="robohash" />
        <span>{profile?.display_name || profile?.name || pubkey.slice(0, 12) + '...'}</span>
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-xs"
          onclick={() => onauthorremove(pubkey)}
          aria-label={m.discover_remove_author_filter()}
        >
          ✕
        </button>
      </div>
    {/each}
    {#if authorFilter.length > 1}
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        onclick={onauthorsclear}
        aria-label={m.discover_clear_author_filters()}
      >
        {m.discover_clear_author_filters()}
      </button>
    {/if}
  </div>
{/if}
