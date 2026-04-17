/**
 * @typedef {Object} SelectedConcept
 * @property {string} id - external URI of the concept
 * @property {string} nostrCoord - "39737:<pubkey>:<d>"
 * @property {string} relay
 * @property {Record<string, string>} labels - { [lang]: label }
 */

/**
 * @typedef {Object} ParsedFormForSerialization
 * @property {string} pubkey
 * @property {string} dTag
 * @property {import('./forms.js').FormField[]} fields
 */

/**
 * Build the tag array for a kind-30142 event produced from a form submission.
 * Does NOT include the `d` tag — the caller (route) decides the resource identifier.
 *
 * @param {Object} args
 * @param {ParsedFormForSerialization} args.form
 * @param {string} args.formRelay - relay hint for the form back-reference
 * @param {Record<string, string|string[]>} args.values - raw field values from FormRenderer
 * @param {Record<string, SelectedConcept[]>} args.selectedConcepts - per-field concept metadata for vocab-bound fields
 * @returns {string[][]}
 */
export function buildAMBResourceTags({ form, formRelay, values, selectedConcepts }) {
  /** @type {string[][]} */
  const out = [];
  const formCoord = `30168:${form.pubkey}:${form.dTag}`;

  for (const field of form.fields) {
    const raw = values[field.id];
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw) && raw.length === 0) continue;

    const output = field.output || `amb:${field.id}`;

    if (output.startsWith('amb:')) {
      const prop = output.slice(4);
      emitForTarget(out, prop, field, raw, selectedConcepts[field.id], false, formCoord);
    } else if (output === 'ext') {
      emitForTarget(out, field.id, field, raw, selectedConcepts[field.id], true, formCoord);
    }
  }

  // Informative form back-reference (spec: MAY)
  out.push(['a', formCoord, formRelay, 'form']);

  return out;
}

/**
 * @param {string[][]} out
 * @param {string} propOrFieldId
 * @param {import('./forms.js').FormField} field
 * @param {string | string[]} raw
 * @param {SelectedConcept[] | undefined} concepts
 * @param {boolean} isExt
 * @param {string} formCoord
 */
function emitForTarget(out, propOrFieldId, field, raw, concepts, isExt, formCoord) {
  const keyBase = isExt ? `ext:${formCoord}:${propOrFieldId}` : propOrFieldId;

  const isConceptField = !!field.vocab;
  if (isConceptField) {
    const list = Array.isArray(concepts) ? concepts : [];
    if (list.length === 0) return;
    for (const c of list) {
      out.push([`${keyBase}:id`, c.id]);
      for (const [lang, label] of Object.entries(c.labels || {})) {
        out.push([`${keyBase}:prefLabel:${lang}`, label]);
      }
      out.push([`${keyBase}:type`, 'Concept']);
      const role = isExt ? `ext:${propOrFieldId}` : propOrFieldId;
      out.push(['a', c.nostrCoord, c.relay, role]);
    }
    return;
  }

  // scalar field — emit as single flat tag
  const vals = Array.isArray(raw) ? raw : [raw];
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    out.push([keyBase, String(v)]);
  }
}
