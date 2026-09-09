/**
 * DOI auto-fetch → sibling-field prefill for template forms.
 *
 * A `doi` field knows nothing about its neighbours; the template author does,
 * through each field's `output`. So the fetched Crossref metadata is routed by
 * output (`amb:name` ← title, `amb:creator` ← authors, …) and, for the two
 * things AMB has no property for, by conventional ext field id (`band`/
 * `volume`, `heft`/`issue`). Only EMPTY fields are filled — the respondent's
 * own input always wins, exactly like the URL prefill on /create/publication.
 *
 * Pure: returns a new values object plus the ids it filled, mutates nothing.
 */

/** @typedef {import('$lib/helpers/publication/crossref.js').DoiPrefill} DoiPrefill */

/** Empty as FormRenderer seeds it: '', [], or a text-array's [''] placeholder. */
function isEmpty(/** @type {any} */ v) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.every((x) => x === '' || x === undefined || x === null);
  return false;
}

/** ext field ids that carry a journal's volume / issue, in either language. */
const EXT_IDS = { volume: ['band', 'volume'], issue: ['heft', 'issue'] };

/**
 * @param {Array<{id: string, type?: string, output?: string, options?: any}>} fields
 * @param {Record<string, any>} values
 * @param {DoiPrefill} prefill
 * @returns {{ values: Record<string, any>, filled: string[] }}
 */
export function applyDoiPrefill(fields, values, prefill) {
  const next = { ...values };
  /** @type {string[]} */
  const filled = [];

  /** @param {string} id @param {any} value */
  const set = (id, value) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    if (!isEmpty(next[id])) return;
    next[id] = value;
    filled.push(id);
  };

  for (const field of fields || []) {
    const out = field.output || `amb:${field.id}`;
    if (out === 'ext') {
      if (EXT_IDS.volume.includes(field.id)) set(field.id, prefill.volume);
      else if (EXT_IDS.issue.includes(field.id)) set(field.id, prefill.issue);
      continue;
    }
    switch (out) {
      case 'amb:name':
        set(field.id, prefill.title);
        break;
      case 'amb:description':
        set(field.id, prefill.abstract);
        break;
      case 'amb:datePublished':
        set(field.id, prefill.datePublished);
        break;
      case 'amb:keywords':
        set(field.id, prefill.keywords);
        break;
      case 'amb:creator':
        if (field.type === 'creator') set(field.id, prefill.creators);
        break;
      case 'amb:isPartOf':
        if (field.type === 'amb-relation' && prefill.journal) {
          set(field.id, [{ name: prefill.journal }]);
        }
        break;
      case 'amb:inLanguage': {
        const lang = prefill.inLanguage;
        const choices = field.options?.options;
        const allowed = !Array.isArray(choices) || choices.some((o) => o?.id === lang);
        if (lang && allowed) set(field.id, lang);
        break;
      }
      default:
        break;
    }
  }
  return { values: next, filled };
}
