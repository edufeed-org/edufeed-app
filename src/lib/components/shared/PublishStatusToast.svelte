<script>
  import { subscribeToPublishStatus } from '$lib/services/publish-service.js';
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {import('$lib/services/publish-service.js').PublishStatus[]} */
  let activeStatuses = $state([]);

  $effect(() => {
    const unsubscribe = subscribeToPublishStatus((status) => {
      // Update or add status
      const existingIndex = activeStatuses.findIndex((s) => s.eventId === status.eventId);
      if (existingIndex >= 0) {
        activeStatuses[existingIndex] = status;
        activeStatuses = [...activeStatuses]; // Trigger reactivity
      } else {
        activeStatuses = [...activeStatuses, status];
      }

      // Auto-remove after delay for success
      if (status.status === 'success') {
        setTimeout(() => {
          activeStatuses = activeStatuses.filter((s) => s.eventId !== status.eventId);
        }, 3000);
      }
    });

    return unsubscribe;
  });

  /**
   * Dismiss a status notification
   * @param {string} eventId
   */
  function dismiss(eventId) {
    activeStatuses = activeStatuses.filter((s) => s.eventId !== eventId);
  }
</script>

{#if activeStatuses.length > 0}
  <div class="toast toast-end toast-bottom z-50">
    {#each activeStatuses as status (status.eventId)}
      <div
        class="alert shadow-lg"
        class:alert-info={status.status === 'pending' || status.status === 'publishing'}
        class:alert-success={status.status === 'success'}
        class:alert-error={status.status === 'failed'}
      >
        <div class="flex flex-1 items-center gap-3">
          {#if status.status === 'pending' || status.status === 'publishing'}
            <span class="loading loading-sm loading-spinner"></span>
            <span
              >{m.publish_status_publishing({
                successCount: String(status.successCount),
                totalRelays: String(status.totalRelays)
              })}</span
            >
          {:else if status.status === 'success'}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span>{m.publish_status_success({ count: String(status.successCount) })}</span>
          {:else if status.status === 'failed'}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span>{m.publish_status_failed()}</span>
          {/if}
        </div>
        <button class="btn btn-circle btn-ghost btn-xs" onclick={() => dismiss(status.eventId)}>
          <CloseIcon class_="w-4 h-4" />
        </button>
      </div>
    {/each}
  </div>
{/if}
