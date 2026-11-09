<script>
  // Termi conversation history: replaces the message area while open.
  import * as m from '$lib/paraglide/messages';
  import { formatDate } from '$lib/helpers/dates.js';
  import { ChevronLeftIcon, TrashIcon } from '$lib/components/icons';

  /**
   * @type {{
   *   conversations: Array<{ id: string, title: string, updatedAt: number }>,
   *   currentId?: string | null,
   *   onOpen: (id: string) => void,
   *   onNew: () => void,
   *   onRemove: (id: string) => void,
   *   onBack: () => void
   * }}
   */
  let { conversations, currentId = null, onOpen, onNew, onRemove, onBack } = $props();

  /** @type {string | null} */
  let pendingRemoval = $state(null);

  const DAY = /** @type {const} */ ({ day: '2-digit', month: '2-digit', year: 'numeric' });
</script>

<div data-testid="termi-history" class="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
  <div class="flex items-center justify-between gap-2">
    <button type="button" class="btn btn-ghost btn-sm" onclick={onBack}>
      <ChevronLeftIcon class_="h-4 w-4" />
      {m.termi_history_back()}
    </button>
    <button type="button" class="btn btn-sm btn-primary" onclick={onNew}>
      {m.termi_history_new()}
    </button>
  </div>

  {#if conversations.length === 0}
    <p class="py-6 text-center text-sm text-base-content/60">{m.termi_history_empty()}</p>
  {:else}
    <ul class="flex flex-col gap-1">
      {#each conversations as c (c.id)}
        <li
          class="flex items-center gap-1 rounded-xl {c.id === currentId
            ? 'bg-base-200'
            : 'hover:bg-base-200'}"
        >
          <button
            type="button"
            data-testid="termi-history-row"
            aria-current={c.id === currentId ? 'true' : undefined}
            class="min-w-0 flex-1 px-3 py-2 text-left"
            onclick={() => onOpen(c.id)}
          >
            <div class="truncate text-sm font-semibold">{c.title || '…'}</div>
            <div class="text-xs text-base-content/60">
              {formatDate(new Date(c.updatedAt), DAY)}
            </div>
          </button>
          <button
            type="button"
            data-testid="termi-history-delete"
            class="btn btn-circle text-base-content/50 btn-ghost btn-sm hover:text-error"
            aria-label={m.termi_history_delete()}
            title={m.termi_history_delete()}
            onclick={() => (pendingRemoval = c.id)}
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if pendingRemoval}
  <!-- Escape closes only this modal, not the Termi window around it -->
  <div
    class="modal-open modal"
    role="dialog"
    tabindex="-1"
    onkeydown={(e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      pendingRemoval = null;
    }}
  >
    <div class="modal-box max-w-sm">
      <h3 class="text-lg font-extrabold">{m.termi_history_delete()}</h3>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={() => (pendingRemoval = null)}>
          {m.common_cancel()}
        </button>
        <button
          type="button"
          data-testid="termi-history-delete-confirm"
          class="btn btn-primary"
          onclick={() => {
            const id = /** @type {string} */ (pendingRemoval);
            pendingRemoval = null;
            onRemove(id);
          }}
        >
          {m.common_delete()}
        </button>
      </div>
    </div>
  </div>
{/if}
