<!--
	EventLocationMap Component
	Displays a compact map with the event location
	Uses MapLibre GL with OpenStreetMap tiles
-->
<script>
  import { onMount } from 'svelte';
  import { MapLibre, Marker, Popup } from 'svelte-maplibre';
  import { parseLocation, detectLocationType } from '$lib/helpers/geocoding.js';
  import { MapIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  let { location = '', geohash = null, compact = true } = $props();

  let coordinates = $state(/** @type {{ lat: number, lng: number } | null} */ (null));
  let loading = $state(true);
  let error = $state(/** @type {string | null} */ (null));
  let _isVenue = $state(false);
  let shouldShowMap = $state(true);

  // Reactive computed values
  let hasCoordinates = $derived(coordinates !== null);

  // MapLibre uses [lng, lat] order (GeoJSON standard), not [lat, lng] like Leaflet
  let center = $derived(
    /** @type {[number, number]} */ (coordinates ? [coordinates.lng, coordinates.lat] : [0, 0])
  );

  let markerLngLat = $derived(
    /** @type {[number, number]} */ (coordinates ? [coordinates.lng, coordinates.lat] : [0, 0])
  );

  let osmUrl = $derived(
    coordinates
      ? `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lng}&zoom=15`
      : null
  );

  /**
   * Parse location on mount
   */
  onMount(async () => {
    try {
      loading = true;
      error = null;

      // Check location type first
      const locationType = detectLocationType(location);

      if (locationType === 'url') {
        // URL detected - don't show map
        shouldShowMap = false;
        loading = false;
        return;
      }

      // Attempt to parse location (parseLocation now handles venue types too)
      const result = await parseLocation(location, geohash);

      if (result) {
        coordinates = { lat: result.lat, lng: result.lng };
      } else {
        // parseLocation will have logged why geocoding failed
        // Don't show an error UI - just don't display the map
      }
    } catch (err) {
      console.error('Error parsing location:', err);
      error = 'Failed to parse location';
    } finally {
      loading = false;
    }
  });
</script>

{#if shouldShowMap}
  <div class="event-location-map" class:compact>
    {#if loading}
      <div class="map-loading">
        <span class="loading loading-md loading-spinner"></span>
        <span class="text-sm">{m.event_location_map_loading()}</span>
      </div>
    {:else if error}
      <div class="map-error">
        <MapIcon class_="w-8 h-8 opacity-50" />
        <span class="text-sm">{m.event_location_map_error()}</span>
      </div>
    {:else if hasCoordinates}
      <div class="map-container">
        <MapLibre
          style="https://tiles.openfreemap.org/styles/liberty"
          {center}
          zoom={15}
          class="map"
          attributionControl={false}
        >
          <Marker lngLat={markerLngLat}>
            <div class="map-pin">📍</div>
            {#if location && typeof location === 'string'}
              <Popup openOn="hover" closeButton={false} offset={[0, -10]}>
                <div class="popup-content" style="background: #ffffff; color: #1a1a1a;">
                  {location}
                </div>
              </Popup>
            {/if}
          </Marker>
        </MapLibre>

        <!-- Attribution and OSM link -->
        <div class="map-footer">
          <span class="attribution">
            © <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer">OpenStreetMap</a
            >
          </span>
          {#if osmUrl}
            <!-- eslint-disable svelte/no-navigation-without-resolve -- external: OpenStreetMap link -->
            <a
              href={osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="map-link"
              title={m.event_location_map_open_osm()}
            >
              <MapIcon class_="w-4 h-4" />
              <span>{m.event_location_map_open_osm()}</span>
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .event-location-map {
    width: 100%;
    border-radius: 0.5rem;
    overflow: hidden;
    background: var(--fallback-b2, oklch(var(--b2)));
  }

  .event-location-map.compact {
    height: 300px;
  }

  .map-loading,
  .map-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    height: 100%;
    padding: 2rem;
    color: var(--fallback-bc, oklch(var(--bc) / 0.6));
  }

  .map-container {
    position: relative;
    width: 100%;
    height: 100%;
  }

  :global(.event-location-map .map) {
    width: 100%;
    height: 100%;
  }

  .map-footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent);
    z-index: 1;
  }

  .attribution {
    font-size: 0.75rem;
    color: white;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .attribution a {
    color: white;
    text-decoration: underline;
  }

  .attribution a:hover {
    color: #e0e0e0;
  }

  .map-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: white;
    border-radius: 0.375rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    font-size: 0.875rem;
    color: #333;
    text-decoration: none;
    transition: all 0.2s;
  }

  .map-link:hover {
    background: #f3f4f6;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  /* Popup styling */
  :global(.event-location-map .maplibregl-popup-content) {
    padding: 0.75rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  :global(.event-location-map .maplibregl-popup-tip) {
    border-top-color: white;
  }

  .popup-content {
    font-family: inherit;
    max-width: 200px;
  }

  /* Pin styling */
  :global(.event-location-map .map-pin) {
    font-size: 2rem;
    cursor: pointer;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
    transition: transform 0.2s;
  }

  :global(.event-location-map .map-pin:hover) {
    transform: scale(1.2);
  }
</style>
