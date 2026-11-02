/**
 * EventLocationMap renders nothing when geocoding yields no coordinates —
 * before, its fixed-height (300px) box stayed on the page as an empty gap in
 * the event modal and detail page. While geocoding runs, the loading state
 * shows. Coarse matches (a state, a country) get a centered map without a
 * pin, zoomed out to the region.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const spies = vi.hoisted(() => ({
  parseLocation: vi.fn(),
  mapProps: /** @type {any[]} */ ([])
}));

vi.mock('$lib/helpers/geocoding.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    parseLocation: spies.parseLocation
  };
});

vi.mock('$lib/stores/config.svelte.js', () => ({
  getConfig: () => ({ geocoding: { validation: { minAddressLength: 10 } } })
}));

vi.mock('svelte-maplibre', async () => {
  const { default: MapLibreStub } = await import('./fixtures/MapLibreStub.svelte');
  const { default: MarkerStub } = await import('./fixtures/MapMarkerStub.svelte');
  const { default: EmptyStub } = await import('./fixtures/EmptyStub.svelte');
  return { MapLibre: MapLibreStub, Marker: MarkerStub, Popup: EmptyStub };
});

vi.mock('$lib/paraglide/messages', () => ({
  event_location_map_loading: () => 'Loading map',
  event_location_map_error: () => 'Map error',
  event_location_map_open_osm: () => 'Open in OpenStreetMap'
}));

import EventLocationMap from '../calendar/EventLocationMap.svelte';

describe('EventLocationMap', () => {
  beforeEach(() => {
    spies.parseLocation.mockReset();
  });

  it('shows the loading state while geocoding runs', async () => {
    spies.parseLocation.mockReturnValue(new Promise(() => {}));
    render(EventLocationMap, { props: { location: 'Somewhere in Hessen' } });
    expect(await screen.findByText('Loading map')).toBeTruthy();
  });

  it('renders nothing when no coordinates come back', async () => {
    spies.parseLocation.mockResolvedValue(null);
    const { container } = render(EventLocationMap, {
      props: { location: 'Raum 204, Gebäude B' }
    });

    await waitFor(() => expect(spies.parseLocation).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.event-location-map')).toBeNull());
  });

  it('shows a pinned street-level map for a precise match', async () => {
    spies.parseLocation.mockResolvedValue({ lat: 50.1, lng: 8.6, source: 'coordinates' });
    render(EventLocationMap, { props: { location: '50.1, 8.6' } });

    const map = await screen.findByTestId('maplibre-stub');
    expect(map.dataset.zoom).toBe('15');
    expect(screen.getByTestId('map-marker-stub')).toBeTruthy();
  });

  it('shows a zoomed-out map without a pin for a state-level match', async () => {
    spies.parseLocation.mockResolvedValue({
      lat: 50.608,
      lng: 9.028,
      source: 'geocoded',
      precision: 'state'
    });
    render(EventLocationMap, { props: { location: 'Hessen, Germany' } });

    const map = await screen.findByTestId('maplibre-stub');
    expect(map.dataset.zoom).toBe('7');
    expect(map.dataset.center).toBe('9.028,50.608');
    expect(screen.queryByTestId('map-marker-stub')).toBeNull();
  });
});
