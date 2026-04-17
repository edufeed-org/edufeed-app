<!--
  BookmarkSetView — Detail page for a kind 30003 bookmark set.
  Shows title, description, all bookmarked items with remove buttons,
  and edit/delete actions for the set owner.
-->
<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { SvelteMap } from 'svelte/reactivity';
  import { getEventPointersFromList, getAddressPointersFromList } from 'applesauce-common/helpers';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import {
    unbookmark,
    updateBookmarkSet,
    reorderBookmarkSetItem,
    getBookmarkSetTitle,
    getBookmarkSetIdentifier
  } from '$lib/stores/personal-bookmarks.svelte.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { showToast } from '$lib/helpers/toast.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import DeleteConfirmModal from '$lib/components/shared/DeleteConfirmModal.svelte';
  import {
    BookmarkIcon,
    ChevronLeftIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    EditIcon,
    TrashIcon
  } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ event: import('nostr-tools').NostrEvent }} */
  let { event: initialEvent } = $props();

  // Subscribe to eventStore for the latest version of this replaceable event
  // so mutations (reorder, remove, edit) are immediately reactive.
  /** @type {import('nostr-tools').NostrEvent | null} */
  let liveEvent = $state(null);
  $effect(() => {
    const dTag = initialEvent.tags.find((t) => t[0] === 'd')?.[1] || '';
    const sub = eventStore
      .replaceable(initialEvent.kind, initialEvent.pubkey, dTag)
      .subscribe((evt) => {
        if (evt) liveEvent = evt;
      });
    return () => sub.unsubscribe();
  });

  let event = $derived(liveEvent || initialEvent);

  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());
  let isOwner = $derived(activeUser?.pubkey === event.pubkey);

  // Set metadata
  let title = $derived(getBookmarkSetTitle(event));
  let identifier = $derived(getBookmarkSetIdentifier(event));
  let description = $derived(event.tags.find((t) => t[0] === 'description')?.[1] || '');

  // Resolve bookmarked events — preserve tag order from the set event
  let orderedPointerKeys = $derived.by(() => {
    const bookmarkTagNames = new Set(['e', 'a']);
    return event.tags
      .filter((t) => bookmarkTagNames.has(t[0]))
      .map((t) => (t[0] === 'e' ? `e:${t[1]}` : `a:${t[1]}`));
  });

  /** @type {SvelteMap<string, import('nostr-tools').NostrEvent>} */
  let collectedEvents = $state.raw(new SvelteMap());

  $effect(() => {
    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    const eventPointers = getEventPointersFromList(event);
    const addressPointers = getAddressPointersFromList(event);
    /** @type {SvelteMap<string, import('nostr-tools').NostrEvent>} */
    const collected = new SvelteMap();

    for (const pointer of eventPointers) {
      const sub = eventStore.event(pointer.id).subscribe((evt) => {
        if (evt) {
          collected.set('e:' + pointer.id, evt);
          collectedEvents = new SvelteMap(collected);
        }
      });
      subs.push(sub);
    }

    for (const pointer of addressPointers) {
      const addrKey = 'a:' + pointer.kind + ':' + pointer.pubkey + ':' + (pointer.identifier ?? '');
      const sub = eventStore
        .replaceable(pointer.kind, pointer.pubkey, pointer.identifier)
        .subscribe((evt) => {
          if (evt) {
            collected.set(addrKey, evt);
            collectedEvents = new SvelteMap(collected);
          }
        });
      subs.push(sub);
    }

    const lookupRelays = getAllLookupRelays();

    if (eventPointers.length > 0) {
      const hintRelays = eventPointers.flatMap((p) => p.relays || []);
      const relays = [...new Set([...hintRelays, ...lookupRelays])];
      const ids = eventPointers.map((p) => p.id);
      const loader = createTimelineLoader(timedPool, relays, { ids }, { eventStore });
      subs.push(loader().subscribe());
    }

    for (const pointer of addressPointers) {
      const hintRelays = pointer.relays || [];
      const relays = [...new Set([...hintRelays, ...lookupRelays])];
      const loader = createTimelineLoader(
        timedPool,
        relays,
        { kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier] },
        { eventStore }
      );
      subs.push(loader().subscribe());
    }

    return () => subs.forEach((s) => s.unsubscribe());
  });

  let resolvedEvents = $derived.by(() => {
    /** @type {import('nostr-tools').NostrEvent[]} */
    const result = [];
    for (const key of orderedPointerKeys) {
      const evt = collectedEvents.get(key);
      if (evt) {
        result.push(evt);
        continue;
      }
      if (key.startsWith('a:')) {
        for (const [k, v] of collectedEvents) {
          if (k.startsWith(key)) {
            result.push(v);
            break;
          }
        }
      }
    }
    return result;
  });

  // Optimistic reorder: swap items instantly before async sign+publish completes
  /** @type {import('nostr-tools').NostrEvent[] | null} */
  let optimisticEvents = $state(null);
  let displayEvents = $derived(optimisticEvents || resolvedEvents);

  const getProfiles = useProfileMap(() => displayEvents.map((e) => e.pubkey));

  // Edit modal state
  let showEditModal = $state(false);
  let editTitle = $state('');
  let editDescription = $state('');

  function openEditModal() {
    editTitle = title;
    editDescription = description;
    showEditModal = true;
  }

  async function saveEdit() {
    try {
      await updateBookmarkSet(event, editTitle.trim(), editDescription.trim());
      showToast(m.bookmark_set_updated(), 'success');
      showEditModal = false;
    } catch (err) {
      console.error('Failed to update bookmark set:', err);
      showToast(m.bookmark_toast_error(), 'error');
    }
  }

  // Delete state
  let showDeleteConfirm = $state(false);
  let isDeleting = $state(false);

  async function handleDelete() {
    if (!activeUser) return;
    isDeleting = true;
    try {
      const result = await deleteEvent(event, activeUser);
      if (result.success) {
        showToast(m.bookmark_set_delete(), 'success');
        goto(resolve('/dashboard'));
      } else {
        showToast(result.error || m.bookmark_toast_error(), 'error');
      }
    } catch (_err) {
      showToast(m.bookmark_toast_error(), 'error');
    } finally {
      isDeleting = false;
      showDeleteConfirm = false;
    }
  }

  // Item removal confirmation
  /** @type {import('nostr-tools').NostrEvent | null} */
  let itemToRemove = $state(null);
  let isRemovingItem = $state(false);

  async function confirmRemoveItem() {
    if (!itemToRemove) return;
    isRemovingItem = true;
    try {
      await unbookmark(itemToRemove, identifier);
      showToast(m.bookmark_set_item_removed(), 'info');
    } catch (err) {
      console.error('Failed to remove item:', err);
      showToast(m.bookmark_toast_error(), 'error');
    } finally {
      isRemovingItem = false;
      itemToRemove = null;
    }
  }

  /** @param {number} fromIndex @param {number} toIndex */
  async function handleReorder(fromIndex, toIndex) {
    const swapped = [...displayEvents];
    [swapped[fromIndex], swapped[toIndex]] = [swapped[toIndex], swapped[fromIndex]];
    optimisticEvents = swapped;
    try {
      await reorderBookmarkSetItem(event, fromIndex, toIndex);
    } catch (_err) {
      console.error('Failed to reorder:', _err);
      showToast(m.bookmark_toast_error(), 'error');
    }
    optimisticEvents = null;
  }

  /** @param {import('nostr-tools').NostrEvent} evt */
  function navigateToEvent(evt) {
    const route = getContentEventRoute(evt);
    if (route) goto(resolve(/** @type {any} */ (route)));
  }

  let itemCount = $derived(
    getEventPointersFromList(event).length + getAddressPointersFromList(event).length
  );
