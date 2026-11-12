/**
 * Pure logic of the Termi Werkbank (full-screen workbench): parts read from the
 * turns, changed blocks, rail rows, drafts. Isomorphic — no Svelte or server imports.
 *
 * @typedef {{ key: string, kind: string, n?: number, title: string, text: string, prev?: string, turnId: string }} WerkbankPart
 */
import { lessonPartsOf, partKey, partsInOrder, PHASE_LABELS } from './lesson-state.js';
import { toolNameOf } from './tool-registry.js';
import { isDocumentAnswer } from '../components/assistant/document-export.js';

const HEADING = /^#[ \t]+(.+)$/m;

/** @typedef {{ id?: string, role: string, text: string, textStub?: boolean }} PartTurn */

/** A turn's parts (stub and user turns: none). @param {PartTurn} turn @param {string} task */
function partsIn(turn, task) {
  if (turn.role !== 'assistant' || turn.textStub) return [];
  /** @type {any[]} */
  const found = lessonPartsOf(turn.text).map((p) => ({ ...p, key: partKey(p) }));
  if (found.length || task !== 'ask' || !isDocumentAnswer(turn.text)) return found;
  const text = turn.text.trim();
  const title = (text.match(HEADING)?.[1] ?? text.split('\n')[0]).trim().slice(0, 120);
  return [{ key: 'document', kind: 'document', title, text }];
}

/**
 * Parts in first-appearance order; across turns the latest text wins, the one
 * before it is `prev`. Stub turns are skipped, pending ones read (being streamed).
 * @param {PartTurn[]} turns @param {'ask'|'lesson'|string} task
 * @returns {WerkbankPart[]}
 */
export function partsOf(turns, task) {
  /** @type {Map<string, WerkbankPart>} */
  const byKey = new Map();
  for (const turn of turns) {
    for (const p of partsIn(turn, task)) {
      const old = byKey.get(p.key);
      byKey.set(p.key, { ...p, turnId: String(turn.id), ...(old ? { prev: old.text } : {}) });
    }
  }
  return [...byKey.values()];
}

/**
 * Per turn id, the parts it wrote; `changed` when an earlier turn had the key.
 * @param {PartTurn[]} turns @param {string} task
 * @returns {Record<string, { key: string, title: string, changed: boolean }[]>}
 */
export function partLines(turns, task) {
  const seen = new Set();
  /** @type {Record<string, { key: string, title: string, changed: boolean }[]>} */
  const out = {};
  for (const turn of turns) {
    const lines = partsIn(turn, task).map((p) => {
      const changed = seen.has(p.key);
      seen.add(p.key);
      return { key: p.key, title: p.title, changed };
    });
    if (lines.length) out[String(turn.id)] = lines;
  }
  return out;
}

/**
 * Blank-line blocks; a Markdown table is split into its header+separator and one block per row.
 * @param {string} text @returns {string[]}
 */
export function blocksOf(text) {
  return String(text ?? '')
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .flatMap((b) => {
      const lines = b.split('\n');
      if (lines.length < 3 || !lines.every((l) => l.trimStart().startsWith('|'))) return [b];
      return [lines.slice(0, 2).join('\n'), ...lines.slice(2)];
    });
}

/** Indexes of `next`'s blocks that `prev` does not have. @param {string | undefined} prev @param {string} next */
export function changedBlocks(prev, next) {
  if (prev === undefined) return new Set();
  const old = new Set(blocksOf(prev));
  return new Set(blocksOf(next).flatMap((b, i) => (old.has(b) ? [] : [i])));
}

/** @param {any} state @returns {string[]} overview, then lesson-<n> per plan entry */
export const plannedKeys = (state) => [
  'overview',
  ...(Array.isArray(state?.plan) ? state.plan : []).map(
    (/** @type {any} */ e, /** @type {number} */ i) => `lesson-${e?.n ?? i + 1}`
  )
];

