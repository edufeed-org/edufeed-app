<script>
  // Mirrors ResourceFormWizard / EventAttributesFields: the parent keeps a
  // compact `{id, label}` shape and rebuilds the picker's rich value (with an
  // empty nostrCoord) from it on every render.
  import FormConceptPicker from '$lib/components/forms/FormConceptPicker.svelte';

  /**
   * @type {{
   *   field: any,
   *   initial?: {id: string, label: string}[],
   *   onemit?: (v: any[]) => void,
   *   storeLabelAsId?: boolean
   * }}
   */
  // storeLabelAsId mirrors a parent that persists AI-enriched `{id: prefLabel}`
  // values verbatim instead of the canonical id the picker emits.
  let { field, initial = [], onemit, storeLabelAsId = false } = $props();

  /** @type {{id: string, label: string}[]} */
  // svelte-ignore state_referenced_locally
  let compact = $state(initial);

  /** @type {import('$lib/helpers/educational/formReference.js').SelectedConcept[]} */
  const rich = $derived(
    compact.map((c) => ({
      id: c.id,
      nostrCoord: '',
      relay: field.vocab?.relay ?? '',
      labels: /** @type {Record<string, string>} */ (c.label ? { de: c.label } : {})
    }))
  );

  /** @param {any[]} picked */
  function handleChange(picked) {
    onemit?.(picked);
    compact = picked.map((p) => ({
      id: storeLabelAsId ? p.labels?.de || p.id : p.id,
      label: p.labels?.de || ''
    }));
  }
</script>

<FormConceptPicker {field} multiple={true} value={rich} onchange={handleChange} />
<p data-testid="compact-count">{compact.length}</p>
