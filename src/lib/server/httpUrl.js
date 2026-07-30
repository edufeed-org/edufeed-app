import net from 'node:net';
import dns from 'node:dns/promises';

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
 * IPv4 blocks a server-side fetch must never reach. Compared as masked
 * integers, not string prefixes, so `172.32.0.1` stays reachable while all of
 * `172.16.0.0/12` does not.
 *
 * @type {[string, number][]}
 */
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this network" — 0.0.0.0 is a loopback alias on Linux
  ['10.0.0.0', 8], // RFC1918 private
  ['100.64.0.0', 10], // RFC6598 CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. the 169.254.169.254 metadata endpoint
  ['172.16.0.0', 12], // RFC1918 private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918 private
  ['198.18.0.0', 15], // RFC2544 benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved, incl. the 255.255.255.255 broadcast address
];

/**
 * Hostname suffixes that name internal infrastructure by convention rather
 * than by address, so they are blocked before any resolution is attempted.
 */
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa'];

/** @param {string} addr @returns {number} */
function v4ToInt(addr) {
  const parts = addr.split('.');
  return (
    ((Number(parts[0]) << 24) |
      (Number(parts[1]) << 16) |
      (Number(parts[2]) << 8) |
      Number(parts[3])) >>>
    0
  );
}

/** @param {number[]} bytes @returns {boolean} */
function isBlockedV4Bytes(bytes) {
  const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0;
  });
}

/**
 * Expand a syntactically valid IPv6 address into its 16 bytes. Only ever
 * called on strings `net.isIPv6` has already accepted, so it does not
 * re-validate — it only has to handle the forms the spec allows, including a
 * single `::` run and a trailing dotted-quad (`::ffff:127.0.0.1`).
 *
 * @param {string} addr
 * @returns {number[] | null}
 */
function v6ToBytes(addr) {
  const halves = addr.split('::');
  if (halves.length > 2) return null;

  /** @param {string} part @returns {number[]} */
  const groupBytes = (part) => {
    if (!part) return [];
    const bytes = [];
    for (const group of part.split(':')) {
      if (group.includes('.')) {
        for (const octet of group.split('.')) bytes.push(Number(octet));
      } else {
        const word = parseInt(group, 16);
        bytes.push((word >> 8) & 0xff, word & 0xff);
      }
    }
    return bytes;
  };

  const head = groupBytes(halves[0]);
  if (halves.length === 1) return head.length === 16 ? head : null;

  const tail = groupBytes(halves[1]);
  const fill = 16 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

/**
 * True if a literal IP address string falls in a blocked range. Handles both
 * families; every IPv6 form that embeds an IPv4 address is unwrapped and checked
 * against the IPv4 blocks, so `[::ffff:127.0.0.1]` cannot smuggle loopback past
 * an IPv4-only check.
 *
 * @param {string} addr
 * @returns {boolean}
 */
export function isBlockedIp(addr) {
  if (net.isIPv4(addr)) {
    return isBlockedV4Bytes(addr.split('.').map(Number));
  }
  if (!net.isIPv6(addr)) return false;

  const bytes = v6ToBytes(addr);
  if (!bytes) return true; // unparseable but syntactically valid: fail closed

  /** @param {number} n */
  const zeroPrefix = (n) => bytes.slice(0, n).every((b) => b === 0);
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible, covers :: and ::1) and
  // 64:ff9b::a.b.c.d (NAT64) all carry an IPv4 address in the last 4 bytes.
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedV4Bytes(bytes.slice(12));
  }
  // ::ffff:0:a.b.c.d — RFC2765 "IPv4-translated", ::ffff:0:0/96. The 0xffff sits
  // at bytes 8-9 rather than 10-11, so this is a near-miss of the mapped form
  // above and slips past both zeroPrefix(10) and zeroPrefix(12).
  if (
    zeroPrefix(8) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0
  ) {
    return isBlockedV4Bytes(bytes.slice(12));
  }
  if (zeroPrefix(12)) {
    return isBlockedV4Bytes(bytes.slice(12));
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return isBlockedV4Bytes(bytes.slice(12));
  }

  // 6to4 (2002::/16) and Teredo (2001::/32) are transition-tunnel prefixes that
  // carry an IPv4 destination in the middle of the address — 6to4 at bytes 2-5,
  // Teredo as an obfuscated client field at bytes 12-15. Blocked wholesale
  // rather than unwrapped: nothing this app legitimately fetches lives behind a
  // v6 transition tunnel, and a blanket refusal removes a whole class of
  // "did we unwrap the right four bytes" reasoning error from a security check.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true; // 2002::/16 6to4
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0) return true; // 2001::/32 Teredo

  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local, deprecated by RFC3879
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}

