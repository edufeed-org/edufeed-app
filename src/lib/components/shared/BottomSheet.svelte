<script>
  // Phone bottom sheet: scrim, grab handle, title row, Esc + scrim + close
  // button all call onClose; body scroll is locked while open. The create
  // sheet in GlobalFAB predates this primitive and keeps its own markup.
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   open: boolean,
   *   title: string,
   *   onClose: () => void,
   *   testid?: string,
   *   children: import('svelte').Snippet,
   *   legend?: import('svelte').Snippet
   * }}
   */
  let { open, title, onClose, testid = 'bottom-sheet', children, legend } = $props();

  $effect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

{#if open}
  <button
    type="button"
    data-testid="bottom-sheet-scrim"
    class="fixed inset-0 z-[55] cursor-default bg-(--c-scrim)"
    aria-label={m.aria_close_modal()}
    onclick={onClose}
  ></button>
  <div
    data-testid={testid}
    role="dialog"
    aria-label={title}
    class="pb-safe fixed inset-x-0 bottom-0 z-[60] max-h-[80vh] overflow-y-auto rounded-t-2xl bg-base-100 shadow-2xl"
  >
    <div class="flex items-center justify-center pt-2 pb-1">
      <div class="h-1 w-12 rounded-full bg-base-content/20"></div>
    </div>
    <div class="flex items-center gap-2 px-4 pb-2">
      <h2 class="flex-1 text-lg font-semibold">{title}</h2>
      {#if legend}
        <div class="text-xs text-base-content/60">{@render legend()}</div>
      {/if}
      <button
        type="button"
        data-testid="bottom-sheet-close"
        class="btn btn-circle btn-ghost btn-sm"
        aria-label={m.aria_close_modal()}
        onclick={onClose}
      >
        <CloseIcon class_="h-5 w-5" />
      </button>
    </div>
    <div class="px-4 pt-1 pb-6">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom);
  }
</style>
