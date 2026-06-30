<script>
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getAllLookupRelays, getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    collectCommunityEvents,
    deleteCommunityEvents,
    downloadCommunityBackup
  } from '$lib/helpers/communityDeletion.js';

  let { modalId } = $props();

  let communityEvent = $derived(/** @type {any} */ (modalStore.modalProps)?.communityEvent);
  let profileEvent = $derived(/** @type {any} */ (modalStore.modalProps)?.profileEvent);

  let communityPubkey = $derived(communityEvent?.pubkey || '');

  // Display name from kind 0 metadata, falling back to a short pubkey.
  let communityName = $derived.by(() => {
    if (profileEvent?.content) {
      try {
        const meta = JSON.parse(profileEvent.content);
        return meta.display_name || meta.name || '';
      } catch {
        /* ignore */
      }
    }
    return communityPubkey ? communityPubkey.slice(0, 12) + '…' : '';
  });

  // The signer able to act for this community (current- or new-keypair community).
  let communitySigner = $derived.by(() => {
    if (!communityPubkey) return null;
    const account = manager.getAccountForPubkey(communityPubkey);
    return account?.signer ?? null;
  });
  let isOwner = $derived(!!communitySigner);

  /** @type {'community' | 'all'} */
  let scope = $state('community');
  let confirmText = $state('');
  let isCollecting = $state(false);
  let isDeleting = $state(false);
  /** @type {any[]} */
  let collectedEvents = $state.raw([]);
  let collectError = $state('');

  const CONFIRM_WORD = 'DELETE';
  let canDelete = $derived(
    isOwner &&
      !isDeleting &&
      !isCollecting &&
      collectedEvents.length > 0 &&
      confirmText.trim() === CONFIRM_WORD
  );

  // Re-collect the community's events whenever the modal opens or the scope
  // changes, so the displayed count + backup reflect the chosen scope. A token
  // guards against out-of-order async resolution when the scope is toggled fast.
  let collectToken = 0;
  $effect(() => {
    const pk = communityPubkey;
    const currentScope = scope;
    if (modalStore.activeModal !== 'deleteCommunity' || !pk) return;

    const token = ++collectToken;
    isCollecting = true;
    collectError = '';
    collectedEvents = [];

    const relays =
      currentScope === 'all'
        ? Array.from(new Set([...getAllLookupRelays(), ...getCommunikeyRelays()]))
        : getCommunikeyRelays();

    collectCommunityEvents({ pubkey: pk, scope: currentScope, relays })
      .then((events) => {
        if (token !== collectToken) return;
        collectedEvents = events;
      })
      .catch((err) => {
        if (token !== collectToken) return;
        console.error('Failed to collect community events:', err);
        collectError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        if (token === collectToken) isCollecting = false;
      });
  });

  // Reset local state when the dialog closes.
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;
    const onClose = () => {
      if (modalStore.activeModal === 'deleteCommunity') {
        modalStore.closeModal();
        resetState();
      }
    };
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  });

  function resetState() {
    scope = 'community';
    confirmText = '';
    collectedEvents = [];
    collectError = '';
    isCollecting = false;
    isDeleting = false;
  }

  function handleDownloadBackup() {
    if (collectedEvents.length === 0) return;
    downloadCommunityBackup(collectedEvents, { pubkey: communityPubkey });
  }

  async function handleDelete() {
    if (!canDelete || !communitySigner) return;
    isDeleting = true;
    try {
      const result = await deleteCommunityEvents({
        events: collectedEvents,
        signer: communitySigner
      });
      if (result.success) {
        showToast(
          m.delete_community_modal_toast_success?.({ count: String(result.deleted) }) ||
            `Deleted ${result.deleted} events`,
          'success'
        );
        closeModal();
        await goto(/** @type {string} */ (resolve('/discover')));
      } else {
        showToast(
          result.error || m.delete_community_modal_toast_failed?.() || 'Failed to delete community',
          'error'
        );
      }
    } catch (err) {
      console.error('Error deleting community:', err);
      showToast(m.delete_community_modal_toast_failed?.() || 'Failed to delete community', 'error');
    } finally {
      isDeleting = false;
    }
  }

  function closeModal() {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (dialog?.open) dialog.close();
    modalStore.closeModal();
    resetState();
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-lg">
    <h1 class="mb-1 text-2xl font-bold text-error">
      {m.delete_community_modal_title?.() || 'Delete Community'}
    </h1>
    {#if communityName}
      <p class="mb-4 text-sm text-base-content/70">{communityName}</p>
    {/if}

    {#if !communityEvent}
      <div class="alert alert-error">
        <span>{m.edit_community_modal_error_no_community?.() || 'No community data available'}</span
        >
      </div>
    {:else if !isOwner}
      <div class="alert alert-warning">
        <span
          >{m.edit_community_modal_error_not_owner?.() ||
            'Only the community owner can edit settings'}</span
        >
      </div>
    {:else}
      <div class="space-y-5">
        <!-- Scope selection -->
        <div class="space-y-3">
          <p class="text-sm font-medium">
            {m.delete_community_modal_scope_label?.() || 'What should be deleted?'}
          </p>

          <label class="flex cursor-pointer gap-3 rounded-lg border border-base-300 p-3">
            <input
              type="radio"
              class="radio mt-1 radio-error"
              value="community"
              bind:group={scope}
            />
            <span class="text-sm">
              <span class="font-medium">
                {m.delete_community_modal_scope_community_title?.() || 'Community events only'}
              </span>
              <br />
              <span class="text-base-content/70">
                {m.delete_community_modal_scope_community_desc?.() ||
                  'The community definition, profile (name/avatar) and access-control lists. The keypair is preserved.'}
              </span>
            </span>
          </label>

          <label class="flex cursor-pointer gap-3 rounded-lg border border-error/40 p-3">
            <input type="radio" class="radio mt-1 radio-error" value="all" bind:group={scope} />
            <span class="text-sm">
              <span class="font-medium text-error">
                {m.delete_community_modal_scope_all_title?.() || 'All events by this key'}
              </span>
              <br />
              <span class="text-base-content/70">
                {m.delete_community_modal_scope_all_desc?.() ||
                  'Every event ever signed by this key. For a personal-key community this erases your entire Nostr history.'}
              </span>
            </span>
          </label>
        </div>

        <!-- Collected count -->
        <div class="rounded-lg bg-base-200 p-3 text-sm">
          {#if isCollecting}
            <span class="loading loading-xs loading-spinner"></span>
            {m.delete_community_modal_counting?.() || 'Finding events…'}
          {:else if collectError}
            <span class="text-error">{collectError}</span>
          {:else}
            {m.delete_community_modal_found_count?.({ count: String(collectedEvents.length) }) ||
              `${collectedEvents.length} events will be deleted`}
          {/if}
        </div>

        <!-- Backup -->
        <button
          type="button"
          class="btn w-full btn-outline btn-sm"
          disabled={isCollecting || collectedEvents.length === 0}
          onclick={handleDownloadBackup}
        >
          {m.delete_community_modal_backup_button?.() || 'Download backup first (JSON)'}
        </button>

        <!-- Irreversible warning -->
        <div class="alert text-sm alert-warning">
          <span>
            {m.delete_community_modal_warning?.() ||
              'This is permanent and cannot be undone. Note: events stored on other people’s relays or memberships held by other users cannot be removed by you.'}
          </span>
        </div>

        <!-- Typed confirmation -->
        <div class="form-control">
          <label class="label" for="delete-community-confirm">
            <span class="label-text">
              {m.delete_community_modal_confirm_label?.({ word: CONFIRM_WORD }) ||
                `Type ${CONFIRM_WORD} to confirm`}
            </span>
          </label>
          <input
            id="delete-community-confirm"
            type="text"
            class="input-bordered input w-full"
            autocomplete="off"
            bind:value={confirmText}
            placeholder={CONFIRM_WORD}
          />
        </div>

        <!-- Actions -->
        <div class="modal-action">
          <form method="dialog">
            <button class="btn" disabled={isDeleting}>
              {m.create_community_modal_button_cancel?.() || 'Cancel'}
            </button>
          </form>
          <button class="btn btn-error" disabled={!canDelete} onclick={handleDelete}>
            {#if isDeleting}
              <span class="loading loading-sm loading-spinner"></span>
              {m.delete_community_modal_deleting?.() || 'Deleting…'}
            {:else}
              {m.delete_community_modal_delete_button?.() || 'Delete permanently'}
            {/if}
          </button>
        </div>
      </div>
    {/if}
  </div>
</dialog>
