/**
 * Embedding-backed ranking of free text against the Termi skill catalogue's
 * example phrases (see `$lib/helpers/termi-skills.js`). Vectors live for the
 * process lifetime once warm-up succeeds; a failed `rank` never clears them.
 */

export class NotReadyError extends Error {
  constructor() {
    super('router index not ready');
    this.name = 'NotReadyError';
  }
}

const CHUNK_SIZE = 32;
const WARMUP_BUDGET_MS = 60_000;

/** @param {number[]} a @param {number[]} b */
function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * @param {Array<{ id: string, phrases: { de: string[], en: string[] } }>} skills
 * @returns {Array<{ skill: string, locale: string, phrase: string }>}
 */
function flattenPhrases(skills) {
  const items = [];
  for (const skill of skills) {
    for (const locale of /** @type {const} */ (['de', 'en'])) {
      for (const phrase of skill.phrases[locale] ?? []) {
        items.push({ skill: skill.id, locale, phrase });
      }
    }
  }
  return items;
}

/**
 * @param {{
 *   embed: (texts: string[], inputType: 'query'|'passage') => Promise<number[][]>,
 *   skills: Array<{ id: string, phrases: { de: string[], en: string[] } }>
 * }} opts
 */
export function createRouterIndex({ embed, skills }) {
  let ready = false;
  /** @type {Array<{ skill: string, locale: string, vector: number[] }>} */
  let vectors = [];
  /** @type {Promise<void> | null} */
  let inFlight = null;

  async function doWarmUp() {
    const items = flattenPhrases(skills);
    const chunks = chunk(items, CHUNK_SIZE);
    const deadline = Date.now() + WARMUP_BUDGET_MS;
    /** @type {typeof vectors} */
    const collected = [];
    for (const batch of chunks) {
      if (Date.now() > deadline) throw new Error('termi warm-up exceeded its time budget');
      const embedded = await embed(
        batch.map((item) => item.phrase),
        'passage'
      );
      if (
        !Array.isArray(embedded) ||
        embedded.length !== batch.length ||
        embedded.some((v) => !Array.isArray(v))
      ) {
        throw new Error('embed service returned a malformed response');
      }
      batch.forEach((item, i) => collected.push({ ...item, vector: embedded[i] }));
    }
    vectors = collected;
    ready = true;
  }

  /** @returns {Promise<void>} */
  function warmUp() {
    if (ready) return Promise.resolve();
    if (!inFlight) {
      inFlight = doWarmUp().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  /**
   * @param {string} text
   * @param {'de'|'en'} locale
   * @returns {Promise<Array<{ skill: string, score: number }>>}
   */
  async function rank(text, locale) {
    if (!ready) {
      // Lazily retry a previously failed warm-up rather than staying stuck.
      await warmUp().catch(() => {});
    }
    if (!ready) throw new NotReadyError();

    const [queryVector] = await embed([text], 'query');

    /** @type {Map<string, number>} */
    const bestPerSkill = new Map();
    for (const v of vectors) {
      if (v.locale !== locale) continue;
      const score = dot(queryVector, v.vector);
      const prev = bestPerSkill.get(v.skill);
      if (prev === undefined || score > prev) bestPerSkill.set(v.skill, score);
    }

    return [...bestPerSkill.entries()]
      .map(([skill, score]) => ({ skill, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  return { warmUp, ready: () => ready, rank };
}
