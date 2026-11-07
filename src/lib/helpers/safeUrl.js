/**
 * URL scheme guard for user-supplied links.
 *
 * Values from Nostr event tags are untrusted: rendering them in an <a href>
 * without a scheme check turns a `javascript:` URI into stored XSS (an
 * <img src> is inert, an anchor is not).
 */

/**
 * True only for absolute http(s) URLs.
 *
 * @param {unknown} url
 * @returns {url is string}
 */
export function isHttpUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sentinel origin for resolving in-app relative hrefs. `.invalid` is reserved
 * by RFC 2606 and can never resolve, so a href that lands on this origin is
 * genuinely relative and one that escapes it is genuinely off-origin.
 */
const RELATIVE_BASE = 'https://relative.invalid/';
const RELATIVE_BASE_ORIGIN = 'https://relative.invalid';

/**
 * An in-app path (`/…`) re-serialised, or null for anything else.
 *
 * `//` is not the only authority-relative form. Chrome normalises `\` to `/`
 * and strips TAB/CR/LF from an href entirely, so `/\evil.com`, `/\\evil.com`
 * and `/<TAB>/evil.com` all leave the origin while reading as in-app paths.
 * Pattern-matching loses this race — a regex closing the backslash pair
 * still lets the TAB through — so resolve it against a sentinel origin and
 * let the URL parser answer. Returning the re-serialised path also drops the
 * stripped characters instead of passing them to the DOM.
 *
 * @param {unknown} href
 * @returns {string | null}
 */
export function safeInternalPath(href) {
  if (typeof href !== 'string' || !href.startsWith('/')) return null;
  let resolved;
  try {
    resolved = new URL(href, RELATIVE_BASE);
  } catch {
    return null;
  }
  if (resolved.origin !== RELATIVE_BASE_ORIGIN) return null;
  return resolved.pathname + resolved.search + resolved.hash;
}
