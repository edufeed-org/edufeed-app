<!-- Stand-in for FormConceptPicker: shows its value, emits one fixed concept. -->
<script>
  /** @type {{ value?: any[], onchange?: (v: any[]) => void }} */
  let { value = [], onchange } = $props();
</script>

<span data-testid="concept-picker-value">{JSON.stringify(value.map((v) => v.id))}</span>
<button
  type="button"
  data-testid="concept-picker-pick"
  onclick={() =>
    onchange?.([
      {
        id: 'https://w3id.org/kim/educationalLevel/level_C',
        nostrCoord: '',
        relay: '',
        labels: { de: 'Fortbildung', en: 'Advanced training' }
      }
    ])}>pick</button
>
