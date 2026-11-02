/**
 * Geocoding Helper
 * Handles location parsing, coordinate extraction, and geocoding
 * Supports NIP-52 location formats:
 * - Physical addresses
 * - GPS coordinates (various formats)
 * - Geohash
 * - URLs (detected and skipped)
 */

import { getConfig } from '$lib/stores/config.svelte.js';

// Coordinate pattern matchers
const COORD_PATTERNS = {
  // "40.7829,-73.9654" or "40.7829, -73.9654"
  standard: /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/,
  // "geo:40.7829,-73.9654"
  geoUri: /^geo:(-?\d+\.?\d*),(-?\d+\.?\d*)$/i,
  // "lat:40.7829 lng:-73.9654" or "lat:40.7829,lng:-73.9654"
  labeled: /(?:lat|latitude)[:\s]+(-?\d+\.?\d*)[\s,]+(?:lon|lng|longitude)[:\s]+(-?\d+\.?\d*)/i
};

// URL pattern - detects URLs anywhere in the string (e.g., "Zoom: https://..." or "https://...")
const URL_PATTERN = /https?:\/\//i;

// Geohash base32 characters
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Validate if location is likely a geocodable address
 * @param {string} location - Location string
 * @returns {boolean}
 */
function isGeocodableAddress(location) {
  const config = getConfig();
  const validation = config.geocoding.validation;

  // Must meet minimum length
  if (location.length < validation.minAddressLength) {
    return false;
  }

  // Cannot be just a single word
  if (!location.includes(' ') && !location.includes(',')) {
    return false;
  }

  return true;
}

/**
 * OpenCage result types (`components._type`) whose match covers a whole
 * region. Their coordinates are a centroid, not a place: the map centers on
 * them without a pin.
 */
const COARSE_PRECISIONS = new Set([
  'continent',
  'country',
  'region',
  'state',
  'state_district',
  'island',
  'archipelago',
  'county'
]);

/** Map zoom per OpenCage result type; anything not listed is street level. */
const ZOOM_BY_PRECISION = new Map([
  ['continent', 3],
  ['country', 5],
  ['region', 7],
  ['state', 7],
  ['state_district', 8],
  ['island', 8],
  ['archipelago', 7],
  ['county', 9],
  ['city', 11],
  ['municipality', 11],
  ['postal_city', 11],
  ['town', 12],
  ['village', 12],
  ['hamlet', 13],
  ['locality', 12],
  ['city_district', 12],
  ['suburb', 13],
  ['quarter', 13],
  ['postcode', 13],
  ['neighbourhood', 13]
]);

/** Zoom for an exact location (coordinates, geohash, street, building, venue). */
export const STREET_ZOOM = 15;

/**
 * Map zoom for a geocoding precision (OpenCage `components._type`).
 * Missing or unknown types — exact coordinates, roads, buildings and the many
 * POI types — get street level.
 * @param {string | null | undefined} precision
 * @returns {number}
 */
export function zoomForPrecision(precision) {
  return (precision && ZOOM_BY_PRECISION.get(precision)) || STREET_ZOOM;
}

/**
 * True when a match only names a region (country, state, county): no pin.
 * @param {string | null | undefined} precision
 * @returns {boolean}
 */
export function isCoarsePrecision(precision) {
  return Boolean(precision && COARSE_PRECISIONS.has(precision));
}

/**
 * Validate geocoding result from server API.
 *
 * OpenCage's `confidence` measures the size of the match's bounding box, not
 * whether the match is right: a state is always confidence 1, a city 3-6. So
 * the confidence threshold only applies to street-level matches, where a big
 * bounding box does mean something went wrong. Settlement and region matches
 * are accepted and shown zoomed out (`zoomForPrecision`).
 * @param {any} result - Geocoding result object
 * @returns {boolean}
 */
function validateGeocodeResult(result) {
  const config = getConfig();
  const validation = config.geocoding.validation;

  // Ensure coordinates are valid
  if (!isValidCoordinates(result.lat, result.lng)) {
    return false;
  }

  // Check component type
  const componentType = result.components?._type;
  if (componentType && validation.acceptedComponentTypes?.length > 0) {
    if (!validation.acceptedComponentTypes.includes(componentType)) {
      return false;
    }
  }

  // Check confidence score — street-level matches only (see above)
  if (zoomForPrecision(componentType) >= STREET_ZOOM) {
    if (result.confidence < validation.minConfidenceScore) {
      return false;
    }
  }

  return true;
}

