<!--
  ExtFacetField
  Renders a single form-driven ext facet:
  - vocab-bound (field.vocab set) → chip list resolved from useSchemeConcepts
  - scalar (no vocab) → free-text input

  Emits the selection as { id: string }[] (concept URIs) or { value: string }[]
  (scalar) so LearningContentFilters can assemble the extFields map.
-->
<script>
  import { useSchemeConcepts } from '$lib/stores/vocab-store.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  /**
   * @typedef {import('$lib/helpers/forms.js').FormField} FormField
   * @typedef {{ id?: string, value?: string }} ExtValue
   */

  /**
   * @type {{
   *   field: FormField,
   *   value?: ExtValue[],
   *   onchange: (v: ExtValue[]) => void
   * }}
   */
  let { field, value = [], onchange } = $props();

  const locale = $derived(getLocale());

  // Vocab-bound path: load scheme concepts
  const getConcepts = useSchemeConcepts(
    () => field.vocab?.address || '',
    () => /** @type {string[]} */ ([field.vocab?.relay, ...getAllLookupRelays()].filter(Boolean))
  );
  const concepts = $derived(field.vocab ? getConcepts() : []);

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {string}
   */
  function conceptUri(evt) {
    const iTag = evt.tags.find((t) => t[0] === 'i')?.[1];
    if (iTag) return iTag;
    const d = evt.tags.find((t) => t[0] === 'd')?.[1] || '';
    return `nostr:39737:${evt.pubkey}:${d}`;
  }

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {string}
   */
  function conceptLabel(evt) {
    const lang = locale;
    const pref = evt.tags.find((t) => t[0] === 'prefLabel' && t[2] === lang)?.[1];
    return (
      pref ||
      evt.tags.find((t) => t[0] === 'prefLabel')?.[1] ||
      evt.tags.find((t) => t[0] === 'd')?.[1] ||
      evt.id.slice(0, 8)
    );
  }

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {boolean}
   */
  function isSelected(evt) {
    const uri = conceptUri(evt);
    return value.some((v) => v.id === uri);
  }

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   */
  function toggleConcept(evt) {
    const uri = conceptUri(evt);
    const without = value.filter((v) => v.id !== uri);
    const next = without.length === value.length ? [...value, { id: uri }] : without;
    onchange(next);
  }

  // Scalar path: single text input value
  const scalarValue = $derived(value[0]?.value ?? '');

  /**
   * @param {Event} e
   */
  function onScalarInput(e) {
    const v = /** @type {HTMLInputElement} */ (e.target).value;
    onchange(v ? [{ value: v }] : []);
  }
</script>

<div class="form-control" data-testid="ext-facet-field" data-field-id={field.id}>
  {#if field.vocab}
    <div class="label">
      <span class="label-text text-sm font-medium">{field.label || field.id}</span>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each concepts as concept (concept.id)}
        {@const selected = isSelected(concept)}
        <button
          type="button"
          class="badge cursor-pointer"
          class:badge-primary={selected}
          class:badge-outline={!selected}
          onclick={() => toggleConcept(concept)}
        >
          {conceptLabel(concept)}
        </button>
      {/each}
      {#if concepts.length === 0}
        <span class="text-xs text-base-content/50">…</span>
      {/if}
    </div>
  {:else}
    <label class="label">
      <span class="label-text text-sm font-medium">{field.label || field.id}</span>
    </label>
    <input
      type="text"
      class="input-bordered input input-sm w-full"
      value={scalarValue}
      oninput={onScalarInput}
      placeholder={field.options?.placeholder || ''}
    />
  {/if}
</div>
