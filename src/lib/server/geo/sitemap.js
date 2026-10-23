/**
 * /sitemap.xml: the deployment's own content pages, so search and AI crawlers
 * can find pages they would otherwise only reach through client-rendered
 * links. Mirrors what the app itself shows: articles and learning resources
 * respect the curated-author config of their category (plus WoT anchors —
 * WoT follows are not resolved, so a WoT deployment's sitemap is a subset).
 *
 * Built from relay queries, cached stale-while-revalidate: an old sitemap is
 * served at once and refreshed in the background, never expired into a
 * blocking fetch (see "Store First, Network Second" in CLAUDE.md).
 */
import { nip19 } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';
import {
  parseArray,
  parseBool,
  resolveCuratedConfig,
  resolveWotConfig
} from '$lib/server/env-parse.js';
import { normalizePubkey } from '$lib/helpers/pubkey.js';
import { eventMatchesFilter, fetchFirstEvent, getRelaysForKind } from '$lib/server/og.js';
import { canonicalPathFor } from './page-content.js';

const PAGE_SIZE = 500;
const PAGE_TIMEOUT = 5000;
const MAX_EVENTS_PER_RELAY = 10_000;
const AUTHOR_CHUNK = 100;

/**
 * @typedef {{ sets: string[], direct: string[] }} CuratedConfig
 * @typedef {{ kind: number, relays: string[], curated: CuratedConfig | null, wotAnchors: string[] }} SitemapSource
 */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {SitemapSource[]}
 */
export function sitemapSources(env) {
  const wot = parseBool(env.WOT_ENABLED, false);
  const anchors = (/** @type {string} */ suffix) =>
    wot ? resolveWotConfig(env, suffix).anchors : [];
  return [
    {
      kind: 30023,
      relays: parseArray(env.LONGFORM_CONTENT_RELAY),
      curated: resolveCuratedConfig(env, 'LONGFORM'),
      wotAnchors: anchors('LONGFORM')
    },
    // Wiki articles have no curation category in the app.
    { kind: 30818, relays: parseArray(env.COMMUNIKEY_RELAYS), curated: null, wotAnchors: [] },
    {
      kind: 30142,
      // Aggregated third-party metadata (e.g. an OERSI mirror) can be left out:
      // thin copies of pages that live elsewhere don't belong in our sitemap.
      relays: parseArray(env.SITEMAP_AMB_RELAYS || env.AMB_RELAYS),
      curated: resolveCuratedConfig(env, 'EDUCATIONAL'),
      wotAnchors: anchors('EDUCATIONAL')
    }
  ];
}

/**
 * @param {CuratedConfig | null} curated
 * @param {string[]} wotAnchors
 * @param {typeof fetchFirstEvent} fetchFirst
 * @returns {Promise<string[] | null>} null = no author restriction; [] = restricted to nobody
 */
export async function resolveAuthors(curated, wotAnchors, fetchFirst) {
  const sets = curated?.sets ?? [];
  const direct = curated?.direct ?? [];
  if (sets.length === 0 && direct.length === 0 && wotAnchors.length === 0) return null;

  /** @type {Set<string>} */
  const authors = new Set();
  for (const value of [...direct, ...wotAnchors]) {
    const hex = normalizePubkey(value);
    if (hex) authors.add(hex);
  }
  const lists = await Promise.all(
    sets.map(async (naddr) => {
      try {
        const decoded = nip19.decode(naddr);
        if (decoded.type !== 'naddr') return null;
        const { kind, pubkey, identifier, relays = [] } = decoded.data;
        return fetchFirst(
          { kinds: [kind], authors: [pubkey], '#d': [identifier], limit: 1 },
          getRelaysForKind(kind, relays)
        );
      } catch {
        return null;
      }
    })
  );
  for (const list of lists) {
    for (const tag of list?.tags ?? []) {
      const hex = tag[0] === 'p' ? normalizePubkey(tag[1]) : null;
      if (hex) authors.add(hex);
    }
  }
  return [...authors];
}

/**
 * One REQ on one relay, collected until EOSE or timeout.
 * @param {string} relay
 * @param {import('nostr-tools').Filter} filter
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
async function fetchPage(relay, filter) {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve) => {
    /** @type {import('nostr-tools').NostrEvent[]} */
    const events = [];
    let done = false;
    /** @type {import('ws').WebSocket | undefined} */
    let ws;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
      resolve(events);
    };
    const timer = setTimeout(finish, PAGE_TIMEOUT);
    try {
      ws = new WebSocket(relay);
    } catch {
      finish();
      return;
    }
    ws.on('open', () => ws?.send(JSON.stringify(['REQ', 'sitemap', filter])));
    ws.on('message', (/** @type {Buffer} */ data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === 'sitemap') {
          if (verifyEvent(msg[2]) && eventMatchesFilter(msg[2], filter)) events.push(msg[2]);
        } else if ((msg[0] === 'EOSE' || msg[0] === 'CLOSED') && msg[1] === 'sitemap') {
          finish();
        }
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('error', finish);
    ws.on('close', finish);
  });
}

