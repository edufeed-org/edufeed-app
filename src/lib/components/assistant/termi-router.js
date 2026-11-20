/**
 * Termi router client glue: ask `/api/termi` for ranked navigate/create/help
 * skills (keyword fallback on any failure), decide, and turn a skill into a
 * chat action. Everything else is a content question (`searchContent`).
 */
import * as m from '$lib/paraglide/messages';
import {
  TERMI_SKILLS,
  THRESHOLDS,
  availableSkills,
  decide,
  extractQuery,
  keywordMatch
} from '$lib/helpers/termi-skills.js';
import { CREATE_ACTIONS } from '$lib/config/create-actions.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';

/** @typedef {import('$lib/helpers/termi-skills.js').TermiSkill} TermiSkill */
/** @typedef {{ label: string, href?: string, target?: string, rel?: string, run?: () => void }} TermiAction */

/**
 * @param {string} text
 * @param {{
 *   locale: 'de'|'en',
 *   fetch: typeof fetch,
 *   skills?: TermiSkill[],
 *   ctx: { loggedIn: boolean }
 * }} opts
 */
export async function routeQuestion(text, { locale, fetch, skills = TERMI_SKILLS, ctx }) {
  /** @type {'embed'|'keyword'} */
  let mode = 'embed';
  /** @type {Array<{ skill: string, score: number }> | null} */
  let matches = null;
  // A stalled request must not keep the chat blocked: abort → keyword path.
  // (A plain setTimeout rather than AbortSignal.timeout, so fake timers drive it in tests.)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    // No embedding service configured: the router could only answer 503.
    if (!runtimeConfig.termi?.embed) throw new Error('embed off');
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
  const available = availableSkills(skills, ctx);
  const ids = new Set(available.map((s) => s.id));
  // The server ranks the whole catalogue; drop what this user can't use.
  matches = (matches ?? keywordMatch(text, available, locale)).filter((x) => ids.has(x.skill));
  const byId = new Map(available.map((s) => [s.id, s]));
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  // Keyword overlap is noisy: a guess needs half the tokens and to stay near the best one.
  /** @param {{ score: number }} x */
  const strong = (x) =>
    mode === 'keyword'
      ? x.score >= 0.5 && x.score >= 0.75 * top
      : x.score >= THRESHOLDS.embed.MAYBE;
  const guessed = sorted
    .filter(
      (x) => strong(x) && ['navigate', 'create', 'help'].includes(byId.get(x.skill)?.kind ?? '')
    )
    .slice(0, 2);
  return {
    decision: decide(matches, { mode }),
    // "Meinst du …?" on an empty content answer: the two best weak matches.
    guesses: guessed.map((x) => x.skill),
    // Above real cards a wrong guess costs more: keyword mode needs a full multi-word phrase.
    strongGuesses: guessed
      .filter((x) => mode === 'embed' || /** @type {{ full?: boolean }} */ (x).full)
      .map((x) => x.skill),
    query: extractQuery(text, locale),
    mode,
    available
  };
}

// Both languages always count: a German UI user may write English and vice versa.
const LESSON_KEYWORDS = [
  'unterrichtsreihe',
  'unterrichtseinheit',
  'unterrichtsentwurf',
  'stundenplanung',
  'lernsequenz',
  'reihe planen',
  'unterricht planen',
  'lesson series',
  'unit plan',
  'lesson plan',
  'plan a unit'
];
// Word start only: "Veranstaltungsreihe planen" is no lesson series.
const LESSON_RE = new RegExp(`(?:^|[^a-z0-9])(?:${LESSON_KEYWORDS.join('|')})`);
/** Lowercase, diacritics (ä → a) and ß folded, whitespace collapsed. @param {string} s */
const fold = (s) =>
  s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

/**
 * Which task a new conversation is: a lesson-planning request is `lesson`,
 * everything else `ask`. Pure; decided once, at the first message.
 * Both languages' keywords count, whatever the locale.
 * @param {string} text
 * @returns {'ask'|'lesson'}
 */
export function detectTask(text) {
  const folded = fold(text);
  if (LESSON_RE.test(folded)) return 'lesson';
  // One typo in a long keyword ("unterichtsreihe", laoc 2026-11-11) sent a
  // whole planning session through the general task: words of 10+ letters
  // also match at edit distance 1.
  const words = folded.split(/[^a-z0-9]+/);
  return LESSON_KEYWORDS.some(
    (k) =>
      !k.includes(' ') &&
      k.length >= 10 &&
      words.some((w) => w.startsWith(k.slice(0, 4)) && withinOneEdit(w, k))
  )
    ? 'lesson'
    : 'ask';
}

/** Levenshtein distance ≤ 1 between `a` and `b` (or `a` begins with such a variant of `b`). @param {string} a @param {string} b */
function withinOneEdit(a, b) {
  if (a.length > b.length + 1) a = a.slice(0, b.length + 1); // plural/compound tails
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true;
  return (
    a.slice(i + 1) === b.slice(i + 1) || // substitution
    a.slice(i + 1) === b.slice(i) || // extra letter in a
    a.slice(i) === b.slice(i + 1) // missing letter in a
  );
}

/**
 * Termi tier 1: the content items for a question (`/api/termi/search`) and
 * the sources that failed; a failed request is one unavailable source
 * ('search') so the generic sources line and its retry button show.
 *
 * @param {string} text
 * @param {{ locale: 'de'|'en', fetch: typeof fetch, authors?: string[], lessFitting?: boolean }} opts authors = hex pubkeys ("Material von …");
 *   lessFitting = the hits the search held back as only loosely fitting (after an empty answer)
 * @returns {Promise<{ items: Array<import('$lib/termi/items.d.js').Item>, sourcesUnavailable: string[] }>}
 */
export async function searchContent(text, { locale, fetch, authors, lessFitting }) {
  try {
    const res = await fetch('/api/termi/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        locale,
        ...(authors?.length ? { authors } : {}),
        ...(lessFitting ? { lessFitting: true } : {})
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) return { items: [], sourcesUnavailable: ['search'] };
    const body = await res.json();
    return {
      items: Array.isArray(body?.items) ? body.items : [],
      sourcesUnavailable: Array.isArray(body?.sourcesUnavailable) ? body.sourcesUnavailable : []
    };
  } catch {
    return { items: [], sourcesUnavailable: ['search'] };
  }
}

/**
 * The /discover search for one type ("Alle anzeigen").
 *
 * @param {string} type a discover tab id (learning, events, …)
 * @param {string} [query]
 */
export function discoverHref(type, query = '') {
  return query
    ? `/discover?type=${type}&search=${encodeURIComponent(query)}`
    : `/discover?type=${type}`;
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
 *   npub: string | null,
 *   runCreate: (action: import('$lib/config/create-actions.js').CreateAction) => void,
 *   runHelp: (skill: TermiSkill) => void
 * }} ctx
 * @returns {TermiAction | null}
 */
export function skillAction(skill, { npub, runCreate, runHelp }) {
  switch (skill.kind) {
    case 'navigate': {
      let href = skill.href ?? '/';
      if (href.startsWith('profile')) {
        if (!npub) return null;
        href = `/p/${npub}${href.slice('profile'.length)}`;
      }
      return { label: NAVIGATE_LABELS[skill.id]?.() ?? href, href };
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

/** @param {string} id @returns {TermiSkill | undefined} */
export function skillById(id) {
  return TERMI_SKILLS.find((s) => s.id === id);
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
