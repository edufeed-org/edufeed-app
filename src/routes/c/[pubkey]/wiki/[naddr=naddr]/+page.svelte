<script>
  import { page } from '$app/stores';
  import WikiView from '$lib/components/wiki/WikiView.svelte';
  import EventLoadingState from '$lib/components/shared/EventLoadingState.svelte';
  import { useReplaceableEvent } from '$lib/stores/replaceable-event.svelte.js';

  /** @type {{ data: any }} */
  let { data } = $props();

  const getState = useReplaceableEvent(() => data.pointer);
  const communityPubkey = $derived($page.data.pubkey);

  const targetHighlightId = $derived.by(() => {
    const hash = $page.url.hash;
    return hash.startsWith('#highlight-') ? hash.slice('#highlight-'.length) : null;
  });
</script>

<div class="mx-auto w-full max-w-4xl p-4">
  <EventLoadingState state={getState()}>
    {#snippet content(event)}
      <WikiView {event} {communityPubkey} {targetHighlightId} />
    {/snippet}
  </EventLoadingState>
</div>
