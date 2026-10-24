<!--
  DiscoverFeedGrid — the masonry of content cards on /discover (all /
  events / learning / articles / boards). Owns the lazy card rendering
  (cards render once they approach the viewport and stay rendered) and the
  infinite-scroll sentinel; the page owns what the items are and what
  "load more" does.
-->
<script>
  import { SvelteSet } from 'svelte/reactivity';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import KanbanBoardCard from '$lib/components/kanban/KanbanBoardCard.svelte';
  import ContentCardSkeleton from '$lib/components/shared/ContentCardSkeleton.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   items: Array<{ type: string, data: any }>,
   *   authorProfiles: Map<string, any>,
   *   isLoading: boolean,
   *   isSearching: boolean,
   *   hasAnySource: boolean,
   *   emptyMessage?: string,
   *   emptyHint?: string,
   *   hasMore: boolean,
   *   isLoadingMore: boolean,
   *   failing: boolean,
   *   onEventClick: (event: any) => void,
   *   onloadmore: () => void
   * }}
   */
  let {
    items,
    authorProfiles,
    isLoading,
    isSearching,
    hasAnySource,
    emptyMessage = '',
    emptyHint = '',
    hasMore,
    isLoadingMore,
    failing,
    onEventClick,
    onloadmore
  } = $props();

  // Lazy rendering: rendering is STICKY. Once a card rendered it stays
  // rendered — un-rendering on exit changes card heights, which rebalances
  // the masonry columns and shifts cards across the observer boundary (a
  // visible flicker loop).
  let visibleItemIds = $state(/** @type {Set<string>} */ (new Set()));
  /** @type {IntersectionObserver | undefined} */
  let cardObserver;

  $effect(() => {
    cardObserver = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-item-id');
          if (!id) continue;
          if (entry.isIntersecting && !visibleItemIds.has(id)) {
            visibleItemIds.add(id);
            changed = true;
            // Rendered for good — no need to keep tracking this node.
            cardObserver?.unobserve(entry.target);
          }
        }
        if (changed) visibleItemIds = new SvelteSet(visibleItemIds);
      },
      { rootMargin: '800px' } // Pre-render items 800px before viewport for smooth scrolling
    );
    return () => cardObserver?.disconnect();
  });

  /**
   * @param {HTMLElement} node
   * @param {string} itemId
   */
  function observeCard(node, itemId) {
    node.setAttribute('data-item-id', itemId);
    cardObserver?.observe(node);
    return {
      destroy: () => cardObserver?.unobserve(node),
      update: (/** @type {string} */ newId) => {
        node.setAttribute('data-item-id', newId);
      }
    };
  }

  // Infinite scroll: arm the sentinel while there is more and something is shown
  $effect(() => {
    if (!hasMore || isLoading || items.length === 0) return;
    const sentinel = document.getElementById('load-more-sentinel');
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) onloadmore();
      },
      { root: null, rootMargin: '200px', threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });
</script>

{#if (isLoading || isSearching) && items.length === 0}
  <!-- Store first: the spinner only while nothing is rendered yet. Content
       already in the EventStore (coming back to /discover) shows at once;
       while a search is in flight the spinner stands in for the empty state. -->
  <div class="flex justify-center py-12">
    <div class="text-center">
      <div class="loading loading-lg loading-spinner text-primary"></div>
      <p class="mt-4 text-base-content/70">{m.discover_loading()}</p>
    </div>
  </div>
{:else if items.length === 0}
  <div class="flex justify-center py-12">
    <div class="text-center">
      {#if emptyMessage}
        <!-- A filter-specific explanation (e.g. "My communities" with none joined) -->
        <p class="text-xl text-base-content/70" data-testid="discover-empty-message">
          {emptyMessage}
        </p>
        {#if emptyHint}<p class="mt-2 text-base-content/50">{emptyHint}</p>{/if}
      {:else if !hasAnySource}
        <p class="text-xl text-base-content/70">{m.discover_no_content()}</p>
        <p class="mt-2 text-base-content/50">{m.discover_no_content_subtitle()}</p>
      {:else}
        <p class="text-xl text-base-content/70">{m.discover_no_matches()}</p>
        <p class="mt-2 text-base-content/50">{m.discover_no_matches_subtitle()}</p>
      {/if}
    </div>
  </div>
{:else}
  <!-- CSS-columns masonry: cards of different heights pack naturally
       instead of leaving rigid grid gaps -->
  <div class="columns-1 gap-6 sm:columns-2 lg:columns-3" data-testid="content-list">
    {#each items as item (item.data.id)}
      <div
        use:observeCard={item.data.id}
        class="mb-6 inline-block min-h-[200px] w-full break-inside-avoid"
        data-testid="content-card"
      >
        {#if visibleItemIds.has(item.data.id)}
          {#if item.type === 'article'}
            <ArticleCard
              article={item.data}
              authorProfile={authorProfiles.get(item.data.pubkey)}
              variant="card"
            />
          {:else if item.type === 'amb'}
            <AMBResourceCard
              resource={item.data}
              authorProfile={authorProfiles.get(item.data.pubkey)}
              variant="card"
            />
          {:else if item.type === 'event'}
            <CalendarEventCard event={item.data} {onEventClick} variant="card" />
          {:else if item.type === 'board'}
            <KanbanBoardCard
              board={item.data}
              authorProfile={authorProfiles.get(item.data.pubkey)}
              variant="card"
            />
          {/if}
        {:else}
          <ContentCardSkeleton variant="card" />
        {/if}
      </div>
    {/each}
  </div>

  <div id="load-more-sentinel" class="mt-8 py-8">
    {#if isLoadingMore || failing}
      <div class="flex justify-center">
        <div class="text-center">
          <div class="loading loading-lg loading-spinner text-primary"></div>
          <p class="mt-4 text-base-content/70">{m.discover_loading_more()}</p>
        </div>
      </div>
    {:else if !hasMore}
      <div class="flex justify-center">
        <p class="text-base-content/50">{m.discover_no_more_content()}</p>
      </div>
    {/if}
  </div>
{/if}
