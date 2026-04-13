<script>
  import * as m from '$lib/paraglide/messages';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { joinCommunities } from '$lib/helpers/community.js';
  import { writeMigrationFlag } from '$lib/services/migration-check-service.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import ImageWithFallback from './shared/ImageWithFallback.svelte';

  let { modalId } = $props();

  // Get community pubkeys from modal props
  let communityPubkeys = $derived(
    /** @type {string[]} */ (/** @type {any} */ (modalStore.modalProps)?.communityPubkeys || [])
  );

  // Load profiles for all communities
  const getProfiles = useProfileMap(() => communityPubkeys);

  /**
   * @typedef {'selection' | 'processing' | 'results'} ModalState
   */

  /** @type {ModalState} */
  let modalState = $state('selection');

  /** @type {Set<string>} */
  let selected = $state(new Set());

  /** @type {Map<string, 'pending' | 'success' | 'error'>} */
  let processStatus = $state(new Map());

  /** @type {string[]} */
  let failedPubkeys = $state([]);

  // Initialize selection when pubkeys arrive
  $effect(() => {
    if (communityPubkeys.length > 0 && selected.size === 0 && modalState === 'selection') {
      selected = new Set(communityPubkeys);
    }
  });

  // Sync dialog close with modalStore
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      if (modalStore.activeModal === 'communityMigration') {
        modalStore.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  /** @param {string} pubkey */
  function toggleSelection(pubkey) {
    const next = new Set(selected); // eslint-disable-line svelte/prefer-svelte-reactivity -- transient copy
    if (next.has(pubkey)) {
      next.delete(pubkey);
    } else {
      next.add(pubkey);
    }
    selected = next;
  }

  function selectAll() {
    selected = new Set(communityPubkeys);
  }

  function deselectAll() {
    selected = new Set();
  }

  let allSelected = $derived(selected.size === communityPubkeys.length);
  let noneSelected = $derived(selected.size === 0);

  async function handleRefollow() {
    modalState = 'processing';
    const toProcess = [...selected];
    failedPubkeys = [];
    processStatus = new Map(toProcess.map((pk) => [pk, 'pending']));

    const result = await joinCommunities(toProcess);
    const next = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity
    const status = result.success ? 'success' : 'error';
    for (const pubkey of toProcess) {
      next.set(pubkey, status);
    }
    if (!result.success) {
      failedPubkeys = toProcess;
    }
    processStatus = next;

    modalState = 'results';
  }

  async function handleRetryFailed() {
    modalState = 'processing';
    const toRetry = [...failedPubkeys];
    failedPubkeys = [];

    const next = new Map(processStatus); // eslint-disable-line svelte/prefer-svelte-reactivity
    for (const pubkey of toRetry) {
      next.set(pubkey, 'pending');
    }
    processStatus = next;

    const result = await joinCommunities(toRetry);
    const next2 = new Map(processStatus); // eslint-disable-line svelte/prefer-svelte-reactivity
    const status = result.success ? 'success' : 'error';
    for (const pubkey of toRetry) {
      next2.set(pubkey, status);
    }
    if (!result.success) {
      failedPubkeys = toRetry;
    }
    processStatus = next2;

    modalState = 'results';
  }

  async function handleDone() {
    try {
      await writeMigrationFlag();
    } catch (err) {
      console.error('Failed to write migration flag:', err);
    }
    modalStore.closeModal();
  }

  function handleSkip() {
    // No flag written — modal will reappear next login
    modalStore.closeModal();
  }

  /**
   * Get display name for a community
   * @param {string} pubkey
   * @returns {string}
   */
  function getCommunityName(pubkey) {
    const profile = getProfiles().get(pubkey);
    if (profile) {
      return getDisplayName(profile, truncatedNpub(pubkey));
    }
    return truncatedNpub(pubkey);
  }

  /**
   * Get avatar URL for a community
   * @param {string} pubkey
   * @returns {string|undefined}
   */
  function getCommunityAvatar(pubkey) {
    const profile = getProfiles().get(pubkey);
    return profile ? getProfilePicture(profile) : undefined;
  }

  /**
   * @param {string} pubkey
   * @returns {string}
   */
  function truncatedNpub(pubkey) {
    const npub = hexToNpub(pubkey);
    if (npub) return npub.slice(0, 12) + '...';
    return pubkey.slice(0, 8) + '...';
  }
</script>

<dialog id={modalId} class="modal">
  <div class="modal-box max-w-lg">
    <h3 class="text-lg font-bold">{m.community_migration_modal_title()}</h3>
    <p class="py-2 text-sm opacity-70">{m.community_migration_modal_description()}</p>

    {#if modalState === 'selection'}
      <!-- Selection controls -->
      <div class="mb-2 flex gap-2 text-sm">
        <button class="link link-primary" onclick={selectAll} disabled={allSelected}>
          {m.community_migration_modal_select_all()}
        </button>
        <span class="opacity-30">|</span>
        <button class="link link-primary" onclick={deselectAll} disabled={noneSelected}>
          {m.community_migration_modal_deselect_all()}
        </button>
      </div>

      <!-- Community list -->
      <div class="max-h-64 space-y-1 overflow-y-auto">
        {#each communityPubkeys as pubkey (pubkey)}
          <label class="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-base-200">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              checked={selected.has(pubkey)}
              onchange={() => toggleSelection(pubkey)}
            />
            <div class="avatar">
              <div class="w-8 rounded-full">
                {#if getCommunityAvatar(pubkey)}
                  <ImageWithFallback
                    src={getCommunityAvatar(pubkey)}
                    alt=""
                    size="avatar_sm"
                    class="h-full w-full rounded-full object-cover"
                  />
                {:else}
                  <div
                    class="flex h-full w-full items-center justify-center bg-neutral text-xs text-neutral-content"
                  >
                    {getCommunityName(pubkey).charAt(0).toUpperCase()}
                  </div>
                {/if}
              </div>
            </div>
            <span class="text-sm font-medium">{getCommunityName(pubkey)}</span>
          </label>
        {/each}
      </div>

      <!-- Action buttons -->
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={handleSkip}>
          {m.community_migration_modal_button_skip()}
        </button>
        <button class="btn btn-primary" onclick={handleRefollow} disabled={noneSelected}>
          {m.community_migration_modal_button_refollow()}
        </button>
      </div>
    {:else if modalState === 'processing'}
      <!-- Processing state -->
      <div class="max-h-64 space-y-1 overflow-y-auto">
        {#each [...processStatus.entries()] as [pubkey, status] (pubkey)}
          <div class="flex items-center gap-3 rounded-lg p-2">
            {#if status === 'pending'}
              <span class="loading loading-xs loading-spinner"></span>
            {:else if status === 'success'}
              <span class="text-success">&#10003;</span>
            {:else}
              <span class="text-error">&#10007;</span>
            {/if}
            <span class="text-sm">{getCommunityName(pubkey)}</span>
          </div>
        {/each}
      </div>

      <div class="modal-action">
        <button class="btn btn-disabled" disabled>{m.community_migration_modal_processing()}</button
        >
      </div>
    {:else if modalState === 'results'}
      <!-- Results state -->
      <div class="max-h-64 space-y-1 overflow-y-auto">
        {#each [...processStatus.entries()] as [pubkey, status] (pubkey)}
          <div class="flex items-center gap-3 rounded-lg p-2">
            {#if status === 'success'}
              <span class="text-success">&#10003;</span>
            {:else}
              <span class="text-error">&#10007;</span>
            {/if}
            <span class="text-sm">{getCommunityName(pubkey)}</span>
          </div>
        {/each}
      </div>

      <div class="modal-action">
        {#if failedPubkeys.length > 0}
          <button class="btn btn-ghost" onclick={handleRetryFailed}>
            {m.community_migration_modal_button_retry()}
          </button>
        {/if}
        <button class="btn btn-primary" onclick={handleDone}>
          {#if failedPubkeys.length > 0}
            {m.community_migration_modal_button_done_anyway()}
          {:else}
            {m.community_migration_modal_button_done()}
          {/if}
        </button>
      </div>
    {/if}
  </div>

  <!-- Backdrop click = skip -->
  <form method="dialog" class="modal-backdrop">
    <button onclick={handleSkip}>close</button>
  </form>
</dialog>
