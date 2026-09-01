<!--
	CalendarMapView Component
	Displays a full-screen map with multiple event markers
	Uses MapLibre GL with OpenFreeMap Liberty style
-->
<script>
  import { resolve } from '$app/paths';
  import { MapLibre, Marker, Popup } from 'svelte-maplibre';
  import { parseLocation } from '$lib/helpers/geocoding.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { formatEventDateTime, filterEventsByViewMode } from '$lib/helpers/calendar.js';
  import { MapIcon, CalendarIcon, ClockIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {import('$lib/types/calendar.js').CalendarEvent} CalendarEvent
   * @typedef {import('$lib/types/calendar.js').CalendarViewMode} CalendarViewMode
   */

  let {
    events = [],
    viewMode = /** @type {CalendarViewMode} */ ('month'),
    currentDate = new Date()
  } = $props();

  /**
   * Cache of geocoded coordinates keyed by event id. Survives across event-batch
   * re-runs so already-geocoded events aren't reprocessed. `null` = geocoded and
   * no result (so we skip it on next pass).
   *
   * $state.raw is required — we reassign the whole Map for reactivity, and
   * Svelte 5's deep proxy breaks Map methods via incompatible-receiver.
   *
   * @type {Map<string, { lat: number, lng: number } | null>}
   */
  let coordCache = $state.raw(new Map());
  let initialLoadComplete = $state(false);
  let error = $state(/** @type {string | null} */ (null));

  let mapBounds = $state(/** @type {[[number, number], [number, number]] | null} */ (null));

  // Bound to <MapLibre bind:map bind:loaded> so we can call fitBounds programmatically
  // once the style has finished loading. Passing `bounds` as a prop only fits at mount
  // time — if bounds arrive after mount (async geocode), the map wouldn't re-fit.
  /** @type {import('maplibre-gl').Map | undefined} */
  let map = $state();
  let mapLoaded = $state(false);

  // Filter events based on current view mode and date using shared helper
  let filteredEvents = $derived.by(() => filterEventsByViewMode(events, viewMode, currentDate));

  // Derive renderable pins from cache + current filter. Only events with
  // resolved coordinates are rendered; un-geocoded or null-cached events are
  // silently skipped.
  let eventsWithCoordinates = $derived.by(() =>
    filteredEvents.flatMap((event) => {
      const coords = coordCache.get(event.id);
      return coords ? [{ event, coordinates: coords }] : [];
    })
  );

  // Spinner shows only on the very first load (nothing cached yet AND we
  // haven't completed a pass). Subsequent event batches merge into the cache
  // without flipping the template off the <MapLibre> branch.
  let loading = $derived(!initialLoadComplete && eventsWithCoordinates.length === 0);

  /**
   * Compute a bounding box for the given pins. For a single pin we emit a
   * zero-size box at the point — MapLibre's fitBounds handles this via
   * `maxZoom`, centering on the point at that zoom. No pins → null (no fit).
   * @param {{ event: CalendarEvent, coordinates: { lat: number, lng: number } }[]} eventsWithCoords
   */
  function calculateMapBounds(eventsWithCoords) {
    if (eventsWithCoords.length === 0) {
      mapBounds = null;
      return;
    }
    const lngs = eventsWithCoords.map((e) => e.coordinates.lng);
    const lats = eventsWithCoords.map((e) => e.coordinates.lat);
    mapBounds = [
      [Math.min(...lngs), Math.min(...lats)], // Southwest
      [Math.max(...lngs), Math.max(...lats)] // Northeast
    ];
  }

  // Programmatic fitBounds. Fires ONCE when both the map is style-loaded and we
  // have computed bounds. An effect with an imperative call would infinite-loop
  // because svelte-maplibre's internal `moveend` handler writes its bindable
  // bounds/center/zoom, which cascades back through its own effects. The guard
  // flag breaks that cycle: after one fit, we never touch the camera again and
  // let the user pan/zoom freely.
  let boundsFitApplied = false;
  $effect(() => {
    if (boundsFitApplied) return;
    if (!map || !mapLoaded || !mapBounds) return;
    map.fitBounds(mapBounds, { padding: 50, maxZoom: 12, animate: false });
    boundsFitApplied = true;
  });

  // Plain let flag (not $state): flipping shouldn't retrigger effects, and
  // we only read/write it from inside the geocode effect. Bounds are
  // computed once, at the first non-empty geocode snapshot; after that the
  // user controls panning/zooming.
  let boundsComputed = false;

  // Incrementally geocode any events not already in the cache. Runs on every
  // reactive change to `filteredEvents`, but skips already-processed events,
  // so new batches add pins to the map without unmounting the existing ones.
  //
  // On cancellation (a new batch arrived mid-flight) we still commit the
  // partial progress so subsequent runs don't redo that work. This matters
  // because the loader frequently emits batches faster than we can geocode
  // them — without partial commits, we'd cancel + restart without making
  // progress.
  $effect(() => {
    const toProcess = filteredEvents.filter((e) => !coordCache.has(e.id));
    if (toProcess.length === 0) {
      if (!initialLoadComplete) initialLoadComplete = true;
      return;
    }

    let cancelled = false;
    (async () => {
      /** @type {Map<string, { lat: number, lng: number } | null>} */
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive working map
      const myUpdates = new Map();
      for (const event of toProcess) {
        if (cancelled) break;
        try {
          const coords = await parseLocation(event.location, event.geohash);
          myUpdates.set(event.id, coords ? { lat: coords.lat, lng: coords.lng } : null);
        } catch (err) {
          console.warn(`Failed to parse location for event ${event.id}:`, err);
          myUpdates.set(event.id, null);
        }
      }
      // Merge into live coordCache rather than overwriting: multiple effect
      // runs may have concurrent in-flight IIFEs, and a stale snapshot must
      // not clobber a newer commit. parseLocation is deterministic, so for
      // overlapping keys last-write-wins is safe.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- assigned to $state.raw; replaced, not mutated
      const merged = new Map(coordCache);
      for (const [k, v] of myUpdates) merged.set(k, v);

      // Compute bounds once, from the first non-empty snapshot, BEFORE
      // committing coordCache. This guarantees mapCenter/mapZoom/mapBounds
      // are set in the same tick as the template flips to the MapLibre
      // branch — MapLibre only reads these at mount, so they must be
      // populated synchronously with the `{:else}` transition.
      if (!boundsComputed) {
        const pins = filteredEvents.flatMap((event) => {
          const c = merged.get(event.id);
          return c ? [{ event, coordinates: c }] : [];
        });
        if (pins.length > 0) {
          calculateMapBounds(pins);
          boundsComputed = true;
        }
      }

      coordCache = merged;
      if (!cancelled) initialLoadComplete = true;
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="calendar-map-view">
  {#if loading}
    <div class="map-loading">
      <span class="loading loading-lg loading-spinner"></span>
      <p class="mt-3 text-sm">{m.calendar_map_loading()}</p>
    </div>
  {:else if error}
    <div class="map-error">
      <MapIcon class_="w-16 h-16 opacity-30 mb-4" />
      <h3 class="mb-2 text-lg font-medium">{m.calendar_map_error_title()}</h3>
      <p class="text-base-content/60">{error}</p>
    </div>
  {:else if eventsWithCoordinates.length === 0 && events.length > 0}
    <div class="map-empty">
      <MapIcon class_="w-16 h-16 opacity-30 mb-4" />
      <h3 class="mb-2 text-lg font-medium">{m.calendar_map_empty_locations_title()}</h3>
      <p class="mb-4 max-w-md text-base-content/60">
        {m.calendar_map_empty_locations_desc({
          count: events.length,
          plural: events.length === 1 ? '' : 'en'
        })}
      </p>
    </div>
  {:else if events.length === 0}
    <div class="map-empty">
      <CalendarIcon class_="w-16 h-16 opacity-30 mb-4" />
      <h3 class="mb-2 text-lg font-medium">{m.calendar_map_empty_events_title()}</h3>
      <p class="mb-4 text-base-content/60">
        {m.calendar_map_empty_events_desc()}
      </p>
    </div>
  {:else}
    <div class="map-container">
      <MapLibre
        bind:map
        bind:loaded={mapLoaded}
        style="https://tiles.openfreemap.org/styles/liberty"
        class="map"
      >
        {#each eventsWithCoordinates as item (item.event.id)}
          <Marker lngLat={[item.coordinates.lng, item.coordinates.lat]}>
            <div class="map-pin">📍</div>
            <Popup openOn="click" closeButton={true} offset={[0, -10]}>
              <div class="event-popup">
                <h3 class="mb-2 text-base leading-tight font-semibold">
                  <a
                    href={resolve(
                      `/calendar/event/${encodeEventToNaddr(item.event.originalEvent)}`
                    )}
                    class="transition-colors hover:text-primary"
                  >
                    {item.event.title}
                  </a>
                </h3>

                <div class="mb-3 space-y-1 text-sm text-base-content/70">
                  <div class="flex items-center gap-2">
                    <ClockIcon class_="w-4 h-4 flex-shrink-0" />
                    <time class="flex-1">{formatEventDateTime(item.event)}</time>
                  </div>

                  {#if item.event.location}
                    <div class="flex items-start gap-2">
                      <MapIcon class_="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span class="flex-1 break-words">{item.event.location}</span>
                    </div>
                  {/if}
                </div>

                <a
                  href={resolve(`/calendar/event/${encodeEventToNaddr(item.event.originalEvent)}`)}
                  class="btn btn-block btn-xs btn-primary"
                >
                  View Event Details →
                </a>
              </div>
            </Popup>
          </Marker>
        {/each}
      </MapLibre>
    </div>
  {/if}
</div>

<style>
  .calendar-map-view {
    width: 100%;
    height: 600px;
    position: relative;
    border-radius: 0 0 0.5rem 0.5rem;
    overflow: hidden;
    background: var(--fallback-b2, oklch(var(--b2)));
  }

  .map-loading,
  .map-error,
  .map-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    text-align: center;
    color: var(--fallback-bc, oklch(var(--bc) / 0.6));
  }

  .map-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  :global(.calendar-map-view .map) {
    width: 100%;
    height: 100%;
  }

  /* Popup styling */
  :global(.calendar-map-view .event-popup) {
    min-width: 250px;
    max-width: 300px;
    padding: 1rem;
    color: #1a1a1a; /* Dark text for readability */
  }

  :global(.calendar-map-view .event-popup h3) {
    color: #000000; /* Darker heading */
  }

  :global(.calendar-map-view .event-popup h3 a) {
    color: inherit;
  }

  :global(.calendar-map-view .event-popup .text-sm) {
    color: #4a4a4a !important; /* Override for better contrast */
  }

  :global(.calendar-map-view .maplibregl-popup-content) {
    padding: 0;
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    background: #ffffff; /* Explicit white background */
  }

  :global(.calendar-map-view .maplibregl-popup-close-button) {
    font-size: 1.5rem;
    padding: 0.5rem;
    color: #666666;
  }

  :global(.calendar-map-view .maplibregl-popup-close-button:hover) {
    color: #000000;
    background: transparent;
  }

  /* Custom pin marker */
  :global(.calendar-map-view .map-pin) {
    font-size: 2rem;
    line-height: 1;
    cursor: pointer;
    transition: transform 0.2s ease;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
    user-select: none;
  }

  :global(.calendar-map-view .map-pin:hover) {
    transform: scale(1.2);
  }

  /* Attribution styling */
  :global(.calendar-map-view .maplibregl-ctrl-attrib) {
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(4px);
  }

  /* Responsive adjustments */
  @media (max-width: 640px) {
    .calendar-map-view {
      height: 500px;
    }

    :global(.calendar-map-view .event-popup) {
      min-width: 200px;
      max-width: 250px;
    }
  }
</style>
