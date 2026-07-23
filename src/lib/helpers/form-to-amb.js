import { resolveEmitter, fieldProp } from './forms/amb-emitters.js';

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
 * Delegates per-field serialization to the NIP-AMB emitter registry
 * (`./forms/amb-emitters.js`). Concept-valued fields (vocab-bound) emit
 * `:id`/`:prefLabel:<lang>`/`:type` tags with NO a-tag, per NIP-AMB.
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
  for (const field of form.fields) {
    const emitter = resolveEmitter(field);
    const value = field.vocab ? selectedConcepts[field.id] : values[field.id];
    const ctx = { field, prop: fieldProp(field), formDTag: form.dTag, defaultLang: 'de' };
    for (const tag of emitter.emit(value, ctx)) out.push(tag);
  }
  // Informative form back-reference (spec: MAY)
  out.push(['a', `30168:${form.pubkey}:${form.dTag}`, formRelay, 'form']);
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
  /** @type {Record<string, string|string[]>} */
  const values = {};
  /** @type {Record<string, SelectedConcept[]>} */
  const selectedConcepts = {};
  for (const field of form.fields) {
    const emitter = resolveEmitter(field);
    const ctx = { field, prop: fieldProp(field), formDTag: form.dTag, defaultLang: 'de' };
    const { value, concepts } = emitter.parse(event, ctx);
    if (concepts) selectedConcepts[field.id] = concepts;
    if (value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      values[field.id] = value;
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
