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

/** Short names nope-mcp's `list_relays` accepts (hostname first label). */
export const DEFAULT_SEARCH_RELAYS = ['amb-relay', 'oersi', 'sodix'];

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
      : relays.filter((r) => /^wss?:\/\//.test(r));

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
    /** @param {string} q @param {{ types?: string[] }} [opts] */
    async searchContent(q, { types } = {}) {
      const picked = (types ?? []).filter((t) => CONTENT_TYPES.includes(t));
      const r = await callTool('search_content', {
        query: q,
        relays,
        limit: 20,
        ...(picked.length > 0 ? { types: picked } : {})
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

    /** @param {string} question @param {{ relay?: string }} [opts] */
    async searchPassages(question, { relay } = {}) {
      const r = await callTool('search_passages', {
        question,
        kinds: PASSAGE_KINDS,
        ...(relay ? { relays: [relay] } : {}),
        limit: 4
      });
      return toResult(r, normalizePassage, r?.passages);
    },

    /** @param {string} q */
    findCommunity(q) {
      return optional('find_community', { query: q }, (r) =>
        toResult(r, normalizeCommunity, r?.communities)
      );
    },

    /** @param {string} q */
    findPeople(q) {
      return optional('resolve_author', { name: q, limit: 5 }, (r) =>
        toResult(r, normalizePerson, r?.candidates)
      );
    }
  };
}
