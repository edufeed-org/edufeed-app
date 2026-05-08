<script>
  import { untrack } from 'svelte';
  import FormBuilderFieldRow from '../forms/FormBuilderFieldRow.svelte';

  /** @type {{ initialField: any, fieldIndex?: number, existing?: boolean, onUpdate?: (field: any) => void }} */
  let { initialField, fieldIndex = 0, existing = false, onUpdate } = $props();

  // Wrap the field in $state so child mutations trigger reactive updates
  // in the preview block. Plain JS objects don't propagate mutations.
  // Read `initialField` inside a closure via `untrack` so the compiler knows
  // we intentionally capture only the initial prop value (it's a snapshot,
  // not a reactive binding).
  let field = $state(untrack(() => initialField));

  // Re-export current field snapshot to the test via callback.
  $effect(() => {
    onUpdate?.(field);
  });
</script>

<FormBuilderFieldRow bind:field fields={[field]} {fieldIndex} {existing} />
