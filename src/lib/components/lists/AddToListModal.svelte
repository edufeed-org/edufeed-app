<!--
  AddToListModal — put a person on my people lists, from their side
  (issue af4b3ae8). Opened by ModalManager (type 'addToList') from the
  profile ⋯ menu and the profile hover card.

  One checkbox per kind 30000 list of mine (community membership excluded):
  tick adds the person publicly, untick removes them from where they are
  (public or private part). A list whose private part cannot be read stays
  disabled — the person may be in it privately, and adding them publicly
  would publish what the owner kept private. "Neue Liste" creates a list
  with the person in it. Small-modal grammar, CSS-only modal.
-->
<script>
  import {
    AddUserToFollowSet,
    RemoveUserFromFollowSet,
    CreateFollowSet
  } from 'applesauce-actions/actions';
  import { unlockHiddenTags } from 'applesauce-core/helpers/hidden-tags';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { useAllLists, isListsLoading } from '$lib/stores/personal-lists.svelte.js';
  import {
    listMembership,
    listTitle,
    pickablePeopleLists
  } from '$lib/helpers/people-list-membership.js';
  import { getDisplayName } from '$lib/helpers/displayName.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { CloseIcon, PlusIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string, onClose: () => void }} */
  let { pubkey, onClose } = $props();

  const getProfile = useUserProfile(() => pubkey);
  const displayName = $derived(getDisplayName(getProfile(), pubkey));

  const getLists = useAllLists(30000);
  const lists = $derived(pickablePeopleLists(getLists()));

  // Bumped when a private part got decrypted (the cache is a Symbol on the
  // event, which Svelte does not see).
  let unlocked = $state(0);
  /** @type {Set<string>} */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- internal bookkeeping, not reactive state
  const unlockTried = new Set();
  $effect(() => {
    const signer = manager.active?.signer;
    if (!signer) return;
    for (const list of lists) {
      if (listMembership(list, pubkey) !== 'locked' || unlockTried.has(list.id)) continue;
      unlockTried.add(list.id);
      const method = list.content.includes('?iv=') ? 'nip04' : 'nip44';
      unlockHiddenTags(list, signer, method)
        .then(() => unlocked++)
        .catch((err) => console.debug('[add-to-list] private part stays locked', err));
    }
  });

  const rows = $derived.by(() => {
    void unlocked;
    return lists.map((list) => ({
      list,
      d: list.tags.find((t) => t[0] === 'd')?.[1] ?? '',
      title: listTitle(list),
      membership: listMembership(list, pubkey)
    }));
  });

  /** d-tag of the row being written */
  let busy = $state('');
  let newTitle = $state('');
  let creating = $state(false);

  /** @param {(typeof rows)[number]} row */
  async function toggle(row) {
    if (busy || row.membership === 'locked') return;
    busy = row.d;
    try {
      if (row.membership === 'none') {
        await actionRunner.run(AddUserToFollowSet, pubkey, row.d);
      } else {
        await actionRunner.run(RemoveUserFromFollowSet, pubkey, row.d, row.membership === 'hidden');
      }
      showToast(m.list_detail_updated(), 'success');
    } catch (err) {
      console.error('Failed to update list:', err);
      showToast(m.list_detail_update_error(), 'error');
    } finally {
      busy = '';
    }
  }

  async function createList() {
    const title = newTitle.trim();
    if (!title || creating) return;
    creating = true;
    try {
      await actionRunner.run(CreateFollowSet, title, { public: [pubkey] });
      newTitle = '';
      showToast(m.list_detail_updated(), 'success');
    } catch (err) {
      console.error('Failed to create list:', err);
      showToast(m.list_detail_update_error(), 'error');
    } finally {
      creating = false;
    }
  }

  /** @type {HTMLDivElement | undefined} */
  let rootEl = $state(undefined);
  $effect(() => {
    rootEl?.focus();
  });

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }
</script>

<div
  class="modal-open modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="add-to-list-title"
  tabindex="-1"
  data-testid="add-to-list-modal"
  bind:this={rootEl}
  onkeydown={onKeyDown}
>
  <div class="modal-box max-w-sm">
    <div class="mb-3 flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 id="add-to-list-title" class="font-bold">{m.add_to_list_title()}</h3>
        <p class="truncate text-sm text-base-content/60">{displayName}</p>
      </div>
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        aria-label={m.common_close()}
        onclick={onClose}
      >
        <CloseIcon class_="w-5 h-5" />
      </button>
    </div>

    {#if rows.length > 0}
      <ul class="mb-4 max-h-72 space-y-1 overflow-y-auto">
        {#each rows as row (row.list.id)}
          <li>
            <label
              class="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-base-200"
              class:opacity-60={row.membership === 'locked'}
              title={row.membership === 'locked' ? m.add_to_list_locked() : undefined}
            >
              <input
                type="checkbox"
                class="checkbox checkbox-sm checkbox-primary"
                checked={row.membership === 'public' || row.membership === 'hidden'}
                disabled={row.membership === 'locked' || !!busy}
                data-testid="add-to-list-row-{row.d}"
                onchange={() => toggle(row)}
              />
              <span class="min-w-0 flex-1 truncate">{row.title}</span>
              {#if busy === row.d}
                <span class="loading loading-xs loading-spinner"></span>
              {:else if row.membership === 'hidden'}
                <span class="badge badge-ghost badge-sm">{m.add_to_list_private()}</span>
              {/if}
            </label>
          </li>
        {/each}
      </ul>
    {:else if isListsLoading()}
      <div class="mb-4 flex justify-center py-4">
        <span class="loading loading-md loading-spinner text-primary"></span>
      </div>
    {:else}
      <p class="mb-4 text-sm text-base-content/60">{m.add_to_list_none()}</p>
    {/if}

    <form
      class="flex gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        createList();
      }}
    >
      <input
        type="text"
        class="input-bordered input input-sm min-w-0 flex-1"
        placeholder={m.add_to_list_new_placeholder()}
        aria-label={m.add_to_list_new_placeholder()}
        bind:value={newTitle}
        maxlength="100"
        data-testid="add-to-list-new-title"
      />
      <button
        type="submit"
        class="btn btn-sm btn-primary"
        disabled={!newTitle.trim() || creating}
        data-testid="add-to-list-create"
      >
        {#if creating}
          <span class="loading loading-xs loading-spinner"></span>
        {:else}
          <PlusIcon class_="w-4 h-4" />
        {/if}
        {m.add_to_list_new_button()}
      </button>
    </form>
  </div>
  <button
    type="button"
    class="modal-backdrop"
    aria-label={m.common_close()}
    tabindex="-1"
    onclick={onClose}
  ></button>
</div>
