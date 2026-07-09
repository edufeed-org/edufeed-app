/**
 * URL Parameter Management Utilities
 *
 * Provides helpers for managing query parameters in SvelteKit applications,
 * specifically for calendar filter state management.
 */

import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

/**
 * Update URL query parameters while preserving others
 *
 * @param {URLSearchParams} currentParams - Current URL params from $page.url.searchParams
 * @param {Object} updates - Key-value pairs to update. Use array for multiple values.
 * @param {Object} [options] - Navigation options
 * @param {boolean} [options.replaceState=true] - Replace current history entry
 * @param {boolean} [options.keepFocus=true] - Keep focus on current element
 * @param {boolean} [options.noScroll=true] - Don't scroll to top
 * @returns {Promise<void>} - Navigation promise
 *
 * @example
 * // Single value
 * updateQueryParams(params, { view: 'list', search: 'bitcoin' });
 *
 * // Multiple values (repeated keys)
 * updateQueryParams(params, {
 *   tags: ['bitcoin', 'nostr', 'conference'],
 *   relays: ['wss://relay.damus.io', 'wss://nos.lol']
 * });
 *
 * // Remove parameter (pass null, undefined, empty string, or empty array)
 * updateQueryParams(params, { search: null, tags: [] });
 */
export function updateQueryParams(currentParams, updates, options = {}) {
  const params = new URLSearchParams(currentParams);

  Object.entries(updates).forEach(([key, value]) => {
    // Delete existing values for this key
    params.delete(key);

    // Add new value(s)
    if (Array.isArray(value)) {
      // Multiple values (tags, relays, authors) - use repeated keys
      value.forEach((v) => {
        if (v !== null && v !== undefined && v !== '') {
          params.append(key, v);
        }
      });
    } else if (value !== null && value !== undefined && value !== '') {
      // Single value (view, search)
      params.set(key, value);
    }
    // If value is null/undefined/empty string/empty array, param is removed
  });

  const queryString = params.toString();
  // Always include pathname - resolve() needs a proper path, not just query string
  const pathname = window.location.pathname;
  const url = queryString ? `${pathname}?${queryString}` : pathname;

  return goto(/** @type {any} */ (resolve)(url), {
    replaceState: options.replaceState ?? true,
    keepFocus: options.keepFocus ?? true,
    noScroll: options.noScroll ?? true
  });
}

/**
 * Parse calendar filter parameters from URL
 *
 * @param {URLSearchParams} searchParams - URL search params from $page.url.searchParams
 * @returns {Object} - Parsed filter state
 *
 * @example
 * const filters = parseCalendarFilters($page.url.searchParams);
 * // Returns: {
 * //   view: 'list',
 * //   period: 'month',
 * //   tags: ['bitcoin', 'nostr'],
 * //   relays: ['wss://relay.damus.io'],
 * //   authors: ['npub1...'],
 * //   search: 'conference'
 * // }
 */
export function parseCalendarFilters(searchParams) {
  return {
    view: searchParams.get('view') || 'list',
    period: searchParams.get('period') || 'month',
    date: searchParams.get('date') || '',
    tags: searchParams.getAll('tags'),
    relays: searchParams.getAll('relays'),
    authors: searchParams.getAll('authors'),
    search: searchParams.get('search') || ''
  };
}

/**
 * Build calendar URL with specified filters
 *
 * @param {Object} filters - Filter parameters
 * @param {string} [filters.view] - Presentation view mode
 * @param {string} [filters.period] - Time period (month/week/day/all)
 * @param {string} [filters.date] - Anchor date of the viewed range (YYYY-MM-DD)
 * @param {string[]} [filters.tags] - Tag filters
 * @param {string[]} [filters.relays] - Relay filters
 * @param {string[]} [filters.authors] - Author filters
 * @param {string} [filters.search] - Search query
 * @param {string} [basePath='/calendar'] - Base path for URL
 * @returns {string} - Complete URL with query parameters
 *
 * @example
 * const url = buildCalendarURL({
 *   view: 'list',
 *   period: 'all',
 *   tags: ['bitcoin', 'nostr'],
 *   search: 'conference'
 * });
 * // Returns: '/calendar?view=list&period=all&tags=bitcoin&tags=nostr&search=conference'
 */
