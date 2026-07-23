<script>
  import CreatorInput from '$lib/components/educational/CreatorInput.svelte';
  import { manager } from '$lib/stores/accounts.svelte';

  /** Registry-contract adapter around CreatorInput (value = Creator[]).
   *  FieldsRenderer renders the field label/required marker and the error
   *  generically (wrapping this component), so the adapter must NOT render its
   *  own — it passes label="" to suppress CreatorInput's heading, and omits any
   *  error block. `error` is accepted per the registry contract but unused. */
  let { field, value = [], error: _error = null, readonly = false, onchange } = $props();

  // Writable $derived mirror of the external value (edit-mode prefill);
  // bind:creators below reassigns it as the user edits (see DateField).
  let creators = $derived(Array.isArray(value) ? value : []);
</script>

{#if readonly}
  <!-- Static, non-interactive view (preview route renders FormRenderer readonly). -->
  <ul class="space-y-1">
    {#each creators as creator, i (i)}
      <li class="flex items-center gap-2 text-sm">
        {#if creator.honorificPrefix}<span>{creator.honorificPrefix}</span>{/if}
        <span class="font-medium">{creator.name}</span>
        <span class="text-base-content/60">{creator.type}</span>
      </li>
    {/each}
  </ul>
{:else}
  <CreatorInput
    bind:creators
    label=""
    helpText={field.options?.helpText || ''}
    activeUserPubkey={manager.active?.pubkey || ''}
    onchange={(c) => onchange(c)}
  />
{/if}
