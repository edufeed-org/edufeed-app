/**
 * Termi router client glue: ask `/api/termi` for ranked skills (keyword
 * fallback on any failure), decide, and turn a skill into a chat action.
 */
import * as m from '$lib/paraglide/messages';
import {
  TERMI_SKILLS,
  availableSkills,
  decide,
  extractQuery,
  keywordMatch
} from '$lib/helpers/termi-skills.js';
import { CREATE_ACTIONS } from '$lib/config/create-actions.js';

/** @typedef {import('$lib/helpers/termi-skills.js').TermiSkill} TermiSkill */
/** @typedef {{ label: string, href?: string, target?: string, rel?: string, run?: () => void }} TermiAction */

/**
 * @param {string} text
 * @param {{
 *   locale: 'de'|'en',
 *   fetch: typeof fetch,
 *   skills?: TermiSkill[],
 *   ctx: { loggedIn: boolean, discoverTypes: string[], llm: boolean | Promise<boolean> }
 * }} opts
 */
export async function routeQuestion(text, { locale, fetch, skills = TERMI_SKILLS, ctx }) {
  // `llm` may be the pending eligibility probe: it runs alongside the router request.
  const llm = Promise.resolve(ctx.llm);
  /** @type {'embed'|'keyword'} */
  let mode = 'embed';
  /** @type {Array<{ skill: string, score: number }> | null} */
  let matches = null;
  // A stalled request must not keep the chat blocked: abort → keyword path.
  // (A plain setTimeout rather than AbortSignal.timeout, so fake timers drive it in tests.)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch('/api/termi', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, locale }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    if (!Array.isArray(body?.matches)) throw new Error('bad body');
    matches = body.matches;
  } catch {
    mode = 'keyword';
  } finally {
    clearTimeout(timer);
  }
  const available = availableSkills(skills, { ...ctx, llm: await llm });
  const ids = new Set(available.map((s) => s.id));
  // The server ranks the whole catalogue; drop what this user can't use.
  matches = (matches ?? keywordMatch(text, available, locale)).filter((x) => ids.has(x.skill));
  return {
    decision: decide(matches, { mode }),
    query: extractQuery(text, locale),
    mode,
    available
  };
}

/**
 * Seam for Task 10: assistant skills open the chat there. Until then they
 * fall back to the plain learning-search link so nothing dead-ends.
 *
 * @param {string} skillId
 * @returns {string}
 */
export function answerableSkill(skillId) {
  return skillId === 'assistant.search' ? 'search.learning' : skillId;
}

const NAVIGATE_LABELS = /** @type {Record<string, () => string>} */ ({
  home: m.termi_route_home,
  'my-content': m.termi_route_my_content,
  bookmarks: m.termi_route_bookmarks,
  calendar: m.termi_route_calendar,
  inbox: m.termi_route_inbox,
  settings: m.termi_route_settings,
  'my-communities': m.termi_route_my_communities
});

const TYPE_LABELS = /** @type {Record<string, () => string>} */ ({
  all: m.discover_tab_all,
  events: m.discover_tab_events,
  learning: m.discover_tab_learning,
  articles: m.discover_tab_articles,
  boards: m.discover_tab_boards,
  communities: m.discover_tab_communities,
  people: m.discover_tab_people
});

/** Help skills → the canned Q&A they stand for (help.4 "Wer bist du?" → the greeting). */
const HELP_COPY = /** @type {Record<number, { q: () => string, a: () => string }>} */ ({
  1: { q: m.termi_sugg_1_q, a: m.termi_sugg_1_a },
  2: { q: m.termi_sugg_3_q, a: m.termi_sugg_3_a },
  3: { q: m.termi_sugg_4_q, a: m.termi_sugg_4_a },
  4: { q: m.termi_route_help_who_q, a: m.termi_greeting }
});

/**
 * Canned answer text for a help skill.
 *
 * @param {TermiSkill} skill
 */
export function helpAnswer(skill) {
  return HELP_COPY[skill.helpIndex ?? 1].a();
}

/**
 * @param {TermiSkill} skill
 * @param {{
 *   query: string,
 *   npub: string | null,
 *   runCreate: (action: import('$lib/config/create-actions.js').CreateAction) => void,
 *   runHelp: (skill: TermiSkill) => void
 * }} ctx
 * @returns {TermiAction | null}
 */
export function skillAction(skill, { query, npub, runCreate, runHelp }) {
  switch (skill.kind) {
    case 'navigate': {
      let href = skill.href ?? '/';
      if (href.startsWith('profile')) {
        if (!npub) return null;
        href = `/p/${npub}${href.slice('profile'.length)}`;
      }
      return { label: NAVIGATE_LABELS[skill.id]?.() ?? href, href };
    }
    case 'search': {
      const type = skill.discoverType ?? 'all';
      const typeLabel = TYPE_LABELS[type]?.() ?? type;
      return query
        ? {
            label: m.termi_route_search_label({ query, type: typeLabel }),
            href: `/discover?type=${type}&search=${encodeURIComponent(query)}`
          }
        : {
            label: m.termi_route_browse_label({ type: typeLabel }),
            href: `/discover?type=${type}`
          };
    }
    case 'create': {
      const action = CREATE_ACTIONS.find((a) => a.id === skill.actionId);
      return action ? { label: action.label(), run: () => runCreate(action) } : null;
    }
    case 'help':
      return { label: HELP_COPY[skill.helpIndex ?? 1].q(), run: () => runHelp(skill) };
    default:
      return null;
  }
}

/** pubkey → the probe's definitive answer, for this session (page load). */
const eligibility = new Map();

/**
 * Whether the assistant's NIP-05 gate admits this pubkey (/api/termi/eligible).
 * `null` (a directory not loaded yet) and errors count as "no" without being
 * remembered, so a later question asks again.
 *
 * @param {string} pubkey
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<boolean>}
 */
export async function isTermiEligible(pubkey, fetchImpl) {
  if (eligibility.has(pubkey)) return eligibility.get(pubkey);
  try {
    const res = await fetchImpl(`/api/termi/eligible?pubkey=${pubkey}`, {
      // Above the server's 5 s nostr.json timeout, so a cold directory still answers.
      signal: AbortSignal.timeout(6_000)
    });
    const body = res.ok ? await res.json() : null;
    if (typeof body?.eligible === 'boolean') eligibility.set(pubkey, body.eligible);
    return body?.eligible === true;
  } catch {
    return false;
  }
}

/** The chat route said 403 not_eligible: believe it over an older probe. @param {string} pubkey */
export function markTermiIneligible(pubkey) {
  eligibility.set(pubkey, false);
}

/** Test seam. */
export function _resetTermiEligibilityForTests() {
  eligibility.clear();
}
