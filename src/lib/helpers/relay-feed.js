/**
 * Relay feed helpers — pure logic for the dashboard relay feed:
 * user-input normalization, relay option assembly for the picker,
 * and provenance-based event filtering for the feed itself.
 */
import { getSeenRelays, normalizeURL } from 'applesauce-core/helpers';
import { getNip10References } from 'applesauce-common/helpers';

/**
 * Normalize free-text relay input to a canonical relay URL.
 * Lenient: bare hostnames get wss:// prepended. Only ws/wss allowed.
 * @param {string} input
 * @returns {string | null} normalized URL (trailing slash, lowercase host) or null if invalid
 */
export function normalizeRelayInput(input) {
  const trimmed = (input || '').trim();
  // Internal whitespace is never valid — WHATWG parsers strip tabs/newlines
  // and browsers percent-encode spaces instead of throwing.
  if (!trimmed || /\s/.test(trimmed)) return null;

  // Check if input already has a scheme
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    // Has a scheme; only wss and ws are allowed
    if (!/^wss?:\/\//i.test(trimmed)) return null;
  }

  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null;
    // Browsers percent-encode invalid host characters instead of throwing
    // (Node throws) — a % in the hostname means the input was never a hostname.
    if (!url.hostname || url.hostname.includes('%')) return null;
    return normalizeURL(url.toString());
  } catch {
    return null;
  }
}

/**
 * Compact display label for a relay URL: host (+ port) plus any non-root path.
 * @param {string} url
 * @returns {string}
 */
export function relayHostLabel(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    return `${u.host}${path}`;
  } catch {
    return url.replace(/^wss?:\/\//i, '').replace(/\/$/, '');
  }
}

/**
 * @typedef {Object} RelayOption
 * @property {string} url - Normalized relay URL
 * @property {string} label - Display label (host)
 * @property {boolean} isCustom - True if the user added it manually (removable)
 */

/**
 * Union NIP-65, community, and custom relays into deduped picker options.
 * Custom relays win the isCustom flag on collision so they stay removable.
 * @param {string[]} nip65Relays
 * @param {string[]} communityRelays
 * @param {string[]} customRelays
 * @returns {RelayOption[]}
 */
export function buildRelayOptions(nip65Relays, communityRelays, customRelays) {
  /** @type {Map<string, RelayOption>} */
  const options = new Map();

  /** @param {string[]} urls @param {boolean} isCustom */
  function add(urls, isCustom) {
    for (const raw of urls || []) {
      let url;
      try {
        url = normalizeURL(raw);
      } catch {
        continue;
      }
      const existing = options.get(url);
      if (existing) {
        if (isCustom) existing.isCustom = true;
        continue;
      }
      options.set(url, { url, label: relayHostLabel(url), isCustom });
    }
  }

  add(nip65Relays, false);
  add(communityRelays, false);
  add(customRelays, true);
  return [...options.values()];
}

/**
 * Filter a timeline to events actually seen on the given relay.
 * Kind-1 replies (NIP-10 root/reply markers) are excluded — only root notes.
 * @param {any[]} events
 * @param {string} relayUrl
 * @returns {any[]}
 */
export function filterEventsForRelay(events, relayUrl) {
  let normalized;
  try {
    normalized = normalizeURL(relayUrl);
  } catch {
    return [];
  }
  return events.filter((event) => {
    const seen = getSeenRelays(event);
    if (!seen?.has(normalized)) return false;
    if (event.kind === 1) {
      const refs = getNip10References(event);
      if (refs?.reply?.e || refs?.root?.e) return false;
    }
    return true;
  });
}
