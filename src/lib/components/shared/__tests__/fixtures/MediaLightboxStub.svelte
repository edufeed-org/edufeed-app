<!-- Surfaces MediaLightbox's props in the DOM so tests can assert which image
     the lightbox opened on. -->
<script>
  let { items = [], startIndex = 0 } = $props();
</script>

<div
  data-testid="lightbox"
  data-start-index={startIndex}
  data-start-src={items[startIndex]?.src ?? ''}
  data-count={items.length}
></div>
