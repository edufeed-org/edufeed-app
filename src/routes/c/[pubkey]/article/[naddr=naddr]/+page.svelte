<script>
  import { page } from '$app/stores';
  import ArticleView from '$lib/components/article/ArticleView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();

  const communityPubkey = $derived($page.data.pubkey);

  // Extract target highlight ID from URL fragment (e.g. #highlight-abc123)
  const targetHighlightId = $derived.by(() => {
    const hash = $page.url.hash;
    return hash.startsWith('#highlight-') ? hash.slice('#highlight-'.length) : null;
  });
</script>

<div class="flex-1 overflow-auto pb-16 transition-all duration-300 lg:ml-(--sidebar-nav-w) lg:pb-0">
  <div class="mx-auto max-w-4xl p-4">
    {#if data.event}
      <ArticleView event={data.event} {communityPubkey} {targetHighlightId} />
    {/if}
  </div>
</div>
