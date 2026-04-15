import { nip19 } from 'nostr-tools';

let hasHistory = false;

/**
 * Record that an in-app navigation occurred.
 * Called from afterNavigate in +layout.svelte.
 * @param {{ url: URL } | null | undefined} from
 */
export function recordNavigation(from) {
  if (from?.url) hasHistory = true;
}

/**
 * Whether at least one in-app navigation has occurred.
 * Used to guard history.back() against navigating to an external site.
 * @returns {boolean}
 */
export function getHasHistory() {
  return hasHistory;
}

/**
 * Compute a sensible fallback route from an event when no in-app history exists.
 * @param {import('nostr-tools').NostrEvent | null | undefined} event
 * @returns {string}
 */
export function getFallbackRoute(event) {
  if (!event) return '/';

  // Community-scoped content → community feed
  const hTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'h')?.[1];
  if (hTag && /^[0-9a-f]{64}$/i.test(hTag)) {
    try {
      return `/c/${nip19.npubEncode(hTag)}`;
    } catch {
      // fall through
    }
  }

  // Kind-based fallbacks
  const kind = event.kind;
  if (kind === 31922 || kind === 31923) return '/calendar';
  if (kind === 30142) return '/discover';
  if (kind === 30023) return '/discover';
  if (kind === 30818) return '/wiki';
  if (kind === 39701) return '/bookmarks';

  return '/';
}

/** Reset state (for testing only) */
export function _reset() {
  hasHistory = false;
}
