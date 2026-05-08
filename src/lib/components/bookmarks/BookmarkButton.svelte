<!--
  BookmarkButton — Dropdown to bookmark an event into the default list or a named set.
  Uses optimistic UI via actionRunner.exec() for instant feedback.
  Uses <details> dropdown so the menu stays open during "new set" input flow.
-->
<script>
  import { tick } from 'svelte';
  import { BookmarkIcon, PlusIcon } from '$lib/components/icons';
  import {
    isBookmarked,
    isBookmarkedAnywhere,
    isInBookmarkSet,
    isBookmarkPending,
    bookmark,
    unbookmark,
    createBookmarkSetAndBookmark,
    getBookmarkSets,
    getBookmarkSetTitle,
    getBookmarkSetIdentifier,
    getIsLoading
  } from '$lib/stores/personal-bookmarks.svelte.js';
  import { manager, useActiveUser } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ event: import('nostr-tools').NostrEvent }} */
  let { event } = $props();

  let dropdownOpen = $state(false);
  let showNewSetInput = $state(false);
  let newSetName = $state('');

  /** @type {HTMLInputElement | undefined} */
  let inputEl = $state(undefined);

  const getActiveUser = useActiveUser();
  let loggedIn = $derived(getActiveUser() != null);

  let active = $derived(isBookmarkedAnywhere(event));
  let inDefault = $derived(isBookmarked(event));
  let sets = $derived(
    getBookmarkSets().toSorted((a, b) =>
      getBookmarkSetTitle(a).localeCompare(getBookmarkSetTitle(b))
    )
  );
  let loading = $derived(getIsLoading());

  function closeDropdown() {
    dropdownOpen = false;
    showNewSetInput = false;
    newSetName = '';
  }

  /**
   * @param {string} [identifier]
   * @param {string} [setName]
   */
  function toggleBookmark(identifier, setName) {
    if (!manager.active) {
      showToast(m.bookmark_toast_login_required(), 'warning');
      return;
    }

    const isIn =
      identifier === undefined
        ? isBookmarked(event)
        : sets.some((s) => getBookmarkSetIdentifier(s) === identifier && isInBookmarkSet(event, s));

    // Fire async action — optimistic.run() sets override synchronously inside,
    // so isBookmarked/isInBookmarkSet flip instantly before signing completes.
    const action = isIn ? unbookmark(event, identifier) : bookmark(event, identifier);
    action.catch((err) => {
      console.error('BookmarkButton: action failed', err);
      showToast(m.bookmark_toast_error(), 'error');
    });

    // Immediate toast
    if (isIn) {
      showToast(
        setName ? m.bookmark_dropdown_removed_from_set({ setName }) : m.bookmark_toast_removed(),
        'info'
      );
    } else {
      showToast(
        setName ? m.bookmark_dropdown_added_to_set({ setName }) : m.bookmark_toast_saved(),
        'success'
      );
    }
  }

  async function showNewSet() {
    showNewSetInput = true;
    await tick();
    inputEl?.focus();
  }

  async function createAndBookmark() {
    const name = newSetName.trim();
    if (!name) return;

    try {
      await createBookmarkSetAndBookmark(event, name);
      showToast(m.bookmark_dropdown_set_created({ setName: name }), 'success');
    } catch (err) {
      console.error('BookmarkButton: create set failed', err);
      showToast(m.bookmark_toast_error(), 'error');
    }
    closeDropdown();
  }

  /** @param {KeyboardEvent} e */
  function handleNewSetKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      createAndBookmark();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      showNewSetInput = false;
      newSetName = '';
    }
  }
</script>

<details class="dropdown dropdown-end" bind:open={dropdownOpen}>
  <summary
    class="btn btn-ghost btn-sm {active ? 'text-primary' : ''} {loading || !loggedIn
      ? 'btn-disabled'
      : ''}"
    title={!loggedIn
      ? m.bookmark_toast_login_required()
      : active
        ? m.bookmark_toast_removed()
        : m.bookmark_toast_saved()}
    onclick={(e) => {
      if (loading || !loggedIn) e.preventDefault();
    }}
  >
    <BookmarkIcon class_="w-4 h-4" filled={active} />
  </summary>
  <ul class="dropdown-content menu z-10 w-56 rounded-box bg-base-200 p-2 shadow-lg">
    <!-- Default bookmark list (kind 10003) -->
    <li>
      <button onclick={() => toggleBookmark(undefined)}>
        {#if isBookmarkPending(event)}
          <span class="loading loading-xs loading-spinner"></span>
        {:else}
          <BookmarkIcon class_="w-4 h-4" filled={inDefault} />
        {/if}
        {m.bookmark_dropdown_default_list()}
      </button>
    </li>

    <!-- Bookmark sets (kind 30003) -->
    {#each sets as set (set.id)}
      {@const identifier = getBookmarkSetIdentifier(set)}
      {@const title = getBookmarkSetTitle(set)}
      {@const inSet = isInBookmarkSet(event, set)}
      <li>
        <button onclick={() => toggleBookmark(identifier, title)}>
          {#if isBookmarkPending(event, identifier)}
            <span class="loading loading-xs loading-spinner"></span>
          {:else}
            <BookmarkIcon class_="w-4 h-4" filled={inSet} />
          {/if}
          {title}
        </button>
      </li>
    {/each}

    <div class="divider my-0"></div>

    <!-- Create new set -->
    {#if showNewSetInput}
      <li class="p-2">
        <div class="flex gap-1">
          <input
            bind:this={inputEl}
            type="text"
            class="input-bordered input input-sm min-w-0 flex-1"
            placeholder={m.bookmark_dropdown_new_set_placeholder()}
            bind:value={newSetName}
            onkeydown={handleNewSetKeydown}
          />
          <button
            class="btn btn-sm btn-primary"
            onclick={createAndBookmark}
            disabled={!newSetName.trim()}
          >
            <PlusIcon class_="w-4 h-4" />
          </button>
        </div>
      </li>
    {:else}
      <li>
        <button onclick={showNewSet}>
          <PlusIcon class_="w-4 h-4" />
          {m.bookmark_dropdown_new_set()}
        </button>
      </li>
    {/if}
  </ul>
</details>
