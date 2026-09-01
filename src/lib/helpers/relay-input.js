/**
 * The one gate every "type a relay URL" field runs user input through.
 *
 * Users type `relay.example.org`, not `wss://relay.example.org` — every relay
 * field in the app accepts the bare hostname and supplies the scheme. Only
 * ws/wss survive; an explicit `ws://` is kept as-is (localhost dev relays have
 * no TLS), but a bare host defaults to `wss://`.
 */
import { normalizeURL } from 'applesauce-core/helpers';

/**
 * @param {string | null | undefined} input - raw text straight out of an <input>
 * @param {{ trailingSlash?: boolean }} [options] - `trailingSlash: false` drops
 *   the root "/" normalizeURL appends (and only that one — a "/inbox/" path is
 *   left intact, since relays that route by path treat it as a distinct
 *   resource). Use it for lists that store bare URLs (kind 10002/10050/10222
 *   r-tags, config relays) where a raw string compare decides duplicates — a
 *   slash mismatch there reads as a distinct relay.
 * @returns {string | null} normalized relay URL, or null if the input is not one
 */
export function normalizeRelayInput(input, options = {}) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  // Internal whitespace is never valid — WHATWG parsers strip tabs/newlines
  // and browsers percent-encode spaces instead of throwing.
  if (!trimmed || /\s/.test(trimmed)) return null;

  // A scheme that is present but not ws/wss is a hard reject: prepending
  // wss:// to "https://…" would silently invent a different relay.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^wss?:\/\//i.test(trimmed)) return null;

  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return null;
    // Browsers percent-encode invalid host characters instead of throwing
    // (Node throws) — a % in the hostname means the input was never a hostname.
    if (!url.hostname || url.hostname.includes('%')) return null;
    const normalized = normalizeURL(url.toString());
    const dropRootSlash = options.trailingSlash === false && new URL(normalized).pathname === '/';
    return dropRootSlash ? normalized.replace(/\/$/, '') : normalized;
  } catch {
    return null;
  }
}
