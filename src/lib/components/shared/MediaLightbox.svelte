<!--
  MediaLightbox — fullscreen image overlay for feed media.

  Close: backdrop click, close button, or Escape. Galleries get prev/next
  buttons, arrow-key navigation (wrapping) and an "n / total" counter.
  Clicks are stopped from bubbling so the overlay never triggers card
  navigation in the host component.
-->

<script>
  import * as m from '$lib/paraglide/messages';

  /** @type {{ items: Array<{ src: string, alt?: string }>, startIndex?: number, onclose: () => void }} */
  let { items, startIndex = 0, onclose } = $props();

  let offset = $state(0);
  const index = $derived(
    items.length > 0 ? (((startIndex + offset) % items.length) + items.length) % items.length : 0
  );
  const current = $derived(items[index]);

  /** @param {number} dir */
  function nav(dir) {
    offset += dir;
  }

  /** @param {KeyboardEvent} e */
  function handleWindowKeydown(e) {
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowRight') nav(1);
    else if (e.key === 'ArrowLeft') nav(-1);
  }

  /** @param {MouseEvent} e */
  function handleBackdropClick(e) {
    // Never bubble into the host card's click-to-navigate handler
    e.stopPropagation();
    if (e.target === e.currentTarget) onclose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if current}
  <div
    data-testid="media-lightbox"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    class="fixed inset-0 z-[100] grid cursor-zoom-out place-items-center bg-[rgb(15_13_10/0.9)]"
    onclick={handleBackdropClick}
    onkeydown={(e) => e.stopPropagation()}
  >
    <img
      data-testid="lightbox-image"
      src={current.src}
      alt={current.alt || ''}
      class="max-h-[90vh] max-w-[92vw] cursor-default rounded-lg shadow-2xl"
    />

    {#if items.length > 1}
      <span
        data-testid="lightbox-counter"
        class="absolute top-7 left-1/2 -translate-x-1/2 font-mono text-[13px] text-white/70"
        >{index + 1} / {items.length}</span
      >
      <button
        type="button"
        data-testid="lightbox-prev"
        aria-label={m.media_lightbox_prev()}
        class="absolute top-1/2 left-5 grid h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/10 text-white hover:bg-white/25"
        onclick={() => nav(-1)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
        >
      </button>
      <button
        type="button"
        data-testid="lightbox-next"
        aria-label={m.media_lightbox_next()}
        class="absolute top-1/2 right-5 grid h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/10 text-white hover:bg-white/25"
        onclick={() => nav(1)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg
        >
      </button>
    {/if}

    <button
      type="button"
      data-testid="lightbox-close"
      aria-label={m.media_lightbox_close()}
      class="absolute top-4 right-4 grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-white/10 text-white hover:bg-white/25"
      onclick={onclose}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg
      >
    </button>
  </div>
{/if}
