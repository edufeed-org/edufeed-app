<script>
  import { page } from '$app/stores';
  import WikiView from '$lib/components/wiki/WikiView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();

  const communityPubkey = $derived($page.data.pubkey);

  // Extract target highlight ID from URL fragment (e.g. #highlight-abc123)
  const targetHighlightId = $derived.by(() => {
    const hash = $page.url.hash;
    return hash.startsWith('#highlight-') ? hash.slice('#highlight-'.length) : null;
  });
</script>

<div class="mx-auto max-w-4xl p-4">
  {#if data.event}
    <WikiView event={data.event} {communityPubkey} {targetHighlightId} />
  {/if}
</div>
