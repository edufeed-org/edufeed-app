/**
 * URL grouping helpers for Social Bookmarks.
 * Groups bookmark (39701), highlight (9802), and page note (1111) events by URL.
 */

/**
 * @typedef {Object} UrlGroup
 * @property {string} url - Normalized URL (canonical key)
 * @property {string} displayUrl - Original URL for display/linking
 * @property {string} title - From bookmark title tag, or URL
 * @property {string} description - From bookmark content
 * @property {any[]} bookmarks - Kind 39701 events
 * @property {any[]} highlights - Kind 9802 events (r-tag only)
 * @property {any[]} pageNotes - Kind 1111 events (K=web)
 * @property {number} latestActivity - Most recent created_at
 * @property {string[]} contributors - Unique pubkeys
 */

/**
 * Normalize a URL for grouping. Strips scheme, www., trailing slash, lowercases hostname.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  if (!url) return '';

  let normalized = url;

  // Strip scheme
  normalized = normalized.replace(/^https?:\/\//, '');

  // Strip www.
  normalized = normalized.replace(/^www\./, '');

  // Lowercase hostname (everything before first /)
  const slashIndex = normalized.indexOf('/');
  if (slashIndex > 0) {
    const hostname = normalized.slice(0, slashIndex).toLowerCase();
    const rest = normalized.slice(slashIndex);
    normalized = hostname + rest;
  } else {
    normalized = normalized.toLowerCase();
  }

  // Strip trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Extract URL from a social bookmark event based on its kind.
 * Returns undefined if event doesn't qualify as a social bookmark.
 * @param {any} event
 * @returns {string | undefined}
 */
export function extractUrlFromEvent(event) {
  if (!event || !event.tags) return undefined;

  if (event.kind === 39701) {
    // Bookmark: d-tag is the URL without scheme
    const dTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'd');
    return dTag?.[1] || undefined;
  }

  if (event.kind === 9802) {
    // Highlight: r-tag is the source URL. Only URL highlights qualify.
    const rTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'r');
    return rTag?.[1] || undefined;
  }

  if (event.kind === 1111) {
    // Page note: I-tag is the URL, K-tag must be 'web'
    const kTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'K');
    if (kTag?.[1] !== 'web') return undefined;
    const iTag = event.tags.find((/** @type {string[]} */ t) => t[0] === 'I');
    return iTag?.[1] || undefined;
  }

  return undefined;
}

/**
 * Filter events to only social bookmark-eligible ones.
 * - Kind 39701: always included
 * - Kind 9802: only with r-tag (URL highlights, not Nostr event highlights)
 * - Kind 1111: only with K=web (page notes, not event comments)
 * @param {any[]} events
 * @returns {any[]}
 */
export function filterSocialBookmarks(events) {
  return events.filter((event) => extractUrlFromEvent(event) !== undefined);
}

/**
 * Group filtered social bookmark events by normalized URL.
 * @param {any[]} events - Already-filtered events (use filterSocialBookmarks first, or raw events)
 * @returns {UrlGroup[]} Sorted by latestActivity descending
 */
export function groupByUrl(events) {
  /** @type {Map<string, { bookmarks: any[], highlights: any[], pageNotes: any[], displayUrl: string, title: string, description: string, latestActivity: number, contributorSet: Set<string> }>} */
  const groups = new Map();

  for (const event of events) {
    const rawUrl = extractUrlFromEvent(event);
    if (!rawUrl) continue;

    const normalized = normalizeUrl(rawUrl);
    if (!normalized) continue;

    if (!groups.has(normalized)) {
      groups.set(normalized, {
        bookmarks: [],
        highlights: [],
        pageNotes: [],
        displayUrl: '',
        title: '',
        description: '',
        latestActivity: 0,
        contributorSet: new Set()
      });
    }

    const group = /** @type {NonNullable<ReturnType<typeof groups.get>>} */ (
      groups.get(normalized)
    );

    // Categorize by kind
    if (event.kind === 39701) {
      group.bookmarks.push(event);
      // Extract title from bookmark's title tag
      const titleTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'title');
      if (titleTag?.[1] && !group.title) {
        group.title = titleTag[1];
      }
      // Extract description from bookmark content
      if (event.content && !group.description) {
        group.description = event.content;
      }
    } else if (event.kind === 9802) {
      group.highlights.push(event);
    } else if (event.kind === 1111) {
      group.pageNotes.push(event);
    }

    // Track display URL (prefer full URL with scheme)
    if (rawUrl.startsWith('http') && !group.displayUrl) {
      group.displayUrl = rawUrl;
    }

    // Track latest activity
    if (event.created_at > group.latestActivity) {
      group.latestActivity = event.created_at;
    }

    // Track contributors
    if (event.pubkey) {
      group.contributorSet.add(event.pubkey);
    }
  }

  // Convert to UrlGroup array
  return Array.from(groups.entries())
    .map(([url, data]) => ({
      url,
      displayUrl: data.displayUrl || `https://${url}`,
      title: data.title || url,
      description: data.description,
      bookmarks: data.bookmarks,
      highlights: data.highlights,
      pageNotes: data.pageNotes,
      latestActivity: data.latestActivity,
      contributors: Array.from(data.contributorSet)
    }))
    .sort((a, b) => b.latestActivity - a.latestActivity);
}
