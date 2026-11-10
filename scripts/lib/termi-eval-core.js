/**
 * Pure helpers for scripts/termi-eval-ask.js — matching, budgets, hit-rate
 * aggregation, the baseline diff and the exit-code decision. Kept separate
 * and free of network/filesystem I/O so they can be unit tested without a
 * dev server, nope-mcp token or Nostr key (see
 * scripts/lib/__tests__/termi-eval-core.test.mjs).
 */

/** @typedef {{ type: string, label: string, text: string }} EvalItem */
/**
 * @typedef {{ types?: string[], match?: string, notMatch?: string,
 *   answerMatch?: string, answerNotMatch?: string, tools?: string[] }} Expect
 */

/**
 * `expect.match`/`expect.notMatch` test the top-3 items' title/subtitle/
 * description text; for a `tier2Only` fixture (no item concept, e.g.
 * show_pages's `{ids}`) they test the raw tool-output JSON (`rawText`)
 * instead. `expect.answerMatch`/`answerNotMatch` always test the model's
 * generated answer text only — tier 1 never generates prose, so in practice
 * these only appear on `tier2Only` fixtures (e.g. `^# ` for "answers with a
 * document").
 * @param {EvalItem[]} top3
 * @param {Expect} expect
 * @param {{ rawText?: string, answerText?: string, tier2Only?: boolean }} [ctx]
 */
export function matchesExpect(top3, expect, ctx = {}) {
  const { rawText = '', answerText = '', tier2Only = false } = ctx;
  const haystacks = tier2Only ? [rawText] : [];
  const typeHit = !expect.types || top3.some((i) => expect.types.includes(i.type));
  // `match`: the top-3 cards, or (tier 2) what the model wrote — a name can
  // be in the prose while the cards show something else
  const matchHit =
    !expect.match ||
    top3.some((i) => new RegExp(expect.match, 'i').test(i.text)) ||
    [...haystacks, answerText].some((t) => t && new RegExp(expect.match, 'i').test(t));
  const notMatchHit =
    !expect.notMatch || !haystacks.some((t) => new RegExp(expect.notMatch, 'i').test(t));
  const answerMatchHit =
    !expect.answerMatch || new RegExp(expect.answerMatch, 'i').test(answerText);
  const answerNotMatchHit =
    !expect.answerNotMatch || !new RegExp(expect.answerNotMatch, 'i').test(answerText);
  return typeHit && matchHit && notMatchHit && answerMatchHit && answerNotMatchHit;
}

const REGEX_FIELDS = ['match', 'notMatch', 'answerMatch', 'answerNotMatch'];

/**
 * Compiles every fixture's `expect.{match,notMatch,answerMatch,answerNotMatch}`
 * once, up front. A bad pattern (a typo'd regex in the fixture file) must
 * fail loudly and name the fixture + field, not throw mid-run inside
 * `matchesExpect` and abort every case after it.
 * @param {{ id: string, expect?: Record<string, unknown> }[]} fixtures
 * @returns {{ id: string, field: string, message: string }[]} empty when every pattern compiles
 */
export function validateFixtureRegexes(fixtures) {
  const errors = [];
  for (const f of fixtures) {
    for (const field of REGEX_FIELDS) {
      const pattern = f.expect?.[field];
      if (pattern === undefined) continue;
      try {
        new RegExp(pattern, 'i');
      } catch (err) {
        errors.push({ id: f.id, field, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return errors;
}

/**
 * AND across `expectTools` elements, OR between `|`-separated tool names
 * within one element — e.g. `["search_content|search_resources"]` means
 * "either tool", `["search_content", "find_people"]` means "both". Tier 1
 * has no tool concept and never checks this.
 * @param {string[]} toolsUsed
 * @param {string[]} [expectTools]
 */
export function toolsHit(toolsUsed, expectTools) {
  if (!expectTools || expectTools.length === 0) return true;
  return expectTools.every((group) => group.split('|').some((t) => toolsUsed.includes(t)));
}

/**
 * A tier-2 answer that asks the teacher back instead of searching: the right
 * move for an underspecified request (a placeholder topic, a lesson series
 * without grade or duration). Counts as a hit when the fixture allows it
 * (`expect.clarifyOk`): no tool was called and the answer asks for the
 * missing piece — a question mark, or the imperative form ("Nenne mir …").
 * @param {string} answerText @param {string[]} toolsUsed
 */
export function isClarification(answerText, toolsUsed) {
  return toolsUsed.length === 0 && /\?|\bnenn(e|en Sie)? mir\b/i.test(answerText);
}

/**
 * A fixture's optional `maxSteps`/`maxMs` budget vs. this run's numbers.
 * Returns the names of the budgets this case blew (`[]` when none, or the
 * fixture sets none) — reported, but only turned into a miss by the
 * caller when `--strict` is set.
 * @param {{ maxSteps?: number, maxMs?: number }} fixture
 * @param {{ steps?: number, ms?: number }} actual
 */
export function checkBudget(fixture, actual) {
  const blown = [];
  if (
    fixture.maxSteps !== undefined &&
    typeof actual.steps === 'number' &&
    actual.steps > fixture.maxSteps
  ) {
    blown.push('maxSteps');
  }
  if (fixture.maxMs !== undefined && typeof actual.ms === 'number' && actual.ms > fixture.maxMs) {
    blown.push('maxMs');
  }
  return blown;
}

/**
 * Hit rate over the cases that actually ran: a `notRun` case (a 429
 * quota/busy response) is excluded from both the numerator and the
 * denominator — never counted as a miss, per audit B17.
 * @param {{ hit: boolean, notRun?: boolean }[]} cases
 */
export function aggregateHitRate(cases) {
  const ran = cases.filter((c) => !c.notRun);
  const hits = ran.filter((c) => c.hit).length;
  return { ranCount: ran.length, hits, hitRate: ran.length > 0 ? hits / ran.length : 1 };
}

/**
 * Below `minHitRate` → 1 (a real regression gate instead of always exiting
 * 0). `hitRate`/`minHitRate` are both 0..1 fractions.
 * @param {number} hitRate
 * @param {number} minHitRate
 */
export function exitCodeFor(hitRate, minHitRate) {
  return hitRate < minHitRate ? 1 : 0;
}

/**
 * Diffs this run's cases against a previous `--baseline` run's, matched by
 * fixture `id` (unique across the whole fixture set, tiers included). A
 * `notRun` case on either side is skipped — there is nothing to compare.
 * @param {{ id: string, hit: boolean, notRun?: boolean }[]} current
 * @param {{ id: string, hit: boolean, notRun?: boolean }[]} baseline
 */
export function diffBaseline(current, baseline) {
  const baseById = new Map(baseline.map((c) => [c.id, c]));
  const curIds = new Set(current.map((c) => c.id));
  const regressions = [];
  const improvements = [];
  const newCases = [];
  for (const cur of current) {
    const base = baseById.get(cur.id);
    if (!base) {
      newCases.push(cur.id);
      continue;
    }
    if (cur.notRun || base.notRun) continue;
    if (base.hit && !cur.hit) regressions.push(cur.id);
    else if (!base.hit && cur.hit) improvements.push(cur.id);
  }
  const missing = baseline.filter((b) => !curIds.has(b.id)).map((b) => b.id);
  return { regressions, improvements, newCases, missing };
}
