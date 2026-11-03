<!-- Test stub for MarkdownRenderer — renders the `content` prop verbatim so a
     test can assert WHICH string a caller passed in, with no markdown/XSS
     processing. -->
<script>
  let { content = '' } = $props();
</script>

<span data-testid="markdown-renderer-stub">{content}</span>
