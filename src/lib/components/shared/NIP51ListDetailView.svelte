<!--
  NIP51ListDetailView — Generic read-only detail page for any NIP-51 list event.
  Auto-detects content type from tags and renders: events as FeedCards,
  profiles as chips, hashtags as badges, relay URLs with markers.
-->
<script>
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    getEventPointersFromList,
    getAddressPointersFromList,
    getProfilePointersFromList,
    getRelaysFromList
  } from 'applesauce-common/helpers';
  import { createTimelineLoader } from 'applesauce-loaders/loaders';
  import { timedPool } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import {
    reorderBookmarkSetItem,
    removeItemFromList,
    updateBookmarkSet
  } from '$lib/stores/personal-bookmarks.svelte.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { getContentEventRoute } from '$lib/helpers/contentNavigation.js';
  import { getFeedCardData } from '$lib/helpers/feedCardData.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { parseRelayListEvent } from '$lib/services/relay-settings-service.js';
  import { showToast } from '$lib/helpers/toast.js';
  import FeedCard from '$lib/components/shared/FeedCard.svelte';
  import ProfileCard from '$lib/components/shared/ProfileCard.svelte';
  import DeleteConfirmModal from '$lib/components/shared/DeleteConfirmModal.svelte';
  import {
    ChevronLeftIcon,
    BookmarkIcon,
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

  // Detect what content types this list contains
  let eventPointers = $derived(getEventPointersFromList(event));
  let addressPointers = $derived(getAddressPointersFromList(event));
  let profilePointers = $derived(getProfilePointersFromList(event));
  let hashtags = $derived(event.tags.filter((t) => t[0] === 't').map((t) => t[1]));
  let mutedWords = $derived(event.tags.filter((t) => t[0] === 'word').map((t) => t[1]));
  let mutedThreads = $derived(
    event.tags.filter((t) => t[0] === 'e' && event.kind === 10000).map((t) => t[1])
  );

  let hasEvents = $derived(eventPointers.length > 0 || addressPointers.length > 0);
  let hasProfiles = $derived(profilePointers.length > 0);
  let hasHashtags = $derived(hashtags.length > 0);
  let hasWords = $derived(mutedWords.length > 0);
  let hasThreads = $derived(mutedThreads.length > 0);

  // Relay content — kind 10002 uses parseRelayListEvent (read/write markers),
  // others use getRelaysFromList (plain URLs)
  let relayEntries = $derived(event.kind === 10002 ? parseRelayListEvent(event) : []);
  let relayUrls = $derived(event.kind !== 10002 ? getRelaysFromList(event) : []);
  let hasRelays = $derived(relayEntries.length > 0 || relayUrls.length > 0);

  let isEmpty = $derived(
    !hasEvents && !hasProfiles && !hasHashtags && !hasWords && !hasThreads && !hasRelays
  );

  // Title: parameterized kinds use title/d-tag, replaceable kinds use i18n
  let title = $derived.by(() => {
    const titleTag = event.tags.find((t) => t[0] === 'title')?.[1];
    if (titleTag) return titleTag;
    const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
    if (dTag) return dTag;
    // Fall back to kind-specific i18n names
    switch (event.kind) {
      case 10003:
        return m.dashboard_lists_bookmarks();
      case 10001:
        return m.dashboard_lists_pinned();
      case 10000:
        return m.dashboard_lists_mute();
      case 10015:
        return m.dashboard_lists_interests();
      case 10002:
        return m.dashboard_lists_relay_list();
      case 10007:
        return m.dashboard_lists_search_relays();
      default:
        return 'List';
    }
  });

  let description = $derived(event.tags.find((t) => t[0] === 'description')?.[1] || '');

  // Total item count
  let totalCount = $derived(
    eventPointers.length +
      addressPointers.length +
      profilePointers.length +
      hashtags.length +
      mutedWords.length +
      mutedThreads.length +
      relayEntries.length +
      relayUrls.length
  );

  // --- Event resolution — preserve tag order ---
  let orderedPointerKeys = $derived.by(() => {
    return event.tags
      .filter((t) => t[0] === 'e' || t[0] === 'a')
      .map((t) => (t[0] === 'e' ? `e:${t[1]}` : `a:${t[1]}`));
  });

  /** @type {SvelteMap<string, import('nostr-tools').NostrEvent>} */
  let collectedEvents = $state.raw(new SvelteMap());

  $effect(() => {
    if (!hasEvents) {
      collectedEvents = new SvelteMap();
      return;
    }

    /** @type {import('rxjs').Subscription[]} */
    const subs = [];
    const evtPtrs = getEventPointersFromList(event);
    const addrPtrs = getAddressPointersFromList(event);
    /** @type {SvelteMap<string, import('nostr-tools').NostrEvent>} */
    const collected = new SvelteMap();

    for (const pointer of evtPtrs) {
      const sub = eventStore.event(pointer.id).subscribe((evt) => {
        if (evt) {
          collected.set(`e:${pointer.id}`, evt);
          collectedEvents = new SvelteMap(collected);
        }
      });
      subs.push(sub);
    }

    for (const pointer of addrPtrs) {
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

    if (evtPtrs.length > 0) {
      const hintRelays = evtPtrs.flatMap((p) => p.relays || []);
      const relays = [...new Set([...hintRelays, ...lookupRelays])];
      const ids = evtPtrs.map((p) => p.id);
      const loader = createTimelineLoader(timedPool, relays, { ids }, { eventStore });
      subs.push(loader().subscribe());
    }

    for (const pointer of addrPtrs) {
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

  /** @param {import('nostr-tools').NostrEvent} evt */
  function navigateToEvent(evt) {
    const route = getContentEventRoute(evt);
    if (route) goto(resolve(/** @type {any} */ (route)));
  }

  /** @param {number} fromIndex @param {number} toIndex */
  async function handleReorder(fromIndex, toIndex) {
    const swapped = [...displayEvents];
    [swapped[fromIndex], swapped[toIndex]] = [swapped[toIndex], swapped[fromIndex]];
    optimisticEvents = swapped;
    try {
      await reorderBookmarkSetItem(event, fromIndex, toIndex);
    } catch (err) {
      console.error('Failed to reorder:', err);
      showToast(m.bookmark_toast_error(), 'error');
    }
    optimisticEvents = null;
  }

  // Item removal confirmation
  /** @type {import('nostr-tools').NostrEvent | null} */
  let itemToRemove = $state(null);
  let isRemovingItem = $state(false);

  async function confirmRemoveItem() {
    if (!itemToRemove) return;
    isRemovingItem = true;
    try {
      await removeItemFromList(event, itemToRemove);
      showToast(m.bookmark_set_item_removed(), 'info');
    } catch (err) {
      console.error('Failed to remove item:', err);
      showToast(m.bookmark_toast_error(), 'error');
    } finally {
      isRemovingItem = false;
      itemToRemove = null;
    }
  }

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
      console.error('Failed to update list:', err);
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
</script>

<div class="mx-auto max-w-3xl">
  <!-- Back button -->
  <button class="btn mb-4 gap-1 btn-ghost btn-sm" onclick={() => history.back()}>
    <ChevronLeftIcon class_="w-4 h-4" />
    {m.list_detail_back()}
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
        <p class="mt-1 text-sm text-base-content/40">
          {m.list_detail_items_count({ count: totalCount })}
        </p>
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

  {#if isEmpty}
    <div
      class="flex flex-col items-center justify-center rounded-lg border border-base-300 bg-base-200/50 py-12 text-center"
    >
      <BookmarkIcon class_="mb-3 h-10 w-10 text-base-content/30" />
      <p class="text-base-content/60">{m.list_detail_empty()}</p>
    </div>
  {:else}
    <div class="space-y-6">
      <!-- Events section -->
      {#if hasEvents}
        {#if displayEvents.length > 0}
          {@const profiles = getProfiles()}
          <section>
            <h2 class="mb-3 text-sm font-semibold text-base-content/50 uppercase">
              {m.list_detail_events_section()}
            </h2>
            <div class="space-y-3">
              {#each displayEvents as itemEvent, i (itemEvent.id)}
                {@const cardData = getFeedCardData(itemEvent)}
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
                      role="toolbar"
                      tabindex="-1"
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
          </section>
        {:else}
          <div class="flex justify-center py-8">
            <span class="loading loading-md loading-spinner text-primary"></span>
          </div>
        {/if}
      {/if}

      <!-- Profiles section -->
      {#if hasProfiles}
        <section>
          <h2 class="mb-3 text-sm font-semibold text-base-content/50 uppercase">
            {m.list_detail_profiles_section()}
          </h2>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each profilePointers as pointer (pointer.pubkey)}
              <ProfileCard pubkey={pointer.pubkey} size="sm" showNpub={false} showIcon={false} />
            {/each}
          </div>
        </section>
      {/if}

      <!-- Hashtags section -->
      {#if hasHashtags}
        <section>
          <h2 class="mb-3 text-sm font-semibold text-base-content/50 uppercase">
            {m.list_detail_hashtags_section()}
          </h2>
          <div class="flex flex-wrap gap-2">
            {#each hashtags as tag (tag)}
              <span class="badge badge-outline">#{tag}</span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Muted words section -->
      {#if hasWords}
        <section>
          <h2 class="mb-3 text-sm font-semibold text-base-content/50 uppercase">
            {m.list_detail_words_section()}
          </h2>
          <div class="flex flex-wrap gap-2">
            {#each mutedWords as word (word)}
              <span class="badge badge-outline badge-error">{word}</span>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Muted threads section -->
      {#if hasThreads}
        <section>
          <h2 class="mb-3 text-sm font-semibold text-base-content/50 uppercase">
            {m.list_detail_threads_section()}
          </h2>
          <p class="text-sm text-base-content/50">{mutedThreads.length} threads</p>
        </section>
      {/if}

      <!-- Relays section (with read/write markers for kind 10002) -->
      {#if relayEntries.length > 0}
        <section>
          <h2 class="mb-3 text-sm font-semibold text-base-content/50 uppercase">
            {m.list_detail_relays_section()}
          </h2>
          <div class="space-y-1">
            {#each relayEntries as entry (entry.url)}
              <div
                class="flex items-center justify-between rounded border border-base-300 bg-base-100 px-3 py-1.5 text-sm"
              >
                <span class="font-mono">{entry.url}</span>
                <div class="flex gap-1">
                  {#if entry.read}
                    <span class="badge badge-sm badge-success"
                      >{m.dashboard_lists_relay_read()}</span
                    >
                  {/if}
                  {#if entry.write}
                    <span class="badge badge-sm badge-info">{m.dashboard_lists_relay_write()}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Relays section (plain URLs for other relay list kinds) -->
      {#if relayUrls.length > 0}
        <section>
          <h2 class="mb-3 text-sm font-semibold text-base-content/50 uppercase">
            {m.list_detail_relays_section()}
          </h2>
          <div class="space-y-1">
            {#each relayUrls as relay (relay)}
              <div
                class="flex items-center gap-2 rounded border border-base-300 bg-base-100 px-3 py-1.5 font-mono text-sm"
              >
                {relay}
              </div>
            {/each}
          </div>
        </section>
      {/if}
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

<!-- Delete Confirmation -->
<!-- Delete List Confirmation -->
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
