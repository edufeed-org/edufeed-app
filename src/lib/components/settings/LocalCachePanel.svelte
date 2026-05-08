<script>
  import { count as cacheCount, clear as cacheClear } from '$lib/stores/event-cache.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {number | null} */
  let eventCount = $state(null);
  let showConfirm = $state(false);
  let clearing = $state(false);

  /** @type {HTMLDialogElement | undefined} */
  let dialog = $state();

  async function refreshCount() {
    try {
      eventCount = await cacheCount();
    } catch (err) {
      console.warn('LocalCachePanel: failed to read cache count', err);
      eventCount = 0;
    }
  }

  $effect(() => {
    refreshCount();
  });

  $effect(() => {
    if (showConfirm && dialog && !dialog.open) {
      dialog.showModal();
    } else if (!showConfirm && dialog?.open) {
      dialog.close();
    }
  });

  function handleDialogClose() {
    showConfirm = false;
  }

  async function handleConfirm() {
    clearing = true;
    try {
      await cacheClear();
      await refreshCount();
    } catch (err) {
      console.warn('LocalCachePanel: failed to clear cache', err);
    } finally {
      clearing = false;
      showConfirm = false;
    }
  }
</script>

<section class="card bg-base-200 shadow-xl">
  <div class="card-body">
    <h2 class="mb-2 card-title text-2xl">
      <span class="text-2xl">{m.settings_cache_title()}</span>
    </h2>
    <p class="mb-6 text-base-content/70">{m.settings_cache_description()}</p>

    <div class="flex items-center justify-between gap-4">
      <span class="text-sm">
        {m.settings_cache_event_count({ count: eventCount ?? 0 })}
      </span>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={() => (showConfirm = true)}
        disabled={clearing}
      >
        {m.settings_cache_clear_button()}
      </button>
    </div>
  </div>
</section>

<dialog
  bind:this={dialog}
  class="modal"
  aria-labelledby="cache-confirm-title"
  onclose={handleDialogClose}
>
  <div class="modal-box">
    <h3 id="cache-confirm-title" class="text-lg font-bold">
      {m.settings_cache_confirm_title()}
    </h3>
    <p class="py-4">{m.settings_cache_confirm_message()}</p>
    <div class="modal-action">
      <button type="button" class="btn" onclick={() => dialog?.close()} disabled={clearing}>
        {m.settings_cache_cancel_button()}
      </button>
      <button type="button" class="btn btn-error" onclick={handleConfirm} disabled={clearing}>
        {#if clearing}
          <span class="loading loading-sm loading-spinner"></span>
        {/if}
        {m.settings_cache_confirm_button()}
      </button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
