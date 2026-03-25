<!--
  EventContextMenu Component
  Three-dots dropdown with copy event ID, copy share link, and view raw event actions
-->

<script>
  import * as m from '$lib/paraglide/messages.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { MoreIcon, CopyIcon, ExternalLinkIcon, InfoIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {import('nostr-tools').NostrEvent} event - Raw Nostr event
   */

  /** @type {Props} */
  let { event } = $props();

  /** @type {HTMLDialogElement|undefined} */
  let rawEventDialog = $state(undefined);
  let isCopied = $state(false);

  function closeDropdown() {
    /** @type {HTMLElement|null} */ (document.activeElement)?.blur();
  }

  async function copyEventId() {
    try {
      const naddr = encodeEventToNaddr(event);
      await navigator.clipboard.writeText(naddr);
      showToast(m.event_menu_event_id_copied(), 'success');
    } catch (err) {
      console.error('Failed to copy event ID:', err);
    }
    closeDropdown();
  }

  async function copyShareLink() {
    try {
      const naddr = encodeEventToNaddr(event);
      await navigator.clipboard.writeText(`https://njump.me/${naddr}`);
      showToast(m.event_menu_share_link_copied(), 'success');
    } catch (err) {
      console.error('Failed to copy share link:', err);
    }
    closeDropdown();
  }

  function viewRawEvent() {
    closeDropdown();
    rawEventDialog?.showModal();
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
  <button tabindex="0" class="btn btn-square btn-ghost btn-sm" aria-label="Event menu">
    <MoreIcon class_="w-5 h-5" />
  </button>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <ul tabindex="0" class="dropdown-content menu z-10 w-56 rounded-box bg-base-200 p-2 shadow-lg">
    <li>
      <button onclick={copyEventId}>
        <CopyIcon class_="w-4 h-4" />
        {m.event_menu_copy_event_id()}
      </button>
    </li>
    <li>
      <button onclick={copyShareLink}>
        <ExternalLinkIcon class_="w-4 h-4" />
        {m.event_menu_copy_share_link()}
      </button>
    </li>
    <li>
      <button onclick={viewRawEvent}>
        <InfoIcon class_="w-4 h-4" />
        {m.event_menu_view_raw_event()}
      </button>
    </li>
  </ul>
</div>

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
