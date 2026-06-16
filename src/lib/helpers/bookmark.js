/**
 * Bookmark helper functions for creating kind 39701 social bookmark events.
 */

import { nip19 } from 'nostr-tools';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { parseEventCoordinate } from '$lib/helpers/urlGrouping.js';

/** Kind number for social bookmarks */
export const BOOKMARK_KIND = 39701;

/**
 * Resolve the redirect path for a bookmark-detail `[url]` route param.
 * Event-ref bookmarks key the detail route by their Nostr coordinate
 * (`kind:pubkey:identifier`, sometimes carrying a leftover `https://` prefix).
 * Such a "URL" can't be fetched as a web page, so redirect to the referenced
 * event's naddr, which renders through normal canonical routing.
 * Returns null for genuine web URLs (which the detail page handles directly).
 * @param {string} encodedUrlParam - The raw `[url]` route param (URI-encoded)
 * @returns {string | null}
 */
export function getBookmarkEventRefRedirect(encodedUrlParam) {
  let value;
  try {
    value = decodeURIComponent(encodedUrlParam);
  } catch {
    value = encodedUrlParam;
  }
  value = value.replace(/^https?:\/\//, '');
  const pointer = parseEventCoordinate(value);
  if (!pointer) return null;
  const naddr = nip19.naddrEncode({
    kind: pointer.kind,
    pubkey: pointer.pubkey,
    identifier: pointer.identifier,
    relays: []
  });
  return `/${naddr}`;
}

/**
 * If `urlStr` is an edufeed bookmark-detail page on `currentOrigin`
 * (`/c/<pubkey>/bookmarks/<inner>` or `/bookmarks/<inner>`), return the decoded
 * inner URL. Otherwise null.
 * @param {string} urlStr
 * @param {string} currentOrigin
 * @returns {string | null}
 */
function extractInnerBookmarkUrl(urlStr, currentOrigin) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return null;
  }
  if (parsed.origin !== currentOrigin) return null;
  const match = parsed.pathname.match(/^\/(?:c\/[^/]+\/)?bookmarks\/(.+)$/);
  if (!match) return null;
  let inner = match[1];
  try {
    inner = decodeURIComponent(inner);
  } catch {
    // keep raw if it isn't valid percent-encoding
  }
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
 * @param {string} currentOrigin - The app's own origin (e.g. https://dev.edufeed.org)
 * @returns {string | null}
 */
export function getInternalBookmarkRedirectTarget(encodedUrlParam, currentOrigin) {
  let target;
  try {
    target = decodeURIComponent(encodedUrlParam);
  } catch {
    target = encodedUrlParam;
  }

  let unwrapped = false;
  // Cap iterations to guard against pathological deep nesting.
  for (let i = 0; i < 10; i++) {
    const inner = extractInnerBookmarkUrl(target, currentOrigin);
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
