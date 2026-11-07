<!-- Stand-in for HighlightOverlay: renders only the htmlContent it is given. -->
<script>
  let { htmlContent = '' } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- test stub, input is the sanitizer output under test -->
<div data-testid="html-content">{@html htmlContent}</div>