</script>

<div class="mx-auto max-w-3xl">
  <!-- Back button -->
  <button class="btn mb-4 gap-1 btn-ghost btn-sm" onclick={() => history.back()}>
    <ChevronLeftIcon class_="w-4 h-4" />
    {m.bookmark_set_back()}
  </button>

  <!-- Header -->
  <div class="mb-6 flex items-start justify-between">
    <div class="flex items-center gap-3">
      <BookmarkIcon class_="h-7 w-7 text-secondary" />
      <div>
        <h1 class="text-2xl font-bold">{title}</h1>
        {#if description}
          <p class="mt-1 text-base-content/60">{description}</p>
        {/if}
        <p class="mt-1 text-sm text-base-content/40">{itemCount} items</p>
      </div>
    </div>
    {#if isOwner}
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-sm" onclick={openEditModal} title={m.bookmark_set_edit()}>
          <EditIcon class="h-4 w-4" />
        </button>
        <button
          class="btn text-error btn-ghost btn-sm"
          onclick={() => (showDeleteConfirm = true)}
          title={m.bookmark_set_delete()}
        >
          <TrashIcon class="h-4 w-4" />
        </button>
      </div>
    {/if}
  </div>

  <!-- Items -->
  {#if displayEvents.length > 0}
    <div class="space-y-3">
      {#each displayEvents as itemEvent, i (itemEvent.id)}
        {@const cardData = getFeedCardData(itemEvent)}
        {@const profiles = getProfiles()}
        {@const authorProfile = profiles.get(itemEvent.pubkey)}
        <div>
          <FeedCard
            title={cardData.title}
            subtitle={cardData.subtitle}
            typeKey={cardData.typeKey}
            kind={itemEvent.kind}
            tags={cardData.tags}
            description={cardData.description}
            authorName={authorProfile?.displayName || authorProfile?.name}
            authorAvatar={authorProfile?.picture}
            authorPubkey={itemEvent.pubkey}
            timestamp={itemEvent.created_at}
            onclick={() => navigateToEvent(itemEvent)}
          />
          {#if isOwner}
            <div
              class="flex items-center gap-1 px-3 py-1"
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => e.stopPropagation()}
            >
              <button
                class="btn text-base-content/50 btn-ghost btn-xs hover:text-base-content"
                onclick={() => handleReorder(i, i - 1)}
                disabled={i === 0}
                title={m.bookmark_set_move_up()}
              >
                <ChevronUpIcon class_="w-4 h-4" />
              </button>
              <button
                class="btn text-base-content/50 btn-ghost btn-xs hover:text-base-content"
                onclick={() => handleReorder(i, i + 1)}
                disabled={i === displayEvents.length - 1}
                title={m.bookmark_set_move_down()}
              >
                <ChevronDownIcon class_="w-4 h-4" />
              </button>
              <div class="flex-1"></div>
              <button
                class="btn text-base-content/50 btn-ghost btn-xs hover:text-error"
                onclick={() => (itemToRemove = itemEvent)}
                title={m.bookmark_set_remove_item()}
              >
                <TrashIcon class="h-4 w-4" />
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if itemCount === 0}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <BookmarkIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="mb-2 text-base-content/60">{m.bookmark_set_empty()}</p>
      <p class="text-sm text-base-content/40">{m.bookmark_set_empty_hint()}</p>
    </div>
  {:else}
    <div class="flex justify-center py-8">
      <span class="loading loading-md loading-spinner text-primary"></span>
    </div>
  {/if}
</div>

<!-- Edit Modal -->
{#if showEditModal}
  <dialog class="modal-open modal">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">{m.bookmark_set_edit()}</h3>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          saveEdit();
        }}
      >
        <div class="space-y-4">
          <div class="form-control">
            <label class="label" for="edit-title">
              <span class="label-text">{m.bookmark_set_edit_title_label()}</span>
            </label>
            <input
              id="edit-title"
              type="text"
              class="input-bordered input w-full"
              bind:value={editTitle}
            />
          </div>
          <div class="form-control">
            <label class="label" for="edit-description">
              <span class="label-text">{m.bookmark_set_edit_description_label()}</span>
            </label>
            <textarea
              id="edit-description"
              class="textarea-bordered textarea w-full"
              rows="3"
              placeholder={m.bookmark_set_edit_description_placeholder()}
              bind:value={editDescription}
            ></textarea>
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn" onclick={() => (showEditModal = false)}>
            {m.common_cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={!editTitle.trim()}>
            {m.bookmark_set_edit_save()}
          </button>
        </div>
      </form>
    </div>
    <button class="modal-backdrop" onclick={() => (showEditModal = false)}>close</button>
  </dialog>
{/if}

<!-- Delete Set Confirmation -->
<DeleteConfirmModal
  open={showDeleteConfirm}
  title={m.bookmark_set_delete_title()}
  itemName={title}
  {isDeleting}
  onconfirm={handleDelete}
  oncancel={() => (showDeleteConfirm = false)}
/>

<!-- Remove Item Confirmation -->
<DeleteConfirmModal
  open={itemToRemove !== null}
  title={m.bookmark_set_remove_item()}
  itemName={itemToRemove ? getFeedCardData(itemToRemove).title || 'item' : ''}
  isDeleting={isRemovingItem}
  onconfirm={confirmRemoveItem}
  oncancel={() => (itemToRemove = null)}
/>