/**
 * @param {any} state @param {WerkbankPart[]} parts
 * @param {{ writingKey?: string, failedKey?: string | Set<string>, wraps?: Record<string, string>, locale?: string }} [opts]
 *   `wraps`: part key → id of the turn whose draftWraps holds it
 */
export function railRows(state, parts, { writingKey, failedKey, wraps = {}, locale = 'de' } = {}) {
  /** @param {string} key @param {WerkbankPart | undefined} part */
  const stateOf = (key, part) =>
    /** @type {'todo'|'writing'|'failed'|'changed'|'saved'} */ (
      key === writingKey
        ? 'writing'
        : (typeof failedKey === 'string' ? key === failedKey : failedKey?.has(key))
          ? 'failed'
          : !part
            ? 'todo'
            : wraps[key] === part.turnId
              ? 'saved'
              : 'changed'
    );
  // no lesson state (an ask document): no steps, the parts as they are
  if (!state)
    return {
      steps: [],
      parts: parts.map((p) => ({ key: p.key, title: p.title || p.key, state: stateOf(p.key, p) }))
    };
  const phase = state.phase ?? 1;
  const labels = locale === 'de' ? PHASE_LABELS.de : PHASE_LABELS.en;
  const steps = [1, 2, 3, 4].map((n) => ({
    n: /** @type {1|2|3|4} */ (n),
    label: labels[n - 1],
    state: /** @type {'done'|'current'|'todo'} */ (
      phase > n ? 'done' : phase === n ? 'current' : 'todo'
    )
  }));
  const ordered = partsInOrder(state, {}, parts);
  const titles = new Map(ordered.map((p) => [p.key, p.title]));
  const keys = [...new Set([...plannedKeys(state), ...ordered.map((p) => p.key)])];
  const rows = keys.map((key) => {
    const part = parts.find((p) => p.key === key);
    return { key, title: part?.title || titles.get(key) || key, state: stateOf(key, part) };
  });
  return { steps, parts: rows };
}

/** First planned key without a part, or null. @param {any} state @param {{ key: string }[]} parts */
export const nextPartKey = (state, parts) =>
  plannedKeys(state).find((k) => !parts.some((p) => p.key === k)) ?? null;

/** @param {any} conv @returns {any[]} stored assistant messages */
const assistantMessages = (conv) =>
  (conv?.messages ?? []).filter((/** @type {any} */ m) => m.role === 'assistant');

/** @param {any} conv stored conversation (messages use `content`) */
export const isDraft = (conv) =>
  !!conv?.lesson ||
  assistantMessages(conv).some(
    (m) =>
      (m.draftWraps && Object.keys(m.draftWraps).length > 0) ||
      ((conv.task ?? 'ask') === 'ask' && isDocumentAnswer(m.content))
  );

/** @typedef {{ title: string, kind: 'series'|'document', done: number, total: number, published: boolean }} DraftSummary */

/** @param {any} conv @returns {DraftSummary} */
export function draftSummary(conv) {
  // stored content writes `task` only for a lesson; an older ask record may carry a stray lesson state
  if (conv?.lesson && conv.task === 'lesson') {
    const done = partsInOrder(conv.lesson).filter((p) => p.wrap).length;
    const total = Math.max(plannedKeys(conv.lesson).length, partsInOrder(conv.lesson).length);
    return {
      title: conv.lesson.frame?.topic || conv.title || '',
      kind: 'series',
      done,
      total,
      published: !!conv.lesson.publication
    };
  }
  const docs = assistantMessages(conv).filter((m) => isDocumentAnswer(m.content));
  const heading = docs
    .map((m) => String(m.content).match(HEADING)?.[1])
    .filter(Boolean)
    .pop();
  const saved = assistantMessages(conv).some((m) => m.draftWraps?.document);
  return {
    title: (heading ?? conv?.title ?? '').trim(),
    kind: 'document',
    done: saved ? 1 : 0,
    total: 1,
    published: false
  };
}

