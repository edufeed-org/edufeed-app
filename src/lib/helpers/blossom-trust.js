/**
 * Pure helpers for Blossom server trust checks used by the image library picker.
 *
 * No side effects, no Svelte reactivity — safe to import from any layer.
 */

/**
 * Normalize a Blossom server URL for comparison:
 *   - strip a single trailing slash
 *   - lowercase the host (preserve scheme + path case)
 *
 * Falls back to returning the input unchanged when it isn't parseable as a URL.
 *
 * @param {string} url
 * @returns {string}
 */
export function normalizeServerUrl(url) {
  if (!url) return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  // URL constructor always adds a trailing slash for bare origins (no path).
  // Strip it so callers get a consistent representation whether or not they
  // included a trailing slash in the input.
  return parsed.toString().replace(/\/$/, '');
}

/**
 * True when `url` lives on one of the trusted Blossom `servers`. Matches the
 * server URL itself OR any path under it. Comparison is case-insensitive on
 * host, case-sensitive on path. Rejects look-alike domains
 * (e.g. blossom.edufeed.org.evil.com).
 *
 * @param {string} url
 * @param {string[]} servers
 * @returns {boolean}
 */
export function urlIsOnTrustedServer(url, servers) {
  if (!url || !servers || servers.length === 0) return false;
  const normalizedUrl = normalizeServerUrl(url);
  return servers.some((s) => {
    const normalizedServer = normalizeServerUrl(s);
    return normalizedUrl === normalizedServer || normalizedUrl.startsWith(normalizedServer + '/');
  });
}
