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

/**
 * Derive the edit-form state for an existing bookmark event.
 *
 * The URL field is read-only in edit mode, but it is still shown so the user
 * can see what they are editing: a web bookmark shows its `r` URL, an
 * event-reference bookmark shows the naddr rebuilt from its `a` tag. When
 * neither is present, the `d` tag (a scheme-stripped URL) is the last resort.
 *
 * @param {import('nostr-tools').NostrEvent | null | undefined} event
 * @returns {{ input: string, title: string, description: string, communityPubkeys: string[] }}
 */
export function getBookmarkEditPrefill(event) {
  const empty = { input: '', title: '', description: '', communityPubkeys: [] };
  if (!event) return empty;

  const tags = event.tags || [];
  const findValue = (/** @type {string} */ name) => tags.find((t) => t[0] === name)?.[1] || '';

  let input = findValue('r');

  if (!input) {
    const aTag = tags.find((t) => t[0] === 'a');
    const pointer = aTag?.[1] ? parseEventCoordinate(aTag[1]) : null;
    if (pointer) {
      try {
        input = nip19.naddrEncode({
          kind: pointer.kind,
          pubkey: pointer.pubkey,
          identifier: pointer.identifier,
          ...(aTag?.[2] ? { relays: [aTag[2]] } : {})
        });
      } catch {
        // fall through to the d-tag
      }
    }
  }

  if (!input) {
    const dTag = findValue('d');
    if (dTag) input = /^https?:\/\//.test(dTag) ? dTag : `https://${dTag}`;
  }

  // h-tags come off the wire untrusted; a repeat would duplicate a key in the
  // community selector's {#each}.
  const communityPubkeys = [...new Set(tags.filter((t) => t[0] === 'h' && t[1]).map((t) => t[1]))];

  return {
    input,
    title: findValue('title'),
    description: event.content || '',
    communityPubkeys
  };
}

/**
 * Build the tag array for an edited bookmark.
 *
 * Everything that addresses the bookmark stays untouched: the `d` tag (derived
 * from the URL at creation time) and the `r`/`a` tags it points at. Changing
 * them would publish a *different* addressable event instead of replacing this
 * one, so the edit UI keeps the URL read-only. Only `title` and the `h`
 * community targets are rewritten; any other tag is carried over verbatim.
 *
 * @param {import('nostr-tools').NostrEvent} event - The existing bookmark event
 * @param {{ title: string, communityPubkeys: string[] }} updates
 * @returns {string[][]}
 */
export function buildBookmarkEditTags(event, { title, communityPubkeys }) {
  const preserved = (event.tags || []).filter((t) => t[0] !== 'title' && t[0] !== 'h');

  const tags = [...preserved];

  if (title?.trim()) {
    tags.push(['title', title.trim()]);
  }

  for (const pubkey of communityPubkeys) {
    tags.push(['h', pubkey]);
  }

  return tags;
}

/**
 * Create and sign a replacement bookmark event with an edited title, comment
 * and community targets. Kind 39701 is addressable, so republishing with the
 * same d-tag overwrites the previous version.
 *
 * @param {Object} params
 * @param {import('nostr-tools').NostrEvent} params.event - The existing bookmark event
 * @param {string} params.title
 * @param {string} params.description
 * @param {string[]} params.communityPubkeys
 * @param {{ signEvent: (template: any) => Promise<any> }} params.account
 * @returns {Promise<import('nostr-tools').NostrEvent>}
 */
export async function updateBookmarkEvent({
  event,
  title,
  description,
  communityPubkeys,
  account
}) {
  const tags = buildBookmarkEditTags(event, { title, communityPubkeys });

  const eventFactory = createAppEventFactory();
  const template = await eventFactory.build({
    kind: BOOKMARK_KIND,
    content: description || '',
    tags
  });

  return account.signEvent(template);
}
