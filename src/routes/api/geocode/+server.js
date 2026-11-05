/**
 * Server-side Geocoding API
 * Protects the OpenCage API key by proxying geocoding requests through the server
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createRateLimiter, clientKey, tooManyRequests } from '$lib/server/rate-limit.js';

// Each call spends OpenCage quota; autocomplete fires while typing, so stay generous.
const limit = createRateLimiter({ max: 120, windowMs: 10 * 60_000 });

/**
 * GET /api/geocode?q=address&mode=geocode
 * GET /api/geocode?q=partial&mode=autocomplete
 *
 * Modes:
 * - geocode: Full geocoding of an address
 * - autocomplete: Address suggestions for autocomplete
 */
export async function GET({ url, getClientAddress }) {
  const retryAfter = limit(clientKey({ getClientAddress }));
  if (retryAfter) return tooManyRequests(retryAfter);

  const query = url.searchParams.get('q');
  const mode = url.searchParams.get('mode') || 'geocode';

  if (!query || query.trim().length < 3) {
    throw error(400, 'Query parameter "q" must be at least 3 characters');
  }

  const apiKey = env.GEOCODING_API_KEY;
  if (!apiKey) {
    // Return graceful response instead of error - geocoding is optional
    return json({ success: false, error: 'not_configured' });
  }

  try {
    if (mode === 'autocomplete') {
      return json(await handleAutocomplete(query.trim(), apiKey));
    } else if (mode === 'geocode') {
      return json(await handleGeocode(query.trim(), apiKey));
    } else {
      throw error(400, 'Invalid mode. Use "geocode" or "autocomplete"');
    }
  } catch (err) {
    console.error('Geocoding API error:', err);

    // @ts-ignore - err might have a status property from SvelteKit
    if (err?.status) {
      throw err; // Re-throw SvelteKit errors
    }

    throw error(500, 'Geocoding request failed');
  }
}

/**
 * Handle autocomplete request
 * @param {string} query
 * @param {string} apiKey
 */
async function handleAutocomplete(query, apiKey) {
  const params = new URLSearchParams({
    q: query,
    key: apiKey,
    limit: '5',
    countrycode: 'de,at,ch,fr,nl,be,pl,cz,dk,it,es', // Germany and neighboring countries
    language: 'en',
    no_annotations: '1'
  });

  const opencageUrl = `https://api.opencagedata.com/geocode/v1/json?${params}`;
  const response = await fetch(opencageUrl);

  if (!response.ok) {
    throw error(response.status, `OpenCage API error: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.results && data.results.length > 0) {
    return {
      success: true,
      results: data.results.map((/** @type {any} */ result) => ({
        formatted: result.formatted,
        lat: result.geometry.lat,
        lng: result.geometry.lng
      }))
    };
  }

  return { success: true, results: [] };
}

/**
 * Handle geocoding request
 * @param {string} address
 * @param {string} apiKey
 */
async function handleGeocode(address, apiKey) {
  const params = new URLSearchParams({
    q: address,
    key: apiKey,
    limit: '1'
  });

  const opencageUrl = `https://api.opencagedata.com/geocode/v1/json?${params}`;
  const response = await fetch(opencageUrl);

  if (!response.ok) {
    throw error(response.status, `OpenCage API error: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.results && data.results.length > 0) {
    const result = data.results[0];

    return {
      success: true,
      result: {
        lat: result.geometry.lat,
        lng: result.geometry.lng,
        formatted: result.formatted,
        confidence: result.confidence,
        components: result.components
      }
    };
  }

  return { success: false, result: null };
}
