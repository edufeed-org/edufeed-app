<!--
  ShareByNaddrModal Component
  Allows users to paste an naddr to share existing Nostr content with a community
  via NIP-18 repost with h-tag community targeting.
-->

<script>
  import { CloseIcon } from '$lib/components/icons';
  import CommunitySelector from '$lib/components/calendar/CommunitySelector.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  // Share surfaces list joined ∪ area-linked communities — a private area's
  // member never (publicly) follow-set-joins, but must still be able to share.
  import { useShareableCommunities } from '$lib/concord/shareable-communities.svelte.js';
  import { decodeNaddr } from '$lib/helpers/bookmark.js';
  import { createCommunityReposts } from '$lib/helpers/communityRepost.js';
  import { addressLoader } from '$lib/loaders/base.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { firstValueFrom, filter, timeout } from 'rxjs';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import * as m from '$lib/paraglide/messages';

  let { modalId = 'share-by-naddr-modal' } = $props();

  // Props from modal store
  let communityPubkey = $derived(
    /** @type {string} */ (/** @type {any} */ (modalStore.modalProps)?.communityPubkey) || ''
  );
  let allowedKinds = $derived(
    /** @type {number[] | undefined} */ (/** @type {any} */ (modalStore.modalProps)?.allowedKinds)
  );

  // Community selector
  const getJoinedCommunities = useShareableCommunities();
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
  let isFetching = $state(false);
  let isSubmitting = $state(false);
  let error = $state('');
  let success = $state('');

  /** @type {any} */
  let fetchedEvent = $state(null);
  /** @type {string} */
  let fetchedTitle = $state('');
  /** @type {string} */
  let fetchedAuthorPubkey = $state('');

  // Kind labels for display
  /** @type {Record<number, string>} */
  const kindLabels = {
    1: 'Note',
    30023: 'Article',
    30818: 'Wiki',
    30142: 'Learning Resource',
    31922: 'Calendar Event',
    31923: 'Calendar Event'
  };

  /**
   * Strip nostr: prefix and decode naddr
   * @param {string} raw
   * @returns {string}
   */
  function cleanInput(raw) {
    return raw.trim().replace(/^nostr:/, '');
  }

  // Auto-fetch on valid naddr input
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let fetchDebounce;
  $effect(() => {
    const currentInput = input;
    clearTimeout(fetchDebounce);
    fetchedEvent = null;
    fetchedTitle = '';
    fetchedAuthorPubkey = '';
    error = '';
    success = '';

    const cleaned = cleanInput(currentInput);
    if (!cleaned) return;

    const decoded = decodeNaddr(cleaned);
    if (!decoded) {
      if (cleaned.length > 5) error = m.share_modal_error_invalid_naddr();
      return;
    }

    // Validate kind if restricted
    if (allowedKinds && !allowedKinds.includes(decoded.kind)) {
      const allowedLabels = allowedKinds.map((k) => kindLabels[k] || `kind ${k}`).join(', ');
      error = m.share_modal_error_tab_accepts({ types: allowedLabels });
      return;
    }

    fetchDebounce = setTimeout(() => fetchNaddrEvent(cleaned, decoded), 300);

    return () => clearTimeout(fetchDebounce);
  });

  /**
   * Fetch the event referenced by naddr
   * @param {string} _naddrStr
   * @param {import('$lib/helpers/bookmark.js').NaddrData} decoded
   */
  async function fetchNaddrEvent(_naddrStr, decoded) {
    isFetching = true;
    error = '';

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

      fetchedEvent = event;
      fetchedTitle = event.tags?.find((t) => t[0] === 'title')?.[1] || '';
      fetchedAuthorPubkey = event.pubkey;
    } catch {
      error = m.share_modal_error_not_found();
    } finally {
      isFetching = false;
    }
  }

  async function handleSubmit() {
    error = '';
    success = '';

    const account = manager.active;
    if (!account) {
      error = m.share_modal_error_login();
      return;
    }

    if (!fetchedEvent) {
      error = m.share_modal_error_no_event();
      return;
    }

    if (selectedCommunityIds.length === 0) {
      error = m.share_modal_error_no_community();
      return;
    }

    isSubmitting = true;

    try {
      const ok = await createCommunityReposts(fetchedEvent, selectedCommunityIds, account.signer);

      if (ok) {
        success = m.share_modal_success({ count: selectedCommunityIds.length });
        setTimeout(() => modalStore.closeModal(), 1200);
      } else {
        error = m.share_modal_error_share_failed({ count: selectedCommunityIds.length });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : m.share_modal_error_share_generic();
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
      <h3 class="text-lg font-bold">{m.share_modal_title()}</h3>
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
      <!-- naddr input -->
      <div class="form-control mb-3">
        <label class="label" for="share-naddr-input">
          <span class="label-text">{m.share_modal_input_label()}</span>
        </label>
        <input
          id="share-naddr-input"
          type="text"
          class="input-bordered input w-full"
          class:input-error={error && !isFetching}
          class:input-success={fetchedEvent && !error}
          placeholder={m.share_modal_input_placeholder()}
          bind:value={input}
        />
        {#if isFetching}
          <span class="label-text-alt mt-1 text-info">{m.share_modal_fetching()}</span>
        {/if}
      </div>

      <!-- Event preview -->
      {#if fetchedEvent}
        <div class="mb-3 rounded-lg border border-base-300 bg-base-200/50 p-3">
          <div class="text-sm font-medium">
            {fetchedTitle || 'Untitled'}
          </div>
          <div class="mt-1 flex items-center gap-2 text-xs text-base-content/60">
            <span class="badge badge-ghost badge-sm">
              {kindLabels[fetchedEvent.kind] || `Kind ${fetchedEvent.kind}`}
            </span>
            {#if fetchedAuthorPubkey}
              {@const getProfile = useUserProfile(fetchedAuthorPubkey)}
              {@const profile = getProfile()}
              <span>by {getDisplayName(profile) || fetchedAuthorPubkey.slice(0, 8) + '...'}</span>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Community selector -->
      <CommunitySelector
        {communities}
        bind:selectedCommunityIds
        title={m.share_modal_community_label()}
        showSelectAll={true}
      />

      <!-- Error -->
      {#if error}
        <div class="mb-3 alert text-sm alert-error">{error}</div>
      {/if}

      <!-- Success -->
      {#if success}
        <div class="mb-3 alert text-sm alert-success">{success}</div>
      {/if}

      <!-- Actions -->
      <div class="modal-action">
        <button type="button" class="btn" onclick={handleClose}>{m.common_cancel()}</button>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={isSubmitting || !fetchedEvent || selectedCommunityIds.length === 0}
        >
          {#if isSubmitting}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {m.share_modal_submit()}
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleClose}>close</button>
  </form>
</dialog>
