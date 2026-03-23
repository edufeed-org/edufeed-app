<!--
  ReaderView — Fetches article content and renders highlights inline.
  Falls back to card layout via onerror callback when article can't be fetched.
-->
<script>
  import { browser } from '$app/environment';
  import DOMPurify from 'dompurify';
  import { matchHighlights, injectHighlightMarks } from '$lib/helpers/highlightOverlay.js';
  import BookmarkChip from './BookmarkChip.svelte';
  import HighlightItem from './HighlightItem.svelte';
  import HighlightSelectionTooltip from './HighlightSelectionTooltip.svelte';
  import PageNoteItem from './PageNoteItem.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   articleUrl: string,
   *   highlights: any[],
   *   pageNotes: any[],
   *   bookmarks: any[],
   *   profiles: Map<string, any>,
   *   onerror: () => void,
   *   communityPubkey?: string,
   *   activeUser?: any
   * }}
   */
  let {
    articleUrl,
    highlights,
    pageNotes,
    bookmarks,
    profiles,
    onerror,
    communityPubkey,
    activeUser
  } = $props();

  let isLoading = $state(true);
  let article = $state(
    /** @type {{ title?: string, content?: string, textContent?: string, byline?: string, siteName?: string } | null} */ (
      null
    )
  );
  /** @type {HTMLElement | undefined} */
  let container = $state();
  let unmatchedHighlights = $state.raw(/** @type {any[]} */ ([]));

  // Active highlight state for comment thread overlay
  /** @type {string | null} */
  let activeHighlightId = $state(null);
  let panelTop = $state(0);

  /** @type {Array<{start: number, end: number, events: any[]}>} */
  let matchedHighlights = $state.raw([]);

  // Derive active highlight events from the matched data
  const activeHighlightEvents = $derived.by(() => {
    if (!activeHighlightId) return [];
    for (const match of matchedHighlights) {
      const event = match.events.find((e) => e.id === activeHighlightId);
      if (event) return match.events;
    }
    // Check unmatched highlights too
    const unmatchedEvent = unmatchedHighlights.find((e) => e.id === activeHighlightId);
    return unmatchedEvent ? [unmatchedEvent] : [];
  });

  // Fetch article
  $effect(() => {
    if (!articleUrl) return;
    isLoading = true;

    const abortController = new AbortController();

    fetch(`/api/reader?url=${encodeURIComponent(articleUrl)}`, {
      signal: abortController.signal
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          onerror();
          return;
        }
        article = data.article;
        isLoading = false;
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          onerror();
        }
      });

    return () => abortController.abort();
  });

  // Track sanitized HTML separately so highlight injection can re-run without resetting HTML
  let sanitizedHtml = $derived.by(() => {
    if (!article?.content || !browser) return '';
    if (typeof DOMPurify?.sanitize === 'function') {
      return DOMPurify.sanitize(article.content, {
        ALLOWED_TAGS: [
          'p',
          'br',
          'strong',
          'em',
          'u',
          's',
          'del',
          'code',
          'pre',
          'a',
          'ul',
          'ol',
          'li',
          'blockquote',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'hr',
          'table',
          'thead',
          'tbody',
          'tr',
          'th',
          'td',
          'img',
          'figure',
          'figcaption',
          'mark',
          'span',
          'div',
          'section'
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'class']
      });
    }
    return article.content;
  });

  // Render HTML and inject highlight marks
  $effect(() => {
    if (!container || !sanitizedHtml) return;

    // Reset active highlight when content changes
    activeHighlightId = null;

    // Set sanitized article HTML
    /* eslint-disable svelte/no-dom-manipulating -- safe: sanitized with DOMPurify, required for reader view */
    container.innerHTML = sanitizedHtml;
    /* eslint-enable svelte/no-dom-manipulating */

    // Match and inject highlights using DOM text as single source of truth
    const containerText = container.textContent || '';
    if (highlights.length > 0 && containerText) {
      const { matched, unmatched } = matchHighlights(containerText, highlights);
      matchedHighlights = matched;
      unmatchedHighlights = unmatched;
      if (matched.length > 0) {
        injectHighlightMarks(container, matched, profiles);
      }
    }
  });

  /**
   * Handle click on inline <mark> elements — delegated on container.
   * @param {MouseEvent} e
   */
  function handleMarkClick(e) {
    const mark = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest('mark.reader-highlight')
    );
    if (!mark) return;

    const ids = mark.dataset.highlightIds;
    if (!ids) return;

    const firstId = ids.split(',')[0];

    // Toggle: if same highlight clicked, close; otherwise open
    if (activeHighlightId === firstId) {
      activeHighlightId = null;
      clearActiveMarkStyle();
      return;
    }

    activeHighlightId = firstId;

    // Compute panel position relative to the article wrapper
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

  /**
   * Handle click on unmatched highlight card — toggle expanded state.
   * @param {string} eventId
   */
  function handleUnmatchedHighlightClick(eventId) {
    if (activeHighlightId === eventId) {
      activeHighlightId = null;
    } else {
      clearActiveMarkStyle();
      activeHighlightId = eventId;
    }
  }
