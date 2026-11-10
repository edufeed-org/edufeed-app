#!/usr/bin/env node
/**
 * Termi knowledge-assistant eval v2: runs scripts/fixtures/termi-questions.json
 * (the eight sentences from the 2026-11-07 design doc + paraphrases, plus the
 * tier2Only UX cases) through both answer paths and reports a hit rate — a
 * real regression gate (audit B17): JSON results, a baseline diff, a
 * non-zero exit below `--min-hit-rate`, a 429 counted as not-run rather than
 * a miss, and the stream's `error` chunks recorded instead of ignored.
 *
 *   node scripts/termi-eval-ask.js [--tier1|--tier2|--both]
 *     [--base <url>] [--out <file>] [--baseline <file>]
 *     [--min-hit-rate <0..1>] [--strict] [--help|-h]
 *
 * `--help`/`-h` prints usage and exits 0; an unrecognized flag prints usage
 * and exits 2 — neither runs the eval. Every fixture's `match`/`notMatch`/
 * `answerMatch`/`answerNotMatch` regex is also compiled up front: a bad
 * pattern exits 2 naming the fixture id and field instead of crashing
 * mid-run (and losing every case after it).
 *
 * Tier 1 calls the server module `answerQuestion(text, locale, tools)`
 * (src/lib/server/termi/answer.js) directly, with a one-off knowledge-tools
 * client built from process.env (no SvelteKit env, no app token) — no
 * network pacing needed there.
 *
 * Tier 2 posts to a running dev server (`--base`/`TERMI_EVAL_BASE_URL`,
 * default http://localhost:5183) at `/api/termi/chat` with
 * `{ task: 'ask', messages }`, NIP-98 signed with a key from
 * `TERMI_EVAL_NSEC` (an eligible test account; never printed) and paced at
 * most one request every 7s (SAIA budget). Skipped entirely when
 * `TERMI_EVAL_NSEC` is unset.
 *
 * Never logs user text beyond the fixture's own (our test data, not a
 * live user's input).
 *
 * Flags:
 * - `--tier1` / `--tier2` run one tier only; default (neither flag, or
 *   `--both`) runs both.
 * - `--base <url>` — tier 2's dev server. Recorded in the output's `base`
 *   field regardless of which tier ran; tier 1 never contacts it (it calls
 *   `answerQuestion` in-process).
 * - `--out <file>` — writes `{ ranAt, base, tier, hitRate, cases }` as JSON.
 *   Each `cases[]` entry is `{ id, tier, hit, notRun, ms, tools,
 *   sourcesUnavailable, top, steps?, errors?, budget?, reason? }`:
 *     - `steps` (tier 2 only) = the number of distinct assistant tool-call
 *       parts in the stream, plus 1 for the model's own final generation
 *       step (present even when it never calls a tool).
 *     - `errors` collects the UI-message-stream's `error` chunks'
 *       `errorText` (what the client would render as `termi:upstream`) —
 *       previously silently dropped.
 *     - `budget` lists which of the fixture's `maxSteps`/`maxMs` this case
 *       exceeded, when any (see `--strict` below).
 *     - `reason` is set alongside `notRun: true` (`busy`, `quota` or
 *       `requires` — a `--assume` mismatch).
 * - `--baseline <file>` — diffs this run's `cases` against a previous run's
 *   output (matched by fixture `id`); prints regressions first, then
 *   improvements, new and missing fixtures. Diagnostic only — never changes
 *   the exit code.
 * - `--min-hit-rate <0..1>` — exit 1 when the hit rate (over cases that
 *   actually ran — see "429 as not-run" below) is below this. Default 0,
 *   i.e. never fails: the previous always-exit-0 behaviour stays the
 *   default, a real gate is opt-in via this flag (e.g. in CI).
 * - `--strict` — a case whose fixture sets `maxSteps`/`maxMs` and exceeds it
 *   stops counting as a hit (default: reported in `budget` but still a
 *   hit).
 * - `--only <id,id,...>` — run just these fixture ids (editing fixtures;
 *   an unknown id exits 2). The baseline diff then lists the rest as missing.
 * - `--assume <requires>` — a fixture's `requires` (e.g. a dev server started
 *   with `MEM_MCP_URL=none`) is satisfied only by an exact string match
 *   against this flag; otherwise that fixture is skipped (`notRun`, reason
 *   `requires`) with a console note instead of being sent.
 *
 * Tier 2 records also carry `answer` (the first 400 chars of what the model
 * wrote), `toolInputs` (what it asked each tool — a relative date shows up
 * resolved as `from`/`to` here) and `clarified: true` when the hit came
 * from `expect.clarifyOk` (below).
 *
 * 429 as not-run: a tier 2 request answered 429 (`{error:'busy'}` — another
 * chat in flight for the same pubkey — or `{error:'quota', scope}` — the
 * per-pubkey/global SAIA budget is spent) means the harness got throttled,
 * not that the assistant gave a wrong answer. It is recorded
 * `{ notRun: true, reason }`, excluded from both the numerator and the
 * denominator of the hit rate, and reported separately in the console
 * summary — never counted as a miss.
 *
 * Fixture schema (scripts/fixtures/termi-questions.json): each entry is
 * `{ id, text, locale: 'de'|'en', expect: { types?: string[], match?: string,
 * notMatch?: string, answerMatch?: string, answerNotMatch?: string,
 * tools?: string[], clarifyOk?: boolean, noTools?: boolean }, variantOf?: string,
 * mayBeUnavailable?: boolean, tier2Only?: boolean, maxSteps?: number,
 * maxMs?: number, history?: { role: 'user'|'assistant', text: string }[],
 * task?: 'ask'|'lesson', lesson?: object, requires?: string }`.
 * `tier2Only` (e.g. the show_pages case) skips tier 1, which has no concept
 * of a page answer. `variantOf` points at the base sentence's `id` (a
 * paraphrase). `history` (tier2Only) is sent before `text` as earlier turns
 * of the same conversation, so a follow-up ("und in der Woche danach?") is
 * asked in context. `clarifyOk`: a tier-2 answer that calls no tool and asks
 * back counts as a hit (an underspecified request). `noTools`: tier 2 must
 * not call any tool (an off-topic question, an import request without a
 * file). `match` is checked against the top-3 cards and, on tier 2, the
 * answer text as well. `task` (default `'ask'`) picks the tier-2 request's
 * `task`; `lesson` (only meaningful with `task: 'lesson'`) is sent as the
 * body's `lesson` phase state — the q20 lesson family uses both. `requires`
 * names a dev-server precondition the harness cannot set up itself (e.g.
 * `MEM_MCP_URL=none`): the fixture is skipped unless `--assume` names the
 * same string.
 * `expect`:
 * - `types` — OR: the top 3 items must contain at least one item whose
 *   type is in this list (not all of them).
 * - `match` / `notMatch` — a regex source (matched case-insensitively)
 *   against the top-3 items' title/subtitle/description text; for a
 *   `tier2Only` fixture (no item concept) against the raw tool-output JSON
 *   instead.
 * - `answerMatch` / `answerNotMatch` — a regex source against the model's
 *   generated answer text only (tier 2; e.g. `^# ` for "answers with a
 *   document"). Tier 1 never generates prose, so these only make sense on
 *   `tier2Only` fixtures.
 * - `tools` — tier 2 only, ignored for tier 1. AND across array elements
 *   (every element must be satisfied); `|` inside one element is OR
 *   between tool names, e.g. `["search_content|search_resources"]` means
 *   "either tool", while `["search_content", "find_people"]` means "both".
 * - `mayBeUnavailable` — a source may legitimately be unreachable (e.g.
 *   the calendar relay); when set and the run reports the source as
 *   unavailable, the case counts as a hit regardless of `types`/`match`.
 * - `maxSteps` / `maxMs` — optional per-case budgets; see `--strict` above.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { nip19 } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { createNIP98AuthHeader } from '../src/lib/helpers/nip98.js';
import { answerQuestion } from '../src/lib/server/termi/answer.js';
import { callNopeMcpTool } from '../src/lib/server/nopeMcpClient.js';
import { nopeMcpEnv } from '../src/lib/server/nopeMcpEnv.js';
import {
  createKnowledgeTools,
  nopeMcpCaller,
  parseSearchRelays
} from '../src/lib/server/termi/knowledge-tools.js';
import {
  matchesExpect,
  toolsHit,
  isClarification,
  checkBudget,
  aggregateHitRate,
  exitCodeFor,
  diffBaseline,
  validateFixtureRegexes,
  familyStepTotals
} from './lib/termi-eval-core.js';

const allFixtures = JSON.parse(
  readFileSync(new URL('./fixtures/termi-questions.json', import.meta.url), 'utf-8')
);

const USAGE = `Usage: node scripts/termi-eval-ask.js [--tier1|--tier2|--both]
  [--base <url>] [--out <file>] [--baseline <file>]
  [--min-hit-rate <0..1>] [--strict] [--only <id,id,...>] [--assume <requires>]

Runs scripts/fixtures/termi-questions.json through the Termi knowledge
assistant and reports a hit rate. Tier 1 calls answerQuestion in-process;
tier 2 POSTs to <base>/api/termi/chat (requires TERMI_EVAL_NSEC, skipped
otherwise). See the file header comment for full flag documentation.`;

/** This script's own knowledge tools: no SvelteKit env, no app token. */
function toolsFromProcessEnv() {
  const mcpUrl = nopeMcpEnv(process.env, 'URL');
  if (!mcpUrl) throw new Error('NOPE_MCP_URL / AMB_MCP_URL not set');
  const getToken = () => Promise.reject(new Error('no nope-mcp token outside the app'));
  return createKnowledgeTools({
    callTool: nopeMcpCaller({ mcpUrl, getToken, callTool: callNopeMcpTool }),
    relays: parseSearchRelays(process.env.TERMI_SEARCH_RELAYS)
  });
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const opts = {
    tier1: true,
    tier2: true,
    base: process.env.TERMI_EVAL_BASE_URL || 'http://localhost:5183',
    out: undefined,
    baseline: undefined,
    minHitRate: 0,
    strict: false,
    /** @type {string[] | undefined} */
    only: undefined,
    /** @type {string | undefined} */
    assume: undefined
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--tier1') opts.tier2 = false;
    else if (a === '--tier2') opts.tier1 = false;
    else if (a === '--both') {
      opts.tier1 = true;
      opts.tier2 = true;
    } else if (a === '--out') opts.out = argv[++i];
    else if (a === '--baseline') opts.baseline = argv[++i];
    else if (a === '--min-hit-rate') opts.minHitRate = Number(argv[++i]);
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--strict') opts.strict = true;
    else if (a === '--only')
      opts.only = String(argv[++i] ?? '')
        .split(',')
        .filter(Boolean);
    else if (a === '--assume') opts.assume = argv[++i];
    else {
      console.error(`Unknown flag: ${a}\n`);
      console.error(USAGE);
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
// --only: a handful of cases while editing fixtures (the baseline diff then lists the rest as missing)
const fixtures = opts.only
  ? allFixtures.filter((/** @type {{ id: string }} */ f) => opts.only?.includes(f.id))
  : allFixtures;
if (opts.only && fixtures.length !== opts.only.length) {
  const known = new Set(fixtures.map((/** @type {{ id: string }} */ f) => f.id));
  console.error(
    `--only: unknown fixture id(s): ${opts.only.filter((id) => !known.has(id)).join(', ')}`
  );
  process.exit(2);
}

const regexErrors = validateFixtureRegexes(fixtures);
if (regexErrors.length) {
  for (const e of regexErrors) {
    console.error(`bad regex in fixture "${e.id}", field "${e.field}": ${e.message}`);
  }
  process.exit(2);
}

/**
 * Items are normalised server-side (src/lib/server/termi/items.js) and
 * always carry a `type` — no shape-guessing needed any more.
 * @param {any[]} rawItems
 * @returns {{ type: string, label: string, text: string }[]}
 */
function normalizeItems(rawItems) {
  return rawItems.map((r) => ({
    type: r?.type || 'resource',
    label: r?.title ?? r?.name ?? r?.heading ?? '',
    // `match` also sees subtitle + description: a passage's text lives in description
    text: [r?.title ?? r?.name, r?.subtitle ?? r?.heading, r?.description]
      .filter(Boolean)
      .join(' | ')
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds one fixture's case record for the JSON output, and prints its
 * console line.
 * @param {'tier1'|'tier2'} tier
 * @param {any} fixture
 * @param {{ items?: {type:string,label:string,text:string}[], toolsUsed?: string[],
 *   unavailable?: boolean, ms: number, sourcesUnavailable?: string[], rawText?: string,
 *   answerText?: string, steps?: number, errors?: string[], notRun?: boolean, reason?: string,
 *   requestFailed?: boolean }} data
 */
function recordCase(tier, fixture, data) {
  const { ms, notRun = false, reason, requestFailed = false, errors: failureErrors = [] } = data;
  if (notRun) {
    console.log(`[${tier}] ${fixture.id} "${fixture.text}"`);
    console.log(`  not run (${reason})  ms: ${ms}`);
    return {
      id: fixture.id,
      tier,
      hit: false,
      notRun: true,
      reason,
      ms,
      tools: [],
      sourcesUnavailable: [],
      top: []
    };
  }
  if (requestFailed) {
    console.log(`[${tier}] ${fixture.id} "${fixture.text}"`);
    console.log(
      `  request failed  ms: ${ms}${failureErrors.length ? `  errors: ${failureErrors.join(' | ')}` : ''}`
    );
    return {
      id: fixture.id,
      tier,
      hit: false,
      notRun: false,
      ms,
      tools: [],
      sourcesUnavailable: [],
      top: [],
      errors: failureErrors
    };
  }

  const {
    items = [],
    toolsUsed = [],
    unavailable = false,
    sourcesUnavailable = [],
    rawText = '',
    answerText = '',
    steps,
    errors = [],
    toolInputs = []
  } = data;
  const top3 = items.slice(0, 3);
  const clarified =
    tier === 'tier2' && Boolean(fixture.expect.clarifyOk) && isClarification(answerText, toolsUsed);
  const expectHit =
    unavailable ||
    clarified ||
    (matchesExpect(top3, fixture.expect, {
      rawText,
      answerText,
      tier2Only: Boolean(fixture.tier2Only)
    }) &&
      (tier !== 'tier2' ||
        (toolsHit(toolsUsed, fixture.expect.tools) &&
          // `noTools`: an off-topic or file-less request must not search
          (!fixture.expect.noTools || toolsUsed.length === 0))));
  const budget = checkBudget(fixture, { steps, ms });
  const hit = opts.strict && budget.length > 0 ? false : expectHit;
  const top = top3.map((i) => `${i.type}: ${i.label}`);

  console.log(`[${tier}] ${fixture.id} "${fixture.text}"`);
  console.log(
    `  top: ${top.join(' | ') || '(none)'}${toolsUsed.length ? `  tools: ${toolsUsed.join(', ')}` : ''}`
  );
  console.log(
    `  hit: ${hit ? 'yes' : 'no'}${unavailable ? ' (source unavailable, accepted)' : ''}  ms: ${ms}` +
      `${sourcesUnavailable.length ? `  sourcesUnavailable: ${sourcesUnavailable.join(', ')}` : ''}` +
      `${budget.length ? `  budget exceeded: ${budget.join(', ')}` : ''}`
  );
  if (errors.length) console.log(`  errors: ${errors.join(' | ')}`);

  /** @type {any} */
  const rec = {
    id: fixture.id,
    tier,
    hit,
    notRun: false,
    ms,
    tools: toolsUsed,
    sourcesUnavailable,
    top
  };
  if (steps !== undefined) rec.steps = steps;
  if (errors.length) rec.errors = errors;
  if (budget.length) rec.budget = budget;
  // a miss is diagnosed from what the model said, not only from its cards
  if (answerText) rec.answer = answerText.slice(0, 400);
  if (toolInputs.length) rec.toolInputs = toolInputs;
  if (clarified) rec.clarified = true;
  return rec;
}

async function runTier1Eval() {
  const tools = toolsFromProcessEnv();
  const applicable = fixtures.filter((f) => !f.tier2Only);
  const cases = [];
  for (const fixture of applicable) {
    const start = Date.now();
    const result = await answerQuestion(fixture.text, fixture.locale, tools);
    const ms = Date.now() - start;
    const items = normalizeItems(result?.items ?? []);
    const sourcesUnavailable = result?.sourcesUnavailable ?? [];
    const unavailable = Boolean(fixture.mayBeUnavailable && sourcesUnavailable.length);
    cases.push(recordCase('tier1', fixture, { items, ms, sourcesUnavailable, unavailable }));
  }
  const { hitRate, ranCount } = aggregateHitRate(cases);
  console.log(`\n=== tier1 summary ===`);
  console.log(
    `hit rate: ${(hitRate * 100).toFixed(1)}% (${ranCount}/${applicable.length} fixtures)`
  );
  return cases;
}

/** Raw UI-message-stream SSE text → chunk objects (ai `JsonToSseTransformStream` wire format). */
function parseSseChunks(text) {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => block.slice('data: '.length))
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data));
}

async function runTier2Eval() {
  const rawKey = process.env.TERMI_EVAL_NSEC;
  if (!rawKey) {
    console.log('\ntier 2 skipped (TERMI_EVAL_NSEC not set)');
    return [];
  }
  const { type, data } = nip19.decode(rawKey);
  if (type !== 'nsec') throw new Error('TERMI_EVAL_NSEC is not an nsec');
  const sk = data;
  console.log(`\ntier 2 signing as pubkey: ${getPublicKey(sk)}`);

  const chatUrl = `${opts.base}/api/termi/chat`;
  const cases = [];
  let first = true;
  for (const fixture of fixtures) {
    // `requires`: a dev-server precondition this harness cannot set up
    // itself (e.g. MEM_MCP_URL=none) — skipped, never sent, unless the
    // operator confirms it with --assume.
    if (fixture.requires && fixture.requires !== opts.assume) {
      cases.push(recordCase('tier2', fixture, { ms: 0, notRun: true, reason: 'requires' }));
      console.log(
        `  pass --assume "${fixture.requires}" once a server meeting that precondition is running`
      );
      continue;
    }

    if (!first) await sleep(7000);
    first = false;

    // `history`: earlier turns of the same conversation, given as text (a
    // follow-up like "und in der Woche danach?" only makes sense after them)
    const messages = [
      ...(fixture.history ?? []).map((/** @type {{ role: string, text: string }} */ h, i) => ({
        id: `m-${fixture.id}-h${i}`,
        role: h.role,
        parts: [{ type: 'text', text: h.text }]
      })),
      { id: `m-${fixture.id}`, role: 'user', parts: [{ type: 'text', text: fixture.text }] }
    ];
    const body = JSON.stringify({
      task: fixture.task ?? 'ask',
      messages,
      today: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date()),
      tz: 'Europe/Berlin',
      ...(fixture.lesson ? { lesson: fixture.lesson } : {})
    });
    const Authorization = await createNIP98AuthHeader(chatUrl, 'POST', body, (draft) =>
      finalizeEvent(draft, sk)
    );

    const start = Date.now();
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { Authorization, 'Content-Type': 'application/json' },
      body
    });
    let ms = Date.now() - start;

    if (res.status === 429) {
      let reason = 'busy';
      try {
        const errBody = await res.json();
        if (errBody?.error === 'quota') reason = errBody.scope ? `quota:${errBody.scope}` : 'quota';
      } catch {
        /* keep the default reason */
      }
      cases.push(recordCase('tier2', fixture, { ms, notRun: true, reason }));
      continue;
    }
    if (!res.ok) {
      cases.push(
        recordCase('tier2', fixture, { ms, requestFailed: true, errors: [`http_${res.status}`] })
      );
      continue;
    }

    const text = await res.text();
    // the whole stream, not the headers: tier 2's time is the model's time
    ms = Date.now() - start;
    const chunks = parseSseChunks(text);
    /** @type {Map<string,string>} */
    const toolNameByCallId = new Map();
    for (const c of chunks) {
      if (c.type === 'tool-input-start' || c.type === 'tool-input-available') {
        toolNameByCallId.set(c.toolCallId, c.toolName);
      }
    }
    const toolsUsed = [...new Set(toolNameByCallId.values())];
    // what the model asked each tool (a relative date resolves into `from`/`to` here)
    const toolInputs = chunks
      .filter((c) => c.type === 'tool-input-available')
      .map((c) => ({ tool: c.toolName, input: c.input }));
    const outputChunks = chunks.filter((c) => c.type === 'tool-output-available');
    const items = outputChunks.flatMap((c) =>
      normalizeItems(Array.isArray(c.output?.items) ? c.output.items : [])
    );
    const rawText = JSON.stringify(outputChunks.map((c) => c.output));
    // one text part per step: joined as paragraphs, like the app's textOf —
    // glued together, "…Belege.# Titel" would hide a heading from answerMatch
    /** @type {Map<string, string>} */
    const textParts = new Map();
    for (const c of chunks) {
      if (c.type === 'text-delta') textParts.set(c.id, (textParts.get(c.id) ?? '') + c.delta);
    }
    const answerText = [...textParts.values()]
      .map((t) => t.trim())
      .filter(Boolean)
      .join('\n\n');
    const outputErrorChunks = chunks.filter((c) => c.type === 'tool-output-error');
    const sourcesUnavailable = [
      ...new Set([
        ...outputChunks.flatMap((c) =>
          Array.isArray(c.output?.sourcesUnavailable) ? c.output.sourcesUnavailable : []
        ),
        // a whole tool call that failed (not a partial-relay sourcesUnavailable) is
        // "unavailable" in the same sense, named by the tool it would have called.
        ...outputErrorChunks.map((c) => toolNameByCallId.get(c.toolCallId)).filter(Boolean)
      ])
    ];
    const errors = chunks
      .filter((c) => c.type === 'error')
      .map((c) => c.errorText)
      .filter(Boolean);
    const unavailable = Boolean(fixture.mayBeUnavailable && sourcesUnavailable.length);
    // Each step is one model call: one per distinct tool call it made, plus
    // its own final generation step (present even with zero tool calls).
    const steps = toolNameByCallId.size + 1;

    cases.push(
      recordCase('tier2', fixture, {
        items,
        toolsUsed,
        unavailable,
        ms,
        sourcesUnavailable,
        rawText,
        answerText,
        steps,
        errors,
        toolInputs
      })
    );
  }
  const { hitRate, ranCount } = aggregateHitRate(cases);
  console.log(`\n=== tier2 summary ===`);
  console.log(`hit rate: ${(hitRate * 100).toFixed(1)}% (${ranCount}/${fixtures.length} fixtures)`);
  // A multi-turn family (the lesson q20 group) has its own step budget as a
  // whole, not just per case — print the family totals alongside the hit rate.
  for (const [family, total] of familyStepTotals(cases)) {
    console.log(`  family ${family}: ${total} steps total`);
  }
  return cases;
}

const allCases = [];
if (opts.tier1) allCases.push(...(await runTier1Eval()));
if (opts.tier2) allCases.push(...(await runTier2Eval()));

const { hitRate } = aggregateHitRate(allCases);
const tierLabel = opts.tier1 && opts.tier2 ? 'both' : opts.tier1 ? 'tier1' : 'tier2';

if (opts.out) {
  const output = {
    ranAt: new Date().toISOString(),
    base: opts.base,
    tier: tierLabel,
    hitRate,
    cases: allCases
  };
  writeFileSync(opts.out, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nwrote ${allCases.length} cases to ${opts.out}`);
}

if (opts.baseline) {
  const baselineData = JSON.parse(readFileSync(opts.baseline, 'utf-8'));
  const { regressions, improvements, newCases, missing } = diffBaseline(
    allCases,
    baselineData.cases ?? []
  );
  console.log(`\n=== baseline diff (${opts.baseline}) ===`);
  if (regressions.length) console.log(`regressions: ${regressions.join(', ')}`);
  if (improvements.length) console.log(`improvements: ${improvements.join(', ')}`);
  if (newCases.length) console.log(`new cases: ${newCases.join(', ')}`);
  if (missing.length) console.log(`missing from this run: ${missing.join(', ')}`);
  if (!regressions.length && !improvements.length && !newCases.length && !missing.length) {
    console.log('no changes');
  }
}

console.log(`\noverall hit rate: ${(hitRate * 100).toFixed(1)}%`);
if (exitCodeFor(hitRate, opts.minHitRate) !== 0) {
  console.error(
    `hit rate ${(hitRate * 100).toFixed(1)}% is below --min-hit-rate ${(opts.minHitRate * 100).toFixed(1)}%`
  );
  process.exit(1);
}
