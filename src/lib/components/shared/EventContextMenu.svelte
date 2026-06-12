<!--
  EventContextMenu Component
  Three-dots dropdown with author actions, share, copy, pin, and dev actions
-->

<script>
  import * as m from '$lib/paraglide/messages.js';
  import { encodeEventBech32 } from '$lib/helpers/nostrUtils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import {
    MoreIcon,
    CopyIcon,
    ExternalLinkIcon,
    InfoIcon,
    BookmarkIcon,
    RepostIcon,
    EditIcon,
    TrashIcon
  } from '$lib/components/icons';
  import { pinEvent, unpinEvent, isPinned } from '$lib/services/pin-list-service.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import CommunityShare from './CommunityShare.svelte';
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';

  /**
   * @typedef {Object} Props
   * @property {import('nostr-tools').NostrEvent} event - Raw Nostr event
   * @property {(() => void) | undefined} [onEdit] - Callback when edit is clicked
   * @property {(() => void | Promise<void>) | undefined} [onDelete] - Callback when delete is confirmed
   * @property {string} [deleteTitle] - Title for the delete confirmation modal
   * @property {string} [deleteItemName] - Item name shown in the delete confirmation modal
   */

  /** @type {Props} */
  let { event, onEdit, onDelete, deleteTitle = '', deleteItemName = '' } = $props();

  let showDeleteConfirmation = $state(false);
  let isDeleting = $state(false);
  let hasAuthorActions = $derived(!!onEdit || !!onDelete);

  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());

  // Self-detect: active user is community admin if they have a kind 10222 event
  let isCommunityAdmin = $state(false);
  $effect(() => {
    if (!activeUser) {
      isCommunityAdmin = false;
      return;
    }
    const sub = eventStore.replaceable(10222, activeUser.pubkey).subscribe((evt) => {
      isCommunityAdmin = !!evt;
    });
    return () => sub.unsubscribe();
  });

  let canReportMetadata = $derived(
    !!activeUser && activeUser.pubkey !== event.pubkey && event.kind === 30142
  );

  let showPinOption = $derived(!!isCommunityAdmin);
  let eventIsPinned = $derived(
    showPinOption && activeUser ? isPinned(event, activeUser.pubkey) : false
  );

  /** @type {HTMLDialogElement|undefined} */
  let rawEventDialog = $state(undefined);
  /** @type {HTMLDialogElement|undefined} */
  let shareDialog = $state(undefined);
  let isCopied = $state(false);

  function handleEditClick() {
    closeDropdown();
    onEdit?.();
  }

  function handleDeleteClick() {
    closeDropdown();
    showDeleteConfirmation = true;
  }

  async function handleDeleteConfirm() {
    if (!onDelete) return;
    isDeleting = true;
    try {
      await onDelete();
      showDeleteConfirmation = false;
    } catch {
      // Parent should handle error display
    } finally {
      isDeleting = false;
    }
  }

  function handleDeleteCancel() {
    showDeleteConfirmation = false;
  }

  function closeDropdown() {
    /** @type {HTMLElement|null} */ (document.activeElement)?.blur();
  }

  function openShareModal() {
    closeDropdown();
    shareDialog?.showModal();
  }

  async function copyShareLink() {
    try {
      const id = encodeEventBech32(event);
      await navigator.clipboard.writeText(`${window.location.origin}/${id}`);
      showToast(m.event_menu_share_link_copied(), 'success');
    } catch (err) {
      console.error('Failed to copy share link:', err);
    }
    closeDropdown();
  }

  async function togglePin() {
    try {
      if (eventIsPinned) {
        await unpinEvent(event);
        showToast(m.event_menu_unfeatured_toast(), 'success');
      } else {
        await pinEvent(event);
        showToast(m.event_menu_featured_toast(), 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed', 'error');
    }
    closeDropdown();
  }

  async function copyEventId() {
    try {
      const id = encodeEventBech32(event);
      await navigator.clipboard.writeText(id);
      showToast(m.event_menu_event_id_copied(), 'success');
    } catch (err) {
      console.error('Failed to copy event ID:', err);
    }
    closeDropdown();
  }

  function viewRawEvent() {
    closeDropdown();
    rawEventDialog?.showModal();
  }

  function handleReportMetadata() {
    closeDropdown();
    modalStore.openModal('reportMetadata', { event });
  }

  async function copyRawJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      isCopied = true;
      setTimeout(() => {
        isCopied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy raw event:', err);
    }
  }
</script>

<div class="dropdown dropdown-end">
  <button tabindex="0" class="btn btn-square btn-ghost btn-sm" aria-label={m.aria_event_menu()}>
    <MoreIcon class_="w-5 h-5" />
  </button>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <ul tabindex="0" class="dropdown-content menu z-10 w-56 rounded-box bg-base-200 p-2 shadow-lg">
    <!-- Author actions -->
    {#if onEdit}
      <li>
        <button onclick={handleEditClick}>
          <EditIcon class="h-4 w-4" />
          {m.common_edit()}
        </button>
      </li>
    {/if}
    {#if onDelete}
      <li>
        <button class="text-error" onclick={handleDeleteClick}>
          <TrashIcon class="h-4 w-4" />
          {m.common_delete()}
        </button>
      </li>
    {/if}
    {#if hasAuthorActions}
      <div class="divider my-0"></div>
    {/if}
    <!-- Sharing actions -->
    {#if activeUser}
      <li>
        <button onclick={openShareModal}>
          <RepostIcon class_="w-4 h-4" />
          {m.event_menu_share_to_communities()}
        </button>
      </li>
    {/if}
    <li>
      <button onclick={copyShareLink}>
        <ExternalLinkIcon class_="w-4 h-4" />
        {m.event_menu_copy_link()}
      </button>
    </li>
    {#if showPinOption}
      <li>
        <button onclick={togglePin}>
          <BookmarkIcon class_="w-4 h-4" />
          {eventIsPinned ? m.event_menu_remove_from_homepage() : m.event_menu_feature_on_homepage()}
        </button>
      </li>
    {/if}
    {#if canReportMetadata}
      <li>
        <button onclick={handleReportMetadata}>
          <InfoIcon class_="w-4 h-4" />
          {m.report_metadata_menu_item()}
        </button>
      </li>
    {/if}
    <!-- Divider -->
    <div class="divider my-0"></div>
    <!-- Dev actions -->
    <li class="opacity-50">
      <button onclick={copyEventId}>
        <CopyIcon class_="w-4 h-4" />
        {m.event_menu_copy_event_id()}
      </button>
    </li>
    <li class="opacity-50">
      <button onclick={viewRawEvent}>
        <InfoIcon class_="w-4 h-4" />
        {m.event_menu_view_raw_event()}
      </button>
    </li>
  </ul>
</div>

<!-- Share to communities modal -->
<dialog bind:this={shareDialog} class="modal">
  <div class="modal-box max-w-lg">
    <h3 class="mb-4 text-lg font-bold">{m.event_menu_share_to_communities()}</h3>
    {#if activeUser}
      <CommunityShare {event} {activeUser} shareButtonText={m.event_menu_share_to_communities()} />
    {/if}
    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>

<!-- Delete confirmation modal -->
<DeleteConfirmModal
  open={showDeleteConfirmation}
  title={deleteTitle}
  itemName={deleteItemName}
  {isDeleting}
  onconfirm={handleDeleteConfirm}
  oncancel={handleDeleteCancel}
/>

<!-- Raw event modal -->
<dialog bind:this={rawEventDialog} class="modal">
  <div class="modal-box max-w-2xl">
    <div class="mb-4 flex items-center justify-between">
      <h3 class="text-lg font-bold">{m.event_menu_raw_event_title()}</h3>
      <button class="btn btn-sm {isCopied ? 'btn-success' : 'btn-ghost'}" onclick={copyRawJson}>
        <CopyIcon class_="w-4 h-4" />
        {isCopied ? m.common_copied() : m.common_copy()}
      </button>
    </div>
    <div class="max-h-96 overflow-y-auto rounded-lg bg-base-200 p-4">
      <pre class="text-xs">{JSON.stringify(event, null, 2)}</pre>
    </div>
    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{m.common_close()}</button>
      </form>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
