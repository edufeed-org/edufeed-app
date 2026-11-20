<!--
  WhatsNewModal — a short tour announcing what changed (ModalManager type 'whatsNew').
  Generic: the caller passes the steps (headline, text, an optional "try it now" action) and one
  Scene component that shows each step (`<Scene id={step.id} />`). Copy on the left, the scene
  on the right (above the copy on a phone). Escape and the backdrop close.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /** @typedef {{ id: string, title: string, text: string, note?: string, action?: string, onAction?: () => void }} Step */
  /**
   * @type {{
   *   steps: Step[],
   *   Scene?: import('svelte').Component<{ id: string, onClose: () => void }>,
   *   doneLabel: string,
   *   onDone: () => void,
   *   onClose: () => void
   * }}
   */
  let { steps, Scene, doneLabel, onDone, onClose } = $props();

  let index = $state(0);
  const step = $derived(steps[index]);
  const last = $derived(index === steps.length - 1);

  /** @type {HTMLButtonElement | undefined} */
  let nextEl = $state(undefined);
  $effect(() => {
    nextEl?.focus();
  });

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }
</script>

{#if step}
  <div
    class="modal-open modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="whats-new-title"
    tabindex="-1"
    data-testid="whats-new"
    onkeydown={onKeyDown}
  >
    <div
      class="modal-box grid max-w-3xl grid-cols-1 overflow-hidden p-0 md:grid-cols-[20rem_minmax(0,1fr)]"
    >
      <div class="order-2 flex flex-col gap-2.5 p-6 md:order-1">
        <div class="flex items-center justify-between gap-3">
          <div
            class="text-xs font-semibold tracking-wide text-primary uppercase"
            aria-live="polite"
          >
            {m.whats_new_kicker({ n: index + 1, total: steps.length })}
          </div>
          <div class="flex gap-1.5" aria-hidden="true">
            {#each steps as s, i (s.id)}
              <span class="h-1 w-4 rounded-full {i <= index ? 'bg-primary' : 'bg-base-300'}"></span>
            {/each}
          </div>
        </div>
        <h3 id="whats-new-title" class="text-2xl leading-tight font-bold text-balance">
          {step.title}
        </h3>
        <p class="text-sm text-base-content/70">{step.text}</p>
        {#if step.note}
          <p class="text-sm font-semibold">{step.note}</p>
        {/if}
        <div class="mt-auto flex flex-col gap-3 pt-3">
          {#if step.action}
            <button
              type="button"
              class="btn justify-between btn-outline"
              data-testid="whats-new-try"
              onclick={step.onAction}
            >
              {step.action}
              <span class="text-primary" aria-hidden="true">→</span>
            </button>
          {/if}
          <div class="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              class="btn btn-ghost"
              data-testid="whats-new-back"
              onclick={() => (index === 0 ? onClose() : index--)}
            >
              {index === 0 ? m.whats_new_later() : m.common_back()}
            </button>
            <button
              bind:this={nextEl}
              type="button"
              class="btn btn-primary"
              data-testid="whats-new-next"
              onclick={() => (last ? onDone() : index++)}
            >
              {last ? doneLabel : m.common_next()}
            </button>
          </div>
        </div>
      </div>
      <div
        class="order-1 flex min-h-56 flex-col justify-center border-base-300 bg-base-200 p-5 md:order-2 md:min-h-96 md:border-l"
      >
        {#if Scene}
          {#key step.id}
            <Scene id={step.id} {onClose} />
          {/key}
        {/if}
      </div>
    </div>
    <button
      type="button"
      class="modal-backdrop"
      aria-label={m.common_close()}
      tabindex="-1"
      onclick={onClose}
    ></button>
  </div>
{/if}
