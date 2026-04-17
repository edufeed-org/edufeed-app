<script>
  import { useConceptScheme, useSchemeConcepts } from '$lib/stores/vocab-store.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';

  /**
   * @typedef {Object} Props
   * @property {import('$lib/helpers/forms.js').FormField} field
   * @property {import('$lib/helpers/form-to-amb.js').SelectedConcept[]} [value]
   * @property {(v: import('$lib/helpers/form-to-amb.js').SelectedConcept[]) => void} [onchange]
   * @property {boolean} [multiple]
   */
  /** @type {Props} */
  let { field, value = [], onchange, multiple = false } = $props();

  const getScheme = useConceptScheme(() => field.vocab);
  const getConcepts = useSchemeConcepts(
    () => field.vocab?.address,
    () => [field.vocab?.relay, ...getAllLookupRelays()].filter(Boolean)
  );

  const scheme = $derived(getScheme());
  const concepts = $derived(getConcepts());

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   * @returns {import('$lib/helpers/form-to-amb.js').SelectedConcept}
   */
  function toSelected(evt) {
    const d = evt.tags.find((t) => t[0] === 'd')?.[1] || '';
    const iTag = evt.tags.find((t) => t[0] === 'i')?.[1];
    const external = iTag || `nostr:39737:${evt.pubkey}:${d}`;
    /** @type {Record<string,string>} */
    const labels = {};
    for (const t of evt.tags) {
      if (t[0] === 'prefLabel' && t[1] && t[2]) labels[t[2]] = t[1];
    }
    return {
      id: external,
      nostrCoord: `39737:${evt.pubkey}:${d}`,
      relay: field.vocab?.relay || '',
      labels
    };
  }

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   * @param {string} [lang]
   */
  function displayLabel(evt, lang = 'de') {
    const pref = evt.tags.find((t) => t[0] === 'prefLabel' && t[2] === lang)?.[1];
    return (
      pref ||
      evt.tags.find((t) => t[0] === 'prefLabel')?.[1] ||
      evt.tags.find((t) => t[0] === 'd')?.[1]
    );
  }

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   */
  function toggle(evt) {
    const candidate = toSelected(evt);
    const without = value.filter((v) => v.nostrCoord !== candidate.nostrCoord);
    const next = multiple
      ? without.length === value.length
        ? [...value, candidate]
        : without
      : without.length === value.length
        ? [candidate]
        : [];
    onchange?.(next);
  }

  /**
   * @param {import('nostr-tools').NostrEvent} evt
   */
  function isSelected(evt) {
    const d = evt.tags.find((t) => t[0] === 'd')?.[1] || '';
    const coord = `39737:${evt.pubkey}:${d}`;
    return value.some((v) => v.nostrCoord === coord);
  }
</script>

<div class="form-control w-full">
  {#if !scheme}
    <div class="text-sm opacity-70">Lade Vokabular …</div>
  {:else if concepts.length === 0}
    <div class="text-sm opacity-70">Keine Konzepte gefunden.</div>
  {:else}
    <ul class="menu max-h-64 overflow-y-auto rounded-box bg-base-200">
      {#each concepts as c (c.id)}
        <li>
          <button type="button" class:active={isSelected(c)} onclick={() => toggle(c)}>
            {displayLabel(c)}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
