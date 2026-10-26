/**
 * /sitemap.xml: the deployment's indexable content pages (articles, wiki
 * entries, learning resources — see indexability.js: published through this
 * deployment or by curated authors, minimal quality), so search and AI
 * crawlers find pages they would otherwise only reach through client-rendered
 * links. Pages outside the rule carry noindex; the sitemap never lists them.
 *
 * Built from the deployment's own relays, cached stale-while-revalidate: an
 * old sitemap is served at once and refreshed in the background, never
 * expired into a blocking fetch (see "Store First, Network Second" in
 * CLAUDE.md).
 */
import { verifyEvent } from 'nostr-tools/pure';
import { parseArray } from '$lib/server/env-parse.js';
import { eventMatchesFilter, getRelaysForKind } from '$lib/server/relay-fetch.js';
import { curatedAuthors, mirrorOriginal } from '$lib/server/og.js';
import { isIndexableEvent } from './indexability.js';
import { canonicalPathFor } from './page-content.js';

// amb-relay caps at 250 and answers some requests at exactly that limit empty.
const PAGE_SIZE = 200;
const PAGE_TIMEOUT = 5000;
const EMPTY_PAGE_RETRY_MS = 2000;
const MAX_EVENTS_PER_RELAY = 20_000;
const CURATED_MAX_WAIT = 10_000;
const MIRROR_CHECK_CONCURRENCY = 8;

/**
 * @typedef {{ kind: number, relays: string[] }} SitemapSource
 */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {SitemapSource[]}
 */
export function sitemapSources(env) {
  return [
    { kind: 30023, relays: parseArray(env.LONGFORM_CONTENT_RELAY) },
    { kind: 30818, relays: parseArray(env.COMMUNIKEY_RELAYS) },
    // Leave mirrors of third-party metadata (e.g. OERSI) out of the scan:
    // nothing there passes the indexability rule, it only costs relay time.
    { kind: 30142, relays: parseArray(env.SITEMAP_AMB_RELAYS || env.AMB_RELAYS) }
  ];
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
        const pageFilter = { ...filter, limit: PAGE_SIZE, ...(until ? { until } : {}) };
        let page = await fetchPage(relay, pageFilter);
        if (page.length === 0) {
          // Relays occasionally answer empty; one retry before concluding "done".
          await new Promise((r) => setTimeout(r, EMPTY_PAGE_RETRY_MS));
          page = await fetchPage(relay, pageFilter);
        }
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
 * Latest version per address (kind:pubkey:d); events without a d value dropped.
 * @param {import('nostr-tools').NostrEvent[]} events
 * @returns {Map<string, import('nostr-tools').NostrEvent>}
 */
export function latestByAddress(events) {
  /** @type {Map<string, import('nostr-tools').NostrEvent>} */
  const latest = new Map();
  for (const event of events) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1];
    if (!d) continue;
    const address = `${event.kind}:${event.pubkey}:${d}`;
    const known = latest.get(address);
    if (!known || known.created_at < event.created_at) latest.set(address, event);
  }
  return latest;
}

/**
 * Latest version per address, filtered by the indexability rule.
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {{ origin: string, relayHintFor: (kind: number) => string | undefined, isIndexable: (e: import('nostr-tools').NostrEvent) => boolean }} opts
 * @returns {{ loc: string, lastmod: string }[]}
 */
export function buildSitemapEntries(events, { origin, relayHintFor, isIndexable }) {
  const latest = latestByAddress(events);

  /** @type {Map<string, number>} loc → newest created_at (wiki topics share a loc) */
  const byLoc = new Map();
  for (const event of latest.values()) {
    if (!isIndexable(event)) continue;
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
 * Events that are (or may be) mirrors of partner content: resolve says
 * anything but null (edufeed original). Checks a few at a time so a sitemap
 * rebuild never floods a partner site.
 * @param {import('nostr-tools').NostrEvent[]} events
 * @param {(event: import('nostr-tools').NostrEvent) => Promise<string | null | undefined>} resolve
 * @returns {Promise<Set<import('nostr-tools').NostrEvent>>}
 */
export async function findMirrors(events, resolve) {
  /** @type {Set<import('nostr-tools').NostrEvent>} */
  const mirrors = new Set();
  for (let i = 0; i < events.length; i += MIRROR_CHECK_CONCURRENCY) {
    await Promise.all(
      events.slice(i, i + MIRROR_CHECK_CONCURRENCY).map(async (event) => {
        if ((await resolve(event)) !== null) mirrors.add(event);
      })
    );
  }
  return mirrors;
}

/**
 * @param {string} origin
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<string>}
 */
export async function buildSitemapXml(origin, env) {
  const curated = await curatedAuthors.get(CURATED_MAX_WAIT);
  const clientName = env.CLIENT_NAME || env.APP_NAME || 'Edufeed';
  /** @type {import('nostr-tools').NostrEvent[]} */
  const events = [];
  for (const source of sitemapSources(env)) {
    if (source.relays.length === 0) continue;
    events.push(...(await fetchAllEvents({ kinds: [source.kind] }, source.relays)));
  }
  const byRule = (/** @type {import('nostr-tools').NostrEvent} */ event) =>
    isIndexableEvent(event, { clientName, curatedAuthors: curated });

  // Mirrors of partner content stay out — also when the partner site didn't
  // answer (never list a possible mirror).
  const excluded = await findMirrors(
    [...latestByAddress(events).values()].filter(byRule),
    mirrorOriginal
  );

  return renderSitemapXml(
    buildSitemapEntries(events, {
      origin,
      relayHintFor: (kind) => getRelaysForKind(kind, [])[0],
      isIndexable: (event) => byRule(event) && !excluded.has(event)
    })
  );
}

/** @param {string} xml */
const urlCount = (xml) => (xml.match(/<url>/g) ?? []).length;

/**
 * Stale-while-revalidate cache keyed by origin. A rebuild that lost more than
 * half of the URLs is treated as a relay hiccup: the previous sitemap stays
 * and the rebuild is retried after `retryMs`.
 * @param {{ ttlMs: number, now?: () => number, retryMs?: number }} opts
 */
export function createSitemapCache({ ttlMs, now = Date.now, retryMs = 10 * 60 * 1000 }) {
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
        const previous = entries.get(key);
        if (previous && urlCount(xml) < urlCount(previous.xml) / 2) {
          entries.set(key, { xml: previous.xml, builtAt: now() - ttlMs + retryMs });
          return previous.xml;
        }
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
