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

/**
 * SSRF-guarded fetch: follows redirects manually and re-validates every hop
 * (http/https only, no private/local hosts), so a public URL cannot bounce
 * the server into internal infrastructure via a 3xx Location header.
 *
 * @param {string} url - already-validated public http(s) URL
 * @param {RequestInit} init - fetch options; `redirect` is forced to 'manual'
 * @param {number} [maxRedirects]
 * @returns {Promise<Response>}
 * @throws {Error} on a private/invalid redirect target or too many redirects
 */
export async function fetchGuardedRedirects(url, init, maxRedirects = 5) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    const target = parseHttpUrl(new URL(location, current).toString());
    if (!target || isPrivateIp(target)) {
      throw new Error('Redirect to a disallowed target');
    }
    current = target.toString();
  }
  throw new Error('Too many redirects');
}
