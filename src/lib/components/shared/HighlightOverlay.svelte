<!--
  HighlightOverlay — Reusable highlight overlay for rendered HTML content.
  Handles highlight matching, DOM injection, selection tooltip, click interactions,
  and unmatched highlights display. Used by ReaderView, ArticleView, WikiView.
-->
<script>
  import { matchHighlights, injectHighlightMarks } from '$lib/helpers/highlightOverlay.js';
  import HighlightItem from '$lib/components/bookmarks/HighlightItem.svelte';
  import HighlightSelectionTooltip from '$lib/components/bookmarks/HighlightSelectionTooltip.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   htmlContent: string,
   *   highlights?: any[],
   *   profiles?: Map<string, any>,
   *   source?: import('nostr-tools/nip19').AddressPointer | string,
   *   activeUser?: any,
   *   communityPubkey?: string,
   *   targetHighlightId?: string | null,
   *   class?: string
   * }}
   */
  let {
    htmlContent,
    highlights = [],
    profiles = new Map(),
    source = undefined,
    activeUser = undefined,
    communityPubkey = undefined,
    targetHighlightId = null,
    class: className = 'prose max-w-none'
  } = $props();

  /** @type {HTMLElement | undefined} */
  let container = $state();
  let unmatchedHighlights = $state.raw(/** @type {any[]} */ ([]));

  /** @type {string | null} */
  let activeHighlightId = $state(null);
  let panelTop = $state(0);

  /** @type {Array<{start: number, end: number, events: any[]}>} */
  let matchedHighlights = $state.raw([]);

  const activeHighlightEvents = $derived.by(() => {
    if (!activeHighlightId) return [];
    for (const match of matchedHighlights) {
      const event = match.events.find((e) => e.id === activeHighlightId);
      if (event) return match.events;
    }
    const unmatchedEvent = unmatchedHighlights.find((e) => e.id === activeHighlightId);
    return unmatchedEvent ? [unmatchedEvent] : [];
  });

  // Render HTML and inject highlight marks
  $effect(() => {
    if (!container || !htmlContent) return;

    activeHighlightId = null;

    /* eslint-disable svelte/no-dom-manipulating -- safe: sanitized HTML, required for highlight injection */
    container.innerHTML = htmlContent;
    /* eslint-enable svelte/no-dom-manipulating */

    const containerText = container.textContent || '';
    if (highlights.length > 0 && containerText) {
      const { matched, unmatched } = matchHighlights(containerText, highlights);
      matchedHighlights = matched;
      unmatchedHighlights = unmatched;
      if (matched.length > 0) {
        injectHighlightMarks(container, matched, profiles);
      }
    } else {
      matchedHighlights = [];
      unmatchedHighlights = [];
    }
  });

  // Scroll to target highlight
  $effect(() => {
    if (!targetHighlightId || !container || matchedHighlights.length === 0) return;

    const mark = /** @type {HTMLElement | null} */ (
      container.querySelector(`mark[data-highlight-ids*="${targetHighlightId}"]`)
    );
    if (mark) {
      requestAnimationFrame(() => {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearActiveMarkStyle();
        mark.classList.add('reader-highlight-active');
        activeHighlightId = targetHighlightId;

        const containerRect = container?.parentElement?.getBoundingClientRect();
        const markRect = mark.getBoundingClientRect();
        if (containerRect) {
          panelTop = markRect.bottom - containerRect.top + 8;
        }
      });
    }
  });

  /** @param {MouseEvent} e */
  function handleMarkClick(e) {
    const mark = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest('mark.reader-highlight')
    );
    if (!mark) {
      if (activeHighlightId) {
        activeHighlightId = null;
        clearActiveMarkStyle();
      }
      return;
    }

    const ids = mark.dataset.highlightIds;
    if (!ids) return;

    const firstId = ids.split(',')[0];

    if (activeHighlightId === firstId) {
      activeHighlightId = null;
      clearActiveMarkStyle();
      return;
    }

    activeHighlightId = firstId;

    clearActiveMarkStyle();
    mark.classList.add('reader-highlight-active');
    const containerRect = container?.parentElement?.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    if (containerRect) {
      panelTop = markRect.bottom - containerRect.top + 8;
    }
  }

  function clearActiveMarkStyle() {
    if (!container) return;
    container
      .querySelectorAll('mark.reader-highlight-active')
      .forEach((el) => el.classList.remove('reader-highlight-active'));
  }

  /** @param {MouseEvent} e */
  function handleWindowClick(e) {
    if (!activeHighlightId) return;
    const target = /** @type {HTMLElement} */ (e.target);
    // If click is inside our overlay container, handleMarkClick handles it
    if (container?.parentElement?.contains(target)) return;
    activeHighlightId = null;
    clearActiveMarkStyle();
  }

  /** @param {string} eventId */
  function handleUnmatchedHighlightClick(eventId) {
    if (activeHighlightId === eventId) {
      activeHighlightId = null;
    } else {
      clearActiveMarkStyle();
      activeHighlightId = eventId;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="highlight-overlay relative" onclick={handleMarkClick}>
  <article class={className} bind:this={container}></article>
  {#if activeUser && container && communityPubkey && source}
    <HighlightSelectionTooltip {container} {source} {communityPubkey} {activeUser} />
  {/if}

  <!-- Inline comment thread overlay for matched highlights -->
  {#if activeHighlightId && activeHighlightEvents.length > 0 && matchedHighlights.some( (m) => m.events.some((e) => e.id === activeHighlightId) )}
    <div class="absolute right-0 left-0 z-10" style:top="{panelTop}px">
      <div class="rounded-lg border border-base-300 bg-base-100 shadow-lg">
        <HighlightItem
          event={activeHighlightEvents[0]}
          authorProfile={profiles.get(activeHighlightEvents[0].pubkey)}
          expanded={true}
          {activeUser}
          {communityPubkey}
          onclick={() => {
            activeHighlightId = null;
            clearActiveMarkStyle();
          }}
        />
      </div>
    </div>
  {/if}
</div>

<!-- Unmatched highlights -->
{#if unmatchedHighlights.length > 0}
  <section class="mt-8 border-t border-base-300 pt-6">
    <h2 class="mb-3 text-sm font-semibold text-base-content/70">
      {m.reader_additional_highlights()}
    </h2>
    <div class="flex flex-col gap-3">
      {#each unmatchedHighlights as highlight (highlight.id)}
        <HighlightItem
          event={highlight}
          authorProfile={profiles.get(highlight.pubkey)}
          expanded={activeHighlightId === highlight.id}
          {activeUser}
          {communityPubkey}
          onclick={() => handleUnmatchedHighlightClick(highlight.id)}
        />
      {/each}
    </div>
  </section>
{/if}

<style>
  .highlight-overlay :global(mark.reader-highlight) {
    background-color: oklch(0.9 0.1 95 / 0.4);
    border-radius: 2px;
    padding: 1px 0;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .highlight-overlay :global(mark.reader-highlight:hover) {
    background-color: oklch(0.85 0.13 95 / 0.6);
  }

  .highlight-overlay :global(mark.reader-highlight-active) {
    background-color: oklch(0.85 0.13 95 / 0.6);
  }
</style>
