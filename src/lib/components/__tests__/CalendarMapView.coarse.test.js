/**
 * The calendar overview map pins only located events: a region-level match
 * ("Hessen, Germany" → the state's centroid) would put a pin where the event
 * is not. The single-event map shows those as a zoomed-out map instead.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const spies = vi.hoisted(() => ({
  parseLocation: vi.fn(async (/** @type {string} */ location) =>
    location === 'Hessen, Germany'
      ? { lat: 50.608, lng: 9.028, source: 'geocoded', precision: 'state' }
      : { lat: 52.52, lng: 13.405, source: 'geocoded', precision: 'road' }
  )
}));

vi.mock('$lib/helpers/geocoding.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, parseLocation: spies.parseLocation };
});
vi.mock('svelte-maplibre', async () => {
  const { default: MapLibreStub } = await import('./fixtures/MapLibreStub.svelte');
  const { default: MarkerStub } = await import('./fixtures/MapMarkerStub.svelte');
  const { default: EmptyStub } = await import('./fixtures/EmptyStub.svelte');
  return { MapLibre: MapLibreStub, Marker: MarkerStub, Popup: EmptyStub };
});
vi.mock('$lib/helpers/calendar.js', () => ({
  formatEventDateTime: () => '',
  filterEventsByViewMode: (/** @type {any[]} */ events) => events
}));
vi.mock('$lib/helpers/nostrUtils.js', () => ({ encodeEventToNaddr: () => 'naddr1x' }));
vi.mock('$lib/paraglide/messages', () => ({
  calendar_map_empty_events_desc: () => '',
  calendar_map_empty_events_title: () => '',
  calendar_map_empty_locations_desc: () => '',
  calendar_map_empty_locations_title: () => '',
  calendar_map_error_title: () => '',
  calendar_map_loading: () => ''
}));

const { default: CalendarMapView } = await import('../calendar/CalendarMapView.svelte');

const base = {
  kind: 31923,
  pubkey: 'b'.repeat(64),
  title: 'x',
  start: 1_790_000_000,
  originalEvent: { kind: 31923, pubkey: 'b'.repeat(64), tags: [['d', 'x']] }
};

describe('CalendarMapView with region-level matches', () => {
  it('pins the street-level event and leaves the state-level one off the map', async () => {
    render(CalendarMapView, {
      props: {
        events: [
          { ...base, id: 'state', location: 'Hessen, Germany' },
          { ...base, id: 'street', location: 'Unter den Linden 1, Berlin' }
        ]
      }
    });

    await waitFor(() => expect(screen.getAllByTestId('map-marker-stub')).toHaveLength(1));
    expect(spies.parseLocation).toHaveBeenCalledWith('Hessen, Germany', undefined);
  });
});
