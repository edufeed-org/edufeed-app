/**
 * Server-side Nostr relay fetch helpers.
 *
 * The application's normal data flow is built around the client-side
 * applesauce `EventStore` + `runtimeConfig` + loader infrastructure, none of
 * which is initialised on the server. SvelteKit `+server.js` endpoints that
 * need to read events from relays therefore have to talk to relays directly.
 *
 * This module mirrors the WebSocket race pattern used by `og.js` for OG
 * meta-tag generation, but exposes generic primitives so any server endpoint
 * can fetch a single event or a batch of events with bounded latency.
 */

import { env } from '$env/dynamic/private';
import { nip19 } from 'nostr-tools';

/**
 * @param {string | undefined} csv
 * @returns {string[]}
 */
export function parseRelays(csv) {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve relays to query for calendar content (kinds 31922/31923/31924).
 * Order: caller hints first, then `CALENDAR_RELAYS`, then `FALLBACK_RELAYS`.
 * Falls back to a tiny set of public relays if env is empty.
 *
 * @param {string[]} [hintRelays]
 * @returns {string[]}
 */
export function getCalendarRelaysServer(hintRelays = []) {
  const calendarRelays = parseRelays(env.CALENDAR_RELAYS);
  const fallback = parseRelays(env.FALLBACK_RELAYS);
  const all = [...new Set([...hintRelays, ...calendarRelays, ...fallback])];
  return all.length > 0 ? all : ['wss://relay.damus.io', 'wss://nos.lol'];
}

/**
 * Decode a Nostr identifier (naddr or nevent) into its components.
 *
 * @param {string} identifier
 * @returns {
 *   | { type: 'naddr', kind: number, pubkey: string, identifier: string, relays: string[] }
 *   | { type: 'nevent', id: string, relays: string[], kind?: number }
 *   | null
 * }
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

/** @type {any} */
let _wsCtorCache = null;

/**
 * Resolve a WebSocket constructor. Production uses dynamic `import('ws')` so
 * the dependency stays server-only; tests can inject a stub via the option.
 *
 * @param {any} [override]
 * @returns {Promise<any>}
 */
async function resolveWebSocketCtor(override) {
  if (override) return override;
  if (_wsCtorCache) return _wsCtorCache;
  const mod = await import('ws');
  _wsCtorCache = mod.default;
  return _wsCtorCache;
}

const SUB_ID_PREFIX = 'srv';
let _subCounter = 0;
function nextSubId() {
  _subCounter = (_subCounter + 1) & 0xffff;
  return `${SUB_ID_PREFIX}-${Date.now().toString(36)}-${_subCounter}`;
}

/**
 * @typedef {Object} FetchOptions
 * @property {number} [timeout=3000] Overall timeout in ms.
 * @property {number} [maxRelays=5] Soft cap on parallel relay sockets.
 * @property {any}    [WebSocket]   Constructor override (for tests).
 */

/**
 * Fetch the first event matching `filter` from any of `relays`.
 * Resolves null on timeout if no relay returns a matching event.
 *
 * @param {Record<string, any>} filter Nostr REQ filter.
 * @param {string[]} relays
 * @param {FetchOptions} [options]
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export async function fetchEventFromRelays(filter, relays, options = {}) {
  const { timeout = 3000, maxRelays = 5, WebSocket } = options;
  if (!relays || relays.length === 0) return null;

  const Ctor = await resolveWebSocketCtor(WebSocket);
  const subId = nextSubId();

  return new Promise((resolve) => {
    let resolved = false;
    /** @type {any[]} */
    const sockets = [];

    const timer = setTimeout(() => finish(null), timeout);

    /**
     * @param {import('nostr-tools').NostrEvent | null} value
     */
    function finish(value) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      resolve(value);
    }

    for (const relay of relays.slice(0, maxRelays)) {
      try {
        const ws = new Ctor(relay);
        sockets.push(ws);

        ws.on('open', () => {
          try {
            ws.send(JSON.stringify(['REQ', subId, filter]));
          } catch {
            // socket may have been closed already
          }
        });

        ws.on('message', (/** @type {Buffer | string} */ data) => {
          if (resolved) return;
          try {
            const buf = typeof data === 'string' ? data : data.toString();
            const msg = JSON.parse(buf);
            if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
              finish(msg[2]);
            } else if (msg[0] === 'EOSE' && msg[1] === subId) {
              try {
                ws.close();
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore parse errors
          }
        });

        ws.on('error', () => {
          try {
            ws.close();
          } catch {
            // ignore
          }
        });
      } catch {
        // skip bad relay URL
      }
    }
  });
}

/**
 * Fetch all events matching `filter` from any of `relays`. Collects events
 * until either every relay sends EOSE or the overall timeout fires. Dedupes
 * by event id.
 *
 * @param {Record<string, any>} filter Nostr REQ filter.
 * @param {string[]} relays
 * @param {FetchOptions} [options]
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
export async function fetchEventsFromRelays(filter, relays, options = {}) {
  const { timeout = 3000, maxRelays = 5, WebSocket } = options;
  if (!relays || relays.length === 0) return [];

  const Ctor = await resolveWebSocketCtor(WebSocket);
  const subId = nextSubId();

  return new Promise((resolve) => {
    let resolved = false;
    /** @type {Map<string, import('nostr-tools').NostrEvent>} */
    const collected = new Map();
    /** @type {any[]} */
    const sockets = [];
    /** @type {Set<any>} */
    const eosed = new Set();

    const targetRelays = relays.slice(0, maxRelays);

    const timer = setTimeout(finish, timeout);

    function finish() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      resolve(Array.from(collected.values()));
    }

    function maybeFinishOnAllEose() {
      if (eosed.size >= sockets.length && sockets.length > 0) finish();
    }

    for (const relay of targetRelays) {
      try {
        const ws = new Ctor(relay);
        sockets.push(ws);

        ws.on('open', () => {
          try {
            ws.send(JSON.stringify(['REQ', subId, filter]));
          } catch {
            // socket already closed
          }
        });

        ws.on('message', (/** @type {Buffer | string} */ data) => {
          if (resolved) return;
          try {
            const buf = typeof data === 'string' ? data : data.toString();
            const msg = JSON.parse(buf);
            if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
              const ev = msg[2];
              if (ev.id && !collected.has(ev.id)) collected.set(ev.id, ev);
            } else if (msg[0] === 'EOSE' && msg[1] === subId) {
              eosed.add(ws);
              try {
                ws.close();
              } catch {
                // ignore
              }
              maybeFinishOnAllEose();
            }
          } catch {
            // ignore parse errors
          }
        });

        ws.on('error', () => {
          eosed.add(ws); // treat as terminal so we don't wait on it forever
          try {
            ws.close();
          } catch {
            // ignore
          }
          maybeFinishOnAllEose();
        });

        ws.on('close', () => {
          eosed.add(ws);
          maybeFinishOnAllEose();
        });
      } catch {
        // skip bad relay URL
      }
    }

    if (sockets.length === 0) finish();
  });
}
