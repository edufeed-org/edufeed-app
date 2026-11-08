/**
 * Termi's knowledge tools over nope-mcp, shared by the no-LLM search route
 * (tier 1) and the LLM task `ask` (tier 2). Each returns normalised items
 * plus the sources nope-mcp reported as not (fully) answering.
 */
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
/** @typedef {{ items: Item[], sourcesUnavailable: string[] }} ToolResult */

/** @param {any} result @param {(x: any) => Item | undefined} normalize @param {unknown} list @returns {ToolResult} */
function toResult(result, normalize, list) {
  const items = /** @type {Item[]} */ (
    (Array.isArray(list) ? list : []).map(normalize).filter(Boolean)
  );
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

/** An older nope-mcp without the tool answers "Tool <name> not found". @param {any} err */
function isUnknownTool(err) {
  return err?.isToolError === true && /tool \S+ not found/i.test(String(err.message));
}

/**
 * @param {{
 *   callTool: (name: string, args: Record<string, any>) => Promise<any>,
 *   relays?: string[],
 *   now?: () => number
 * }} deps `now` in ms
 */
export function createKnowledgeTools({ callTool, relays = DEFAULT_SEARCH_RELAYS, now = Date.now }) {
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
     * @param {{ types?: string[], authors?: string[] }} [opts] authors = hex pubkeys
     */
    async searchContent(q, { types, authors } = {}) {
      const picked = (types ?? []).filter((t) => CONTENT_TYPES.includes(t));
      const keys = validAuthors(authors);
      const r = await callTool('search_content', {
        ...(q ? { query: q } : {}),
        relays,
        limit: 20,
        ...(picked.length > 0 ? { types: picked } : {}),
        ...(keys.length > 0 ? { authors: keys } : {})
      });
      return toResult(r, (h) => normalizeContent(h, queriedUrls(r)), r?.results);
    },

    /** @param {string} q @param {Record<string, unknown>} [filters] */
    async searchResources(q, filters = {}) {
      const picked = Object.fromEntries(
        RESOURCE_FILTERS.filter((k) => typeof filters[k] === 'string' && filters[k]).map((k) => [
          k,
          filters[k]
        ])
      );
      const r = await callTool('search_resources', { query: q, relays, limit: 10, ...picked });
      return toResult(r, (h) => normalizeContent(h, queriedUrls(r)), r?.resources);
    },

    /** @param {string} q @param {{ level?: string }} [opts] level = KIM educationalLevel URI */
    async searchEvents(q, { level } = {}) {
      const r = await callTool('search_calendar_events', {
        query: q,
        endAfter: Math.floor(now() / 1000),
        limit: 10,
        ...(level ? { educationalLevel: level } : {})
      });
      return toResult(r, normalizeEvent, r?.events);
    },

    /** @param {string} question @param {{ relay?: string, limit?: number }} [opts] */
    async searchPassages(question, { relay, limit = 4 } = {}) {
      const r = await callTool('search_passages', {
        question,
        kinds: PASSAGE_KINDS,
        relays: relay ? [relay] : relays,
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
