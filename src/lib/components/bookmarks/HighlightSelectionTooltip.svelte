<!--
  HighlightSelectionTooltip — Shows a floating "Highlight" button when text is selected
  in the article container. Publishes NIP-84 highlight (kind 9802) on click.
-->
<script>
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { HighlightBlueprint } from 'applesauce-common/blueprints';
  import { publishEventOptimistic } from '$lib/services/publish-service.js';
  import { getPrimaryWriteRelay } from '$lib/services/relay-service.svelte.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { extractContext, normalizeWhitespace } from '$lib/helpers/highlightOverlay.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   container: HTMLElement,
   *   source: import('nostr-tools/nip19').AddressPointer | string,
   *   communityPubkey: string,
   *   activeUser: any
   * }}
   */
  let { container, source, communityPubkey, activeUser } = $props();

  let visible = $state(false);
  let isSaving = $state(false);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let selectedText = $state('');
  /** @type {HTMLElement | undefined} */
  let tooltipEl = $state();

  $effect(() => {
    if (!container) return;

    function handleMouseUp() {
      // Small delay to let selection finalize
      requestAnimationFrame(checkSelection);
    }

    function handleKeyUp(/** @type {KeyboardEvent} */ e) {
      if (e.key === 'Escape') {
        dismiss();
        return;
      }
      // Shift+arrow keys can change selection
      if (e.shiftKey) {
        requestAnimationFrame(checkSelection);
      }
    }

    function handleMouseDown(/** @type {MouseEvent} */ e) {
      // Dismiss if clicking outside the tooltip
      if (tooltipEl && !tooltipEl.contains(/** @type {Node} */ (e.target))) {
        dismiss();
      }
    }

    container.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  });

  function checkSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      // Don't dismiss if we're currently saving
      if (!isSaving) dismiss();
      return;
    }

    // Ensure selection is within our container
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      dismiss();
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      dismiss();
      return;
    }

    selectedText = text;

    // Position relative to container
    const rangeRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    tooltipX = rangeRect.left - containerRect.left + rangeRect.width / 2;
    tooltipY = rangeRect.top - containerRect.top - 8;
    visible = true;
  }

  function dismiss() {
    visible = false;
    selectedText = '';
  }

  async function handleHighlight() {
    if (!activeUser || !selectedText || isSaving) return;

    isSaving = true;

    try {
      const factory = createAppEventFactory({ signer: activeUser.signer });

      const context = container
        ? extractContext(container.textContent || '', selectedText)
        : undefined;

      const draft = await factory.create(HighlightBlueprint, selectedText, source, {
        context: context || undefined
      });

      // Add relay hint to a-tag for discoverability
      const aTagIdx = draft.tags.findIndex((t) => t[0] === 'a');
      if (aTagIdx !== -1 && typeof source === 'object' && source.pubkey) {
        const relayHint = await getPrimaryWriteRelay(source.pubkey);
        if (relayHint) {
          draft.tags[aTagIdx] = [...draft.tags[aTagIdx].slice(0, 2), relayHint];
        }
      }

      // Add W3C TextQuoteSelector tag for Lantern interop
      if (context) {
        const normCtx = normalizeWhitespace(context);
        const normSel = normalizeWhitespace(selectedText);
        const idx = normCtx.indexOf(normSel);
        if (idx !== -1) {
          draft.tags.push([
            'textquoteselector',
            '-',
            normCtx.slice(0, idx),
            normCtx.slice(idx + normSel.length)
          ]);
        }
      }

      // Add community h-tag
      if (communityPubkey) {
        draft.tags.push(['h', communityPubkey]);
      }

      const signedEvent = await factory.sign(draft);

      // Optimistic UI: add to EventStore immediately
      eventStore.add(signedEvent);

      // Publish in background
      publishEventOptimistic(signedEvent, []);

      dismiss();
    } catch (err) {
      console.error('Failed to create highlight:', err);
    } finally {
      isSaving = false;
    }
  }
</script>

{#if visible}
  <div
    bind:this={tooltipEl}
    class="highlight-tooltip"
    style:left="{tooltipX}px"
    style:top="{tooltipY}px"
    role="tooltip"
  >
    <button
      class="btn btn-xs btn-primary"
      onclick={handleHighlight}
      disabled={isSaving}
      data-testid="highlight-btn"
    >
      {#if isSaving}
        <span class="loading loading-xs loading-spinner"></span>
        {m.highlight_saving()}
      {:else}
        {m.highlight_button()}
      {/if}
    </button>
  </div>
{/if}

<style>
  .highlight-tooltip {
    position: absolute;
    transform: translate(-50%, -100%);
    z-index: 50;
    pointer-events: auto;
  }
</style>
