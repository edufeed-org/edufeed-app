<script>
  import CreatorInput from '$lib/components/educational/CreatorInput.svelte';
  import { manager } from '$lib/stores/accounts.svelte';

  /** Registry-contract adapter around CreatorInput (value = Creator[]). CreatorInput
   *  has no disabled/readonly affordance, so `readonly` is accepted but unused. */
  let { field, value = [], error = null, readonly: _readonly = false, onchange } = $props();

  // Writable $derived: reflects external prefill (edit mode, auto-fill) by
  // default; bind:creators below can reassign it. CreatorInput invokes
  // `onchange` directly on every add/remove/edit, so no outbound $effect is
  // needed here (see DateField for the pattern when the inner input lacks
  // its own onchange prop).
  let creators = $derived(Array.isArray(value) ? value : []);
</script>

<CreatorInput
  bind:creators
  label={field.label}
  required={field.options?.required}
  helpText={field.options?.helpText || ''}
  activeUserPubkey={manager.active?.pubkey || ''}
  onchange={(c) => onchange(c)}
/>
{#if error}<div class="label"><span class="label-text-alt text-error">{error}</span></div>{/if}
