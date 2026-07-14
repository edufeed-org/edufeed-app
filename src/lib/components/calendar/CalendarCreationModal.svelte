<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { useCalendarManagement } from '$lib/stores/calendar-management-store.svelte.js';
  import { useCalendarActions } from '$lib/stores/calendar-actions.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { CloseIcon, AlertIcon } from '$lib/components/icons';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils';
  import { getCalendarRelays } from '$lib/helpers/relay-helper.js';
  import * as m from '$lib/paraglide/messages';

  // Modal ID for dialog element
  const modalId = 'calendar-creation-modal';

  // Form state
  let title = $state('');
  let description = $state('');
  let isSubmitting = $state(false);
  let error = $state('');

  // Get calendar actions for the active user (using empty string as community pubkey for global calendars)
  const calendarActions = manager.active ? useCalendarActions('') : null;

  // Get calendar management store for UI updates
  const calendarManagement = manager.active ? useCalendarManagement(manager.active.pubkey) : null;

  /**
   * Sync dialog open/close with modal store state
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    if (modalStore.activeModal === 'createCalendar') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  });

  /**
   * Sync dialog close events back to the modal store
   * This handles Escape key and backdrop clicks via native dialog behavior
   */
  $effect(() => {
    const dialog = /** @type {HTMLDialogElement} */ (document.getElementById(modalId));
    if (!dialog) return;

    const handleDialogClose = () => {
      if (modalStore.activeModal === 'createCalendar') {
        // Reset form state on close
        resetFormState();
        modalStore.closeModal();
      }
    };

    dialog.addEventListener('close', handleDialogClose);
    return () => {
      dialog.removeEventListener('close', handleDialogClose);
    };
  });

  /**
   * Reset form state to initial values
   */
  function resetFormState() {
    title = '';
    description = '';
    error = '';
    isSubmitting = false;
  }

  /**
   * Handle form submission
   */
  async function handleSubmit() {
    if (!title.trim()) {
      error = m.calendar_creation_modal_error_title_required();
      return;
    }

    if (!calendarActions) {
      error = m.calendar_creation_modal_error_no_account();
      return;
    }

    isSubmitting = true;
    error = '';

    try {
      // Create calendar using calendar actions (publishes to Nostr)
      const resultCalendar = await calendarActions.createCalendar(title.trim(), description.trim());

      if (resultCalendar && resultCalendar.id) {
        // Refresh the calendar management store to show the new calendar
        if (calendarManagement) {
          await calendarManagement.refresh();
        }

        // Generate naddr with relay hints and navigate to calendar page
        const relayHints = getCalendarRelays().slice(0, 3); // Limit to 3 per NIP-19
        const naddr = encodeEventToNaddr(resultCalendar, relayHints);

        handleClose();

        // Navigate to the calendar page
        await goto(resolve(`/calendar/${naddr}`));
      } else {
        error = m.calendar_creation_modal_error_failed();
      }
    } catch (err) {
      console.error('Error creating calendar:', err);
      error = err instanceof Error ? err.message : m.calendar_creation_modal_error_failed();
    } finally {
      isSubmitting = false;
    }
  }

  /**
   * Handle modal close
   */
  function handleClose() {
    resetFormState();
    modalStore.closeModal();
  }

  /**
   * Handle form keydown (submit on Enter)
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }
</script>

{#if modalStore.activeModal === 'createCalendar'}
  <dialog id={modalId} class="modal" aria-labelledby="calendar-creation-title">
    <div class="modal-box max-w-md">
      <!-- Modal Header -->
      <div class="mb-6 flex items-center justify-between">
        <h3 id="calendar-creation-title" class="text-lg font-bold text-base-content">
          {m.calendar_creation_modal_title()}
        </h3>
        <button
          class="btn btn-circle btn-ghost btn-sm"
          onclick={handleClose}
          aria-label={m.calendar_creation_modal_close_modal()}
          disabled={isSubmitting}
        >
          <CloseIcon class_="h-5 w-5" />
        </button>
      </div>

      <!-- Error Display -->
      {#if error}
        <div class="mb-4 alert alert-error">
          <AlertIcon class_="h-5 w-5" />
          <span class="text-sm">{error}</span>
        </div>
      {/if}

      <!-- Form -->
      <form onsubmit={handleSubmit} class="space-y-4">
        <!-- Title Field -->
        <div class="form-control">
          <label class="label" for="calendar-title">
            <span class="label-text font-medium">{m.calendar_creation_modal_name_label()}</span>
          </label>
          <input
            id="calendar-title"
            type="text"
            placeholder={m.calendar_creation_modal_name_placeholder()}
            class="input-bordered input w-full"
            bind:value={title}
            required
            disabled={isSubmitting}
            onkeydown={handleKeydown}
          />
        </div>

        <!-- Description Field -->
        <div class="form-control">
          <label class="label" for="calendar-description">
            <span class="label-text font-medium"
              >{m.calendar_creation_modal_description_label()}</span
            >
          </label>
          <textarea
            id="calendar-description"
            placeholder={m.calendar_creation_modal_description_placeholder()}
            class="textarea-bordered textarea w-full resize-none"
            rows="3"
            bind:value={description}
            disabled={isSubmitting}
          ></textarea>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-3 pt-4">
          <button
            type="button"
            class="btn flex-1 btn-ghost"
            onclick={handleClose}
            disabled={isSubmitting}
          >
            {m.calendar_creation_modal_cancel_button()}
          </button>
          <button
            type="submit"
            class="btn flex-1 btn-primary"
            disabled={isSubmitting || !title.trim()}
          >
            {#if isSubmitting}
              <span class="loading loading-sm loading-spinner"></span>
              {m.calendar_creation_modal_creating()}
            {:else}
              {m.calendar_creation_modal_create_button()}
            {/if}
          </button>
        </div>
      </form>
    </div>
    <!-- Backdrop for clicking outside to close -->
    <form method="dialog" class="modal-backdrop">
      <button disabled={isSubmitting}>close</button>
    </form>
  </dialog>
{/if}
