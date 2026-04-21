<script>
  import FormBuilderFieldRow from '../forms/FormBuilderFieldRow.svelte';

  /** @type {{ initialField: any, fieldIndex?: number, existing?: boolean, onUpdate?: (field: any) => void }} */
  let { initialField, fieldIndex = 0, existing = false, onUpdate } = $props();

  // Wrap the field in $state so child mutations trigger reactive updates
  // in the preview block. Plain JS objects don't propagate mutations.
  let field = $state(initialField);

  // Re-export current field snapshot to the test via callback.
  $effect(() => {
    onUpdate?.(field);
  });
</script>

<FormBuilderFieldRow bind:field fields={[field]} {fieldIndex} {existing} />
