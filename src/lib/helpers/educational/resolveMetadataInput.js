/**
 * Decide what to do with whatever the user typed into step 2 of the AMB wizard.
 *
 * Three shapes of input, three result kinds:
 *
 *   1. Empty string         → `{ kind: 'empty' }`
 *   2. http(s) URL          → `{ kind: 'url', url, metadata }` via `/api/reader?mode=metadata`
 *                             (always resolves — fetch failures degrade to `{source: 'none'}`)
 *   3. naddr (nostr addr)   → one of:
 *        - `{ kind: 'naddr-edit', naddrString }`   — kind 30142, owned by active user
 *        - `{ kind: 'naddr-not-owned' }`           — kind 30142, different owner
 *        - `{ kind: 'naddr-wrong-kind' }`          — not a 30142
 *
 * Anything else (garbage, private-IP URL, unknown nostr: scheme) →
 *   `{ kind: 'invalid', reason }`.
 *
 * This helper is deliberately pure (no direct `fetch` / `window` access) so the
 * wizard's step component can stay thin and tests can stub out networking.
 */

import { nip19 } from 'nostr-tools';

const AMB_KIND = 30142;

/**
 * @param {URL} u
 */
function isPrivateHost(u) {
  const h = u.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h.endsWith('.local') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('172.')
  );
}

/**
 * @typedef {Object} ResolveOptions
 * @property {string | null | undefined} activeUserPubkey - Hex pubkey of the logged-in user (or null if not signed in)
 * @property {typeof fetch} fetchFn - Injected fetch (so tests can stub)
 */

/**
 * @typedef {{ kind: 'empty' } |
 *          { kind: 'invalid', reason: string } |
 *          { kind: 'url', url: string, metadata: { source: 'amb-jsonld' | 'opengraph' | 'none', amb?: any, og?: any } } |
 *          { kind: 'naddr-edit', naddrString: string } |
 *          { kind: 'naddr-not-owned' } |
 *          { kind: 'naddr-wrong-kind' }} ResolveResult
 */

/**
 * @param {string} input
 * @param {ResolveOptions} options
 * @returns {Promise<ResolveResult>}
 */
export async function resolveMetadataInput(input, { activeUserPubkey, fetchFn }) {
  const trimmed = (input || '').trim();
  if (!trimmed) return { kind: 'empty' };

  // naddr (or bare "naddr1..." without nostr: prefix)
  if (/^(nostr:)?naddr1[0-9a-z]+$/i.test(trimmed)) {
    const naddr = trimmed.replace(/^nostr:/i, '');
    try {
      const decoded = nip19.decode(naddr);
      if (decoded.type !== 'naddr') {
        return { kind: 'invalid', reason: 'Expected an naddr identifier' };
      }
      const data = /** @type {{kind: number, pubkey: string, identifier: string}} */ (decoded.data);
      if (data.kind !== AMB_KIND) return { kind: 'naddr-wrong-kind' };
      if (activeUserPubkey && data.pubkey === activeUserPubkey) {
        return { kind: 'naddr-edit', naddrString: naddr };
      }
      return { kind: 'naddr-not-owned' };
    } catch {
      return { kind: 'invalid', reason: 'Could not decode naddr' };
    }
  }

  // URL
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: 'invalid', reason: 'Not a URL or naddr' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'invalid', reason: 'URL must be http or https' };
  }
  if (isPrivateHost(parsed)) {
    return { kind: 'invalid', reason: 'Private/local URLs are not allowed' };
  }

  // Ask the server to extract AMB JSON-LD / Open Graph. Any failure here is
  // non-blocking per the plan — we return `source: 'none'` and let the form
  // fall back to its defaults.
  try {
    const endpoint = `/api/reader?mode=metadata&url=${encodeURIComponent(parsed.toString())}`;
    const response = await fetchFn(endpoint);
    if (!response.ok) {
      return { kind: 'url', url: parsed.toString(), metadata: { source: 'none' } };
    }
    const body = await response.json();
    if (!body?.success || !body.metadata) {
      return { kind: 'url', url: parsed.toString(), metadata: { source: 'none' } };
    }
    return { kind: 'url', url: parsed.toString(), metadata: body.metadata };
  } catch {
    return { kind: 'url', url: parsed.toString(), metadata: { source: 'none' } };
  }
}