/**
 * Normalise `URL.hostname` into something comparable: lowercased, IPv6 brackets
 * removed, and one trailing dot stripped.
 *
 * The trailing dot matters. `http://localhost./` and `http://printer.local./`
 * are the fully-qualified forms of names this module blocks, they resolve to the
 * same addresses, and `URL.hostname` preserves the dot — so without stripping it
 * an exact match on 'localhost' and a `.local` suffix match both miss. Only one
 * dot is stripped, because that is all a hostname may legally carry.
 *
 * @param {string} hostname
 * @returns {string}
 */
function bareHost(hostname) {
  let bare = hostname.toLowerCase();
  if (bare.startsWith('[') && bare.endsWith(']')) return bare.slice(1, -1);
  if (bare.endsWith('.')) bare = bare.slice(0, -1);
  return bare;
}

/**
 * Reject hostnames that name loopback / private / link-local addresses, to
 * block SSRF when fetching user- or search-result-supplied URLs server-side.
 *
 * Synchronous, so it only sees what the URL itself says: literal IP addresses
 * (parsed as addresses, not string-matched) and hostnames that are internal by
 * convention. A public DNS name pointing at a private address passes here —
 * use {@link isBlockedHost} on any path that will actually fetch the URL.
 *
 * Exotic IPv4 encodings need no special handling: the WHATWG URL parser has
 * already normalised `http://2130706433/`, `http://0x7f000001/` and
 * `http://127.1/` to hostname `127.0.0.1` by the time we see them.
 *
 * @param {URL} parsedUrl
 * @returns {boolean}
 */
export function isPrivateIp(parsedUrl) {
  const bare = bareHost(parsedUrl.hostname);

  if (bare === 'localhost') return true;
  if (BLOCKED_SUFFIXES.some((suffix) => bare.endsWith(suffix))) return true;
  return isBlockedIp(bare);
}

/**
 * The one `dns.lookup` overload this module uses. Named so tests can inject a
 * stub without having to satisfy the full overloaded signature.
 *
 * @typedef {(hostname: string, options: { all: true }) => Promise<{ address: string, family: number }[]>} DnsLookupAll
 */

/**
 * Resolve a non-literal hostname and report whether any address it maps to is
 * in a blocked range — the DNS-rebinding half of the guard that
 * {@link isPrivateIp} cannot cover.
 *
 * A lookup *failure* is deliberately not treated as blocked: a hostname that
 * does not resolve cannot be fetched either, so failing open here costs
 * nothing while failing closed would turn every transient resolver blip into a
 * rejected request. The residual gap is TOCTOU — `fetch` resolves the name a
 * second time and could get a different answer. Closing that needs connect-time
 * pinning; the `ASSET_PROXY_ALLOWED_DOMAINS` allowlist and imgproxy network
 * isolation remain the defence in depth for it.
 *
 * @param {string} hostname
 * @param {DnsLookupAll} [lookup] - injectable for tests
 * @returns {Promise<boolean>}
 */
export async function resolvesToPrivateIp(
  hostname,
  lookup = /** @type {DnsLookupAll} */ (dns.lookup)
) {
  const unbracketed =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (net.isIP(bareHost(hostname))) return isBlockedIp(bareHost(hostname));

  try {
    // Resolve the name as given, trailing dot included: the dot is meaningful to
    // a resolver (absolute vs search-domain-suffixed), so normalising it away
    // here could change which addresses we check.
    const records = await lookup(unbracketed, { all: true });
    return records.some((record) => isBlockedIp(record.address));
  } catch {
    return false;
  }
}

/**
 * The full SSRF guard: the synchronous checks plus DNS resolution. Use this on
 * every path that fetches a supplied URL server-side.
 *
 * @param {URL} parsedUrl
 * @param {DnsLookupAll} [lookup] - injectable for tests
 * @returns {Promise<boolean>}
 */
export async function isBlockedHost(parsedUrl, lookup) {
  if (isPrivateIp(parsedUrl)) return true;
  return resolvesToPrivateIp(parsedUrl.hostname, lookup);
}

/**
 * SSRF-guarded fetch: follows redirects manually and re-validates every hop
 * (http/https only, no private/local hosts), so a public URL cannot bounce
 * the server into internal infrastructure via a 3xx Location header.
 *
 * @param {string} url - already-validated public http(s) URL
 * @param {RequestInit} init - fetch options; `redirect` is forced to 'manual'
 * @param {number} [maxRedirects]
 * @param {DnsLookupAll} [lookup] - injectable for tests
 * @returns {Promise<Response>}
 * @throws {Error} on a private/invalid redirect target or too many redirects
 */
export async function fetchGuardedRedirects(url, init, maxRedirects = 5, lookup) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    const target = parseHttpUrl(new URL(location, current).toString());
    if (!target || (await isBlockedHost(target, lookup))) {
      throw new Error('Redirect to a disallowed target');
    }
    current = target.toString();
  }
  throw new Error('Too many redirects');
}
