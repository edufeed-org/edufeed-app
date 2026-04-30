<!--
  ReaderView — Fetches article content and renders highlights inline.
  Falls back to card layout via onerror callback when article can't be fetched.
-->
<script>
  import { browser } from '$app/environment';
  import DOMPurify from 'dompurify';
  import BookmarkChip from './BookmarkChip.svelte';
  import BookmarkItem from './BookmarkItem.svelte';
  import PageNoteItem from './PageNoteItem.svelte';
  import HighlightOverlay from '$lib/components/shared/HighlightOverlay.svelte';
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
   *   activeUser?: any,
   *   targetHighlightId?: string | null
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
    activeUser,
    targetHighlightId = null
  } = $props();

  let isLoading = $state(true);
  /** @type {string | null} */
  let activeBookmarkId = $state(null);
  const activeBookmark = $derived(
    activeBookmarkId ? bookmarks.find((b) => b.id === activeBookmarkId) : null
  );
  let article = $state(
    /** @type {{ title?: string, content?: string, textContent?: string, byline?: string, siteName?: string } | null} */ (
      null
    )
  );

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

  // Sanitize fetched HTML
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
            <BookmarkChip
              profile={profiles.get(bookmark.pubkey)}
              timestamp={bookmark.created_at}
              active={activeBookmarkId === bookmark.id}
              onclick={() => {
                activeBookmarkId = activeBookmarkId === bookmark.id ? null : bookmark.id;
              }}
            />
          {/each}
        </div>
        {#if activeBookmark}
          <div class="mt-4" data-testid="bookmark-panel">
            <BookmarkItem
              event={activeBookmark}
              authorProfile={profiles.get(activeBookmark.pubkey)}
              expanded={true}
              {activeUser}
              {communityPubkey}
            />
          </div>
        {/if}
      </section>
    {/if}

    <!-- Article body with inline highlights -->
    <HighlightOverlay
      htmlContent={sanitizedHtml}
      {highlights}
      {profiles}
      source={articleUrl}
      {activeUser}
      {communityPubkey}
      {targetHighlightId}
      class="prose max-w-none"
    />

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
