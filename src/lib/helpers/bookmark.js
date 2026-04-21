/**
 * Bookmark helper functions for creating kind 39701 social bookmark events.
 */

import { nip19 } from 'nostr-tools';
import { createAppEventFactory } from '$lib/helpers/event-factory.js';

/** Kind number for social bookmarks */
export const BOOKMARK_KIND = 39701;

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
