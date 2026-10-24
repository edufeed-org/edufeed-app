<!--
  CommunitiesTab — the communities grid of /discover: create CTA, count,
  cards in batches of 20 behind an infinite-scroll sentinel, and the
  loading / no-match states. The page passes the already filtered list.
-->
<script>
  import CommunikeyCard from '$lib/components/CommunikeyCard.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communities: Array<{ pubkey: string }>,
   *   loaded: boolean,
   *   activeUser: any,
   *   query: string,
   *   oncreate: () => void
   * }}
   */
  let { communities, loaded, activeUser, query, oncreate } = $props();

  const BATCH = 20;
  let displayedCount = $state(BATCH);
  const shown = $derived(communities.slice(0, displayedCount));
  const hasMore = $derived(displayedCount < communities.length);

  // A new search starts from the first batch again
  $effect(() => {
    if (query) displayedCount = BATCH;
  });

  // Infinite scroll over the already-loaded list
  $effect(() => {
    if (!hasMore) return;
    const sentinel = document.getElementById('load-more-sentinel');
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) displayedCount += BATCH;
      },
      { root: null, rootMargin: '200px', threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });
</script>

{#if communities.length === 0 && !loaded}
  <div class="flex justify-center py-12">
    <div class="text-center">
      <div class="loading loading-lg loading-spinner text-primary"></div>
      <p class="mt-4 text-base-content/70">{m.discover_loading()}</p>
    </div>
  </div>
{:else if communities.length === 0}
  <div class="flex justify-center py-12">
    <div class="text-center">
      <p class="text-xl text-base-content/70">{m.discover_no_matches()}</p>
      <p class="mt-2 text-base-content/50">{m.discover_no_matches_subtitle()}</p>
      {#if activeUser}
        <button class="btn mt-6 gap-2 btn-primary" onclick={oncreate}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
          </svg>
          {m.community_create()}
        </button>
      {/if}
    </div>
  </div>
{:else}
  {#if activeUser}
    <div class="mb-8 flex justify-center">
      <button class="btn gap-2 btn-lg btn-primary" onclick={oncreate}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {m.community_create()}
      </button>
    </div>
  {/if}

  <div class="mb-6 text-center text-sm text-base-content/70">
    {m.discover_results_count({ count: communities.length })}
  </div>

  <div class="columns-1 gap-8 sm:columns-2 lg:columns-3 xl:columns-4">
    {#each shown as community (community.pubkey)}
      <div class="mb-8 inline-block w-full break-inside-avoid">
        <CommunikeyCard pubkey={community.pubkey} showJoinButton={true} />
      </div>
    {/each}
  </div>

  {#if hasMore}
    <div id="load-more-sentinel" class="mt-8 py-8"></div>
  {:else}
    <div class="mt-8 flex justify-center py-8">
      <p class="text-base-content/50">{m.discover_no_more_content()}</p>
    </div>
  {/if}
{/if}
