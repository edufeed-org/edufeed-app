<!-- src/lib/components/educational/AiSuggestionReviewDialog.svelte -->
<script>
  import {
    getFieldConflict,
    ENRICHABLE_FIELDS
  } from '$lib/helpers/educational/getFieldConflict.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {boolean} open
   * @property {Record<string, any>} formData
   * @property {Record<string, Array<{id: string, label?: string}>>} aboutByVocab
   * @property {{source: string, payload: Record<string, any>, evidence?: Record<string, string>} | null} aiSuggestions
   * @property {Set<string>} dismissedFields
   * @property {(field: string, action: 'replace' | 'merge' | 'dismiss') => void} onapply
   * @property {() => void} onclose
   */
  /** @type {Props} */
  let {
    open,
    formData,
    aboutByVocab,
    aiSuggestions,
    dismissedFields,
    onapply: _onapply,
    onclose
  } = $props();

  const conflictRows = $derived.by(() => {
    if (!aiSuggestions) return [];
    return ENRICHABLE_FIELDS.filter((f) => !dismissedFields.has(f))
      .map((f) => ({ field: f, state: getFieldConflict(f, formData, aboutByVocab, aiSuggestions) }))
      .filter((r) => r.state === 'conflict' || r.state === 'additive');
  });
</script>

{#if open}
  <div
    role="dialog"
    aria-modal="true"
    aria-label={m.amb_form_review_dialog_title()}
    class="modal-open modal"
  >
    <div class="modal-box max-w-2xl">
      <h3 class="text-lg font-bold">{m.amb_form_review_dialog_title()}</h3>

      {#if conflictRows.length === 0}
        <p class="py-4 text-base-content/70">{m.amb_form_review_empty()}</p>
      {:else}
        <ul class="divide-y divide-base-300 py-2">
          {#each conflictRows as row (row.field)}
            <li class="py-3" data-testid={`review-row-${row.field}`} data-state={row.state}></li>
          {/each}
        </ul>
      {/if}

      <div class="modal-action">
        <button type="button" class="btn btn-sm" onclick={onclose}
          >{m.amb_form_review_close()}</button
        >
      </div>
    </div>
    <button
      type="button"
      class="modal-backdrop"
      aria-label={m.amb_form_review_close()}
      onclick={onclose}
    ></button>
  </div>
{/if}
