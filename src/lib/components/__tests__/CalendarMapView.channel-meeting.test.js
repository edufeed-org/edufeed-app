/**
 * CalendarMapView skips channel meetings (M5 review): their `location` is an
 * untrusted channel URL that must never be sent to a geocoder, and they have
 * no /calendar/event page to link to.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

const spies = vi.hoisted(() => ({
  parseLocation: vi.fn(async () => null)
}));

vi.mock('$lib/helpers/geocoding.js', () => ({ parseLocation: spies.parseLocation }));
vi.mock('svelte-maplibre', () => ({
  MapLibre: () => ({}),
  Marker: () => ({}),
  Popup: () => ({})
}));
vi.mock('$lib/helpers/calendar.js', () => ({
  formatEventDateTime: () => '',
  filterEventsByViewMode: (/** @type {any[]} */ events) => events
}));
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

describe('CalendarMapView', () => {
  it('never geocodes a channel meeting, still geocodes normal events', async () => {
    render(CalendarMapView, {
      props: {
        events: [
          {
            ...base,
            id: 'meeting',
            location: 'https://evil.example/c/npub?channel=x',
            channelMeeting: { id: 'x', name: 'x', href: '/c/npub?view=channels&channel=x' }
          },
          { ...base, id: 'public', location: 'Berlin' }
        ]
      }
    });
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    const locations = spies.parseLocation.mock.calls.map((c) => /** @type {any[]} */ (c)[0]);
    expect(locations).toEqual(['Berlin']);
  });
});