export function buildCalendarURL(filters, basePath = '/calendar') {
  const params = new URLSearchParams();

  // Add view mode
  if (filters.view && filters.view !== 'list') {
    params.set('view', filters.view);
  }

  // Add period (time range)
  if (filters.period && filters.period !== 'month') {
    params.set('period', filters.period);
  }

  // Add anchor date of the viewed time range (YYYY-MM-DD, local)
  if (filters.date) {
    params.set('date', filters.date);
  }

  // Add tags (repeated keys)
  if (filters.tags && filters.tags.length > 0) {
    filters.tags.forEach((tag) => params.append('tags', tag));
  }

  // Add relays (repeated keys)
  if (filters.relays && filters.relays.length > 0) {
    filters.relays.forEach((relay) => params.append('relays', relay));
  }

  // Add authors (repeated keys)
  if (filters.authors && filters.authors.length > 0) {
    filters.authors.forEach((author) => params.append('authors', author));
  }

  // Add search query
  if (filters.search) {
    params.set('search', filters.search);
  }

  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

/**
 * Check if URL has any active filters
 *
 * @param {URLSearchParams} searchParams - URL search params
 * @returns {boolean} - True if any filters are active
 */
export function hasActiveFilters(searchParams) {
  return (
    searchParams.getAll('tags').length > 0 ||
    searchParams.getAll('relays').length > 0 ||
    searchParams.getAll('authors').length > 0 ||
    (searchParams.get('search') !== null && searchParams.get('search') !== '') ||
    (searchParams.get('view') !== null && searchParams.get('view') !== 'list') ||
    (searchParams.get('period') !== null && searchParams.get('period') !== 'month')
  );
}

/**
 * Clear all filters from URL
 *
 * @param {string} [basePath='/calendar'] - Base path to navigate to
 * @param {Object} [options] - Navigation options
 * @param {boolean} [options.replaceState] - Replace current history entry
 * @param {boolean} [options.keepFocus] - Keep focus on current element
 * @param {boolean} [options.noScroll] - Don't scroll to top
 * @returns {Promise<void>} - Navigation promise
 */
export function clearAllFilters(basePath = '/calendar', options = {}) {
  return goto(/** @type {any} */ (resolve)(basePath), {
    replaceState: options.replaceState ?? true,
    keepFocus: options.keepFocus ?? true,
    noScroll: options.noScroll ?? false // Allow scroll to top when clearing
  });
}

// ============================================================
// Feed Page URL Parameter Functions
// ============================================================

/**
 * @typedef {Object} FeedFilters
 * @property {string[]} tags - Tag filters
 * @property {string | null} community - Community filter (pubkey, 'joined', or null)
 * @property {string} type - Content type filter ('all', 'events', 'learning', 'articles', 'communities')
 * @property {number | null} eventStart - Events date range start (Unix timestamp in seconds)
 * @property {number | null} eventEnd - Events date range end (Unix timestamp in seconds)
 * @property {string[]} author - Author filter (pubkeys, comma-separated in URL)
 * @property {string} search - Search query text
 */

/**
 * Parse feed filter parameters from URL
 *
 * @param {URLSearchParams} searchParams - URL search params from $page.url.searchParams
 * @returns {FeedFilters} - Parsed filter state
 *
 * @example
 * const filters = parseFeedFilters($page.url.searchParams);
 * // Returns: {
 * //   tags: ['bitcoin', 'nostr'],
 * //   community: 'abc123' | 'joined' | null,
 * //   type: 'all' | 'events' | 'learning' | 'articles' | 'communities',
 * //   eventStart: 1707696000 | null,
 * //   eventEnd: 1715558400 | null
 * // }
 */
export function parseFeedFilters(searchParams) {
  const eventStartStr = searchParams.get('eventStart');
  const eventEndStr = searchParams.get('eventEnd');

  return {
    tags: searchParams.getAll('tags'),
    community: searchParams.get('community') || null,
    type: searchParams.get('type') || 'all',
    eventStart: eventStartStr ? parseInt(eventStartStr, 10) : null,
    eventEnd: eventEndStr ? parseInt(eventEndStr, 10) : null,
    author: (searchParams.get('author') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    search: searchParams.get('search') || ''
  };
}

/**
 * Build feed URL with specified filters
 *
 * @param {Object} filters - Filter parameters
 * @param {string[]} [filters.tags] - Tag filters
 * @param {string | null} [filters.community] - Community filter (pubkey, 'joined', or null)
 * @param {string} [basePath='/discover'] - Base path for URL
 * @returns {string} - Complete URL with query parameters
 *
 * @example
 * const url = buildFeedURL({
 *   tags: ['education', 'nostr'],
 *   community: 'joined'
 * });
 * // Returns: '/discover?tags=education&tags=nostr&community=joined'
 */
export function buildFeedURL(filters, basePath = '/discover') {
  const params = new URLSearchParams();

  // Add tags (repeated keys)
  if (filters.tags && filters.tags.length > 0) {
    filters.tags.forEach((tag) => params.append('tags', tag));
  }

  // Add community filter
  if (filters.community) {
    params.set('community', filters.community);
  }

  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
}

/**
 * Check if feed URL has any active filters
 *
 * @param {URLSearchParams} searchParams - URL search params
 * @returns {boolean} - True if any filters are active
 */
export function hasFeedFilters(searchParams) {
  return (
    searchParams.getAll('tags').length > 0 ||
    searchParams.get('community') !== null ||
    searchParams.get('eventStart') !== null ||
    searchParams.get('eventEnd') !== null ||
    searchParams.get('author') !== null ||
    (searchParams.get('search') !== null && searchParams.get('search') !== '')
  );
}

/**
 * Format a Date as the calendar's `date` URL param (YYYY-MM-DD).
 *
 * Uses LOCAL date components — toISOString would shift the day for viewers
 * east/west of UTC around midnight.
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatDateParam(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a `date` URL param (YYYY-MM-DD) into a LOCAL date at midnight.
 * Returns null for malformed or impossible dates.
 *
 * @param {string | null | undefined} value
 * @returns {Date | null}
 */
export function parseDateParam(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // new Date() silently rolls over impossible dates (2026-02-30 → March 2) —
  // reject those instead of landing the user somewhere unexpected.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}
