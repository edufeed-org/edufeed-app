/**
 * Pure helpers for Blossom server trust checks used by the image library picker.
 *
 * Trust is host-based, not scheme-based: http://blossom.example and
 * https://blossom.example are treated as the same trusted server. Blossom
 * servers commonly transition schemes between dev and prod, and event URLs
 * pinned to the old scheme should still be trusted by their host.
 *
 * No side effects, no Svelte reactivity — safe to import from any layer.
 */

/**
 * Normalize a Blossom server URL for comparison:
 *   - drop the scheme (so http and https on the same host are equivalent)
 *   - lowercase the host
 *   - strip a trailing slash
 *
 * Falls back to returning the input unchanged when it isn't parseable.
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
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port ? ':' + parsed.port : '';
  const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
  return `${host}${port}${pathname}`;
}

/**
 * True when `url` lives on one of the trusted Blossom `servers`. Matches the
 * server URL itself OR any path under it. Comparison is case-insensitive on
 * host, case-sensitive on path, and ignores scheme (http vs https on the same
 * host are treated as equivalent). Rejects look-alike domains
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
    if (!normalizedServer) return false;
    return normalizedUrl === normalizedServer || normalizedUrl.startsWith(normalizedServer + '/');
  });
}
