<!--
  Inline badge that flags a wizard field as auto-filled, so the user knows
  the value didn't come from their typing. Two flavours:

   - source: 'llm-enriched'  → "Smart fill ✨" with the LLM's evidence quote
                                exposed via the title attribute (hover).
   - source: 'amb-jsonld'    → "AMB" — the resource page already exposed
                                AMB JSON-LD, so the value is extracted, not
                                inferred. No evidence quote.

  When `onclear` is provided, a small ✗ button is rendered for one-click
  rejection of the suggestion (clears the field + the badge).
-->
<script>
  /**
   * @typedef {{ source: 'llm-enriched' | 'amb-jsonld', evidence?: string }} Provenance
   */

  /** @type {{ provenance: Provenance | null | undefined, onclear?: () => void }} */
  let { provenance, onclear } = $props();
</script>

{#if provenance}
  {#if provenance.source === 'llm-enriched'}
    <span class="badge gap-1 badge-sm badge-info" title={provenance.evidence ?? ''}>
      <span>Smart fill ✨</span>
      {#if onclear}
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-xs"
          aria-label="Clear smart-filled value"
          onclick={onclear}
        >
          ✗
        </button>
      {/if}
    </span>
  {:else}
    <span class="badge gap-1 badge-sm badge-success">
      <span>AMB</span>
      {#if onclear}
        <button
          type="button"
          class="btn btn-circle btn-ghost btn-xs"
          aria-label="Clear AMB-extracted value"
          onclick={onclear}
        >
          ✗
        </button>
      {/if}
    </span>
  {/if}
{/if}
