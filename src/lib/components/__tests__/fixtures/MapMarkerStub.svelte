<!-- Stand-in for svelte-maplibre's Marker. -->
<script>
  let { children } = $props();
</script>

<div data-testid="map-marker-stub">{@render children?.()}</div>
