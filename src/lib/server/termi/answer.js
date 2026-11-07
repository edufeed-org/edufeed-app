/**
 * Termi tier 1: a deterministic answer to a content question, no LLM.
 * `find_community` + `search_content` always, `find_people` / `search_events`
 * on cues, all in parallel; merged into one typed list (≤ 8 items).
 * Never logs the user text.
 */
import { extractQuery, questionCues } from '../../helpers/termi-skills.js';
import { callNopeMcpTool } from '../nopeMcpClient.js';
import { nopeMcpEnv } from '../nopeMcpEnv.js';
import { createKnowledgeTools, DEFAULT_SEARCH_RELAYS, nopeMcpCaller } from './knowledge-tools.js';

const MAX_ITEMS = 8;
const DIVERSE_TOP = 4;

/** @typedef {import('./items.js').Item} Item */
/** @typedef {ReturnType<typeof createKnowledgeTools>} KnowledgeTools */

/** `TERMI_SEARCH_RELAYS` (comma list) → relay short names/URLs, default the three. @param {string | undefined} value */
export function parseSearchRelays(value) {
  const list = (value ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_SEARCH_RELAYS;
}

/** shortcut: for scripts/termi-eval-ask.js only (no SvelteKit env, no token); routes pass their tools. */
function toolsFromProcessEnv() {
  const mcpUrl = nopeMcpEnv(process.env, 'URL');
  if (!mcpUrl) throw new Error('NOPE_MCP_URL / AMB_MCP_URL not set');
  const getToken = () => Promise.reject(new Error('no nope-mcp token outside the app'));
  return createKnowledgeTools({
    callTool: nopeMcpCaller({ mcpUrl, getToken, callTool: callNopeMcpTool }),
    relays: parseSearchRelays(process.env.TERMI_SEARCH_RELAYS)
  });
}

/** @param {string} s */
const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];

/**
 * @param {string} text already validated (1–300 chars)
 * @param {'de'|'en'} locale
 * @param {KnowledgeTools} [tools]
 * @returns {Promise<{ items: Item[], sourcesUnavailable: string[] }>}
 */
export async function answerQuestion(text, locale, tools = toolsFromProcessEnv()) {
  const cues = questionCues(text);
  const topic =
    extractQuery(text, locale)
      .replace(/\b(?:com+unit(?:y|ies)|gemeinschaft)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || text;
  // The relays' NIP-50 search finds nothing for hyphenated compounds ("Statistik-Vorkurs").
  const contentQuery = topic.replace(/(\p{L})-(\p{L})/gu, '$1 $2');

  /** @type {[string, () => Promise<{ items: Item[], sourcesUnavailable: string[] }>][]} */
  const calls = [
    ['find_community', () => tools.findCommunity(topic)],
    ['search_content', () => tools.searchContent(contentQuery)]
  ];
  if (cues.person) calls.push(['find_people', () => tools.findPeople(topic)]);
  if (cues.event) calls.push(['search_events', () => tools.searchEvents(topic)]);

  const settled = await Promise.allSettled(calls.map(([, run]) => run()));
  /** @type {Item[]} */
  const all = [];
  /** @type {string[]} */
  const sourcesUnavailable = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[termi/answer] ${calls[i][0]} failed:`, r.reason?.name || 'unknown error');
      sourcesUnavailable.push(calls[i][0]);
      return;
    }
    all.push(...r.value.items.filter((it) => !it.weak));
    sourcesUnavailable.push(...r.value.sourcesUnavailable);
  });

  const topicWords = words(topic);
  /** @param {Item} it */
  const communityFirst = (it) =>
    it.type === 'community' &&
    (cues.community || topicWords.some((w) => it.title.toLowerCase().includes(w)));
  const ranked = all
    .map((it, i) => ({ it, i }))
    .sort(
      (a, b) =>
        Number(communityFirst(b.it)) - Number(communityFirst(a.it)) ||
        (b.it.score ?? 0) - (a.it.score ?? 0) ||
        a.i - b.i
    )
    .map(({ it }) => it);

  // Type diversity: the best item of every type makes the top 4 (in rank order), the rest follows.
  const seen = new Set();
  const top = ranked.filter((it) => !seen.has(it.type) && seen.add(it.type)).slice(0, DIVERSE_TOP);
  const items = [...top, ...ranked.filter((it) => !top.includes(it))].slice(0, MAX_ITEMS);
  return { items, sourcesUnavailable: [...new Set(sourcesUnavailable)] };
}
