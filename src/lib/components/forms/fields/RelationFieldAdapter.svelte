<script>
  import AMBResourceSearchInput from '$lib/components/educational/AMBResourceSearchInput.svelte';
  import { CloseIcon } from '$lib/components/icons';

  /** Registry-contract adapter: value = [{ coordinate, relayHint? }]. The
   *  picker (AMBResourceSearchInput) is add-only and never holds a value, so
   *  this adapter owns the selected-relation list.
   *  FieldsRenderer renders the field label/required marker and the error
   *  generically (wrapping this component), so the adapter must NOT render
   *  its own — `error` is accepted per the registry contract but unused. */
  let { field: _field, value = [], error: _error = null, readonly = false, onchange } = $props();

  // Writable $derived mirror of the external value (edit-mode prefill), same
  // pattern as DateField/CreatorFieldAdapter — add()/remove() below reassign
  // it (the picker is add-only and never echoes a value back), and the
  // effect notifies the parent only once `refs` actually diverges from the
  // incoming prop, so initial mount doesn't fire a spurious onchange.
  let refs = $derived(Array.isArray(value) ? value : []);
  $effect(() => {
    if (refs !== value) onchange(refs);
  });

  /** @param {{coordinate:string, relayHint?:string}} ref */
  function add(ref) {
    if (refs.some((r) => r.coordinate === ref.coordinate)) return;
    refs = [...refs, { coordinate: ref.coordinate, relayHint: ref.relayHint || '' }];
  }
  /** @param {string} coordinate */
  function remove(coordinate) {
    refs = refs.filter((r) => r.coordinate !== coordinate);
  }
</script>

{#if !readonly}
  <AMBResourceSearchInput exclude={refs.map((r) => r.coordinate)} onselect={add} />
{/if}
<div class="mt-2 flex flex-col gap-1">
  {#each refs as r (r.coordinate)}
    <div class="flex items-center gap-2 rounded bg-base-200 px-2 py-1 text-sm">
      <code class="flex-1 truncate">{r.coordinate}</code>
      {#if !readonly}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => remove(r.coordinate)}
          aria-label="Remove"
        >
          <CloseIcon class_="w-3 h-3" />
        </button>
      {/if}
    </div>
  {/each}
</div>
