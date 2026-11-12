/**
 * Pure logic of the Termi Werkbank (full-screen workbench): parts read from the
 * turns, changed blocks, rail rows, drafts. Isomorphic — no Svelte or server imports.
 *
 * @typedef {{ key: string, kind: string, n?: number, title: string, text: string, prev?: string, turnId: string }} WerkbankPart
 */
import { lessonPartsOf, partKey, partsInOrder, PHASE_LABELS } from './lesson-state.js';
import { isDocumentAnswer } from '../components/assistant/document-export.js';

const HEADING = /^#[ \t]+(.+)$/m;

/**
 * Parts in first-appearance order; across turns the latest text wins, the one
 * before it is `prev`. Stub turns are skipped, pending ones read (being streamed).
 * @param {{ id?: string, role: string, text: string, textStub?: boolean }[]} turns @param {'ask'|'lesson'|string} task
 * @returns {WerkbankPart[]}
 */
export function partsOf(turns, task) {
  /** @type {Map<string, WerkbankPart>} */
  const byKey = new Map();
  for (const turn of turns) {
    if (turn.role !== 'assistant' || turn.textStub) continue;
    /** @type {any[]} */
    let found = lessonPartsOf(turn.text).map((p) => ({ ...p, key: partKey(p) }));
    if (!found.length && task === 'ask' && isDocumentAnswer(turn.text)) {
      const text = turn.text.trim();
      const title = (text.match(HEADING)?.[1] ?? text.split('\n')[0]).trim().slice(0, 120);
      found = [{ key: 'document', kind: 'document', title, text }];
    }
    for (const p of found) {
      const old = byKey.get(p.key);
      byKey.set(p.key, { ...p, turnId: String(turn.id), ...(old ? { prev: old.text } : {}) });
    }
  }
  return [...byKey.values()];
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
const plannedKeys = (state) => [
  'overview',
  ...(Array.isArray(state?.plan) ? state.plan : []).map(
    (/** @type {any} */ e, /** @type {number} */ i) => `lesson-${e?.n ?? i + 1}`
  )
];

/**
 * @param {any} state @param {WerkbankPart[]} parts
 * @param {{ writingKey?: string, failedKey?: string, wraps?: Record<string, string>, locale?: string }} [opts]
 *   `wraps`: part key → id of the turn whose draftWraps holds it
 */
export function railRows(state, parts, { writingKey, failedKey, wraps = {}, locale = 'de' } = {}) {
  const phase = state?.phase ?? 1;
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
    const rowState =
      key === writingKey
        ? 'writing'
        : key === failedKey
          ? 'failed'
          : !part
            ? 'todo'
            : wraps[key] === part.turnId
              ? 'saved'
              : 'changed';
    return {
      key,
      title: part?.title || titles.get(key) || key,
      state: /** @type {'todo'|'writing'|'failed'|'changed'|'saved'} */ (rowState)
    };
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

/** @param {any} conv @returns {{ title: string, kind: 'series'|'document', done: number, total: number, published: boolean }} */
export function draftSummary(conv) {
  if (conv?.lesson) {
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
