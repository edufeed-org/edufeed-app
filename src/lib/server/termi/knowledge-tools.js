/**
 * Termi's knowledge tools over nope-mcp, shared by the no-LLM search route
 * (tier 1) and the LLM task `ask` (tier 2). Each returns normalised items
 * plus the sources nope-mcp reported as not (fully) answering.
 */
import { AUDIENCES } from '../../termi/audience.js';
import {
  normalizeContent,
  normalizeEvent,
  normalizePerson,
  normalizeCommunity,
  normalizePassage
} from './items.js';

export const MAX_AUTHORS = 5;

/** Short names nope-mcp's `list_relays` accepts (hostname first label). */
export const DEFAULT_SEARCH_RELAYS = ['amb-relay', 'oersi', 'sodix'];

/**
 * `TERMI_SEARCH_RELAYS` (comma list) → relay short names/URLs, default the
 * three. The one parser both Termi routes (tier 1 `/api/termi/search` and
 * tier 2 `/api/termi/chat`) use, so the env var applies to both.
 * @param {string | undefined} value
 */
export function parseSearchRelays(value) {
  const list = (value ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_SEARCH_RELAYS;
}

/** Hint URLs for the short names, used when nope-mcp doesn't report `relaysSearched`. */
const SHORT_RELAY_URLS = /** @type {Record<string, string>} */ ({
  'amb-relay': 'wss://amb-relay.edufeed.org',
  oersi: 'wss://oersi.edufeed.org',
  sodix: 'wss://sodix.edufeed.org'
});

const CONTENT_TYPES = ['resource', 'article', 'wiki', 'project', 'measure', 'publication'];
const RESOURCE_FILTERS = [
  'publisherName',
  'creatorName',
  'subjectLabel',
  'resourceTypeLabel',
  'educationalLevelLabel',
  'licenseFilter'
];
const PASSAGE_KINDS = [30142, 30023, 30818, 30040, 30041];
const MAX_PEOPLE = 5;

/** @typedef {import('./items.js').Item} Item */
/** @typedef {{ items: Item[], sourcesUnavailable: string[], note?: string }} ToolResult  note = a hint for the model only, never a card */

/** @param {any} result @param {(x: any) => Item | undefined} normalize @param {unknown} list @returns {ToolResult} */
function toResult(result, normalize, list) {
  const items = /** @type {Item[]} */ (
    (Array.isArray(list) ? list : []).map(normalize).filter(Boolean)
  );
  // The list order is nope-mcp's ranking: its legs are interleaved and their scores are not
  // comparable, so each score is capped at the one before — a later sort by score keeps the order.
  let cap = Infinity;
  for (const it of items)
    if (typeof it.score === 'number') it.score = cap = Math.min(cap, it.score);
  const incomplete = result?.relaysIncomplete;
  return { items, sourcesUnavailable: Array.isArray(incomplete) ? incomplete : [] };
}

/**
 * `(name, args) => result` over nope-mcp: anonymous first, a client-credentials
 * token only when the server demands one (401).
 * @param {{ mcpUrl: string, getToken: () => Promise<string>, callTool: (p: { mcpUrl: string, bearerToken: string | undefined, name: string, args: object }) => Promise<any> }} deps
 */
export function nopeMcpCaller({ mcpUrl, getToken, callTool }) {
  return async (/** @type {string} */ name, /** @type {object} */ args) => {
    try {
      return await callTool({ mcpUrl, bearerToken: undefined, name, args });
    } catch (err) {
      if (/** @type {any} */ (err)?.status !== 401) throw err;
      return callTool({ mcpUrl, bearerToken: await getToken(), name, args });
    }
  };
}

/** At most 5 well-formed hex pubkeys; anything else is dropped. @param {unknown} list @returns {string[]} */
export function validAuthors(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((a) => typeof a === 'string' && /^[0-9a-f]{64}$/.test(a)))].slice(
    0,
    MAX_AUTHORS
  );
}

/** A hex pubkey (find_community hands out hex; it also serves as the `authors` leg), else undefined. @param {unknown} v */
export function validCommunity(v) {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : undefined;
}

/** `naddr1…` as nope-mcp's get_resource takes it. */
export const NADDR_RE = /^naddr1[0-9a-z]+$/;

/**
 * Unix seconds of midnight starting `ymd` (YYYY-MM-DD) in `tz`; undefined for
 * anything else. Calendar helpers can't be reused here (paraglide/stores).
 * @param {unknown} ymd @param {string} tz a valid IANA zone
 */
