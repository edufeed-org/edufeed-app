#!/usr/bin/env node
/**
 * Termi knowledge-assistant eval: runs scripts/fixtures/termi-questions.json
 * (the eight sentences from the 2026-11-07 design doc + paraphrases) through
 * both answer paths and reports a hit rate.
 *
 *   node scripts/termi-eval-ask.js [--tier1|--tier2|--both]   (default: both)
 *
 * Tier 1 calls the server module `answerQuestion(text, locale)`
 * (src/lib/server/termi/answer.js, Task 3) directly — no network pacing
 * needed, but the module doesn't exist until Task 3 lands: until then this
 * prints a notice and skips tier 1 cleanly.
 *
 * Tier 2 posts to a running dev server (`TERMI_EVAL_BASE_URL`, default
 * http://localhost:5183) at `/api/termi/chat` with `{ task: 'ask', messages }`,
 * NIP-98 signed with a key from `TERMI_EVAL_NSEC` (an eligible test account;
 * never printed) and paced at most one request every 7s (SAIA budget). Task
 * 'ask' doesn't exist until Task 4 lands — until then the server answers
 * 400 unknown_task and every tier-2 case is reported as a miss, which is
 * expected and not a bug in this script.
 *
 * Never logs user text beyond the fixture's own (our test data, not a
 * live user's input).
 *
 * Fixture schema (scripts/fixtures/termi-questions.json): each entry is
 * `{ id, text, locale: 'de'|'en', expect: { types: string[], match?: string,
 * tools?: string[] }, variantOf?: string, mayBeUnavailable?: boolean }`.
 * `variantOf` points at the base sentence's `id` (a paraphrase). `expect`:
 * - `types` — OR: the top 3 items must contain at least one item whose
 *   type is in this list (not all of them).
 * - `match` — a regex source (matched case-insensitively) that at least
 *   one of the top-3 items' title/subtitle/description must satisfy, when given.
 * - `tools` — tier 2 only, ignored for tier 1. AND across array elements
 *   (every element must be satisfied); `|` inside one element is OR
 *   between tool names, e.g. `["search_content|search_resources"]` means
 *   "either tool", while `["search_content", "find_people"]` means "both".
 * - `mayBeUnavailable` — a source may legitimately be unreachable (e.g.
 *   the calendar relay); when set and the run reports the source as
 *   unavailable, the case counts as a hit regardless of `types`/`match`.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { nip19 } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { createNIP98AuthHeader } from '../src/lib/helpers/nip98.js';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/termi-questions.json', import.meta.url), 'utf-8')
);

const args = new Set(process.argv.slice(2));
const runTier1 = !args.has('--tier2');
const runTier2 = !args.has('--tier1');

/** Tool name a bare item (no explicit `type`) is assumed to come from. */
const DEFAULT_TYPE_BY_TOOL = {
  find_community: 'community',
  find_people: 'person',
  search_events: 'event',
  search_passages: 'passage'
};

/**
 * Pulls the first array of result-like objects out of a tool/answer output,
 * whatever key it's filed under — the exact Task 3/4 response shape isn't
 * fixed yet, so this stays shape-tolerant on purpose.
 * @param {any} output
 * @returns {any[]}
 */
function itemsOf(output) {
  if (Array.isArray(output)) return output;
  if (!output || typeof output !== 'object') return [];
  for (const key of ['items', 'hits', 'resources', 'communities', 'people', 'events', 'passages']) {
    if (Array.isArray(output[key])) return output[key];
  }
  return [];
}

/**
 * @param {any[]} rawItems
 * @param {string} [toolName]
 * @returns {{ type: string, label: string, text: string }[]}
 */
function normalizeItems(rawItems, toolName) {
  return rawItems.map((r) => ({
    type: r?.type || DEFAULT_TYPE_BY_TOOL[toolName ?? ''] || 'resource',
    label: r?.title ?? r?.name ?? r?.heading ?? '',
    // `match` also sees subtitle + description: a passage's text lives in description
    text: [r?.title ?? r?.name, r?.subtitle ?? r?.heading, r?.description]
      .filter(Boolean)
      .join(' | ')
  }));
}

/**
 * @param {{ type: string, label: string, text: string }[]} top3
 * @param {{ types: string[], match?: string }} expect
 */
function matchesExpect(top3, expect) {
  const typeHit = top3.some((i) => expect.types.includes(i.type));
  const matchHit = !expect.match || top3.some((i) => new RegExp(expect.match, 'i').test(i.text));
  return typeHit && matchHit;
}

/**
 * AND across `expectTools` elements, OR between `|`-separated tool names
 * within one element — see the fixture schema note in the file header.
 * @param {string[]} toolsUsed
 * @param {string[]} [expectTools]
 */
