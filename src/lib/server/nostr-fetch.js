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
import { verifyEvent } from 'nostr-tools/pure';
import { matchFilters } from 'nostr-tools/filter';
import { isBlockedHost } from '$lib/server/httpUrl.js';

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
 * Order: `CALENDAR_RELAYS`, then `FALLBACK_RELAYS`, then caller hints — the
 * operator's relays come first so a hint (naddr relays, `a`-tag hints,
 * community `r` tags — all attacker-choosable) can never crowd them out of
 * the `maxRelays` cap. Falls back to a tiny set of public relays if env is
 * empty. Pass hints through {@link safeHintRelays} first.
 *
 * @param {string[]} [hintRelays]
 * @returns {string[]}
 */
export function getCalendarRelaysServer(hintRelays = []) {
  const calendarRelays = parseRelays(env.CALENDAR_RELAYS);
  const fallback = parseRelays(env.FALLBACK_RELAYS);
  const configured = [...calendarRelays, ...fallback];
  const base =
    configured.length > 0 ? configured : ['wss://relay.damus.io', 'wss://relay.primal.net'];
  return [...new Set([...base, ...hintRelays])];
}

/**
 * SSRF guard for relay URLs taken from a request or from event content
 * (naddr relay hints, `a`-tag hints, community `r` tags). The server opens a
 * WebSocket to each, so only public `wss:` relays pass: no `ws:`, no
 * loopback/private/link-local literals, no internal-by-convention names, and
 * no public name that resolves to a private address (DNS checked).
 *
 * @param {unknown[]} relays
 * @param {import('$lib/server/httpUrl.js').DnsLookupAll} [lookup] injectable for tests
 * @returns {Promise<string[]>}
 */
export async function safeHintRelays(relays, lookup) {
  if (!Array.isArray(relays)) return [];
  const checked = await Promise.all(
    relays.map(async (relay) => {
      if (typeof relay !== 'string') return null;
      let url;
      try {
        url = new URL(relay.trim());
      } catch {
        return null;
      }
      if (url.protocol !== 'wss:' || url.username || url.password) return null;
      if (await isBlockedHost(url, lookup)) return null;
      return relay.trim();
    })
  );
  return [...new Set(checked.filter((r) => r !== null))];
}

/**
 * Accept a relay-supplied event only if its signature verifies and it
 * actually matches what was asked for — a malicious (hint) relay could
 * otherwise return a forged or unrelated event and have it exported under
 * this site's domain. Never throws.
 *
 * @param {any} event
 * @param {Record<string, any>[]} filters
 * @returns {boolean}
 */
function isAcceptable(event, filters) {
  try {
    if (!event || typeof event !== 'object' || !Array.isArray(event.tags)) return false;
    return verifyEvent(event) && matchFilters(/** @type {any} */ (filters), event);
  } catch {
    return false;
  }
}

/**
 * NIP-01 winner among candidates: newest `created_at`, ties broken by the
 * lowest id.
 *
 * @param {import('nostr-tools').NostrEvent[]} events
 * @returns {import('nostr-tools').NostrEvent | null}
 */
function newestEvent(events) {
  /** @type {import('nostr-tools').NostrEvent | null} */
  let best = null;
  for (const ev of events) {
    if (
      !best ||
      ev.created_at > best.created_at ||
      (ev.created_at === best.created_at && ev.id < best.id)
    ) {
      best = ev;
    }
  }
  return best;
}

/**
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {string | null} `kind:pubkey:d` for (parameterised) replaceable kinds
 */
function addressOf(event) {
  const k = event.kind;
  if (k >= 30000 && k < 40000) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
    return `${k}:${event.pubkey}:${d}`;
  }
  if (k === 0 || k === 3 || (k >= 10000 && k < 20000)) return `${k}:${event.pubkey}:`;
  return null;
}

/**
 * Kind-5 filters that find every NIP-09 deletion of `events` by their own
 * authors: one by address (`#a`) for replaceable kinds, one by id (`#e`).
 *
 * @param {import('nostr-tools').NostrEvent[]} events
 * @returns {Record<string, any>[]}
 */
