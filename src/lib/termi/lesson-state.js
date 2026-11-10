/**
 * The Termi `lesson` task's phase state: what the model writes with
 * `lesson_state` (a patch), what the client keeps on the conversation and
 * sends back, and the compact paragraph the prompt carries. Isomorphic — no
 * server, Svelte or Paraglide imports. Every patch is untrusted model output:
 * `sanitizeLessonPatch` is the one gate.
 *
 * @typedef {{ n: number, title: string, wrap?: string, naddr?: string }} LessonPart
 * @typedef {{
 *   phase: number,
 *   frame: Record<string, any>,
 *   competences: { uri?: string, label: string }[],
 *   didactics: Record<string, any>,
 *   plan: any[],
 *   parts: { lessons: LessonPart[], worksheets?: any, summary?: any, module?: any, overview?: any, sources?: any },
 *   licence?: string,
 *   publication?: string,
 *   resource?: string
 * }} LessonState
 */

export const LESSON_PHASES = [
  'rahmen',
  'kompetenzen',
  'didaktik',
  'stundenplan',
  'ausarbeitung',
  'material',
  'veroeffentlichen'
];

/** Display names of `LESSON_PHASES`, also the phase names in the lesson prompt. */
export const PHASE_LABELS = {
  de: [
    'Rahmen',
    'Kompetenzen',
    'Didaktik',
    'Stundenplan',
    'Ausarbeitung',
    'Schülermaterial',
    'Veröffentlichen'
  ],
  en: [
    'Frame',
    'Competences',
    'Didactics',
    'Lesson plan',
    'Elaboration',
    'Student material',
    'Publish'
  ]
};

const MAX_STRING = 500;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;
// a model patch; the whole accumulated state has its own, larger gate
const MAX_PATCH_BYTES = 4 * 1024;
const MAX_STATE_BYTES = 16 * 1024;
const NADDR = /^naddr1[02-9ac-hj-np-z]+$/;
const NADDR_KEYS = new Set(['wrap', 'naddr', 'publication', 'resource']);
const URL_KEYS = new Set(['uri', 'href', 'url']);
const HTTP = /^https?:\/\//i;

/** Top-level keys and the value type each must have; anything else is dropped. */
const SHAPE = /** @type {const} */ ({
  phase: 'number',
  frame: 'object',
  competences: 'array',
  didactics: 'object',
  plan: 'array',
  parts: 'object',
  licence: 'string',
  publication: 'string',
  resource: 'string'
});

/** @returns {LessonState} */
export const emptyLessonState = () => ({
  phase: 1,
  frame: {},
  competences: [],
  didactics: {},
  plan: [],
  parts: { lessons: [] }
});

/** @param {unknown} v */
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} v @returns {'array'|'object'|string} */
const typeOf = (v) => (Array.isArray(v) ? 'array' : isPlainObject(v) ? 'object' : typeof v);

/**
 * Strings capped, arrays capped, numbers finite, naddr-named fields checked;
 * anything else (functions, null, too deep) becomes undefined.
 * @param {unknown} v @param {number} depth @param {string} [key] @returns {any}
 */
function clean(v, depth, key) {
  if (typeof v === 'string') {
    if (key && NADDR_KEYS.has(key)) return NADDR.test(v) && v.length <= MAX_STRING ? v : undefined;
    return v.slice(0, MAX_STRING);
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(v))
    return v
      .slice(0, MAX_ARRAY)
      .map((x) => clean(x, depth + 1))
      .filter((x) => x !== undefined);
  if (isPlainObject(v)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, x] of Object.entries(/** @type {object} */ (v)).slice(0, MAX_ARRAY)) {
      // a link that is not http(s) (javascript:, data:) drops the whole entry
      if (URL_KEYS.has(k) && !(typeof x === 'string' && HTTP.test(x))) return undefined;
      const c = clean(x, depth + 1, k);
      // keys are model-chosen; over-long ones are dropped rather than cut (a cut could collide)
      if (c !== undefined && k.length <= 64) out[k] = c;
    }
    return out;
  }
  return undefined;
}

/**
 * A model-written patch → the part worth keeping, or null (not an object, or
 * over 4 KB once cleaned). Unknown or mistyped top-level keys are dropped,
 * `phase` is clamped to 1..7.
 * @param {unknown} input @returns {Partial<LessonState> | null}
 */
export const sanitizeLessonPatch = (input) => sanitize(input, MAX_PATCH_BYTES);

/**
 * A whole state (stored, or sent back by the client) → a full LessonState, or
 * null (not an object, or over 16 KB once cleaned). Same rules as a patch.
 * @param {unknown} input @returns {LessonState | null}
 */
export function sanitizeLessonState(input) {
  const clean = sanitize(input, MAX_STATE_BYTES);
  return clean ? mergeLessonState(null, clean) : null;
}

