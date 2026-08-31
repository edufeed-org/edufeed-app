/**
 * Relay feed helpers — pure logic for the dashboard relay feed: relay option
 * assembly for the picker and provenance-based event filtering for the feed
 * itself. User-input normalization lives in relay-input.js.
 */
import { getSeenRelays, normalizeURL } from 'applesauce-core/helpers';
import { getNip10References } from 'applesauce-common/helpers';

/** Valid picker source tokens; unknown tokens are ignored. */
const FEED_RELAY_SOURCE_TOKENS = ['config', 'custom', 'nip65', 'community'];

/**
 * Resolve the enabled relay-picker sources from runtime config.
 * @param {{ relaySources?: string[] } | undefined} feedConfig - runtimeConfig.feed
 * @returns {Set<string>} enabled tokens; defaults to config+custom (restricted mode)
 */
export function resolveFeedRelaySources(feedConfig) {
  const raw = feedConfig?.relaySources;
  const tokens = (raw?.length ? raw : ['config', 'custom']).filter((t) =>
    FEED_RELAY_SOURCE_TOKENS.includes(t)
  );
  return new Set(tokens.length ? tokens : ['config', 'custom']);
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
      // Only websocket relays — a malformed r-tag (e.g. https://) in someone's
      // kind 10002 must not become a selectable dead relay.
      if (!/^wss?:\/\//i.test(url)) continue;
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
