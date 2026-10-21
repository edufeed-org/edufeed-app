/**
 * Comparison key for Blossom server URLs — the same host-based identity
 * `normalizeServerUrl` (blossom-trust.js) uses for trust: scheme ignored,
 * hostname lowercased, default port dropped, trailing slash stripped. So
 * `https://blossom.edufeed.org/` (config), `https://blossom.edufeed.org` and
 * `HTTPS://blossom.edufeed.org:443/` (kind 10063 entries) count as one server
 * everywhere: routing, hints, settings badges and dedupe. Kept dependency-free
 * (duplicates the few lines rather than importing blossom-trust, which many
 * component tests mock partially). Unparsable input falls back to the
 * trimmed, lowercased string without trailing slashes.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function blossomServerKey(url) {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const port = parsed.port ? ':' + parsed.port : '';
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    return `${parsed.hostname.toLowerCase()}${port}${pathname}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Dedupe a server list by blossomServerKey, keeping first occurrences.
 * @param {Array<string | null | undefined>} urls
 * @returns {string[]}
 */
export function uniqueBlossomServers(urls) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const url of urls) {
    if (!url) continue;
    const key = blossomServerKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}