/**
 * Competences this session offered that the plan does not hold yet: the outputs of
 * `curriculum_competences`, plus the options of a `propose_options` in the same message
 * (the model offers the found competences as a tick list; options of a message without a
 * curriculum lookup are Bundesland/method choices, not competences). Deduped by label.
 * @param {any[]} messages UI messages @param {{ label: string }[]} chosen
 * @returns {{ uri?: string, label: string, topic?: string }[]}
 */
export function foundCompetences(messages, chosen) {
  const seen = new Set((chosen ?? []).map((c) => c?.label));
  /** @type {{ uri?: string, label: string, topic?: string }[]} */
  const out = [];
  /** @param {{ uri?: string, label?: unknown, topic?: string }} c */
  const add = (c) => {
    if (typeof c?.label !== 'string' || !c.label.trim() || seen.has(c.label)) return;
    seen.add(c.label);
    out.push({
      ...(c.uri ? { uri: c.uri } : {}),
      label: c.label,
      ...(c.topic ? { topic: c.topic } : {})
    });
  };
  for (const msg of messages ?? []) {
    const done = /** @type {any[]} */ (msg?.parts ?? []).filter(
      (p) => p?.state === 'output-available'
    );
    const looked = done.filter((p) => toolNameOf(p) === 'curriculum_competences');
    if (!looked.length) continue;
    for (const p of looked) for (const c of p.output?.competences ?? []) add(c);
    for (const p of done.filter((p) => toolNameOf(p) === 'propose_options'))
      for (const o of p.output?.options ?? []) add({ label: o?.label });
  }
  return out;
}

/**
 * Writes the planned parts one after another: `write(key)` sends one turn and resolves
 * when its answer is finished; messages queued meanwhile go out between two parts.
 * A part that still is `next()` after its write — or a throwing write (refused, account
 * or conversation changed) — stops the run as `failed`; `pause()` lets the part in progress finish.
 * @param {{ next: () => string | null, write: (key: string) => Promise<void>, sendQueued: (text: string) => Promise<void>, onState: (s: { writing?: string, failed?: string, paused?: true, done?: true }) => void }} opts
 */
export function createRun({ next, write, sendQueued, onState }) {
  /** @type {string[]} */
  const queued = [];
  const state = { running: false, paused: false };
  /** @param {{ failed?: string, paused?: true, done?: true }} s */
  const end = (s) => {
    state.running = false;
    onState(s);
  };
  async function start() {
    if (state.running) return;
    state.running = true;
    state.paused = false;
    /** @type {string | null} */
    let key;
    while (!state.paused && (key = next())) {
      onState({ writing: key });
      try {
        await write(key);
        if (next() === key) return end({ failed: key });
        while (queued.length) await sendQueued(/** @type {string} */ (queued.shift()));
      } catch {
        return end({ failed: key });
      }
    }
    end(state.paused ? { paused: true } : { done: true });
  }
  return {
    start,
    pause: () => void (state.paused = true),
    /** @param {string} text */
    queue: (text) => void queued.push(text),
    state
  };
}

const CURRICULUM_TOOLS = new Set([
  'find_curriculum',
  'search_curriculum',
  'curriculum_competences'
]);
const MATERIAL_TOOLS = new Set(['search_resources', 'search_passages', 'search_content']);

/**
 * What a running tool call is doing, for the chat's activity line; null when it is
 * finished or not a search.
 * @param {any} toolPart @param {{ curriculum: (q: string) => string, material: (q: string) => string }} say
 */
export function activityOf(toolPart, say) {
  if (toolPart?.state !== 'input-streaming' && toolPart?.state !== 'input-available') return null;
  const name = toolNameOf(toolPart);
  const input = toolPart.input ?? {};
  if (CURRICULUM_TOOLS.has(name)) return say.curriculum(String(input.query ?? input.subject ?? ''));
  if (MATERIAL_TOOLS.has(name)) return say.material(String(input.query ?? input.question ?? ''));
  return null;
}