/**
 * Detect the type of location string
 * @param {string} location - Location string
 * @returns {'url' | 'coordinates' | 'geohash' | 'address' | 'venue'}
 */
export function detectLocationType(location) {
  if (!location || typeof location !== 'string') {
    return 'venue';
  }

  const trimmed = location.trim();

  // Check if it's a URL
  if (URL_PATTERN.test(trimmed)) {
    return 'url';
  }

  // Check if it matches coordinate patterns
  for (const pattern of Object.values(COORD_PATTERNS)) {
    if (pattern.test(trimmed)) {
      return 'coordinates';
    }
  }

  // Check if it's a valid geohash (3-12 chars, only base32 chars)
  if (trimmed.length >= 3 && trimmed.length <= 12) {
    const isGeohash = [...trimmed.toLowerCase()].every((char) => BASE32.includes(char));
    if (isGeohash) {
      return 'geohash';
    }
  }

  // Distinguish between geocodable address and venue name
  if (isGeocodableAddress(trimmed)) {
    return 'address';
  }

  return 'venue';
}

/**
 * Parse coordinates from a location string
 * @param {string} location - Location string
 * @returns {{ lat: number, lng: number } | null}
 */
export function parseCoordinates(location) {
  if (!location || typeof location !== 'string') {
    return null;
  }

  const trimmed = location.trim();

  // Try each coordinate pattern
  for (const pattern of Object.values(COORD_PATTERNS)) {
    const match = trimmed.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);

      if (isValidCoordinates(lat, lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

/**
 * Validate coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean}
 */
export function isValidCoordinates(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Decode geohash to approximate coordinates
 * @param {string} geohash - Geohash string
 * @returns {{ lat: number, lng: number } | null}
 */
export function geohashToCoordinates(geohash) {
  if (!geohash || typeof geohash !== 'string') {
    return null;
  }

  const hash = geohash.toLowerCase();
  let evenBit = true;
  let latMin = -90.0;
  let latMax = 90.0;
  let lngMin = -180.0;
  let lngMax = 180.0;

  for (let i = 0; i < hash.length; i++) {
    const char = hash[i];
    const index = BASE32.indexOf(char);

    if (index === -1) {
      return null; // Invalid character
    }

    for (let j = 4; j >= 0; j--) {
      const bit = (index >> j) & 1;

      if (evenBit) {
        // Longitude
        const mid = (lngMin + lngMax) / 2;
        if (bit === 1) {
          lngMin = mid;
        } else {
          lngMax = mid;
        }
      } else {
        // Latitude
        const mid = (latMin + latMax) / 2;
        if (bit === 1) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }

      evenBit = !evenBit;
    }
  }

  const lat = (latMin + latMax) / 2;
  const lng = (lngMin + lngMax) / 2;

  return { lat, lng };
}

/**
 * Get cached coordinates for a location
 * @param {string} location - Location string
 * @returns {{ lat: number, lng: number, precision?: string } | null}
 */
export function getCachedCoordinates(location) {
  try {
    const cache = JSON.parse(localStorage.getItem('geocode_cache') || '{}');
    const cached = cache[location];

    if (cached && cached.timestamp) {
      const age = Date.now() - cached.timestamp;
      const config = getConfig();
      const maxAge = config.geocoding.cacheDurationDays * 24 * 60 * 60 * 1000;

      if (age < maxAge && isValidCoordinates(cached.lat, cached.lng)) {
        return cached.precision
          ? { lat: cached.lat, lng: cached.lng, precision: cached.precision }
          : { lat: cached.lat, lng: cached.lng };
      }
    }
  } catch (error) {
    console.error('Error reading geocode cache:', error);
  }

  return null;
}

/**
 * Set cached coordinates for a location
 * @param {string} location - Location string
 * @param {{ lat: number, lng: number, precision?: string }} coords - Coordinates, plus the
 *   geocoding precision (OpenCage `_type`) so a cache hit zooms like the live match
 */
export function setCachedCoordinates(location, coords) {
  try {
    const cache = JSON.parse(localStorage.getItem('geocode_cache') || '{}');
    cache[location] = {
      lat: coords.lat,
      lng: coords.lng,
      ...(coords.precision ? { precision: coords.precision } : {}),
      timestamp: Date.now()
    };
    localStorage.setItem('geocode_cache', JSON.stringify(cache));
  } catch (error) {
    console.error('Error writing to geocode cache:', error);
  }
}

/**
 * Autocomplete address suggestions using server-side geocoding API
 * Focused on Germany and Europe
 * @param {string} query - Partial address to search for
 * @returns {Promise<Array<{formatted: string, lat: number, lng: number}>>}
 */
export async function autocompleteAddress(query) {
  if (!query || typeof query !== 'string' || query.trim().length < 3) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: query.trim(),
      mode: 'autocomplete'
    });

    const url = `/api/geocode?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Autocomplete failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.results && data.results.length > 0) {
      return data.results;
    }

    return [];
  } catch (error) {
    console.error('Autocomplete error:', error);
    return [];
  }
}

/**
 * Geocode an address using server-side geocoding API with validation
 * @param {string} address - Address to geocode
 * @returns {Promise<{ lat: number, lng: number, formatted: string, precision?: string } | null>}
 */
export async function geocodeAddress(address) {
  if (!address || typeof address !== 'string') {
    return null;
  }

  // Basic validation: minimum length and not just a single word
  const trimmed = address.trim();
  if (trimmed.length < 3 || (!trimmed.includes(' ') && !trimmed.includes(','))) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      q: trimmed,
      mode: 'geocode'
    });

    const url = `/api/geocode?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.result) {
      const result = data.result;

      // Post-validation: Check result quality
      if (!validateGeocodeResult(result)) {
        return null;
      }

      const coords = {
        lat: result.lat,
        lng: result.lng,
        formatted: result.formatted, // Store formatted address for display
        // OpenCage result type (state, city, road, …): drives the map zoom
        ...(result.components?._type ? { precision: result.components._type } : {})
      };

      // Cache the result
      setCachedCoordinates(address, coords);

      return coords;
    }

    return null;
  } catch {
    // Geocoding failures are expected when not configured
    return null;
  }
}

