/**
 * Pure helper wiring a template-form submission through the shared
 * `amb-nostr-converter`: form values → AMB JSON (`formValuesToAmbJson`) →
 * Nostr tags/content (`ambToNostr`), then reconciling the `d` tag and
 * appending edufeed-specific extras (external-url `r` tags, the form
 * back-reference `a` tag) that live outside the AMB object itself.
 *
 * No Svelte imports — usable from node tests and from
 * `TemplateResourceForm.svelte`.
 */

import { ambToNostr } from 'amb-nostr-converter';
import { formValuesToAmbJson } from './formValuesToAmbJson.js';
import { resolveResourceDTag } from './formReference.js';

/**
 * @param {Object} args
 * @param {{ pubkey: string, dTag: string, fields: any[] }} args.form
 * @param {string} args.formRelay - relay hint for the form back-reference / converter default
 * @param {Record<string, any>} args.rawValues - raw field values from FormRenderer
 * @param {Record<string, any>} args.selectedConcepts - per-field concept metadata for vocab-bound fields
 * @param {string} args.signerPubkey - active account pubkey (converter needs a pubkey for id derivation)
 * @param {boolean} args.isEditMode
 * @param {string} [args.existingDTag] - resource's current `d` tag (edit mode)
 * @returns {{ tags: string[][], content: string, dTag: string }}
 */
export function buildTemplateResourceSubmission({
  form,
  formRelay,
  rawValues,
  selectedConcepts,
  signerPubkey,
  isEditMode,
  existingDTag
}) {
  const { amb, extras } = formValuesToAmbJson(form, rawValues, selectedConcepts);
  const { success, data, error } = ambToNostr(/** @type {any} */ (amb), {
    pubkey: signerPubkey,
    defaultRelayHint: formRelay,
    relatedEvents: extras.relatedEvents,
    // The companion concept a tags are appended below from the selected
    // concepts, which know the vocabulary's relay; the converter would only
    // know the form relay.
    conceptCompanionTags: false
  });
  if (!success || !data) throw new Error(error?.message || 'AMB conversion failed');

  // The converter derives its own `d` tag from amb.id. Edit mode must keep
  // the resource's existing d-tag for addressable stability; create mode
  // honors the emitted d (e.g. a url field mapped to amb:id) and only falls
  // back to a fresh UUID when none was produced. See resolveResourceDTag.
  const emittedD = data.tags.find((t) => t[0] === 'd')?.[1];
  const dTag = resolveResourceDTag({ isEditMode, existingDTag, emittedD });

  // The converter sets content from amb.description. Fall back to the raw
  // description field value in case it wasn't mapped to amb:description, so
  // the published content never silently regresses to empty.
  const descFieldId = form.fields.find((f) => f.output === 'amb:description')?.id;
  const descFallback = descFieldId ? rawValues[descFieldId] : rawValues.description;
  const content = data.content || descFallback || '';

  const converterTags = data.tags.filter((t) => t[0] !== 'd');
  const tags = [
    ['d', dTag],
    ...converterTags,
    ...extras.externalUrls.map((/** @type {string} */ u) => ['r', u]),
    ...companionConceptTags(form, selectedConcepts, converterTags),
    ['a', `30168:${form.pubkey}:${form.dTag}`, formRelay, 'form']
  ];

  return { tags, content, dTag };
}

/**
 * NIP-VOCAB companion tags for the selected concepts that live on Nostr:
 * `['a', '<kind>:<pubkey>:<d>', <relay>, '<prefix>']`, where `<prefix>` is the
 * flattened tag prefix the concept appears under (`about`, `educationalLevel`,
 * …, or `ext:<form.dTag>:<fieldId>`). The `<prefix>:id` tag stays authoritative;
 * this is an index and a relay hint. One tag per (address, prefix); tags the
 * converter already emitted are not repeated.
 *
 * @param {{ dTag: string, fields: any[] }} form
 * @param {Record<string, any[]>} selectedConcepts
 * @param {string[][]} existingTags
 * @returns {string[][]}
 */
export function companionConceptTags(form, selectedConcepts, existingTags) {
  const seen = new Set(
    existingTags.filter((t) => t[0] === 'a' && t[3]).map((t) => `${t[1]}\u0000${t[3]}`)
  );
  /** @type {string[][]} */
  const out = [];
  for (const field of form.fields) {
    const concepts = selectedConcepts?.[field.id];
    if (!Array.isArray(concepts) || !concepts.length) continue;
    const output = field.output || `amb:${field.id}`;
    const prefix =
      output === 'ext'
        ? `ext:${form.dTag}:${field.id}`
        : output.startsWith('amb:')
          ? output.slice(4)
          : field.id;
    for (const c of concepts) {
      const address = c?.nostrCoord;
      if (!address) continue;
      const key = `${address}\u0000${prefix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(['a', address, c.relay || '', prefix]);
    }
  }
  return out;
}
