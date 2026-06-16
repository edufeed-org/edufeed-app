<!--
  Community Bookmark Detail Page — Unified detail view for a single URL within a community.
  Event-ref bookmarks render the Nostr-native view; web URLs render the reader-backed view.
-->
<script>
  import { page } from '$app/stores';
  import SocialBookmarkDetailView from '$lib/components/bookmarks/SocialBookmarkDetailView.svelte';
  import WebBookmarkDetailView from '$lib/components/bookmarks/WebBookmarkDetailView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();

  const decodedUrl = $derived(decodeURIComponent(data.encodedUrl));
  const communityPubkey = $derived($page.data.pubkey);

  // Extract target highlight ID from URL fragment (e.g. #highlight-abc123)
  const targetHighlightId = $derived.by(() => {
    const hash = $page.url.hash;
    return hash.startsWith('#highlight-') ? hash.slice('#highlight-'.length) : null;
  });
</script>

{#if data.eventRef}
  <SocialBookmarkDetailView
    pointer={data.eventRef.pointer}
    aTagValue={data.eventRef.aTagValue}
    {communityPubkey}
    {targetHighlightId}
  />
{:else}
  <WebBookmarkDetailView url={decodedUrl} {communityPubkey} {targetHighlightId} />
{/if}