/** @param {unknown} input @param {number} maxBytes @returns {Partial<LessonState> | null} */
function sanitize(input, maxBytes) {
  if (!isPlainObject(input)) return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, type] of Object.entries(SHAPE)) {
    const v = /** @type {any} */ (input)[key];
    if (typeOf(v) !== type) continue;
    if (key === 'phase') {
      if (Number.isFinite(v)) out.phase = Math.min(7, Math.max(1, Math.round(v)));
      continue;
    }
    const c = clean(v, 0, key);
    if (c !== undefined) out[key] = c;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > maxBytes) return null;
  return /** @type {Partial<LessonState>} */ (out);
}

/**
 * Arrays replace, objects merge one level deep, scalars replace.
 * @param {LessonState | null | undefined} prev @param {Partial<LessonState> | null | undefined} patch
 * @returns {LessonState}
 */
export function mergeLessonState(prev, patch) {
  /** @type {Record<string, any>} */
  const next = { ...emptyLessonState(), ...(prev ?? {}) };
  for (const [k, v] of Object.entries(/** @type {Record<string, any>} */ (patch ?? {}))) {
    next[k] = isPlainObject(v) && isPlainObject(next[k]) ? { ...next[k], ...v } : v;
  }
  return /** @type {LessonState} */ (next);
}

/** @param {unknown} v @returns {string} */
const flat = (v) =>
  Array.isArray(v)
    ? v.map(flat).filter(Boolean).join(', ')
    : isPlainObject(v)
      ? Object.values(/** @type {object} */ (v))
          .map(flat)
          .filter(Boolean)
          .join(', ')
      : v === undefined || v === null
        ? ''
        : String(v);

/**
 * One compact paragraph for the prompt (German for 'de', English otherwise), ≤ 1 200 chars.
 * @param {LessonState | null | undefined} state @param {string} [locale]
 */
export function renderLessonState(state, locale = 'de') {
  // the state may come from a stored conversation: sanitize, so a malformed one never throws
  const s = sanitizeLessonState(state) ?? emptyLessonState();
  const de = locale === 'de';
  const labels = de ? PHASE_LABELS.de : PHASE_LABELS.en;
  const f = s.frame ?? {};
  const count = f.lessons ?? (s.plan.length || undefined);
  const frame = [
    f.subject,
    f.grade !== undefined && (de ? `Klasse ${f.grade}` : `grade ${f.grade}`),
    f.schoolType,
    f.state,
    count !== undefined && (de ? `${count} Stunden` : `${count} lessons`),
    f.minutes !== undefined && (de ? `à ${f.minutes} Minuten` : `of ${f.minutes} minutes`),
    f.topic && (de ? `Thema: ${f.topic}` : `topic: ${f.topic}`)
  ]
    .filter(Boolean)
    .join(', ');
  const done = s.parts?.lessons?.length ?? 0;
  const sentences = [
    de
      ? `Stand: Phase ${s.phase} von 7 (${labels[s.phase - 1]}).`
      : `State: phase ${s.phase} of 7 (${labels[s.phase - 1]}).`,
    frame && (de ? `Rahmen: ${frame}.` : `Frame: ${frame}.`),
    s.competences.length &&
      (de ? 'Kompetenzen: ' : 'Competences: ') +
        s.competences
          .map((c) => c?.label)
          .filter(Boolean)
          .join('; ') +
        '.',
    flat(s.didactics) &&
      (de ? `Didaktik: ${flat(s.didactics)}.` : `Didactics: ${flat(s.didactics)}.`),
    s.plan.length &&
      (de ? `Stundenplan: ${s.plan.length} Stunden geplant.` : `Plan: ${s.plan.length} lessons.`),
    done && (de ? `Ausgearbeitet: ${done} Stunden.` : `Written: ${done} lessons.`),
    s.licence && (de ? `Lizenz: ${s.licence}.` : `Licence: ${s.licence}.`)
  ].filter(Boolean);
  const text = sentences.join(' ');
  return text.length > 1200 ? `${text.slice(0, 1199)}…` : text;
}

/** @typedef {{ name: string, text: string }} LessonMaterial */
const MATERIAL_NAME = 120;
const MATERIAL_TEXT = 15_000;
const MATERIALS_MAX = 3;

/**
 * Adds one of her files to the conversation's materials (≤ 3): name collapsed
 * and cut to 120, text cut to 15 000 chars; a same-named file is replaced in
 * place, otherwise a 4th drops the oldest. Untrusted input → unchanged list.
 * @param {LessonMaterial[]} list @param {unknown} input @returns {LessonMaterial[]}
 */
export function addMaterialTo(list, input) {
  const m = /** @type {any} */ (input);
  if (typeof m?.name !== 'string' || typeof m?.text !== 'string') return list;
  const name = m.name.replace(/\s+/g, ' ').trim().slice(0, MATERIAL_NAME);
  if (!name || !m.text.trim()) return list;
  const material = { name, text: m.text.slice(0, MATERIAL_TEXT) };
  if (list.some((x) => x.name === name)) return list.map((x) => (x.name === name ? material : x));
  return [...list, material].slice(-MATERIALS_MAX);
}
