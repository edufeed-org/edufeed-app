/**
 * Bookmark helper functions for creating kind 39701 social bookmark events.
 */

import { nip19 } from 'nostr-tools';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { parseEventCoordinate } from '$lib/helpers/urlGrouping.js';

/** Kind number for social bookmarks */
export const BOOKMARK_KIND = 39701;

/**
 * Parse a bookmark-detail `[url]` route param into its event-ref coordinate.
 * Event-ref bookmarks key the detail route by their Nostr coordinate
 * (`kind:pubkey:identifier`, sometimes carrying a leftover `https://` prefix);
 * such a "URL" isn't a web page but a reference to an addressable Nostr event
 * (in practice a kind-30023 article). Returns the address pointer plus the
 * canonical a-tag value so the detail page can render the unified social
 * bookmark view. Returns null for genuine web URLs (handled by the web hub).
 * @param {string} encodedUrlParam - The raw `[url]` route param (URI-encoded)
 * @returns {{ pointer: import('nostr-tools/nip19').AddressPointer, aTagValue: string } | null}
 */
export function parseBookmarkUrlParam(encodedUrlParam) {
  let value;
  try {
    value = decodeURIComponent(encodedUrlParam);
  } catch {
    value = encodedUrlParam;
  }
  value = value.replace(/^https?:\/\//, '');
  const pointer = parseEventCoordinate(value);
  if (!pointer) return null;
  return { pointer, aTagValue: `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}` };
}

/**
 * True for an edufeed community pubkey path segment (npub or 64-char hex). Used
 * to avoid mistaking an unrelated site's `/c/.../bookmarks/` path for an
 * edufeed bookmark page.
 * @param {string} seg
 * @returns {boolean}
 */
function isPubkeySegment(seg) {
  return /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(seg) || /^[0-9a-f]{64}$/i.test(seg);
}

/**
 * If `urlStr` is an edufeed bookmark-detail page (`/c/<pubkey>/bookmarks/<inner>`
 * or `/bookmarks/<inner>`) whose `<inner>` is itself a wrapped http(s) URL,
 * return the decoded inner URL. Host-independent: the same bad data must unwrap
 * whether viewed on localhost, dev.edufeed.org, or any deployment. Otherwise null.
 * @param {string} urlStr
 * @returns {string | null}
 */
function extractInnerBookmarkUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/^\/(?:c\/([^/]+)\/)?bookmarks\/(.+)$/);
  if (!match) return null;
  const communitySegment = match[1];
  if (communitySegment && !isPubkeySegment(communitySegment)) return null;
  let inner = match[2];
  try {
    inner = decodeURIComponent(inner);
  } catch {
    // keep raw if it isn't valid percent-encoding
  }
  // The pathology is a wrapped absolute URL; a normal /bookmarks/<slug> page
  // never carries an http(s) target embedded in its path.
  if (!/^https?:\/\//i.test(inner)) return null;
  return inner;
}

/**
 * Detect a self-referential bookmark whose `[url]` is itself an edufeed
 * bookmark-detail page (e.g. someone bookmarked the bookmark page instead of
 * the article). Such a "URL" can't be read as an article and roots comments at
 * an internal app URL, so we unwrap to the innermost real target and redirect
 * there. Returns the decoded innermost URL, or null when the param is a genuine
 * external URL.
 * @param {string} encodedUrlParam - The raw `[url]` route param (URI-encoded)
 * @returns {string | null}
 */
export function getInternalBookmarkRedirectTarget(encodedUrlParam) {
  let target;
  try {
    target = decodeURIComponent(encodedUrlParam);
  } catch {
    target = encodedUrlParam;
  }

  let unwrapped = false;
  // Cap iterations to guard against pathological deep nesting.
  for (let i = 0; i < 10; i++) {
    const inner = extractInnerBookmarkUrl(target);
    if (!inner) break;
    target = inner;
    unwrapped = true;
  }

  return unwrapped ? target : null;
}

/**
 * Detect whether input is a URL, naddr, or invalid.
 * @param {string} input
 * @returns {'url' | 'naddr' | 'invalid'}
 */
