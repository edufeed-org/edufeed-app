<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { CloseIcon } from '$lib/components/icons';
  import CommunitySelector from '$lib/components/calendar/CommunitySelector.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import { detectInputType, decodeNaddr, createBookmarkEvent } from '$lib/helpers/bookmark.js';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { firstValueFrom, filter, timeout } from 'rxjs';

  let { modalId = 'add-bookmark-modal' } = $props();

  // Props from modal store
  let communityPubkey = $derived(
    /** @type {string} */ (/** @type {any} */ (modalStore.modalProps)?.communityPubkey) || ''
  );

  // Community selector
  const getJoinedCommunities = useJoinedCommunitiesList();
  let communities = $derived(getJoinedCommunities());
  let selectedCommunityIds = $state(/** @type {string[]} */ ([]));

  // Pre-select community from context
  $effect(() => {
    if (communityPubkey && communities.includes(communityPubkey)) {
      selectedCommunityIds = [communityPubkey];
    }
  });

  // Form state
  let input = $state('');
  let title = $state('');
  let description = $state('');
  let isSubmitting = $state(false);
  let error = $state('');
  let isFetching = $state(false);
  let userEditedTitle = $state(false);

  let inputType = $derived(input.trim() ? detectInputType(input) : 'invalid');

  // Auto-fetch metadata on URL input
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let fetchDebounce;
  $effect(() => {
    const currentInput = input;
    const type = detectInputType(currentInput);

    clearTimeout(fetchDebounce);

    if (type === 'url') {
      fetchDebounce = setTimeout(() => fetchUrlMetadata(currentInput), 500);
    } else if (type === 'naddr') {
      fetchDebounce = setTimeout(() => fetchNaddrMetadata(currentInput), 300);
    }

    return () => clearTimeout(fetchDebounce);
  });

  /**
   * Fetch title/description from URL via /api/reader
   * @param {string} urlInput
   */
  async function fetchUrlMetadata(urlInput) {
    let url = urlInput.trim();
    if (!url.startsWith('http')) url = `https://${url}`;

    isFetching = true;
    try {
      const res = await fetch(`/api/reader?url=${encodeURIComponent(url)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.article?.title && !userEditedTitle) {
        title = data.article.title;
      }
    } catch {
      // Silently fail - user can still fill in manually
    } finally {
      isFetching = false;
    }
  }

  /**
   * Fetch title from an naddr-referenced event
   * @param {string} naddrInput
   */
  async function fetchNaddrMetadata(naddrInput) {
    const decoded = decodeNaddr(naddrInput.trim());
    if (!decoded) return;

    isFetching = true;
    try {
      const relays = decoded.relayHint ? [decoded.relayHint] : getAllLookupRelays();
      const sub = addressLoader({
        kind: decoded.kind,
        pubkey: decoded.pubkey,
        identifier: decoded.identifier,
        relays
      }).subscribe();

      const event = await firstValueFrom(
        eventStore.replaceable(decoded.kind, decoded.pubkey, decoded.identifier).pipe(
          filter((e) => e !== undefined),
          timeout(5000)
        )
      );
      sub.unsubscribe();

      const eventTitle = event.tags?.find((t) => t[0] === 'title')?.[1];
      if (eventTitle && !userEditedTitle) {
        title = eventTitle;
      }
    } catch {
      // Silently fail - user can still fill in manually
    } finally {
      isFetching = false;
    }
  }

  async function handleSubmit() {
    error = '';

    const account = manager.active;
    if (!account) {
      error = 'Please log in first';
      return;
    }

    const trimmedInput = input.trim();
    const type = detectInputType(trimmedInput);

    if (type === 'invalid') {
      error = 'Please enter a valid URL or naddr';
      return;
    }

    if (selectedCommunityIds.length === 0) {
      error = 'Please select at least one community';
      return;
    }

    isSubmitting = true;

    try {
      let url = '';
      /** @type {import('$lib/helpers/bookmark.js').NaddrData | undefined} */
      let naddrData;

      if (type === 'url') {
        url = trimmedInput.startsWith('http') ? trimmedInput : `https://${trimmedInput}`;
      } else if (type === 'naddr') {
        naddrData = decodeNaddr(trimmedInput) || undefined;
        if (!naddrData) {
          error = 'Failed to decode naddr';
          isSubmitting = false;
          return;
        }
      }

      const signedEvent = await createBookmarkEvent({
        url,
        title,
        description,
        communityPubkeys: selectedCommunityIds,
        naddrData,
        account
      });

      publishEventOptimistic(signedEvent);
      modalStore.closeModal();

      // Navigate to detail view
      const communityNpub = hexToNpub(selectedCommunityIds[0]);
      if (type === 'url') {
        goto(resolve(`/c/${communityNpub}/bookmarks/${encodeURIComponent(url)}`));
      } else if (type === 'naddr' && naddrData) {
        if (naddrData.kind === 30818) {
          goto(resolve(`/c/${communityNpub}/wiki/${trimmedInput}`));
        } else {
          goto(resolve(`/c/${communityNpub}/article/${trimmedInput}`));
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create bookmark';
    } finally {
      isSubmitting = false;
    }
  }

  function handleClose() {
    modalStore.closeModal();
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box w-11/12 max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-bold">Add Bookmark</h3>
      <button class="btn btn-circle btn-ghost btn-sm" onclick={handleClose} aria-label="Close">
        <CloseIcon class_="h-5 w-5" />
      </button>
    </div>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <!-- URL / naddr input -->
      <div class="form-control mb-3">
        <label class="label" for="bookmark-input">
          <span class="label-text">URL or naddr</span>
        </label>
        <input
          id="bookmark-input"
          type="text"
          class="input-bordered input w-full"
          class:input-error={input.trim() && inputType === 'invalid'}
          class:input-success={inputType === 'url' || inputType === 'naddr'}
          placeholder="https://example.com or naddr1..."
          bind:value={input}
        />
        {#if isFetching}
          <span class="label-text-alt mt-1 text-info">Fetching info...</span>
        {/if}
      </div>

      <!-- Title -->
      <div class="form-control mb-3">
        <label class="label" for="bookmark-title">
          <span class="label-text">Title</span>
        </label>
        <input
          id="bookmark-title"
          type="text"
          class="input-bordered input w-full"
          placeholder="Page title"
          bind:value={title}
          oninput={() => {
            userEditedTitle = true;
          }}
        />
      </div>

      <!-- Description -->
      <div class="form-control mb-3">
        <label class="label" for="bookmark-description">
          <span class="label-text">Comment</span>
        </label>
        <textarea
          id="bookmark-description"
          class="textarea-bordered textarea w-full"
          rows="3"
          placeholder="Add a note (optional)"
          bind:value={description}
        ></textarea>
      </div>

      <!-- Community selector -->
      <CommunitySelector
        {communities}
        bind:selectedCommunityIds
        title="Share to Communities"
        showSelectAll={true}
      />

      <!-- Error -->
      {#if error}
        <div class="mb-3 alert text-sm alert-error">{error}</div>
      {/if}

      <!-- Actions -->
      <div class="modal-action">
        <button type="button" class="btn" onclick={handleClose}>Cancel</button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={isSubmitting || inputType === 'invalid'}
        >
          {#if isSubmitting}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          Add Bookmark
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleClose}>close</button>
  </form>
</dialog>