/**
 * All events matching `filter` on each relay, paged backwards by `until`
 * (per relay: relays cap `limit` differently).
 * @param {import('nostr-tools').Filter} filter
 * @param {string[]} relays
 * @returns {Promise<import('nostr-tools').NostrEvent[]>}
 */
async function fetchAllEvents(filter, relays) {
  const perRelay = await Promise.all(
    relays.map(async (relay) => {
      /** @type {import('nostr-tools').NostrEvent[]} */
      const all = [];
      /** @type {number | undefined} */
      let until;
      while (all.length < MAX_EVENTS_PER_RELAY) {
        const page = await fetchPage(relay, {
          ...filter,
          limit: PAGE_SIZE,
          ...(until ? { until } : {})
        });
        if (page.length === 0) break;
        all.push(...page);
        const oldest = Math.min(...page.map((e) => e.created_at));
        if (until !== undefined && oldest >= until) break; // relay ignores `until`
        until = oldest - 1;
      }
      return all;
    })
  );
  return perRelay.flat();
}

/**
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {{ origin: string, relayHintFor: (kind: number) => string | undefined }} opts
 * @returns {{ loc: string, lastmod: string }[]}
 */
export function buildSitemapEntries(events, { origin, relayHintFor }) {
  /** @type {Map<string, number>} loc → newest created_at */
  const byLoc = new Map();
  for (const event of events) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1];
    if (!d) continue;
    const path = canonicalPathFor(event, { relayHint: relayHintFor(event.kind) });
    if (!path) continue;
    const loc = `${origin}${path}`;
    byLoc.set(loc, Math.max(byLoc.get(loc) ?? 0, event.created_at));
  }
  return [...byLoc].map(([loc, createdAt]) => ({
    loc,
    lastmod: new Date(createdAt * 1000).toISOString().slice(0, 10)
  }));
}

/** @param {string} s */
const escXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {{ loc: string, lastmod: string }[]} entries
 * @returns {string}
 */
export function renderSitemapXml(entries) {
  const urls = entries
    .map((e) => `<url><loc>${escXml(e.loc)}</loc><lastmod>${e.lastmod}</lastmod></url>`)
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    (urls ? `${urls}\n` : '') +
    '</urlset>\n'
  );
}

/**
 * @param {string} origin
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<string>}
 */
export async function buildSitemapXml(origin, env) {
  /** @type {import('nostr-tools').NostrEvent[]} */
  const events = [];
  for (const source of sitemapSources(env)) {
    if (source.relays.length === 0) continue;
    const authors = await resolveAuthors(source.curated, source.wotAnchors, fetchFirstEvent);
    if (authors && authors.length === 0) continue; // curated, but nobody resolved
    const filters = authors
      ? Array.from({ length: Math.ceil(authors.length / AUTHOR_CHUNK) }, (_, i) => ({
          kinds: [source.kind],
          authors: authors.slice(i * AUTHOR_CHUNK, (i + 1) * AUTHOR_CHUNK)
        }))
      : [{ kinds: [source.kind] }];
    for (const filter of filters) events.push(...(await fetchAllEvents(filter, source.relays)));
  }
  return renderSitemapXml(
    buildSitemapEntries(events, { origin, relayHintFor: (kind) => getRelaysForKind(kind, [])[0] })
  );
}

/**
 * Stale-while-revalidate cache keyed by origin.
 * @param {{ ttlMs: number, now?: () => number }} opts
 */
export function createSitemapCache({ ttlMs, now = Date.now }) {
  /** @type {Map<string, { xml: string, builtAt: number }>} */
  const entries = new Map();
  /** @type {Map<string, Promise<string>>} */
  const inFlight = new Map();

  /**
   * @param {string} key
   * @param {() => Promise<string>} build
   */
  function refresh(key, build) {
    const running = inFlight.get(key);
    if (running) return running;
    const promise = build()
      .then((xml) => {
        entries.set(key, { xml, builtAt: now() });
        return xml;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  return {
    /**
     * @param {string} key
     * @param {() => Promise<string>} build
     * @returns {Promise<string>}
     */
    async get(key, build) {
      const cached = entries.get(key);
      if (!cached) return refresh(key, build);
      if (now() - cached.builtAt > ttlMs) refresh(key, build).catch(() => {});
      return cached.xml;
    }
  };
}
