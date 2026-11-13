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
 * `expect.toolInput`: `{ tool: [param, ...] }` — each listed tool needs one
 * call whose input has every listed parameter non-empty. No recorded input
 * for the tool is a miss.
 * @param {{ tool: string, input?: any }[]} toolInputs
 * @param {Record<string, string[]>} [expectInput]
 */
export function toolInputHit(toolInputs, expectInput) {
  return Object.entries(expectInput ?? {}).every(([tool, params]) =>
    toolInputs.some(
      (c) =>
        c.tool === tool &&
        params.every((p) => {
          const v = c.input?.[p];
          return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
        })
    )
  );
}

/**
 * Shape check of every fixture's `expect.toolInput` (same style as the regex check).
 * @param {{ id: string, expect?: Record<string, any> }[]} fixtures
 * @returns {{ id: string, field: string, message: string }[]}
 */
export function validateFixtureToolInput(fixtures) {
  const errors = [];
  for (const f of fixtures) {
    const v = f.expect?.toolInput;
    if (v === undefined) continue;
    const ok =
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.values(v).every(
        (l) => Array.isArray(l) && l.length > 0 && l.every((n) => typeof n === 'string')
      );
    if (!ok) {
      errors.push({
        id: f.id,
        field: 'toolInput',
        message: 'must be { tool: [non-empty parameter names] }'
      });
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
  // a case another model answered (server fallback) says nothing about the model under test
  const fellBack = cases.filter((c) => !c.notRun && c.fellBack).length;
  const ran = cases.filter((c) => !c.notRun && !c.fellBack);
  const hits = ran.filter((c) => c.hit).length;
  return { ranCount: ran.length, hits, hitRate: ran.length > 0 ? hits / ran.length : 1, fellBack };
}

const MODEL_ID = /^(saia|anthropic):[\w.-]+$/;

/**
 * `--model <id>` / a fixture's `model`: a provider-prefixed id as the chat
 * route's body field `model` takes it (`saia:<id>` / `anthropic:<id>`).
 * Whether the server offers it is the server's call (400 `invalid_model`).
 * @param {string | undefined} value
 * @returns {string}
 */
export function parseModelFlag(value) {
  if (typeof value !== 'string' || !MODEL_ID.test(value)) {
    throw new Error(`--model needs saia:<id> or anthropic:<id>, got "${value ?? ''}"`);
  }
  return value;
}

/**
 * @param {{ id: string, model?: unknown }[]} fixtures
 * @returns {{ id: string, field: string, message: string }[]}
 */
export function validateFixtureModels(fixtures) {
  return fixtures
    .filter((f) => f.model !== undefined && !MODEL_ID.test(String(f.model)))
    .map((f) => ({ id: f.id, field: 'model', message: 'must be saia:<id> or anthropic:<id>' }));
}

/**
 * Who answered, from the UI-message-stream's `messageMetadata` (on `start`,
 * `message-metadata` and `finish` chunks; later chunks overwrite earlier
 * ones, like the client's merge). `fellBack`: another model than the one
 * asked for answered — `requested` when the run named one, else the
 * server's own `chosen`.
 * @param {any[]} chunks
 * @param {string} [requested]
 */
export function answeredBy(chunks, requested) {
  const meta = Object.assign(
    {},
    ...chunks.map((c) =>
      c?.messageMetadata && typeof c.messageMetadata === 'object' ? c.messageMetadata : {}
    )
  );
  const model = meta.model ?? null;
  const chosen = meta.chosen ?? null;
  const asked = requested ?? chosen;
  return {
    model,
    chosen,
    reason: meta.reason ?? null,
    fellBack: Boolean(model && asked && model !== asked)
  };
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
 * Sum of `steps` across ran cases, grouped by family (the id up to its first
 * `-`, e.g. `q20-b-nomem` → `q20`) — the tier 2 summary prints this per
 * family so a multi-turn family (the lesson `q20` group) can be checked
 * against its own step budget as a whole, not just case by case.
 * @param {{ id: string, steps?: number, notRun?: boolean }[]} cases
 * @returns {Map<string, number>}
 */
export function familyStepTotals(cases) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  for (const c of cases) {
    if (c.notRun || typeof c.steps !== 'number') continue;
    const family = c.id.split('-')[0];
    totals.set(family, (totals.get(family) ?? 0) + c.steps);
  }
  return totals;
}

/**
 * A `propose_options` output rendered as text: `"<question>: <label1>, <label2>, …"`
 * (empty when it has no options, e.g. a rejected/malformed call). The window
 * renders this as a card, not a sentence, but it IS the answer the teacher
 * sees — folded into the tier-2 answer text so a clarification made through
 * an option card (not only prose) still counts as an answer for
 * `answerMatch`/`clarifyOk`.
 * @param {{ question?: string, options?: { label?: string }[] } | null | undefined} output
 * @returns {string}
 */
export function optionsCardText(output) {
  const labels = (Array.isArray(output?.options) ? output.options : [])
    .map((o) => o?.label)
    .filter(Boolean);
  if (!labels.length) return '';
  return [output?.question, labels.join(', ')].filter(Boolean).join(': ');
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
