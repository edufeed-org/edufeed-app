<script>
  import { useConceptScheme, useSchemeConcepts } from '$lib/stores/vocab-store.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { conceptEventsToSkosTree } from '$lib/helpers/educational/conceptEventsToSkosTree.js';
  import SKOSDropdown from '$lib/components/educational/SKOSDropdown.svelte';
  import { parseConcept } from 'nostr-vocab-core/parsers';
  import { CONCEPT_KIND } from 'nostr-vocab-core/constants';
  import { createReplaceableAddress } from 'applesauce-core/helpers';

  /**
   * @typedef {Object} ParsedConcept
   * @property {string | undefined} d
   * @property {string | undefined} externalUri
   * @property {{ value: string, lang: string }[]} prefLabels
   */

  /**
   * @typedef {Object} Props
   * @property {import('$lib/helpers/forms.js').FormField} field
   * @property {import('$lib/helpers/educational/formReference.js').SelectedConcept[]} [value]
   * @property {(v: import('$lib/helpers/educational/formReference.js').SelectedConcept[]) => void} [onchange]
   * @property {boolean} [multiple]
   * @property {boolean} [disabled]
   */
  /** @type {Props} */
  let { field, value = [], onchange, multiple = false, disabled = false } = $props();

  const getScheme = useConceptScheme(() => field.vocab);
  const getConcepts = useSchemeConcepts(
    () => field.vocab?.address,
    () => /** @type {string[]} */ ([field.vocab?.relay, ...getAllLookupRelays()].filter(Boolean))
  );

  const scheme = $derived(getScheme());
  const conceptEvents = $derived(getConcepts());
  const locale = $derived(getLocale());

  /**
   * Derive a stable concept id from a Concept event (kind CONCEPT_KIND):
   * prefer the external URI (parsed `externalUri`), else fall back to a
   * Nostr coord URI built from the canonical `createReplaceableAddress`.
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {string}
   */
  function conceptId(evt) {
    const parsed = /** @type {ParsedConcept} */ (parseConcept(evt));
    if (parsed.externalUri) return parsed.externalUri;
    const coord = createReplaceableAddress(CONCEPT_KIND, evt.pubkey, parsed.d || '');
    return `nostr:${coord}`;
  }

  /**
   * Extract prefLabels by language from a Concept event using the library parser.
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {Record<string,string>}
   */
  function labelsFromEvent(evt) {
    const parsed = /** @type {ParsedConcept} */ (parseConcept(evt));
    /** @type {Record<string,string>} */
    const labels = {};
    for (const { value, lang } of parsed.prefLabels || []) {
      if (value && lang) labels[lang] = value;
    }
    return labels;
  }

  /**
   * Pick the best label from a language map with a locale → de → en → first fallback chain.
   * @param {Record<string,string> | undefined} labels
   * @param {string} lang
   * @returns {string}
   */
  function pickLabel(labels, lang) {
    if (!labels) return '';
    return labels[lang] || labels.de || labels.en || Object.values(labels)[0] || '';
  }

  /**
   * Build the rich SelectedConcept shape expected by form-to-amb from a
   * concept event. `nostrCoord` is built via `createReplaceableAddress` so it
   * uses the canonical CONCEPT_KIND prefix regardless of any future NIP shift.
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {import('$lib/helpers/educational/formReference.js').SelectedConcept}
   */
  function toRichSelected(evt) {
    const parsed = /** @type {ParsedConcept} */ (parseConcept(evt));
    return {
      id: conceptId(evt),
      nostrCoord: createReplaceableAddress(CONCEPT_KIND, evt.pubkey, parsed.d || ''),
      relay: field.vocab?.relay || '',
      labels: labelsFromEvent(evt)
    };
  }

  // Map of concept id → full event for re-hydrating selections back to the rich shape.
  const eventById = $derived.by(() => {
    /** @type {Record<string, import('nostr-tools').NostrEvent>} */
    const map = {};
    for (const e of conceptEvents) map[conceptId(e)] = e;
    return map;
  });

  // Heal incoming values whose `id` is a label rather than a canonical
  // concept id. AI enrichment (amb-mcp) returns `{id: prefLabel}`, which
  // chips can render but the option-checked state can't match. When concept
  // events are loaded, look each unmatched value up by label and emit
  // `onchange` once with the corrected rich entries — the form data then
  // carries canonical IDs all the way through to publish.
  $effect(() => {
    if (!conceptEvents.length || !value.length) return;
    /** @type {Record<string, import('nostr-tools').NostrEvent>} */
    const byLabel = {};
    for (const evt of conceptEvents) {
      const labels = labelsFromEvent(evt);
      for (const label of Object.values(labels)) {
        if (label && !byLabel[label]) byLabel[label] = evt;
      }
    }
    let changed = false;
    const healed = value.map((v) => {
      if (eventById[v.id]) return v;
      const label = pickLabel(v.labels, locale);
      const evt = label ? byLabel[label] : undefined;
      if (!evt) return v;
      changed = true;
      return toRichSelected(evt);
    });
    if (changed) onchange?.(healed);
  });

  // Concepts adapted to SKOSDropdown's SKOSConcept shape, with hierarchy
  // (level/parentId) extracted from `broader` tags and concepts emitted in
  // DFS order so SKOSDropdown's tree UI renders correctly.
  const dropdownConcepts = $derived(
    conceptEventsToSkosTree(conceptEvents, conceptId, labelsFromEvent, locale)
  );

  // Translate incoming rich value[] into SKOSDropdown's { id, label } shape.
  const dropdownSelected = $derived(
    value.map((v) => ({ id: v.id, label: pickLabel(v.labels, locale) }))
  );

  /**
   * Invoked when SKOSDropdown emits a new selection. Re-hydrates each { id, label }
   * back to the rich SelectedConcept shape so form output tags still carry nostrCoord
   * and labels by language.
   * @param {{ id: string, label: string }[]} arr
   */
  function handleChange(arr) {
    const out = arr.map((item) => {
      const evt = eventById[item.id];
      if (evt) return toRichSelected(evt);
      // Preserve any pre-existing rich entry with the same id (e.g., initial value
      // from an edit flow where the concept event hasn't re-loaded yet).
      const existing = value.find((v) => v.id === item.id);
      if (existing) return existing;
      // Synthetic fallback — should be rare; only the label is known.
      return {
        id: item.id,
        nostrCoord: '',
        relay: field.vocab?.relay || '',
        labels: { [locale]: item.label }
      };
    });
    onchange?.(out);
  }
</script>

<SKOSDropdown
  concepts={dropdownConcepts}
  isLoading={!scheme && dropdownConcepts.length === 0}
  selected={dropdownSelected}
  {multiple}
  {disabled}
  maxSelections={100}
  onchange={handleChange}
/>
