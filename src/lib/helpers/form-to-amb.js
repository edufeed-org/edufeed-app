/**
 * @typedef {Object} SelectedConcept
 * @property {string} id - external URI of the concept
 * @property {string} nostrCoord - addressable Concept coordinate "<kind>:<pubkey>:<d>" (kind 39738 under NIP-VOCAB v0.2)
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
 * Inverse of buildAMBResourceTags: read a kind-30142 event's tags using the
 * form template that produced it and restore the original field values +
 * per-field selectedConcepts (for vocab-bound fields). Useful for pre-populating
 * FormRenderer when editing an existing resource via the form.
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @param {ParsedFormForSerialization} form
 * @returns {{ values: Record<string, string|string[]>, selectedConcepts: Record<string, SelectedConcept[]> }}
 */
export function parseAMBResourceForForm(event, form) {
  const formCoord = `30168:${form.pubkey}:${form.dTag}`;
  /** @type {Record<string, string|string[]>} */
  const values = {};
  /** @type {Record<string, SelectedConcept[]>} */
  const selectedConcepts = {};

  // Index a-tags by role for concept metadata (nostrCoord + relay)
  /** @type {Map<string, { nostrCoord: string, relay: string }[]>} */
  const aTagsByRole = new Map();
  for (const t of event.tags) {
    if (t[0] !== 'a' || !t[1] || !t[3]) continue;
    const role = t[3];
    if (role === 'form' || role === 'forkOf') continue;
    const list = aTagsByRole.get(role) || [];
    list.push({ nostrCoord: t[1], relay: t[2] || '' });
    aTagsByRole.set(role, list);
  }

  for (const field of form.fields) {
    const output = field.output || `amb:${field.id}`;
    let keyBase;
    let role;
    if (output.startsWith('amb:')) {
      keyBase = output.slice(4);
      role = keyBase;
    } else if (output === 'ext') {
      keyBase = `ext:${formCoord}:${field.id}`;
      role = `ext:${field.id}`;
    } else {
      continue;
    }

    if (field.vocab) {
      // Concept-valued: collect :id occurrences + matching prefLabel tags
      /** @type {{ id: string, labels: Record<string,string> }[]} */
      const entries = [];
      for (const t of event.tags) {
        if (t[0] === `${keyBase}:id` && t[1]) {
          entries.push({ id: t[1], labels: {} });
        }
      }
      if (entries.length === 0) continue;

      // Collect prefLabels; if multiple concepts share the same keyBase the
      // spec doesn't disambiguate by position, so attach all prefLabels to
      // each concept — round-trip is lossy here for multi-concept fields, but
      // adequate for single-concept fields (the common case).
      /** @type {Record<string,string>} */
      const sharedLabels = {};
      for (const t of event.tags) {
        if (t[0]?.startsWith(`${keyBase}:prefLabel:`) && t[1]) {
          const lang = t[0].slice(`${keyBase}:prefLabel:`.length);
          sharedLabels[lang] = t[1];
        }
      }
      const aRefs = aTagsByRole.get(role) || [];

      values[field.id] = entries.map((e) => e.id);
      selectedConcepts[field.id] = entries.map((entry, i) => ({
        id: entry.id,
        nostrCoord: aRefs[i]?.nostrCoord || '',
        relay: aRefs[i]?.relay || '',
        labels: { ...sharedLabels }
      }));
    } else {
      // Scalar: collect flat tag values
      const vals = event.tags.filter((t) => t[0] === keyBase && t[1]).map((t) => t[1]);
      if (vals.length === 0) continue;
      const optionList = /** @type {import('./forms/format.js').FormFieldOption[] | undefined} */ (
        field.options?.options
      );
      if (optionList?.length) {
        // emission writes labels — map back to optionIds (';'-joined) for the renderer
        const byLabel = new Map(optionList.map((o) => [o.label, o.id]));
        values[field.id] = vals.map((v) => byLabel.get(v) ?? v).join(';');
      } else {
        values[field.id] = vals.length === 1 ? vals[0] : vals;
      }
    }
  }

  return { values, selectedConcepts };
}

/**
 * Extract the informative form back-reference from a resource event.
 *
 * @param {import('nostr-tools').NostrEvent} event
 * @returns {{ address: string, relay: string } | null}
 */
export function getFormReferenceFromResource(event) {
  for (const t of event.tags) {
    if (t[0] === 'a' && t[3] === 'form' && t[1]?.startsWith('30168:')) {
      return { address: t[1], relay: t[2] || '' };
    }
  }
  return null;
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

  // scalar field — emit as flat tag(s); option fields resolve ids → labels
  /** @type {import('./forms/format.js').FormFieldOption[] | undefined} */
  const optionList = field.options?.options;
  const byId = optionList?.length ? new Map(optionList.map((o) => [o.id, o.label])) : null;
  const vals = Array.isArray(raw) ? raw : byId ? String(raw).split(';') : [raw];
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    out.push([keyBase, byId ? (byId.get(String(v)) ?? String(v)) : String(v)]);
  }
}
