<script>
  import { page } from '$app/stores';
  import WikiView from '$lib/components/wiki/WikiView.svelte';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { getHasHistory } from '$lib/helpers/navigationHistory.js';
  import * as m from '$lib/paraglide/messages';

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
    <button
      onclick={() => {
        if (getHasHistory()) history.back();
      }}
      class="btn mb-2 btn-circle btn-ghost btn-sm"
      aria-label={m.common_back()}
    >
      <ChevronLeftIcon class_="w-5 h-5" />
    </button>
    {#if data.event}
      <WikiView event={data.event} {communityPubkey} {targetHighlightId} />
    {/if}
  </div>
</div>
