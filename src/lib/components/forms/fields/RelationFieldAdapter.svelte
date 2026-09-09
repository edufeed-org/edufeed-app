<script>
  import AMBResourceSearchInput from '$lib/components/educational/AMBResourceSearchInput.svelte';
  import { CloseIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** Registry-contract adapter: value = [{ coordinate, relayHint? } | { name }].
   *  Two entry shapes: a relay resource picked via AMBResourceSearchInput, or a
   *  free-text container name ("Erschienen in") for works that are not events
   *  on our relays — the serializer maps the latter to isPartOf {name}. The
   *  picker is add-only and never holds a value, so
   *  this adapter owns the selected-relation list.
   *  FieldsRenderer renders the field label/required marker and the error
   *  generically (wrapping this component), so the adapter must NOT render
   *  its own — `error` is accepted per the registry contract but unused. */
  /**
   * @type {{
   *   field?: any,
   *   value?: any,
   *   error?: any,
   *   readonly?: boolean,
   *   onchange: (v: ({coordinate:string, relayHint?:string} | {name:string})[]) => void
   * }}
   */
  let { field: _field, value = [], error: _error = null, readonly = false, onchange } = $props();

  // Read-only render mirror of the external value. FormRenderer seeds a
  // non-vocab field with the string default (''), so coerce non-arrays to [].
  // The ONLY outbound path is add()/remove() calling onchange directly — never
  // sync from an effect: `[] !== ''` would fire a spurious onchange on mount
  // (mutating values[field] ''→[] with no user action). After onchange the
  // parent's updated value flows back and `refs` re-derives.
  let refs = $derived(Array.isArray(value) ? value : []);

  /** Stable identity for either entry shape. @param {any} r */
  const keyOf = (r) => (r.coordinate ? 'c:' + r.coordinate : 'n:' + r.name);

  /** @param {{coordinate:string, relayHint?:string}} ref */
  function add(ref) {
    if (refs.some((r) => r.coordinate === ref.coordinate)) return;
    onchange([...refs, { coordinate: ref.coordinate, relayHint: ref.relayHint || '' }]);
  }

  /**
   * Commit the typed container name. Fires on Enter AND on blur so typed text
   * is never silently lost (same contract as the options editor).
   * @param {HTMLInputElement} input
   */
  function addName(input) {
    const name = input.value.trim();
    if (!name) return;
    if (refs.some((r) => r.name === name)) {
      input.value = '';
      return;
    }
    onchange([...refs, { name }]);
    input.value = '';
  }

  /** @param {any} entry */
  function remove(entry) {
    onchange(refs.filter((r) => keyOf(r) !== keyOf(entry)));
  }
</script>

{#if !readonly}
  <AMBResourceSearchInput exclude={refs.map((r) => r.coordinate).filter(Boolean)} onselect={add} />
  <input
    type="text"
    data-testid="relation-name-input"
    class="input-bordered input input-sm mt-1 w-full"
    placeholder={m.form_relation_name_placeholder()}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addName(e.currentTarget);
      }
    }}
    onblur={(e) => addName(e.currentTarget)}
  />
{/if}
<div class="mt-2 flex flex-col gap-1">
  {#each refs as r (keyOf(r))}
    <div class="flex items-center gap-2 rounded bg-base-200 px-2 py-1 text-sm">
      {#if r.coordinate}
        <code class="flex-1 truncate">{r.coordinate}</code>
      {:else}
        <span class="flex-1 truncate">{r.name}</span>
      {/if}
      {#if !readonly}
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => remove(r)}
          aria-label="Remove"
        >
          <CloseIcon class_="w-3 h-3" />
        </button>
      {/if}
    </div>
  {/each}
</div>
