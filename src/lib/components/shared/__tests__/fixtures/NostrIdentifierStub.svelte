<!-- Test stub for NostrIdentifier: exposes the identifier + inline props in the
     DOM so NostrContentRenderer tests can assert what was passed, plus the
     authors of the quote pointers the renderer shares through context. -->
<script>
  import { getContext } from 'svelte';
  import { QUOTE_POINTERS } from '$lib/helpers/quote-pointers.js';

  let { identifier = '', inline = false } = $props();

  /** @type {(() => Map<string, { author?: string }>) | undefined} */
  const getQuotes = getContext(QUOTE_POINTERS);
  const quoteAuthors = $derived(
    [...(getQuotes?.().values() ?? [])].map((p) => p.author ?? '').join(',')
  );
</script>

<span
  data-testid="nostr-card"
  data-identifier={identifier}
  data-inline={String(inline)}
  data-quote-authors={quoteAuthors}>{identifier}</span
>
