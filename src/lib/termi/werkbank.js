/**
 * Pure logic of the Termi Werkbank (full-screen workbench): parts read from the
 * turns, changed blocks, rail rows, drafts. Isomorphic — no Svelte or server imports.
 *
 * @typedef {{ key: string, kind: string, n?: number, title: string, text: string, prev?: string, turnId: string }} WerkbankPart
 */
import { lessonPartsOf, partKey, partsInOrder } from './lesson-state.js';
import { toolNameOf } from './tool-registry.js';
import { fromDocumentStart, isDocumentAnswer } from '../components/assistant/document-export.js';

const HEADING = /^#[ \t]+(.+)$/m;

/** @typedef {{ id?: string, role: string, text: string, textStub?: boolean }} PartTurn */

/** A turn's parts (stub and user turns: none). @param {PartTurn} turn @param {string} task */
export function partsIn(turn, task) {
  if (turn.role !== 'assistant' || turn.textStub) return [];
  /** @type {any[]} */
  const found = lessonPartsOf(turn.text).map((p) => ({ ...p, key: partKey(p) }));
  if (found.length || task !== 'ask' || !isDocumentAnswer(turn.text)) return found;
  // a short note before the heading is no part of the document (the exports cut it too)
  const text = fromDocumentStart(turn.text);
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
 * Per turn (same index), the part keys a later assistant turn writes again: `same` when the
 * latest holder has the same title (a revision), else `other` (a different document or worksheet).
 * A stub counts with its wrap keys, title unknown (`other`).
 * @param {(PartTurn & { artifacts?: { draftWraps?: Record<string, string> } })[]} turns @param {string} task
 * @returns {Record<string, 'same'|'other'>[]}
 */
export function supersededIn(turns, task) {
  const found = turns.map((t) =>
    t.role === 'assistant' && t.textStub
      ? Object.keys(t.artifacts?.draftWraps ?? {}).map((key) => ({ key, title: undefined }))
      : /** @type {{ key: string, title?: string }[]} */ (partsIn(t, task))
  );
  /** @type {Map<string, number>} key → index of its latest holder */
  const holder = new Map();
  found.forEach((ps, i) => ps.forEach((p) => holder.set(p.key, i)));
  return found.map((ps, i) =>
    Object.fromEntries(
      ps.flatMap((p) => {
        const h = /** @type {number} */ (holder.get(p.key));
        if (h === i) return [];
        const title = found[h].find((x) => x.key === p.key)?.title;
        return [[p.key, title !== undefined && title === p.title ? 'same' : 'other']];
      })
    )
  );
}

/**
 * Per turn id, the parts it wrote; `changed` when an earlier turn had the key,
 * `superseded` when a later one writes it again (see supersededIn).
 * @param {PartTurn[]} turns @param {string} task
 * @returns {Record<string, { key: string, title: string, changed: boolean, superseded?: 'same'|'other' }[]>}
 */
export function partLines(turns, task) {
  const seen = new Set();
  const over = supersededIn(turns, task);
  /** @type {Record<string, { key: string, title: string, changed: boolean, superseded?: 'same'|'other' }[]>} */
  const out = {};
  for (const [i, turn] of turns.entries()) {
    const lines = partsIn(turn, task).map((p) => {
      const changed = seen.has(p.key);
      seen.add(p.key);
      const superseded = over[i][p.key];
      return { key: p.key, title: p.title, changed, ...(superseded ? { superseded } : {}) };
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
 * @param {{ writingKey?: string, failedKey?: string | Set<string>, wraps?: Record<string, string> }} [opts]
 *   `wraps`: part key → id of the turn whose draftWraps holds it
 */
export function railRows(state, parts, { writingKey, failedKey, wraps = {} } = {}) {
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
  // no lesson state (an ask document): no steps, the parts as they are, plus a failed load
  // or a writing key without text yet (a stub whose wrap would not open needs its retry row)
  if (!state) {
    const failed = typeof failedKey === 'string' ? [failedKey] : [...(failedKey ?? [])];
    const keys = new Set([...parts.map((p) => p.key), writingKey, ...failed].filter(Boolean));
    return {
      steps: [],
      parts: [.../** @type {Set<string>} */ (keys)].map((key) => {
        const part = parts.find((p) => p.key === key);
        return { key, title: part?.title || key, state: stateOf(key, part) };
      })
    };
  }
  const phase = state.phase ?? 1;
  // labelled where they render (WerkbankRail), like WerkbankStep does
  const steps = [1, 2, 3, 4].map((n) => ({
    n: /** @type {1|2|3|4} */ (n),
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

/**
 * A lesson state or a saved part (an ask document: its `document` wrap; a long answer alone is
 * no draft — drafts are never evicted). @param {any} conv stored conversation (messages use `content`)
 */
export const isDraft = (conv) =>
  !!conv?.lesson ||
  assistantMessages(conv).some((m) => m.draftWraps && Object.keys(m.draftWraps).length > 0);

/** @typedef {{ title: string, kind: 'series'|'document', done: number, total: number, published: boolean }} DraftSummary */

/** @param {any} conv @returns {DraftSummary} */
export function draftSummary(conv) {
  // stored content writes `task` only for a lesson; an older ask record may carry a stray lesson state
  if (conv?.lesson && conv.task === 'lesson') {
    // a stored record keeps a wrap on its message only (the codec's withoutMessageWraps)
    const wraps = Object.assign({}, ...assistantMessages(conv).map((m) => m.draftWraps ?? {}));
    const ordered = partsInOrder(conv.lesson, wraps);
    const done = ordered.filter((p) => p.wrap).length;
    const total = Math.max(plannedKeys(conv.lesson).length, ordered.length);
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

/** @param {unknown} v */
const low = (v) => String(v ?? '').toLowerCase();
/** @param {string} v @returns {string[]} */
const numbers = (v) => v.match(/\d+/g) ?? [];
/**
 * A search_curriculum entry of the curriculum the frame names: each field both name agrees
 * (subject by containment — "Religion" names "Evangelische Religionslehre"; grade by number).
 * @param {any} e @param {Record<string, any>} f
 */
function ofFrame(e, f) {
  /** @param {string} k @param {(a: string, b: string) => boolean} eq */
  const same = (k, eq) => !e?.[k] || !f?.[k] || eq(low(e[k]), low(f[k]));
  return (
    same('state', (a, b) => a === b) &&
    same('schoolType', (a, b) => a === b) &&
    same('subject', (a, b) => a.includes(b) || b.includes(a)) &&
    same('grade', (a, b) => numbers(a).some((n) => numbers(b).includes(n)))
  );
}

/**
 * Competences this session offered that the plan does not hold yet: the outputs of
 * `curriculum_competences`, the entries of `search_curriculum` that belong to the curriculum
 * the frame names (MEM's get_kompetenzen came back empty for Bayern live, 2026-11-12), plus the
 * options of a `propose_options` in the same message (the model offers the found competences as
 * a tick list; options of a message without a curriculum lookup are Bundesland/method choices,
 * not competences). Deduped by label.
 * @param {any[]} messages UI messages @param {{ label: string }[]} chosen
 * @param {Record<string, any>} [frame] the lesson state's frame (state, schoolType, subject, grade)
 * @returns {{ uri?: string, label: string, topic?: string }[]}
 */
export function foundCompetences(messages, chosen, frame = {}) {
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
    const looked = done.filter((p) =>
      ['curriculum_competences', 'search_curriculum'].includes(toolNameOf(p))
    );
    if (!looked.length) continue;
    for (const p of looked) {
      for (const c of p.output?.competences ?? []) add(c);
      for (const e of p.output?.entries ?? [])
        if (ofFrame(e, frame)) add({ uri: e?.uri, label: e?.label, topic: e?.parent });
    }
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
    queue: (text) => void queued.push(text)
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
