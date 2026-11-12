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
 *   competences: { uri?: string, label: string, topic?: string }[],
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
 * `strip`: a model patch never writes the client-recorded naddr fields (wrap, naddr, …).
 * @param {unknown} v @param {number} depth @param {string} [key] @param {boolean} [strip] @returns {any}
 */
function clean(v, depth, key, strip = false) {
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
      .map((x) => clean(x, depth + 1, undefined, strip))
      .filter((x) => x !== undefined);
  if (isPlainObject(v)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, x] of Object.entries(/** @type {object} */ (v)).slice(0, MAX_ARRAY)) {
      // a link that is not http(s) (javascript:, data:) drops the whole entry
      if (URL_KEYS.has(k) && !(typeof x === 'string' && HTTP.test(x))) return undefined;
      if (strip && NADDR_KEYS.has(k)) continue;
      const c = clean(x, depth + 1, k, strip);
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
 * `phase` is clamped to 1..7. The naddr fields only the client records (wrap,
 * naddr, publication, resource) are dropped: a model never claims a save.
 * @param {unknown} input @returns {Partial<LessonState> | null}
 */
export const sanitizeLessonPatch = (input) => sanitize(input, MAX_PATCH_BYTES, true);

/**
 * A whole state (stored, or sent back by the client) → a full LessonState, or
 * null (not an object, or over 16 KB once cleaned). Same rules as a patch.
 * @param {unknown} input @returns {LessonState | null}
 */
export function sanitizeLessonState(input) {
  const clean = sanitize(input, MAX_STATE_BYTES);
  return clean ? mergeLessonState(null, clean) : null;
}

/** @param {unknown} input @param {number} maxBytes @param {boolean} [strip] @returns {Partial<LessonState> | null} */
function sanitize(input, maxBytes, strip = false) {
  if (!isPlainObject(input)) return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, type] of Object.entries(SHAPE)) {
    const v = /** @type {any} */ (input)[key];
    if (typeOf(v) !== type || (strip && NADDR_KEYS.has(key))) continue;
    if (key === 'phase') {
      if (Number.isFinite(v)) out.phase = Math.min(7, Math.max(1, Math.round(v)));
      continue;
    }
    const c = clean(v, 0, key, strip);
    if (c !== undefined) out[key] = c;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > maxBytes) return null;
  return /** @type {Partial<LessonState>} */ (out);
}

/** The client-recorded fields of a part: they win over any patch. @param {any} p */
const recorded = (p) =>
  Object.fromEntries(['wrap', 'naddr'].filter((k) => p?.[k] !== undefined).map((k) => [k, p[k]]));

/**
 * `parts` merged by key and `lessons` by `n`: a patch updates titles and notes,
 * never a recorded wrap/naddr, and a lesson it omits stays when it has one.
 * @param {Record<string, any>} prev @param {Record<string, any>} patch
 */
function mergeParts(prev, patch) {
  /** @type {Record<string, any>} */
  const out = { ...prev };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'lessons') continue;
    out[k] = isPlainObject(v) ? { ...out[k], ...v, ...recorded(prev[k]) } : v;
  }
  if (Array.isArray(patch.lessons)) {
    const old = Array.isArray(prev.lessons) ? prev.lessons : [];
    const merged = patch.lessons.map((/** @type {any} */ l) => {
      const p = old.find((/** @type {any} */ x) => x?.n === l?.n);
      return p ? { ...p, ...l, ...recorded(p) } : l;
    });
    const kept = old.filter(
      (/** @type {any} */ p) =>
        Object.keys(recorded(p)).length && !merged.some((/** @type {any} */ l) => l?.n === p?.n)
    );
    out.lessons = [...merged, ...kept].sort(
      (/** @type {any} */ a, /** @type {any} */ b) => (a?.n ?? 0) - (b?.n ?? 0)
    );
  }
  return out;
}

/**
 * `plan` rows merged by `n` (a row without one counts by its position): a known n takes
 * the patch row's fields, a new n is added, sorted by n.
 * shortcut: a patch cannot shorten the plan, add an explicit removal when a flow needs it
 * @param {any[]} prev @param {any[]} patch
 */
