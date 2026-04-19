<script>
  import { useConceptScheme, useSchemeConcepts } from '$lib/stores/vocab-store.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { conceptEventsToSkosTree } from '$lib/helpers/educational/conceptEventsToSkosTree.js';
  import SKOSDropdown from '$lib/components/educational/SKOSDropdown.svelte';

  /**
   * @typedef {Object} Props
   * @property {import('$lib/helpers/forms.js').FormField} field
   * @property {import('$lib/helpers/form-to-amb.js').SelectedConcept[]} [value]
   * @property {(v: import('$lib/helpers/form-to-amb.js').SelectedConcept[]) => void} [onchange]
   * @property {boolean} [multiple]
   * @property {boolean} [disabled]
   */
  /** @type {Props} */
  let { field, value = [], onchange, multiple = false, disabled = false } = $props();

  const getScheme = useConceptScheme(() => field.vocab);
  const getConcepts = useSchemeConcepts(
    () => field.vocab?.address,
    () => [field.vocab?.relay, ...getAllLookupRelays()].filter(Boolean)
  );

  const scheme = $derived(getScheme());
  const conceptEvents = $derived(getConcepts());
  const locale = $derived(getLocale());

  /**
   * Derive a stable concept id from a kind-39737 event:
   * prefer the external URI (`i` tag), else fall back to a Nostr coord URI.
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {string}
   */
  function conceptId(evt) {
    const d = evt.tags.find((t) => t[0] === 'd')?.[1] || '';
    const iTag = evt.tags.find((t) => t[0] === 'i')?.[1];
    return iTag || `nostr:39737:${evt.pubkey}:${d}`;
  }

  /**
   * Extract prefLabels by language from a kind-39737 event.
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {Record<string,string>}
   */
  function labelsFromEvent(evt) {
    /** @type {Record<string,string>} */
    const labels = {};
    for (const t of evt.tags) {
      if (t[0] === 'prefLabel' && t[1] && t[2]) labels[t[2]] = t[1];
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
   * Build the rich SelectedConcept shape expected by form-to-amb from a concept event.
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {import('$lib/helpers/form-to-amb.js').SelectedConcept}
   */
  function toRichSelected(evt) {
    const d = evt.tags.find((t) => t[0] === 'd')?.[1] || '';
    return {
      id: conceptId(evt),
      nostrCoord: `39737:${evt.pubkey}:${d}`,
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
