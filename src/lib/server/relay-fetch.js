/**
 * Server-side Nostr relay reads (raw WebSocket, verified + filter-checked
 * events). Shared by the OG/GEO handle and the sitemap.
 */

import { env } from '$env/dynamic/private';
import { nip19 } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';

const FETCH_TIMEOUT = 3000;

/**
 * @param {string | undefined} csv
 * @returns {string[]}
 */
function parseRelays(csv) {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Get relays to query for a given kind.
 * Mirrors kindToAppRelayCategory in src/lib/services/app-relay-service.svelte.js,
 * reading env directly (server context — no user 30002 overrides for crawlers).
 * @param {number} kind
 * @param {string[]} hintRelays
 * @returns {string[]}
 */
export function getRelaysForKind(kind, hintRelays) {
  /** @type {string[]} */
  let appRelays = [];

  if (kind >= 31922 && kind <= 31925) {
    appRelays = parseRelays(env.CALENDAR_RELAYS);
  } else if (kind === 30142) {
    appRelays = parseRelays(env.AMB_RELAYS);
  } else if (kind === 30023 || kind === 30024) {
    appRelays = parseRelays(env.LONGFORM_CONTENT_RELAY);
  } else if (kind === 30168 || kind === 10222 || kind === 11) {
    appRelays = parseRelays(env.COMMUNIKEY_RELAYS);
  } else if (kind === 30301) {
    appRelays = parseRelays(env.KANBAN_RELAYS);
  } else if (kind === 30818) {
    appRelays = [
      ...parseRelays(env.COMMUNIKEY_RELAYS),
      ...parseRelays(env.RELAY_LIST_LOOKUP_RELAYS)
    ];
  } else if (kind === 0) {
    appRelays = [...parseRelays(env.RELAY_LIST_LOOKUP_RELAYS), ...parseRelays(env.INDEXER_RELAYS)];
  }

  const fallback = parseRelays(env.FALLBACK_RELAYS);
  const all = [...new Set([...hintRelays, ...appRelays, ...fallback])];
  return all.length > 0 ? all : ['wss://relay.damus.io', 'wss://nos.lol'];
}

/**
 * Decode a Nostr identifier (naddr or nevent) into its components.
 * @param {string} identifier
 * @returns {{ type: 'naddr', kind: number, pubkey: string, identifier: string, relays: string[] } | { type: 'nevent', id: string, relays: string[], kind?: number } | null}
 */
export function decodeIdentifier(identifier) {
  try {
    const decoded = nip19.decode(identifier);
    if (decoded.type === 'naddr') {
      return {
        type: 'naddr',
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        identifier: decoded.data.identifier,
        relays: decoded.data.relays || []
      };
    }
    if (decoded.type === 'nevent') {
      return {
        type: 'nevent',
        id: decoded.data.id,
        relays: decoded.data.relays || [],
        kind: decoded.data.kind
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check whether an event satisfies the constraining fields of a filter.
 * Used to reject events a relay claims match a REQ but don't — a malicious
 * or misbehaving relay could otherwise return an arbitrary event and have it
 * treated as the requested one. Never throws.
 * @param {import('nostr-tools').NostrEvent | null | undefined} event
 * @param {import('nostr-tools').Filter} filter
 * @returns {boolean}
 */
export function eventMatchesFilter(event, filter) {
  try {
    if (!event || typeof event !== 'object') return false;

    if (Array.isArray(filter?.kinds) && !filter.kinds.includes(event.kind)) return false;
    if (Array.isArray(filter?.authors) && !filter.authors.includes(event.pubkey)) return false;
    if (Array.isArray(filter?.ids) && !filter.ids.includes(event.id)) return false;

    const dFilter = filter?.['#d'];
    if (Array.isArray(dFilter)) {
      const dTag = Array.isArray(event.tags)
        ? event.tags.find((t) => Array.isArray(t) && t[0] === 'd')?.[1]
        : undefined;
      if (dTag === undefined || !dFilter.includes(dTag)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch the first event matching a filter from the given relays.
 * Races all relays; resolves null after FETCH_TIMEOUT.
 * @param {import('nostr-tools').Filter} filter
 * @param {string[]} relays
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export function fetchFirstEvent(filter, relays, timeoutMs = FETCH_TIMEOUT) {
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
      cleanup();
    }, timeoutMs);

    /** @type {import('ws').WebSocket[]} */
    const sockets = [];

    function cleanup() {
      clearTimeout(timeout);
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }

    // Dynamic import ws for server-side WebSocket
    import('ws').then(({ default: WebSocket }) => {
      if (resolved) return;

      for (const relay of relays.slice(0, 5)) {
        try {
          const ws = new WebSocket(relay);
          sockets.push(ws);

          ws.on('open', () => {
            ws.send(JSON.stringify(['REQ', 'og', filter]));
          });

          ws.on('message', (/** @type {Buffer} */ data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg[0] === 'EVENT' && msg[1] === 'og' && msg[2]) {
                if (!resolved && verifyEvent(msg[2]) && eventMatchesFilter(msg[2], filter)) {
                  resolved = true;
                  resolve(msg[2]);
                  cleanup();
                }
                // Non-matching or unverifiable events are ignored; keep
                // listening on this and other relays until timeout/EOSE —
                // a malicious relay could otherwise forge a preview by
                // returning an unrelated (but validly signed) event.
              }
              if (msg[0] === 'EOSE' && msg[1] === 'og') {
                ws.close();
              }
            } catch {
              // ignore parse errors
            }
          });

          ws.on('error', () => ws.close());
        } catch {
          // skip bad relay URL
        }
      }
    });
  });
}

/**
 * Fetch a single event from Nostr relays server-side using WebSocket.
 * @param {string} identifier - naddr1... or nevent1... string
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export async function fetchEventFromRelays(identifier) {
  const decoded = decodeIdentifier(identifier);
  if (!decoded) return null;

  if (decoded.type === 'naddr') {
    return fetchFirstEvent(
      { kinds: [decoded.kind], authors: [decoded.pubkey], '#d': [decoded.identifier], limit: 1 },
      getRelaysForKind(decoded.kind, decoded.relays)
    );
  }
  return fetchFirstEvent(
    { ids: [decoded.id], limit: 1 },
    getRelaysForKind(decoded.kind || 1, decoded.relays)
  );
}