function mergePlan(prev, patch) {
  const nOf = (/** @type {any} */ row, /** @type {number} */ i) =>
    Number.isFinite(row?.n) ? row.n : i + 1;
  const rows = new Map(prev.map((row, i) => [nOf(row, i), row]));
  patch.forEach((row, i) => {
    const n = nOf(row, i);
    rows.set(n, isPlainObject(row) ? { ...rows.get(n), ...row } : row);
  });
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}

/**
 * Arrays replace, objects merge one level deep, scalars replace — except
 * `parts`, merged by key and lesson number (`mergeParts`), and `plan`, merged by n (`mergePlan`).
 * @param {LessonState | null | undefined} prev @param {Partial<LessonState> | null | undefined} patch
 * @returns {LessonState}
 */
export function mergeLessonState(prev, patch) {
  /** @type {Record<string, any>} */
  const next = { ...emptyLessonState(), ...(prev ?? {}) };
  for (const [k, v] of Object.entries(/** @type {Record<string, any>} */ (patch ?? {}))) {
    if (k === 'parts' && isPlainObject(v) && isPlainObject(next.parts))
      next.parts = mergeParts(next.parts, v);
    else if (k === 'plan' && Array.isArray(v) && Array.isArray(next.plan))
      next.plan = mergePlan(next.plan, v);
    else next[k] = isPlainObject(v) && isPlainObject(next[k]) ? { ...next[k], ...v } : v;
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

/** @typedef {{ kind: 'overview'|'document'|'lesson'|'worksheets'|'summary'|'module'|'sources', n?: number, title: string, text: string }} LessonPartText */
// The OUTPUT_CONTRACT marker; only termi:part comments match, never a LiaScript header after it.
const PART_MARKER =
  /<!--\s*termi:part\s+(overview|lesson|worksheets|summary|module|sources)(?:\s+(\d{1,3}))?\s*-->/g;

/** `lesson-<n>` for a lesson, else its kind: the key of `artifacts.draftWraps`. @param {{ kind: string, n?: number }} part */
export const partKey = (part) => (part.kind === 'lesson' ? `lesson-${part.n}` : part.kind);

/** A valid `draftWraps` key. */
export const PART_KEY = /^(overview|document|worksheets|summary|module|sources|lesson-\d{1,3})$/;

/**
 * An answer's parts, split on their markers: each part's text runs to the next
 * marker, with only its marker comment removed. A lesson marker without a
 * number is skipped; a repeated part keeps its first copy.
 * @param {string} text @returns {LessonPartText[]}
 */
export function lessonPartsOf(text) {
  const src = String(text ?? '');
  const marks = [...src.matchAll(PART_MARKER)];
  /** @type {LessonPartText[]} */
  const parts = [];
  marks.forEach((mark, i) => {
    const kind = /** @type {LessonPartText['kind']} */ (mark[1]);
    const n = mark[2] ? Number(mark[2]) : undefined;
    if (kind === 'lesson' && !n) return;
    const start = /** @type {number} */ (mark.index) + mark[0].length;
    const body = src.slice(start, marks[i + 1]?.index ?? src.length).trim();
    /** @type {LessonPartText} */
    const part = { kind, ...(kind === 'lesson' ? { n } : {}), title: '', text: body };
    if (!body || parts.some((p) => partKey(p) === partKey(part))) return;
    const firstLine = body
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim()
      .split('\n')[0];
    part.title = (body.match(/^#[ \t]+(.+)$/m)?.[1] ?? firstLine).trim().slice(0, 120);
    parts.push(part);
  });
  return parts;
}

/**
 * The state with a part's wrap naddr recorded (`parts.lessons[n].wrap` or `parts.<kind>.wrap`);
 * `field` 'naddr' records the published 30023 instead. A new wrap drops the part's naddr:
 * the re-saved text is published again (same d) in the next phase-7 run.
 * @param {LessonState | null | undefined} state @param {string} key @param {string} naddr @param {string} [title]
 * @param {'wrap'|'naddr'} [field]
 * @returns {LessonState}
 */
export function withPartWrap(state, key, naddr, title = '', field = 'wrap') {
  /** @template {Record<string, any>} T @param {T} p @returns {T} */
  const stale = (p) => {
    if (field !== 'wrap') return p;
    const { naddr: _published, ...rest } = p;
    return /** @type {T} */ (rest);
  };
  const s = mergeLessonState(state, {});
  const parts = { ...s.parts, lessons: s.parts?.lessons ?? [] };
  const lesson = key.match(/^lesson-(\d+)$/);
  if (lesson) {
    const n = Number(lesson[1]);
    parts.lessons = parts.lessons.some((l) => l?.n === n)
      ? parts.lessons.map((l) => (l?.n === n ? stale({ ...l, [field]: naddr }) : l))
      : [...parts.lessons, { n, title, [field]: naddr }];
  } else {
    const prev = /** @type {Record<string, any>} */ (parts)[key];
    /** @type {Record<string, any>} */ (parts)[key] = stale({
      ...(isPlainObject(prev) ? prev : {}),
      [field]: naddr
    });
  }
  return { ...s, parts };
}

/**
 * What phase 7 publishes, recorded by the client (never by a model patch):
 * a part's 30023, the series' 30040 or the describing 30142 (`publication: undefined`
 * unsets a stale index while it is republished).
 * @typedef {{ key: string, naddr: string } | { publication: string | undefined } | { resource: string }} PublishedRecord
 * @param {LessonState | null | undefined} state @param {PublishedRecord} rec @returns {LessonState}
 */
export const withPublished = (state, rec) =>
  'key' in rec
    ? withPartWrap(state, rec.key, rec.naddr, '', 'naddr')
    : mergeLessonState(state, rec);

const PART_TITLES = /** @type {const} */ ({
  overview: 'Überblick & Kompetenzen',
  worksheets: 'Arbeitsblätter',
  summary: 'Zusammenfassung',
  module: 'Selbstlernmodul',
  sources: 'Quellen und Lizenzen'
});

/** @typedef {{ key: string, title: string, wrap?: string, naddr?: string }} OrderedPart */

/**
 * The series' parts in reading order — overview, lessons by `n`, worksheets,
 * summary, module, sources — from the state and the turns' `draftWraps`
 * (the state's wrap wins). A part the state names but that has neither a
 * wrap nor an naddr is still listed: phase 7 shows it as missing — so is a part
 * only `found` in the turns' text (never saved; the state's title wins).
 * @param {LessonState | null | undefined} state @param {Record<string, string>} [draftWraps]
 * @param {{ kind: string, n?: number, title?: string }[]} [found]
 * @returns {OrderedPart[]}
 */
export function partsInOrder(state, draftWraps = {}, found = []) {
  const s = mergeLessonState(state, {});
  const wraps = Object.fromEntries(
    Object.entries(draftWraps ?? {}).filter(([k, v]) => PART_KEY.test(k) && NADDR.test(v))
  );
  /** @type {(key: string, p: any, title: string) => OrderedPart} */
  const entry = (key, p, title) => {
    const wrap = p?.wrap ?? wraps[key];
    return {
      key,
      title: typeof p?.title === 'string' && p.title ? p.title : title,
      ...(wrap ? { wrap } : {}),
      ...(p?.naddr ? { naddr: p.naddr } : {})
    };
  };
  /** @type {Record<string, any>} */
  const parts = s.parts ?? {};
  const lessons = new Map(
    (Array.isArray(parts.lessons) ? parts.lessons : [])
      .filter((l) => Number.isInteger(l?.n) && l.n > 0)
      .map((l) => [l.n, l])
  );
  for (const k of Object.keys(wraps)) {
    const n = Number(k.match(/^lesson-(\d+)$/)?.[1]);
    if (n && !lessons.has(n)) lessons.set(n, { n });
  }
  /** @type {Record<string, string>} */
  const foundTitles = {};
  for (const p of found ?? []) {
    const key = partKey(p);
    if (!PART_KEY.test(key)) continue;
    foundTitles[key] = p.title ?? '';
    if (p.kind === 'lesson' && !lessons.has(/** @type {number} */ (p.n)))
      lessons.set(p.n, { n: p.n, title: p.title });
  }
  /** @param {keyof typeof PART_TITLES} kind */
  const single = (kind) =>
    isPlainObject(parts[kind]) || wraps[kind] || kind in foundTitles
      ? [entry(kind, parts[kind], foundTitles[kind] || PART_TITLES[kind])]
      : [];
  return [
    ...single('overview'),
    ...[...lessons.keys()]
      .sort((a, b) => a - b)
      .map((n) => entry(`lesson-${n}`, lessons.get(n), `Stunde ${n}`)),
    ...single('worksheets'),
    ...single('summary'),
    ...single('module'),
    ...single('sources')
  ];
}
