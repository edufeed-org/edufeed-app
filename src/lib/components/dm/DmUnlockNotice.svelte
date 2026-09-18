<!--
  DmUnlockNotice
  Gift wraps that fail to decrypt used to disappear with nothing but a console
  warning — the thread just looked shorter, and the loss survived a reload
  (laoc, 2026-09-18). This says how many messages are affected and offers a
  retry, which hands them to the signer again.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /** @type {{ count: number, onRetry: () => void, retrying?: boolean }} */
  let { count, onRetry, retrying = false } = $props();
</script>

{#if count > 0}
  <div
    class="flex items-center gap-2 bg-warning/10 px-4 py-2 text-sm text-base-content/80"
    data-testid="dm-unlock-notice"
  >
    <span class="min-w-0 flex-1">
      {count === 1 ? m.dm_unlock_failed_one() : m.dm_unlock_failed_many({ count })}
    </span>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      disabled={retrying}
      onclick={() => onRetry()}
    >
      {retrying ? m.dm_unlock_retrying() : m.dm_unlock_retry()}
    </button>
  </div>
{/if}
