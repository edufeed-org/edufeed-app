<script>
  // Stateful host: holds the field value and feeds the parent's updated value
  // back into RelationFieldAdapter (mirrors FormRenderer), so a picked chip
  // renders via the normal value flow-back rather than local optimistic state.
  import RelationFieldAdapter from '$lib/components/forms/fields/RelationFieldAdapter.svelte';

  /** @type {{ initial?: any, onchange?: (v: any) => void }} */
  let { initial = '', onchange } = $props();
  let value = $state(initial);
</script>

<RelationFieldAdapter
  field={{ id: 'parts', label: 'Parts', output: 'amb:hasPart', options: {} }}
  {value}
  error={null}
  readonly={false}
  onchange={(v) => {
    value = v;
    onchange?.(v);
  }}
/>
