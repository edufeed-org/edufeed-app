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
 * Reconcile a Blossom server's reported blob URL with the scheme we actually
 * used to upload. Some Blossom servers advertise an http base URL in their
 * BlobDescriptor response even when accessed over https (deployment bug we
 * can't fix server-side). When the reported URL's hostname matches the upload
 * server's hostname but the scheme differs, prefer the upload server's
 * scheme. The same image is reachable on either scheme on that host, but the
 * scheme we used to upload is the canonical one for our trust set.
 *
 * Returns `blobUrl` unchanged on parse failure or hostname mismatch.
 *
 * @param {string} blobUrl - URL reported by the Blossom server's response
 * @param {string} uploadServerUrl - URL we used to upload (e.g. from getActiveBlossomServer)
 * @returns {string}
 */
export function reconcileBlobUrlScheme(blobUrl, uploadServerUrl) {
  if (!blobUrl || !uploadServerUrl) return blobUrl;
  try {
    const blob = new URL(blobUrl);
    const upload = new URL(uploadServerUrl);
    if (
      blob.hostname.toLowerCase() === upload.hostname.toLowerCase() &&
      blob.protocol !== upload.protocol
    ) {
      blob.protocol = upload.protocol;
      return blob.toString();
    }
  } catch {
    /* parse failure — return as-is */
  }
  return blobUrl;
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