/**
 * Parse location string to extract coordinates
 * Priority: cache > coordinates > address geocoding
 * @param {string} location - Location string
 * @param {string | null} [geohash] - Optional geohash from event
 * @returns {Promise<{ lat: number, lng: number, source: string, precision?: string } | null>}
 *   `precision` is the geocoder's result type (see `zoomForPrecision`); absent
 *   for exact coordinates and geohashes.
 */
export async function parseLocation(location, geohash = null) {
  if (!location || typeof location !== 'string') {
    // Try geohash if location is empty
    if (geohash) {
      const coords = geohashToCoordinates(geohash);
      if (coords) {
        return { ...coords, source: 'geohash' };
      }
    }
    return null;
  }

  const trimmed = location.trim();
  const type = detectLocationType(trimmed);

  // Skip URLs
  if (type === 'url') {
    return null;
  }

  // Check cache first
  const cached = getCachedCoordinates(trimmed);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  // Try parsing as coordinates
  if (type === 'coordinates') {
    const coords = parseCoordinates(trimmed);
    if (coords) {
      setCachedCoordinates(trimmed, coords);
      return { ...coords, source: 'coordinates' };
    }
  }

  // Try geohash from location string
  if (type === 'geohash') {
    const coords = geohashToCoordinates(trimmed);
    if (coords) {
      setCachedCoordinates(trimmed, coords);
      return { ...coords, source: 'geohash' };
    }
  }

  // Try geohash from event if provided (for address or venue types)
  if (geohash && (type === 'address' || type === 'venue')) {
    const coords = geohashToCoordinates(geohash);
    if (coords) {
      // Don't cache geohash as the location string (address might be more specific)
      return { ...coords, source: 'geohash' };
    }
  }

  // Attempt geocoding for both address and venue types
  // Let the OpenCage API determine if it's geocodable
  if (type === 'address' || type === 'venue') {
    const coords = await geocodeAddress(trimmed);
    if (coords) {
      return { ...coords, source: 'geocoded' };
    }
  }

  return null;
}
