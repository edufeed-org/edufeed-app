/**
 * Convert the FormBuilder's editing state (its `FieldState[]` list, with
 * interleaved `type:'section'` divider markers, plus the form-level metadata)
 * into kind-30168 template tags. Pure — no Svelte, no signer, no I/O.
 *
 * This is the SINGLE encoder shared by publishing (`FormBuilder.publish`) and
 * the preview (`FormPreview`). The preview is faithful only because it emits
 * the very tags `publish` would emit and then hands them to the very parser
 * respondents use (`parseFormTemplate`). Re-deriving a rendering straight from
 * builder state would preview something that is not the artifact, and could
 * drift from it silently — so keep this the only path to template tags.
 */
import { nip19 } from 'nostr-tools';
import { buildFormTemplateTags, CHOICE_TYPES, FORM_TEMPLATE_KIND } from './format.js';
import { extractSections, LOCKED_FIELD_OUTPUTS } from './builder-sections.js';

/** @typedef {import('./format.js').FormField} FormField */
/** @typedef {import('./builder-sections.js').SectionMarker} SectionMarker */

/**
 * Map one builder `FieldState` to its wire item — a real field, or a section
 * marker that `extractSections` turns into grouping.
 * @param {any} f - FormBuilder FieldState
 * @returns {FormField | SectionMarker}
 */
export function builderItemFromState(f) {
  if (f.type === 'section') {
    return {
      id: f.id,
      type: 'section',
      title: f.title || '',
      ...(f.description ? { description: f.description } : {})
    };
  }
  return {
    id: f.id,
    type: f.type,
    label: f.label,
    defaultValue: f.defaultValue,
    options: {
      ...(f.required && { required: true }),
      ...(f.description && { description: f.description }),
      ...(f.placeholder && { placeholder: f.placeholder }),
      ...(f.min !== undefined && { min: f.min }),
      ...(f.max !== undefined && { max: f.max }),
      // `?.` (publish itself indexes this unguarded): the preview encodes
      // half-built state where a freshly added row may not have the array yet.
      ...(CHOICE_TYPES.includes(f.type) &&
        f.selectOptions?.length > 0 && { options: f.selectOptions }),
      ...(f.multiple && { multiple: true }),
      ...(f.displayIf ? { displayIf: f.displayIf } : {})
    },
    ...(f.vocab?.address ? { vocab: f.vocab } : {}),
    ...(f.output ? { output: f.output } : {})
  };
}

/**
 * Mirror a field's vocab binding into the naddr text input the builder shows.
 * @param {{ address: string, relay: string } | undefined} vocab
 * @returns {string}
 */
function vocabToNaddr(vocab) {
  if (!vocab?.address) return '';
  const [kindStr, pubkey, ...rest] = vocab.address.split(':');
  const identifier = rest.join(':');
  try {
    return nip19.naddrEncode({
      kind: Number(kindStr),
      pubkey,
      identifier,
      relays: vocab.relay ? [vocab.relay] : []
    });
  } catch {
    return '';
  }
}

/**
 * Map a parsed FormField back to builder FieldState — the edit direction,
 * inverse of `builderItemFromState`. Lives here rather than in FormBuilder so
 * the whole edit cycle (parse -> state -> tags) is testable as a pure round
 * trip: a property this mapping drops is silently erased the first time an
 * author re-opens their own form, and that failure is invisible from the
 * publish direction alone.
 * @param {import('./format.js').FormField} f
 * @returns {any}
 */
export function fieldToState(f) {
  return {
    id: f.id,
    type: f.type,
    label: f.label,
    defaultValue: f.defaultValue || '',
    required: f.options?.required || false,
    description: f.options?.description || '',
    placeholder: f.options?.placeholder || '',
    min: f.options?.min,
    max: f.options?.max,
    selectOptions: f.options?.options || [],
    multiple: f.options?.multiple || false,
    vocab: f.vocab,
    output: LOCKED_FIELD_OUTPUTS[f.type] ?? f.output,
    vocabNaddrInput: vocabToNaddr(f.vocab),
    vocabError: '',
    displayIf: f.options?.displayIf
  };
}

/**
 * Builder state → kind-30168 tags.
 *
 * `dTag` may be empty: a preview is legitimately encoded before the author has
 * settled an identifier, and `buildFormTemplateTags` emits `['d','']` happily.
 * Publishing guards on a non-empty `dTag` separately, at its own call site.
 *
 * @param {any[]} fields - FormBuilder FieldState[] (fields + section markers)
 * @param {{
 *   dTag?: string,
 *   name?: string,
 *   description?: string,
 *   public?: boolean,
 *   confirmationMessage?: string,
 *   forkOf?: { address: string, relay: string }
 * }} [meta]
 * @returns {string[][]}
 */
export function builderStateToTags(fields, meta = {}) {
  const items = (fields || []).map(builderItemFromState);
  const { fields: formFields, sections } = extractSections(items);

  return buildFormTemplateTags(meta.dTag || '', formFields, {
    name: meta.name,
    description: meta.description,
    public: meta.public,
    confirmationMessage: meta.confirmationMessage,
    ...(meta.forkOf ? { forkOf: meta.forkOf } : {}),
    ...(sections.length > 0 ? { sections } : {})
  });
}

/**
 * Builder state → an *unsigned, unpublished* kind-30168 event good enough to
 * render. `parseFormTemplate` reads only `event.tags`, so `id`/`sig` are left
 * empty rather than faked: nothing downstream verifies them, and a plausible
 * looking fake id would be a lie a future reader could act on.
 *
 * This never touches a signer, a relay or the event factory — a preview must
 * not be able to publish, and keeping it out of this path is what guarantees it.
 *
 * @param {any[]} fields - FormBuilder FieldState[]
 * @param {Parameters<typeof builderStateToTags>[1]} [meta]
 * @param {string} [pubkey] - author, for display only
 * @returns {import('nostr-tools').NostrEvent}
 */
export function builderStateToPreviewEvent(fields, meta = {}, pubkey = '') {
  return /** @type {any} */ ({
    kind: FORM_TEMPLATE_KIND,
    tags: builderStateToTags(fields, meta),
    content: '',
    pubkey,
    // Fixed, not Date.now(): the tag signature is what should drive a preview
    // remount, and a ticking created_at would churn it on every keystroke.
    created_at: 0,
    id: '',
    sig: ''
  });
}
