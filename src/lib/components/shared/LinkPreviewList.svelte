<!--
  LinkPreviewList — render link previews for a Nostr event.

  Wraps parseEventContent + extractPreviewableUrls in a $state/$effect pair
  so the Symbol-cache mutation in parseEventContent doesn't fire inside the
  parent's derived context (which would trigger state_unsafe_mutation).
-->
<script>
  import { parseEventContent } from '$lib/helpers/nostrContent.js';
  import { extractPreviewableUrls } from '$lib/helpers/linkPreview.js';
  import LinkPreview from './LinkPreview.svelte';

  /** @type {{ event: any }} */
  let { event } = $props();

  // Use $state + $effect instead of $derived because parseEventContent
  // mutates the event object (symbol-based caching via getParsedContent),
  // which would trigger state_unsafe_mutation inside a derived context.
  /** @type {string[]} */
  // eslint-disable-next-line svelte/prefer-writable-derived -- parseEventContent mutates event (symbol cache)
  let urls = $state([]);

  $effect(() => {
    urls = event ? extractPreviewableUrls(parseEventContent(event)) : [];
  });
</script>

{#each urls as url (url)}
  <LinkPreview {url} />
{/each}
