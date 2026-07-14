/**
 * Kind-agnostic bookmark tag operations.
 *
 * Applesauce's `addEventBookmarkTag` / `removeEventBookmarkTag` (in
 * applesauce-common/operations/tag/bookmarks) hard-reject any event whose
 * kind is not 1 (ShortTextNote) or 30023 (LongFormArticle).
 *
 * NIP-51 itself is permissive: "Lists can contain references to anything"
 * (https://github.com/nostr-protocol/nips/blob/master/51.md). The
 * "expected tag items" column in the spec describes convention, not
 * enforcement — kind 10003 already documents `t` (hashtag) and `r` (URL)
 * tags too. Bookmarking a parameterized-replaceable kind (e.g. 30142 AMB
 * educational resources) via an `a` tag is structurally identical to
 * bookmarking a kind 30023 article and fully valid per the protocol.
 *
 * These helpers re-implement applesauce's logic without the kind allowlist,
 * delegating to applesauce-core's lower-level pointer-tag operations
 * (which have no such check).
 */

import {
  addAddressPointerTag,
  addEventPointerTag,
  removeAddressPointerTag,
  removeEventPointerTag
} from 'applesauce-core/operations/tag/common';
import { isReplaceable } from 'applesauce-core/helpers/event';
import { normalizeUrl } from '$lib/helpers/urlGrouping.js';

/**
 * Build a tag operation that adds a bookmark reference to a NIP-51 list.
 * Replaceable kinds (≥10000 or 30000–39999) become `a` tags; other kinds become `e` tags.
 *
 * @param {import('nostr-tools').NostrEvent} event - The event to bookmark
 * @returns {import('applesauce-core/factories').TagOperation} Tag operation
 */
export function addAnyKindBookmarkTag(event) {
  return isReplaceable(event.kind) ? addAddressPointerTag(event) : addEventPointerTag(event);
}

/**
 * Build a tag operation that removes a bookmark reference from a NIP-51 list.
 *
 * @param {import('nostr-tools').NostrEvent} event - The event to remove
 * @returns {import('applesauce-core/factories').TagOperation} Tag operation
 */
export function removeAnyKindBookmarkTag(event) {
  return isReplaceable(event.kind) ? removeAddressPointerTag(event) : removeEventPointerTag(event);
}

// ---------------------------------------------------------------------------
// URL (`r` tag) bookmark operations — for web bookmarks that have no Nostr
// event, so they can't be referenced via e/a tags. Matching is normalized
// (scheme/www/trailing-slash-insensitive) to stay in sync with how web
// bookmarks are grouped in urlGrouping.js — applesauce's built-in
// addUrlItem/bookmarkUrl match exact strings only, so we keep our own.
// ---------------------------------------------------------------------------

/**
 * Whether a NIP-51 list event references a URL via an `r` tag (normalized match).
 * @param {import('nostr-tools').NostrEvent | null | undefined} listEvent
 * @param {string} url
 * @returns {boolean}
 */
export function isUrlInList(listEvent, url) {
  if (!listEvent || !url) return false;
  const target = normalizeUrl(url);
  return listEvent.tags.some((t) => t[0] === 'r' && normalizeUrl(t[1] || '') === target);
}

/**
 * Tag operation that appends an `r` tag for a URL if not already present.
 * @param {string} url
 * @returns {(tags: string[][]) => string[][]}
 */
export function addUrlTag(url) {
  return (tags) => {
    const target = normalizeUrl(url);
    if (tags.some((t) => t[0] === 'r' && normalizeUrl(t[1] || '') === target)) return tags;
    return [...tags, ['r', url]];
  };
}

/**
 * Tag operation that removes any `r` tag matching a URL (normalized match).
 * @param {string} url
 * @returns {(tags: string[][]) => string[][]}
 */
export function removeUrlTag(url) {
  return (tags) => {
    const target = normalizeUrl(url);
    return tags.filter((t) => !(t[0] === 'r' && normalizeUrl(t[1] || '') === target));
  };
}