</script>

<div class="reader-view">
  {#if isLoading}
    <!-- Loading skeleton -->
    <div class="flex flex-col gap-4 py-8">
      <div class="h-8 w-3/4 skeleton"></div>
      <div class="h-4 w-1/2 skeleton"></div>
      <div class="mt-4 flex flex-col gap-3">
        <div class="h-4 w-full skeleton"></div>
        <div class="h-4 w-full skeleton"></div>
        <div class="h-4 w-5/6 skeleton"></div>
        <div class="h-4 w-full skeleton"></div>
        <div class="h-4 w-4/5 skeleton"></div>
      </div>
    </div>
  {:else if article}
    <!-- Article header -->
    {#if article.title || article.byline || article.siteName}
      <header class="mb-6 border-b border-base-300 pb-4">
        {#if article.title}
          <h1 class="text-2xl font-bold">{article.title}</h1>
        {/if}
        {#if article.byline || article.siteName}
          <p class="mt-1 text-sm text-base-content/60">
            {#if article.byline}{article.byline}{/if}
            {#if article.byline && article.siteName}
              ·
            {/if}
            {#if article.siteName}{article.siteName}{/if}
          </p>
        {/if}
      </header>
    {/if}

    <!-- Bookmarked by -->
    {#if bookmarks.length > 0}
      <section class="mb-6">
        <h2 class="mb-3 text-sm font-semibold text-base-content/70">
          {m.social_bookmarks_bookmarked_by()}
        </h2>
        <div class="flex flex-wrap gap-2">
          {#each bookmarks as bookmark (bookmark.id)}
            <BookmarkChip profile={profiles.get(bookmark.pubkey)} timestamp={bookmark.created_at} />
          {/each}
        </div>
      </section>
    {/if}

    <!-- Article body with inline highlights -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="relative" onclick={handleMarkClick}>
      <article class="prose max-w-none" bind:this={container}></article>
      {#if activeUser && container && communityPubkey}
        <HighlightSelectionTooltip {container} {articleUrl} {communityPubkey} {activeUser} />
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

    <!-- Page notes -->
    {#if pageNotes.length > 0}
      <section class="mt-8 border-t border-base-300 pt-6">
        <h2 class="mb-3 text-sm font-semibold text-base-content/70">
          {m.social_bookmarks_page_notes()}
        </h2>
        <div class="flex flex-col gap-3">
          {#each pageNotes as note (note.id)}
            <PageNoteItem event={note} authorProfile={profiles.get(note.pubkey)} />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .reader-view :global(mark.reader-highlight) {
    background-color: oklch(0.9 0.1 95 / 0.4);
    border-radius: 2px;
    padding: 1px 0;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .reader-view :global(mark.reader-highlight:hover) {
    background-color: oklch(0.85 0.13 95 / 0.6);
  }

  .reader-view :global(mark.reader-highlight-active) {
    background-color: oklch(0.85 0.13 95 / 0.6);
  }
</style>
