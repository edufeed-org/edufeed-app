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