function toolsHit(toolsUsed, expectTools) {
  if (!expectTools || expectTools.length === 0) return true;
  return expectTools.every((group) => group.split('|').some((t) => toolsUsed.includes(t)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} label
 * @param {{ fixture: any, items: {type:string,label:string,text:string}[], toolsUsed: string[], unavailable: boolean, ms: number, sourcesUnavailable?: string[] }} r
 * @param {{ requireTools?: boolean }} [opts] tier 2 also checks `expect.tools`; tier 1 has no tool concept.
 */
function printCase(label, r, { requireTools = false } = {}) {
  const { fixture, items, toolsUsed, unavailable, ms, sourcesUnavailable = [] } = r;
  const top3 = items.slice(0, 3);
  const hit =
    unavailable ||
    (matchesExpect(top3, fixture.expect) &&
      (!requireTools || toolsHit(toolsUsed, fixture.expect.tools)));
  console.log(`[${label}] ${fixture.id} "${fixture.text}"`);
  console.log(
    `  top3: ${top3.map((i) => `${i.type}: ${i.label}`).join(' | ') || '(none)'}${
      toolsUsed.length ? `  tools: ${toolsUsed.join(', ')}` : ''
    }`
  );
  console.log(
    `  hit: ${hit ? 'yes' : 'no'}${unavailable ? ' (source unavailable, accepted)' : ''}  ms: ${ms}${
      sourcesUnavailable.length ? `  sourcesUnavailable: ${sourcesUnavailable.join(', ')}` : ''
    }`
  );
  return hit;
}

async function runTier1Eval() {
  let answerQuestion;
  try {
    ({ answerQuestion } = await import('../src/lib/server/termi/answer.js'));
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.log('answerQuestion not available yet');
      return;
    }
    throw err;
  }

  let hits = 0;
  for (const fixture of fixtures) {
    const start = Date.now();
    const result = await answerQuestion(fixture.text, fixture.locale);
    const ms = Date.now() - start;
    const items = normalizeItems(Array.isArray(result) ? result : (result?.items ?? []));
    const unavailable = Boolean(fixture.mayBeUnavailable && result?.sourcesUnavailable?.length);
    const sourcesUnavailable = result?.sourcesUnavailable ?? [];
    if (printCase('tier1', { fixture, items, toolsUsed: [], unavailable, ms, sourcesUnavailable }))
      hits++;
  }
  console.log(`\n=== tier1 summary ===`);
  console.log(
    `hit rate: ${((hits / fixtures.length) * 100).toFixed(1)}% (${fixtures.length} fixtures)`
  );
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
    return;
  }
  const { type, data } = nip19.decode(rawKey);
  if (type !== 'nsec') throw new Error('TERMI_EVAL_NSEC is not an nsec');
  const sk = data;
  console.log(`\ntier 2 signing as pubkey: ${getPublicKey(sk)}`);

  const baseUrl = process.env.TERMI_EVAL_BASE_URL || 'http://localhost:5183';
  const chatUrl = `${baseUrl}/api/termi/chat`;

  let hits = 0;
  let first = true;
  for (const fixture of fixtures) {
    if (!first) await sleep(7000);
    first = false;

    const messages = [
      { id: `m-${fixture.id}`, role: 'user', parts: [{ type: 'text', text: fixture.text }] }
    ];
    const body = JSON.stringify({ task: 'ask', messages });
    const Authorization = await createNIP98AuthHeader(chatUrl, 'POST', body, (draft) =>
      finalizeEvent(draft, sk)
    );

    const start = Date.now();
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { Authorization, 'Content-Type': 'application/json' },
      body
    });
    const ms = Date.now() - start;

    if (!res.ok) {
      console.log(`[tier2] ${fixture.id} "${fixture.text}"`);
      console.log(`  request failed: ${res.status}  ms: ${ms}`);
      continue;
    }

    const chunks = parseSseChunks(await res.text());
    /** @type {Map<string,string>} */
    const toolNameByCallId = new Map();
    for (const c of chunks) {
      if (c.type === 'tool-input-start' || c.type === 'tool-input-available') {
        toolNameByCallId.set(c.toolCallId, c.toolName);
      }
    }
    const toolsUsed = [...new Set(toolNameByCallId.values())];
    const items = chunks
      .filter((c) => c.type === 'tool-output-available')
      .flatMap((c) => normalizeItems(itemsOf(c.output), toolNameByCallId.get(c.toolCallId)));
    const unavailable = Boolean(
      fixture.mayBeUnavailable && chunks.some((c) => c.type === 'tool-output-error')
    );

    if (
      printCase('tier2', { fixture, items, toolsUsed, unavailable, ms }, { requireTools: true })
    ) {
      hits++;
    }
  }
  console.log(`\n=== tier2 summary ===`);
  console.log(
    `hit rate: ${((hits / fixtures.length) * 100).toFixed(1)}% (${fixtures.length} fixtures)`
  );
}

if (runTier1) await runTier1Eval();
if (runTier2) await runTier2Eval();
