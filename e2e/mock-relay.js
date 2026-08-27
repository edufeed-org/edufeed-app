import { WebSocketServer } from 'ws';
import http from 'http';

const NIP11 = JSON.stringify({
  name: 'Mock Test Relay',
  supported_nips: [1, 9, 11],
  software: 'mock-relay',
  version: '0.0.1'
});

/**
 * Check if an event matches a single Nostr filter
 * @param {import('nostr-tools').NostrEvent} event
 * @param {import('nostr-tools').Filter} filter
 * @returns {boolean}
 */
export function matchesFilter(event, filter) {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;

  // Tag filters: #k, #p, #d, #h, #t, etc.
  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith('#') && Array.isArray(values)) {
      const tagName = key.slice(1);
      const eventTagValues = event.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
      if (!values.some((v) => eventTagValues.includes(String(v)))) return false;
    }
  }

  return true;
}

/**
 * Query events matching any of the given filters (OR'd per Nostr spec).
 * Results sorted by created_at desc, limited by the smallest limit across filters.
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {import('nostr-tools').Filter[]} filters
 * @returns {import('nostr-tools').NostrEvent[]}
 */
export function queryEvents(events, filters) {
  const matched = new Set();
  let limit = Infinity;

  for (const filter of filters) {
    if (filter.limit !== undefined && filter.limit < limit) {
      limit = filter.limit;
    }
    for (const event of events) {
      if (matchesFilter(event, filter)) {
        matched.add(event);
      }
    }
  }

  return Array.from(matched)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit === Infinity ? undefined : limit);
}

/**
 * Start a mock Nostr relay on the given port with pre-seeded events.
 * Serves both HTTP (NIP-11) and WebSocket (Nostr protocol).
 * Published events are stored at runtime and returned in subsequent queries.
 * @param {number} port
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {{hangEoseForKinds?: number[]}} [opts]
 * @returns {Promise<{server: http.Server, wss: WebSocketServer}>}
 */
export function startRelay(port, events = [], opts = {}) {
  // Make events array mutable for runtime additions (published events)
  const storedEvents = [...events];
  const hangEoseForKinds = opts.hangEoseForKinds ?? [];

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // NIP-11 information document
      if (req.headers.accept?.includes('application/nostr+json')) {
        res.writeHead(200, {
          'Content-Type': 'application/nostr+json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(NIP11);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Mock Nostr Relay');
    });

    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      /** @param {any} raw */
      const onMessage = (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }

        const [type, ...rest] = message;

        if (type === 'REQ') {
          const [subId, ...filters] = rest;
          // Query storedEvents (includes runtime additions)
          const results = queryEvents(storedEvents, filters);
          for (const event of results) {
            ws.send(JSON.stringify(['EVENT', subId, event]));
          }
          // Skip EOSE if any filter kind is in the hang list (simulates misbehaving relay)
          const shouldHang =
            hangEoseForKinds.length > 0 &&
            /** @type {import('nostr-tools').Filter[]} */ (filters).some((f) =>
              f.kinds?.some((k) => hangEoseForKinds.includes(k))
            );
          if (!shouldHang) {
            ws.send(JSON.stringify(['EOSE', subId]));
          }
        } else if (type === 'CLOSE') {
          // no-op
        } else if (type === 'EVENT') {
          const event = rest[0];
          if (event?.id) {
            // Store the event for future queries
            storedEvents.push(event);
            ws.send(JSON.stringify(['OK', event.id, true, '']));
          }
        }
      };
      ws.on('message', onMessage);
    });

    server.listen(port, () => {
      resolve({ server, wss });
    });
  });
}

/**
 * Stop the mock relay server.
 * @param {{server: http.Server, wss: WebSocketServer}} relay
 * @returns {Promise<void>}
 */
export function stopRelay({ server, wss }) {
  return new Promise((resolve) => {
    for (const client of wss.clients ?? []) {
      client.terminate();
    }
    wss.close(() => {
      server.close(() => resolve());
    });
  });
}