export function zonedDayStart(ymd, tz) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const wall = Date.parse(`${ymd}T00:00:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== ymd) return undefined;
  /** @param {number} ms the zone's UTC offset at that instant */
  const offset = (ms) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value])
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  // second pass settles a DST change between the two offsets
  return (wall - offset(wall - offset(wall))) / 1000;
}

/** get_resource's `resource` (name, nostr.naddr, type[]) → the search-hit shape normalizeContent reads. @param {any} res */
function resourceAsHit(res) {
  return { ...res, type: 'resource', title: res.title ?? res.name, naddr: res.nostr?.naddr };
}

/** An older nope-mcp without the tool answers "Tool <name> not found". @param {any} err */
function isUnknownTool(err) {
  return err?.isToolError === true && /tool \S+ not found/i.test(String(err.message));
}

/**
 * @param {{
 *   callTool: (name: string, args: Record<string, any>) => Promise<any>,
 *   relays?: string[],
 *   audience?: string,
 *   now?: () => number
 * }} deps `now` in ms; `audience` = the default for every search (tier 1 reads it from the question)
 */
export function createKnowledgeTools({
  callTool: rawCall,
  relays = DEFAULT_SEARCH_RELAYS,
  audience: defaultAudience,
  now = Date.now
}) {
  // audience is a hint: a server whose relays carry other audiences is asked again without it
  /** @param {string} name @param {Record<string, any>} args */
  const callTool = async (name, args) => {
    const r = await rawCall(name, args);
    if (r?.error !== 'Unknown audience') return r;
    const { audience: _dropped, ...rest } = args;
    return rawCall(name, rest);
  };
  /** nope-mcp then searches the general relays plus the ones for that audience. @param {unknown} [value] */
  const forAudience = (value) => {
    const a = /** @type {any} */ (value ?? defaultAudience);
    return AUDIENCES.includes(a) ? { audience: a } : {};
  };
  /** Hints for re-encoded naddrs must be URLs; nope-mcp reports the ones it searched. @param {any} result */
  const queriedUrls = (result) =>
    Array.isArray(result?.relaysSearched)
      ? result.relaysSearched
      : relays.map((r) => (/^wss?:\/\//.test(r) ? r : SHORT_RELAY_URLS[r])).filter(Boolean);

  /** @param {string} name @param {Record<string, any>} args @param {(r: any) => ToolResult} map */
  async function optional(name, args, map) {
    try {
      return map(await callTool(name, args));
    } catch (err) {
      if (isUnknownTool(err)) return { items: [], sourcesUnavailable: [] };
      throw err;
    }
  }

  return {
    /**
     * @param {string} q empty = no topic (with `authors`: everything by them)
     * @param {{ types?: string[], authors?: string[], community?: string, audience?: string }} [opts]
     *   authors = hex pubkeys; community = hex pubkey (wins over authors) or npub
     */
    async searchContent(q, { types, authors, community, audience } = {}) {
      const picked = (types ?? []).filter((t) => CONTENT_TYPES.includes(t));
      const comm = validCommunity(community);
      // community wins: explicit authors are ignored (the community's own key is the second leg)
      const keys = comm ? [] : validAuthors(authors);
      /** @param {Record<string, any>} extra */
      const leg = async (extra) => {
        const r = await callTool('search_content', {
          ...(q ? { query: q } : {}),
          relays,
          limit: 20,
          ...forAudience(audience),
          ...(picked.length > 0 ? { types: picked } : {}),
          ...extra
        });
        return toResult(r, (h) => normalizeContent(h, queriedUrls(r)), r?.results);
      };
      /** @type {ToolResult} */
      let out;
      if (comm) {
        // "in the community" = shared into it (community filter) + posted by its own key (authors filter)
        const legs = await Promise.allSettled([leg({ community: comm }), leg({ authors: [comm] })]);
        const ok = legs.flatMap((l) => (l.status === 'fulfilled' ? [l.value] : []));
        if (ok.length === 0) throw /** @type {PromiseRejectedResult} */ (legs[0]).reason;
        const seen = new Set();
        out = {
          items: ok
            .flatMap((l) => l.items)
            .filter((it) => !seen.has(it.id) && seen.add(it.id))
            .slice(0, 20),
          sourcesUnavailable: [...new Set(ok.flatMap((l) => l.sourcesUnavailable))]
        };
      } else {
        out = await leg(keys.length > 0 ? { authors: keys } : {});
      }
      const applied = [
        comm && 'community',
        keys.length > 0 && 'authors',
        picked.length > 0 && 'types'
      ].filter(Boolean);
      // specific words rarely appear in titles: steer the model to retry instead of reporting "nothing"
      if (out.items.length === 0 && applied.length > 0)
        out.note = `Keine Treffer mit dem Filter ${applied.join(' + ')}. Suche genau einmal noch einmal, im selben Schritt, mit dem gleichen Filter und zwei oder drei verwandten oder weiteren Begriffen, denn spezielle Wörter stehen oft nicht in Titeln. Sind auch diese Suchen leer, sag, dass dort nichts gefunden wurde, und biete die Suche ohne Filter an.`;
      return out;
    },

    /** One piece of content by its naddr (a pasted address). @param {string} naddr */
    getContent(naddr) {
      if (typeof naddr !== 'string' || !NADDR_RE.test(naddr))
        throw new Error(
          'naddr muss mit "naddr1" beginnen und nur Kleinbuchstaben und Ziffern enthalten (NIP-19), z. B. naddr1qvzq…'
        );
      return optional('get_resource', { naddr }, (r) =>
        toResult(r, (h) => normalizeContent(h, queriedUrls(r)), [
          r?.resource ? resourceAsHit(r.resource) : r
        ])
      );
    },

    /** @param {string} q @param {Record<string, unknown>} [filters] */
    async searchResources(q, filters = {}) {
      const picked = Object.fromEntries(
        RESOURCE_FILTERS.filter((k) => typeof filters[k] === 'string' && filters[k]).map((k) => [
          k,
          filters[k]
        ])
      );
      const r = await callTool('search_resources', {
        query: q,
        relays,
        limit: 10,
        ...forAudience(filters.audience),
        ...picked
      });
      return toResult(r, (h) => normalizeContent(h, queriedUrls(r)), r?.resources);
    },

    /**
     * @param {string} q
     * @param {{ level?: string, from?: string, to?: string, tz?: string }} [opts]
     *   level = KIM educationalLevel URI; from/to = YYYY-MM-DD (to inclusive) in `tz`
     */
    async searchEvents(q, { level, from, to, tz = 'UTC' } = {}) {
      // events running during the window: ending after its start, starting before its end
      const windowStart = zonedDayStart(from, tz);
      const nextDay =
        zonedDayStart(to, tz) === undefined
          ? undefined
          : zonedDayStart(
              new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
              tz
            );
      const r = await callTool('search_calendar_events', {
        query: q,
        endAfter: windowStart ?? Math.floor(now() / 1000),
        // nope-mcp's startBefore is inclusive: the last second of `to`
        ...(nextDay === undefined ? {} : { startBefore: nextDay - 1 }),
        limit: 10,
        ...(level ? { educationalLevel: level } : {})
      });
      return toResult(r, normalizeEvent, r?.events);
    },

    /** @param {string} question @param {{ relay?: string, limit?: number, audience?: string }} [opts] */
    async searchPassages(question, { relay, limit = 4, audience } = {}) {
      const r = await callTool('search_passages', {
        question,
        kinds: PASSAGE_KINDS,
        relays: relay ? [relay] : relays,
        ...forAudience(audience),
        limit
      });
      return toResult(r, normalizePassage, r?.passages);
    },

    /** @param {string} q */
    findCommunity(q) {
      return optional('find_community', { query: q }, (r) =>
        toResult(r, normalizeCommunity, r?.communities)
      );
    },

    /**
     * People behind the content on a topic: Person creators/publishers of the
     * first relay's hits (our own relay — catalogue creators are rarely in the
     * network and would crowd them out), most frequent first, then by best hit
     * score; each resolved via resolve_author, kept as a linked person only on
     * an exact name match, else name-only (no href).
     * @param {string} topic
     */
    async aggregatePeople(topic) {
      const r = await callTool('search_content', {
        query: topic,
        relays: relays.slice(0, 1),
        limit: 20
      });
      /** @type {Map<string, { count: number, best: number }>} */
      const tally = new Map();
      for (const hit of Array.isArray(r?.results) ? r.results : []) {
        for (const e of [...(hit?.creator ?? []), ...(hit?.publisher ?? [])]) {
          const name = typeof e?.name === 'string' ? e.name.trim() : '';
          // third-party metadata: a 100+ char "name" is a sentence, not a person
          if (e?.type !== 'Person' || !name || name.length > 100) continue;
          const t = tally.get(name) ?? { count: 0, best: 0 };
          tally.set(name, { count: t.count + 1, best: Math.max(t.best, hit.score ?? 0) });
        }
      }
      const names = [...tally]
        .sort(([, a], [, b]) => b.count - a.count || b.best - a.best)
        .slice(0, MAX_PEOPLE)
        .map(([name]) => name);
      const items = await Promise.all(
        names.map(async (name) => {
          const res = await callTool('resolve_author', { name, limit: 5 }).catch(() => null);
          const match = (Array.isArray(res?.candidates) ? res.candidates : []).find(
            (/** @type {any} */ c) => c?.name?.trim().toLowerCase() === name.toLowerCase()
          );
          return (
            (match && normalizePerson(match)) ?? { type: 'person', id: `name:${name}`, title: name }
          );
        })
      );
      return {
        items: /** @type {Item[]} */ (items),
        sourcesUnavailable: Array.isArray(r?.relaysIncomplete) ? r.relaysIncomplete : []
      };
    },

    /** @param {string} q */
    findPeople(q) {
      return optional('resolve_author', { name: q, limit: 5 }, (r) =>
        toResult(r, normalizePerson, r?.candidates)
      );
    }
  };
}
