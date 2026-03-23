<!--
  EventDeleteButton — Reusable delete button for any Nostr event.
  Renders nothing if the active user doesn't own the event.
-->
<script>
  import { TrashIcon } from '$lib/components/icons';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   event: any,
   *   activeUser?: any
   * }}
   */
  let { event, activeUser = undefined } = $props();

  let isDeleting = $state(false);

  const canDelete = $derived(activeUser && event && event.pubkey === activeUser.pubkey);

  async function handleDelete() {
    if (!canDelete || isDeleting) return;
    if (!confirm(`${m.delete_confirm_text()}? ${m.delete_confirm_cannot_undo()}`)) return;

    isDeleting = true;
    const result = await deleteEvent(event, activeUser);
    isDeleting = false;

    if (result.success) {
      showToast(m.event_delete_success(), 'success');
    } else {
      showToast(m.event_delete_error(), 'error');
    }
  }
</script>

{#if canDelete}
  <button
    class="btn gap-1 text-error btn-ghost btn-xs hover:bg-error/10"
    onclick={handleDelete}
    disabled={isDeleting}
    data-testid="event-delete-btn"
  >
    {#if isDeleting}
      <span class="loading loading-xs loading-spinner"></span>
    {:else}
      <TrashIcon class="h-3.5 w-3.5" />
    {/if}
  </button>
{/if}