export function deletionFiltersFor(events) {
  if (!events.length) return [];
  const authors = [...new Set(events.map((e) => e.pubkey))];
  const coords = [...new Set(events.map(addressOf).filter((a) => a !== null))];
  const ids = [...new Set(events.map((e) => e.id))];
  /** @type {Record<string, any>[]} */
  const filters = [];
  if (coords.length) filters.push({ kinds: [5], authors, '#a': coords });
  filters.push({ kinds: [5], authors, '#e': ids });
  return filters;
}

/**
 * Drop events their author deleted (NIP-09): an `e` deletion removes that
 * id; an `a` deletion removes every revision of the address up to and
 * including the deletion's `created_at` (a later re-publish survives). Only
 * deletions signed by the event's own pubkey count. Deletions are expected to
 * come from {@link fetchEventsFromRelays}, i.e. already verified.
 *
 * @template {import('nostr-tools').NostrEvent} T
 * @param {T[]} events
 * @param {import('nostr-tools').NostrEvent[]} deletions
 * @returns {T[]}
 */
export function dropDeletedEvents(events, deletions) {
  /** @type {Set<string>} */
  const deletedIds = new Set();
  /** @type {Map<string, number>} */
  const deletedAddressAt = new Map();
  for (const del of deletions || []) {
    if (!del || del.kind !== 5 || !Array.isArray(del.tags)) continue;
    for (const tag of del.tags) {
      if (!Array.isArray(tag) || typeof tag[1] !== 'string') continue;
      if (tag[0] === 'e') deletedIds.add(`${del.pubkey}:${tag[1]}`);
      if (tag[0] === 'a') {
        // The address embeds its author; a deletion only counts for the
        // deleter's own addresses.
        if (tag[1].split(':')[1] !== del.pubkey) continue;
        const prev = deletedAddressAt.get(tag[1]) ?? -Infinity;
        if (del.created_at > prev) deletedAddressAt.set(tag[1], del.created_at);
      }
    }
  }
  return events.filter((ev) => {
    if (deletedIds.has(`${ev.pubkey}:${ev.id}`)) return false;
    const address = addressOf(ev);
    if (address === null) return true;
    const at = deletedAddressAt.get(address);
    return at === undefined || at < ev.created_at;
  });
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
 * @property {number} [maxRelays=7] Soft cap on parallel relay sockets
 *   (room for the configured relays plus a couple of hints).
 * @property {any}    [WebSocket]   Constructor override (for tests).
 */

/**
 * Fetch the event `filter` names — the NIP-01 winner (newest `created_at`,
 * lowest id on a tie) among the verified, filter-matching events every relay
 * returns. Collects until all relays sent EOSE (or failed) or the timeout
 * fires, so a stale revision on the fastest relay cannot win. Resolves null
 * when nothing acceptable arrived.
 *
 * @param {Record<string, any>} filter Nostr REQ filter.
 * @param {string[]} relays
 * @param {FetchOptions} [options]
 * @returns {Promise<import('nostr-tools').NostrEvent | null>}
 */
export async function fetchEventFromRelays(filter, relays, options = {}) {
  return newestEvent(await fetchEventsFromRelays(filter, relays, options));
}

/**
 * Fetch all events matching `filter` from any of `relays`. Collects events
 * until either every relay sends EOSE or the overall timeout fires. Dedupes
 * by event id. Only events whose signature verifies and that match one of the
 * filters are kept.
 *
 * @param {Record<string, any> | Record<string, any>[]} filter Nostr REQ
 *   filter, or several (sent in one REQ).
 * @param {string[]} relays
 * @param {FetchOptions} [options]
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
export async function fetchEventsFromRelays(filter, relays, options = {}) {
  const { timeout = 3000, maxRelays = 7, WebSocket } = options;
  const filters = Array.isArray(filter) ? filter : [filter];
  if (!relays || relays.length === 0 || filters.length === 0) return [];

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
            ws.send(JSON.stringify(['REQ', subId, ...filters]));
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
              if (!collected.has(ev.id) && isAcceptable(ev, filters)) collected.set(ev.id, ev);
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
