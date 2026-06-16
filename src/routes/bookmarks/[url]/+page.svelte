<!--
  Standalone Bookmark Detail Page — Unified detail view for a URL.
  Event-ref bookmarks render the Nostr-native view; web URLs render the reader-backed view.
  (Non-community version of c/[pubkey]/bookmarks/[url])
-->
<script>
  import SocialBookmarkDetailView from '$lib/components/bookmarks/SocialBookmarkDetailView.svelte';
  import WebBookmarkDetailView from '$lib/components/bookmarks/WebBookmarkDetailView.svelte';

  /** @type {{ data: any }} */
  let { data } = $props();

  const decodedUrl = $derived(decodeURIComponent(data.encodedUrl));
</script>

{#if data.eventRef}
  <SocialBookmarkDetailView
    pointer={data.eventRef.pointer}
    aTagValue={data.eventRef.aTagValue}
    targetHighlightId={null}
  />
{:else}
  <WebBookmarkDetailView url={decodedUrl} targetHighlightId={null} />
{/if}
