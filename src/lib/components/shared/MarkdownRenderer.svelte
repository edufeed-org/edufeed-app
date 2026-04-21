<!--
  MarkdownRenderer Component
  Safely renders markdown content with XSS protection.
  Converts bare nostr: mentions to app links and renders nostr: protocol hrefs.
-->

<script>
  import { renderMarkdown } from '$lib/helpers/markdown.js';

  let { content = '', class: className = 'prose prose-lg max-w-none' } = $props();

  let html = $derived(renderMarkdown(content));
</script>

<div class={className}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: sanitized with DOMPurify -->
  {@html html}
</div>
