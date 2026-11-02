<!-- Stand-in for svelte-maplibre's MapLibre (no WebGL in jsdom): exposes center + zoom;
     map/loaded are bindable because CalendarMapView binds them. -->
<script>
  let {
    center = [0, 0],
    zoom = 0,
    map = $bindable(),
    loaded = $bindable(false),
    children
  } = $props();
</script>

<div data-testid="maplibre-stub" data-center={center.join(',')} data-zoom={String(zoom)}>
  {@render children?.()}
</div>
