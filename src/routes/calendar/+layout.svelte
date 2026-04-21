<script>
  /** @type {{ children?: import('svelte').Snippet }} */
  let { children } = $props();
</script>

<!-- Child page content (calendar pages) -->
{@render children?.()}
