<!--
  ContactSearchInput - Reusable contact search input with dropdown
  Searches user's followed contacts (kind 3) and displays matching profiles
-->

<script>
  import { contactsStore } from '$lib/stores/contacts.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   value?: string,
   *   placeholder?: string,
   *   disabled?: boolean,
   *   onselect?: (contact: import('$lib/stores/contacts.svelte.js').EnrichedContact) => void,
   *   onblur?: () => void,
   *   inputClass?: string,
   *   id?: string,
   *   exclude?: string[]
   * }}
   */
  let {
    value = $bindable(''),
    placeholder = '',
    disabled = false,
    onselect,
    onblur,
    inputClass = '',
    id = undefined,
    exclude = []
  } = $props();

  let showDropdown = $state(false);
  let selectedDropdownIndex = $state(-1);
  /** @type {import('$lib/stores/contacts.svelte.js').EnrichedContact[]} */
  let filteredContacts = $state([]);

  /**
   * Search contacts as user types
   * @param {string} searchTerm
   */
  function searchContacts(searchTerm) {
    if (!searchTerm || searchTerm.trim().length < 2) {
      filteredContacts = [];
      showDropdown = false;
      return;
    }

    const matches = contactsStore.searchContacts(searchTerm, 10);
    filteredContacts = matches.filter((contact) => !exclude.includes(contact.pubkey));
    showDropdown = filteredContacts.length > 0;
    selectedDropdownIndex = -1;
  }

  /**
   * Handle keyboard navigation in dropdown
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    if (showDropdown && filteredContacts.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedDropdownIndex = Math.min(selectedDropdownIndex + 1, filteredContacts.length - 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedDropdownIndex = Math.max(selectedDropdownIndex - 1, -1);
      } else if (event.key === 'Enter' && selectedDropdownIndex >= 0) {
        event.preventDefault();
        selectContact(filteredContacts[selectedDropdownIndex]);
      } else if (event.key === 'Escape') {
        showDropdown = false;
        selectedDropdownIndex = -1;
      }
    }
  }

  /**
   * Select a contact from the dropdown
   * @param {import('$lib/stores/contacts.svelte.js').EnrichedContact} contact
   */
  function selectContact(contact) {
    showDropdown = false;
    filteredContacts = [];
    selectedDropdownIndex = -1;
    onselect?.(contact);
  }

  function handleBlur() {
    setTimeout(() => {
      showDropdown = false;
    }, 200);
    onblur?.();
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

  {#if showDropdown && filteredContacts.length > 0}
    <div
      class="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg"
      style="top: 100%;"
    >
      {#each filteredContacts as contact, index (contact.pubkey)}
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-base-200"
          class:bg-base-200={index === selectedDropdownIndex}
          onclick={() => selectContact(contact)}
        >
          {#if contact.picture}
            <img src={contact.picture} alt="" class="h-8 w-8 rounded-full object-cover" />
          {:else}
            <div
              class="flex h-8 w-8 items-center justify-center rounded-full bg-neutral text-sm text-neutral-content"
            >
              {(contact.display_name || contact.name || '?')[0]?.toUpperCase()}
            </div>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">
              {contact.display_name || contact.name || 'Anonymous'}
            </div>
            {#if contact.nip05}
              <div class="truncate text-xs text-base-content/60">{contact.nip05}</div>
            {/if}
          </div>
        </button>
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
