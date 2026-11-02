/**
 * Geocoding precision: OpenCage reports how coarse a match is through the
 * result's `components._type` (state, city, road, …). A coarse match such as
 * "Hessen, Germany" (a state, OpenCage confidence 1 because the bounding box
 * is huge) is a correct answer — it gets a map zoomed out to the region with
 * no pin, instead of being rejected and leaving no map at all.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/stores/config.svelte.js', () => ({
  getConfig: () => ({
    geocoding: {
      cacheDurationDays: 30,
      validation: {
        minAddressLength: 10,
        minConfidenceScore: 5,
        requireAddressComponents: false,
        acceptedComponentTypes: [
          'road',
          'building',
          'postcode',
          'neighbourhood',
          'city',
          'town',
          'village',
          'county',
          'state',
          'country',
          'venue'
        ]
      }
    }
  })
}));

import {
  zoomForPrecision,
  isCoarsePrecision,
  geocodeAddress,
  parseLocation,
  getCachedCoordinates
} from '$lib/helpers/geocoding.js';

describe('zoomForPrecision', () => {
  it('zooms out for country and region level matches', () => {
    expect(zoomForPrecision('country')).toBe(5);
    expect(zoomForPrecision('state')).toBe(7);
    expect(zoomForPrecision('region')).toBe(7);
    expect(zoomForPrecision('county')).toBe(9);
  });

  it('uses a town-level zoom for settlements', () => {
    expect(zoomForPrecision('city')).toBe(11);
    expect(zoomForPrecision('municipality')).toBe(11);
    expect(zoomForPrecision('town')).toBe(12);
    expect(zoomForPrecision('village')).toBe(12);
  });

  it('uses a quarter-level zoom for postcodes and neighbourhoods', () => {
    expect(zoomForPrecision('postcode')).toBe(13);
    expect(zoomForPrecision('neighbourhood')).toBe(13);
  });

  it('uses street level for roads, buildings, venues and unknown/missing types', () => {
    for (const type of ['road', 'building', 'house', 'venue', 'university', undefined, null]) {
      expect(zoomForPrecision(type)).toBe(15);
    }
  });
});

describe('isCoarsePrecision', () => {
  it('is true for country, state, region and county', () => {
    for (const type of ['continent', 'country', 'state', 'region', 'state_district', 'county']) {
      expect(isCoarsePrecision(type)).toBe(true);
    }
  });

  it('is false for settlements, streets and missing types', () => {
    for (const type of ['city', 'town', 'postcode', 'road', 'building', undefined]) {
      expect(isCoarsePrecision(type)).toBe(false);
    }
  });
});

/** @param {any} result */
function mockGeocodeResponse(result) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, result })
  }));
}

describe('geocodeAddress validation', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a state-level match despite its low confidence (Hessen, Germany)', async () => {
    vi.stubGlobal(
      'fetch',
      mockGeocodeResponse({
        lat: 50.608,
        lng: 9.028,
        formatted: 'Hessen, Germany',
        confidence: 1,
        components: { _type: 'state', state: 'Hessen', country: 'Germany' }
      })
    );

    const coords = await geocodeAddress('Hessen, Germany');
    expect(coords).toMatchObject({ lat: 50.608, lng: 9.028, precision: 'state' });
  });

  it('accepts a city match whose bounding box makes its confidence low', async () => {
    vi.stubGlobal(
      'fetch',
      mockGeocodeResponse({
        lat: 50.11,
        lng: 8.68,
        confidence: 3,
        components: { _type: 'city', city: 'Frankfurt' }
      })
    );

    expect(await geocodeAddress('Frankfurt am Main')).toMatchObject({ precision: 'city' });
  });

  it('still rejects a street-level match below the confidence threshold', async () => {
    vi.stubGlobal(
      'fetch',
      mockGeocodeResponse({
        lat: 50.11,
        lng: 8.68,
        confidence: 2,
        components: { _type: 'road', road: 'Hauptstraße' }
      })
    );

    expect(await geocodeAddress('Hauptstraße irgendwo')).toBeNull();
  });

  it('still rejects component types outside the accepted list', async () => {
    vi.stubGlobal(
      'fetch',
      mockGeocodeResponse({
        lat: 1,
        lng: 2,
        confidence: 9,
        components: { _type: 'body_of_water' }
      })
    );

    expect(await geocodeAddress('Some lake name')).toBeNull();
  });

  it('still rejects invalid coordinates', async () => {
    vi.stubGlobal(
      'fetch',
      mockGeocodeResponse({
        lat: 123,
        lng: 9,
        confidence: 1,
        components: { _type: 'state' }
      })
    );

    expect(await geocodeAddress('Hessen, Germany')).toBeNull();
  });
});

describe('parseLocation keeps the precision', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the precision of a geocoded match and keeps it on a cache hit', async () => {
    const fetchMock = mockGeocodeResponse({
      lat: 50.608,
      lng: 9.028,
      confidence: 1,
      components: { _type: 'state' }
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await parseLocation('Hessen, Germany');
    expect(first).toMatchObject({ source: 'geocoded', precision: 'state' });

    expect(getCachedCoordinates('Hessen, Germany')).toMatchObject({ precision: 'state' });

    const second = await parseLocation('Hessen, Germany');
    expect(second).toMatchObject({
      source: 'cache',
      lat: 50.608,
      lng: 9.028,
      precision: 'state'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns exact coordinates without a precision (street-level map with pin)', async () => {
    const result = await parseLocation('50.1, 8.6');
    expect(result).toMatchObject({ lat: 50.1, lng: 8.6, source: 'coordinates' });
    expect(zoomForPrecision(result?.precision)).toBe(15);
    expect(isCoarsePrecision(result?.precision)).toBe(false);
  });
});
