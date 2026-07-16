<!--
  ContactSearchInput - Reusable contact search input with dropdown.
  Searches user's followed contacts (kind 3) and displays matching profiles.
  Optional opt-in flags add combobox behaviours used by AddProfileRow:
  - showExcluded: render excluded contacts disabled with a badge
  - acceptPubkeyInput: append a synthetic "add this pubkey" row when the
    input parses as a valid npub/hex and has no existing contact match
-->

<script>
  import { nip19 } from 'nostr-tools';
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import { normalizePubkey } from '$lib/helpers/pubkey.js';
  import * as m from '$lib/paraglide/messages';
  import ImageWithFallback from './ImageWithFallback.svelte';

  /**
   * @type {{
   *   value?: string,
   *   placeholder?: string,
   *   disabled?: boolean,
   *   onselect?: (contact: import('$lib/stores/contacts.svelte.js').EnrichedContact) => void,
   *   onrawpubkey?: (hex: string) => void,
   *   onblur?: () => void,
   *   inputClass?: string,
   *   id?: string,
   *   exclude?: string[],
   *   showExcluded?: boolean,
   *   acceptPubkeyInput?: boolean,
   *   excludedLabel?: string,
   *   addPubkeyLabel?: string
   * }}
   */
  let {
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    onselect,
    onrawpubkey,
    onblur,
    inputClass = '',
    id = undefined,
    exclude = [],
    showExcluded = false,
    acceptPubkeyInput = false,
    excludedLabel = '',
    addPubkeyLabel = ''
  } = $props();

  /**
   * @typedef {{ kind: 'contact', contact: import('$lib/stores/contacts.svelte.js').EnrichedContact, pubkey: string, excluded: boolean }} ContactNavItem
   * @typedef {{ kind: 'pubkey', pubkey: string, npub: string, excluded: boolean }} PubkeyNavItem
   * @typedef {ContactNavItem | PubkeyNavItem} NavItem
   */

  let showDropdown = $state(false);
  let selectedDropdownIndex = $state(-1);
  /** @type {NavItem[]} */
  let navItems = $state([]);

  /**
   * Recompute dropdown items for a given search term.
   * @param {string} searchTerm
   */
  function searchContacts(searchTerm) {
    selectedDropdownIndex = -1;

    const term = (searchTerm || '').trim();
    const matches = term.length >= 2 ? contactsStore.searchContacts(term, 10) : [];

    /** @type {ContactNavItem[]} */
    const contactItems = (
      showExcluded ? matches : matches.filter((c) => !exclude.includes(c.pubkey))
    ).map((c) => ({
      kind: /** @type {'contact'} */ ('contact'),
      contact: c,
      pubkey: c.pubkey,
      excluded: exclude.includes(c.pubkey)
    }));

    /** @type {PubkeyNavItem | null} */
    let pubkeyItem = null;
    if (acceptPubkeyInput) {
      const hex = normalizePubkey(term);
      if (hex && !matches.some((c) => c.pubkey === hex)) {
        pubkeyItem = {
          kind: 'pubkey',
          pubkey: hex,
          npub: nip19.npubEncode(hex),
          excluded: exclude.includes(hex)
        };
      }
    }

    navItems = pubkeyItem ? [...contactItems, pubkeyItem] : contactItems;
    showDropdown = navItems.length > 0;
  }

  /**
   * Handle keyboard navigation in dropdown.
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    if (showDropdown && navItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedDropdownIndex = Math.min(selectedDropdownIndex + 1, navItems.length - 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedDropdownIndex = Math.max(selectedDropdownIndex - 1, -1);
      } else if (event.key === 'Enter' && selectedDropdownIndex >= 0) {
        event.preventDefault();
        selectItem(navItems[selectedDropdownIndex]);
      } else if (event.key === 'Escape') {
        showDropdown = false;
        selectedDropdownIndex = -1;
      }
    }
  }

  /**
   * Select an item from the dropdown. No-op for excluded rows.
   * @param {NavItem} item
   */
  function selectItem(item) {
    if (item.excluded) return;
    showDropdown = false;
    navItems = [];
    selectedDropdownIndex = -1;
    if (item.kind === 'contact') {
      onselect?.(item.contact);
    } else {
      onrawpubkey?.(item.pubkey);
    }
  }

  function handleBlur() {
    setTimeout(() => {
      showDropdown = false;
    }, 200);
    onblur?.();
  }

  /**
   * Short, human-friendly preview of an npub for the synthetic row.
   * @param {string} npub
   */
  function shortNpub(npub) {
    return npub.length > 16 ? `${npub.slice(0, 12)}…${npub.slice(-4)}` : npub;
  }
</script>

<div class="relative">
  <input
    {id}
    type="text"
    class="input-bordered input w-full {inputClass}"
    {placeholder}
    bind:value
    oninput={(e) => searchContacts(e.currentTarget.value)}
    onkeydown={handleKeydown}
    onblur={handleBlur}
    {disabled}
  />

  {#if showDropdown && navItems.length > 0}
    <div
      class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
      style="top: 100%;"
    >
      {#each navItems as item, index (item.kind + ':' + item.pubkey)}
        {#if item.kind === 'contact'}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200"
            class:bg-base-200={index === selectedDropdownIndex}
            class:opacity-60={item.excluded}
            disabled={item.excluded}
            aria-disabled={item.excluded ? 'true' : undefined}
            onclick={() => selectItem(item)}
          >
            <ImageWithFallback
              src={item.contact.picture}
              alt=""
              size="avatar_sm"
              class="h-8 w-8 rounded-full object-cover"
              fallbackType="avatar"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">
                {item.contact.display_name || item.contact.name || 'Anonymous'}
              </div>
              {#if item.contact.nip05}
                <div class="truncate text-xs text-base-content/60">{item.contact.nip05}</div>
              {/if}
            </div>
            {#if item.excluded && excludedLabel}
              <span class="badge badge-sm">{excludedLabel}</span>
            {/if}
          </button>
        {:else}
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200"
            class:bg-base-200={index === selectedDropdownIndex}
            class:opacity-60={item.excluded}
            disabled={item.excluded}
            aria-disabled={item.excluded ? 'true' : undefined}
            onclick={() => selectItem(item)}
          >
            <div
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-base-content/60"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="h-5 w-5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0v.75h-15v-.75Z"
                />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{addPubkeyLabel}</div>
              <div class="truncate font-mono text-xs text-base-content/60">
                {shortNpub(item.npub)}
              </div>
            </div>
            {#if item.excluded && excludedLabel}
              <span class="badge badge-sm">{excludedLabel}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}

  {#if contactsStore.isLoaded && contactsStore.contacts.length > 0}
    <div class="label py-0">
      <span class="label-text-alt text-xs text-base-content/60">
        {m.contact_search_hint({ count: contactsStore.contacts.length })}
      </span>
    </div>
  {:else if contactsStore.isLoading}
    <div class="label py-0">
      <span class="label-text-alt flex items-center gap-1 text-xs text-base-content/60">
        <span class="loading loading-xs loading-spinner"></span>
        {m.contact_search_loading()}
      </span>
    </div>
  {:else}
    <div class="label py-0">
      <span class="label-text-alt text-xs text-base-content/60">
        {m.contact_search_enter_npub()}
      </span>
    </div>
  {/if}
</div>
