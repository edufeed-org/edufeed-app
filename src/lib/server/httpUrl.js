/**
 * Parse a value into an http(s) URL or return null. Used by API routes that
 * accept user-supplied URLs (e.g. /api/curricula, /api/enrich, /api/reader)
 * to reject anything that isn't a real http(s) URL before further processing.
 *
 * @param {unknown} val
 * @returns {URL | null}
 */
export function parseHttpUrl(val) {
  if (typeof val !== 'string') return null;
  try {
    const u = new URL(val);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Validate a string as an http(s) URL safe to interpolate into a SPARQL
 * `<URI>` slot. Adds a regex pre-check rejecting `<` `>` `"` `\` whitespace
 * so the URL can't break out of the angle brackets. Returns the validated
 * raw string, not a URL object, because the SPARQL templates want the
 * original textual IRI.
 *
 * @param {unknown} val
 * @returns {string | null}
 */
export function validateSparqlIri(val) {
  if (typeof val !== 'string') return null;
  if (/[<>"\\\s]/.test(val)) return null;
  return parseHttpUrl(val) ? val : null;
}

/**
 * Reject hostnames that resolve to loopback / private / link-local ranges, to
 * block SSRF when fetching user- or search-result-supplied URLs server-side.
 * Shared by /api/image and /api/oer/asset. Hostname-string heuristic (not a
 * full IP-range parse) — paired with an upstream `ASSET_PROXY_ALLOWED_DOMAINS`
 * allowlist / imgproxy network isolation on the homelab for defence in depth.
 *
 * @param {URL} parsedUrl
 * @returns {boolean}
 */
export function isPrivateIp(parsedUrl) {
  const hostname = parsedUrl.hostname;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local')
  );
}
