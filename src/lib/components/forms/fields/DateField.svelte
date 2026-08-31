<script>
  import EuropeanDateInput from '$lib/components/shared/EuropeanDateInput.svelte';

  /** Registry-contract wrapper around EuropeanDateInput (bindable ISO value). */
  let { field, value = '', error = null, readonly = false, onchange } = $props();

  // Writable $derived: reflects external prefill (edit mode, auto-fill) by
  // default, but bind:value below can reassign it as the user types — Svelte
  // then re-derives from `value` once the prop itself changes again.
  let local = $derived(value);
  $effect(() => {
    if (local !== value) onchange(local);
  });
</script>

<EuropeanDateInput
  id={field.id}
  bind:value={local}
  placeholder={field.options?.placeholder || 'TT.MM.JJJJ'}
  class={`input-bordered input w-full ${error ? 'input-error' : ''}`}
  disabled={readonly}
/>
