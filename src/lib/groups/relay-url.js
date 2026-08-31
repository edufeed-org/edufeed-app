// Relay-url equality for user-authored strings.
//
// Kind-10009 (and other user-owned lists) carry relay URLs written by OTHER
// clients, which may lack the trailing slash normalizeURL adds or differ in
// host case. A raw === against a normalized url then silently misses (the
// relay-hidden-channels bug in host-channels.svelte.js). Malformed input must
// compare, never throw — these strings come straight off the network.
import { normalizeURL } from 'applesauce-core/helpers/url';

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function sameRelayUrl(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  try {
    return normalizeURL(a) === normalizeURL(b);
  } catch {
    return a === b;
  }
}