export function detectInputType(input) {
  const trimmed = input.trim();
  if (!trimmed) return 'invalid';

  if (trimmed.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'naddr') return 'naddr';
    } catch {
      // fall through
    }
    return 'invalid';
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'url';

  // Bare domain (e.g. example.com/path)
  if (/^[a-zA-Z0-9][\w.-]*\.[a-zA-Z]{2,}/.test(trimmed)) return 'url';

  return 'invalid';
}

/**
 * Strip scheme and trailing slash from URL for use as d-tag.
 * @param {string} url
 * @returns {string}
 */
export function stripSchemeForDTag(url) {
  let result = url.replace(/^https?:\/\//, '');
  if (result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

/**
 * Split a URL into everything before the first `#` and the fragment after it.
 * @param {string} url
 * @returns {{ base: string, fragment: string }}
 */
function splitFragment(url) {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return { base: url, fragment: '' };
  return { base: url.slice(0, hashIndex), fragment: url.slice(hashIndex + 1) };
}

/**
 * Parse a fragment as PDF open parameters (`page=31&zoom=100`). Returns null
 * when the fragment is an opaque anchor (`#section-2`) rather than parameters.
 * @param {string} fragment
 * @returns {[string, string][] | null}
 */
function parseOpenParameters(fragment) {
  if (!fragment) return [];
  /** @type {[string, string][]} */
  const params = [];
  for (const part of fragment.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    params.push([part.slice(0, eq), part.slice(eq + 1)]);
  }
  return params;
}

/**
 * Coerce a page value to a positive integer, or null when it isn't one.
 * @param {string | number | null | undefined} page
 * @returns {number | null}
 */
function toPageNumber(page) {
  if (page === null || page === undefined || page === '') return null;
  if (typeof page === 'string' && !/^\d+$/.test(page.trim())) return null;
  const n = Number(page);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * True when the URL's path ends in `.pdf` (query string and fragment ignored).
 * Works on scheme-less URLs too, since the bookmark form accepts bare domains.
 * @param {string | null | undefined} url
 * @returns {boolean}
 */
export function looksLikePdfUrl(url) {
  if (!url) return false;
  const path = splitFragment(url).base.split('?')[0];
  return /\.pdf$/i.test(path);
}

/**
 * Read the page number out of a `#page=N` URL fragment (PDF open parameter).
 * Returns null when there is no such fragment or the value isn't a positive integer.
 * @param {string | null | undefined} url
 * @returns {number | null}
 */
export function parsePageFromUrl(url) {
  if (!url) return null;
  const params = parseOpenParameters(splitFragment(url).fragment);
  if (!params) return null;
  const entry = params.find(([key]) => key === 'page');
  return entry ? toPageNumber(entry[1]) : null;
}

/**
 * Set (or clear) the `#page=N` fragment on a URL.
 *
 * A blank/invalid page removes an existing `page` parameter but leaves any other
 * fragment alone. Other PDF open parameters (`zoom`, `view`, …) are preserved.
 * An opaque fragment (`#section-2`) is replaced when a page is given — a URL can
 * only carry one fragment.
 *
 * @param {string} url
 * @param {string | number | null | undefined} page
 * @returns {string}
 */
export function applyPageToUrl(url, page) {
  if (!url) return url;

  const { base, fragment } = splitFragment(url);
  const pageNumber = toPageNumber(page);
  const params = parseOpenParameters(fragment);

  if (pageNumber === null) {
    // Nothing to clear when the fragment is opaque or has no page parameter.
    if (!params) return url;
    const kept = params.filter(([key]) => key !== 'page');
    if (kept.length === params.length) return url;
    return kept.length ? `${base}#${kept.map(([k, v]) => `${k}=${v}`).join('&')}` : base;
  }

  if (!params) return `${base}#page=${pageNumber}`;

  const next = params.some(([key]) => key === 'page')
    ? params.map((p) => (p[0] === 'page' ? ['page', String(pageNumber)] : p))
    : [...params, ['page', String(pageNumber)]];
  return `${base}#${next.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/**
 * Whether to offer the optional "page" input for this URL: PDFs, plus anything
 * that already carries a `#page=N` fragment (some viewers serve PDFs from paths
 * that don't end in `.pdf`).
 * @param {string | null | undefined} url
 * @returns {boolean}
 */
export function supportsPageReference(url) {
  return looksLikePdfUrl(url) || parsePageFromUrl(url) !== null;
}

/**
 * @typedef {Object} NaddrData
 * @property {number} kind
 * @property {string} pubkey
 * @property {string} identifier
 * @property {string} [relayHint]
 */

/**
 * Build tag array for a kind 39701 bookmark event.
 * @param {string} url - Full URL (may be empty for naddr-only bookmarks)
 * @param {string} title
 * @param {string[]} communityPubkeys - h-tag targets
 * @param {NaddrData} [naddrData] - Decoded naddr data for event reference bookmarks
 * @returns {string[][]}
 */
export function buildBookmarkTags(url, title, communityPubkeys, naddrData) {
  const tags = [];

  // d-tag: URL without scheme, or a-tag value for naddr-only
  if (url) {
    tags.push(['d', stripSchemeForDTag(url)]);
  } else if (naddrData) {
    tags.push(['d', `${naddrData.kind}:${naddrData.pubkey}:${naddrData.identifier}`]);
  }

  // r-tag: full URL
  if (url) {
    tags.push(['r', url]);
  }

  // a-tag: event reference
  if (naddrData) {
    const aValue = `${naddrData.kind}:${naddrData.pubkey}:${naddrData.identifier}`;
    tags.push(['a', aValue, naddrData.relayHint || '']);
  }

  // title tag
  if (title?.trim()) {
    tags.push(['title', title.trim()]);
  }

  // h-tags: community targeting
  for (const pubkey of communityPubkeys) {
    tags.push(['h', pubkey]);
  }

  return tags;
}

/**
 * Decode an naddr string into its components.
 * @param {string} naddrStr
 * @returns {NaddrData | null}
 */
export function decodeNaddr(naddrStr) {
  try {
    const decoded = nip19.decode(naddrStr.trim());
    if (decoded.type !== 'naddr') return null;
    const data = /** @type {import('nostr-tools/nip19').AddressPointer} */ (decoded.data);
    return {
      kind: data.kind,
      pubkey: data.pubkey,
      identifier: data.identifier,
      relayHint: data.relays?.[0]
    };
  } catch {
    return null;
  }
}

/**
 * Create and sign a bookmark event.
 * @param {Object} params
 * @param {string} params.url - Full URL (or empty for naddr-only)
 * @param {string} params.title
 * @param {string} params.description
 * @param {string[]} params.communityPubkeys
 * @param {NaddrData} [params.naddrData]
 * @param {{ signEvent: (template: any) => Promise<any> }} params.account - Active account for signing
 * @returns {Promise<import('nostr-tools').NostrEvent>}
 */
export async function createBookmarkEvent({
  url,
  title,
  description,
  communityPubkeys,
  naddrData,
  account
}) {
  const tags = buildBookmarkTags(url, title, communityPubkeys, naddrData);

  const eventFactory = createAppEventFactory();
  const template = await eventFactory.build({
    kind: BOOKMARK_KIND,
    content: description || '',
    tags
  });

  return account.signEvent(template);
}

/**
 * Create a replacement bookmark event with updated content, preserving all tags.
 * Kind 39701 is addressable — same kind + pubkey + d-tag overwrites the previous version.
 *
 * @param {import('nostr-tools').NostrEvent} event - The existing bookmark event
 * @param {string} newContent - Updated description/content
 * @param {{ signEvent: (template: any) => Promise<any> }} account - Active account for signing
 * @returns {Promise<import('nostr-tools').NostrEvent>}
 */
export async function updateBookmarkContent(event, newContent, account) {
  const eventFactory = createAppEventFactory();
  const template = await eventFactory.build({
    kind: BOOKMARK_KIND,
    content: newContent,
    tags: event.tags
  });

  return account.signEvent(template);
}
