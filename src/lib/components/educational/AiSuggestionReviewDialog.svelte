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
   * @property {import('$lib/helpers/educational/applyEnrichedPayload.js').ExtractMetadataResult | null} aiSuggestions
   * @property {Set<string>} dismissedFields
   * @property {(field: string, action: 'replace' | 'merge' | 'dismiss') => void} onapply
   * @property {() => void} onclose
   */
  /** @type {Props} */
  let { open, formData, aboutByVocab, aiSuggestions, dismissedFields, onapply, onclose } = $props();

  const STRING_FIELDS_FOR_DISPLAY = new Set([
    'name',
    'description',
    'image',
    'inLanguage',
    'license',
    'methodOther'
  ]);

  function isStringField(field) {
    return STRING_FIELDS_FOR_DISPLAY.has(field);
  }

  function formatValue(field, fd, abv) {
    if (field === 'ekwFachrichtung') {
      return (abv?.ekwFachrichtung ?? []).map((c) => c.label || c.id).join(', ');
    }
    const v = fd?.[field];
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === 'string' ? x : x?.label || x?.id || ''))
        .filter(Boolean)
        .join(', ');
    }
    return v ?? '';
  }

  function formatAiValue(field, ai) {
    const v = ai?.payload?.[field];
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === 'string' ? x : x?.prefLabel || x?.label || x?.id || ''))
        .filter(Boolean)
        .join(', ');
    }
    return v ?? '';
  }

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
            <li class="py-3" data-testid={`review-row-${row.field}`} data-state={row.state}>
              <div class="font-semibold">{row.field}</div>
              <div class="grid grid-cols-2 gap-3 py-1 text-sm">
                <div>
                  <div class="text-xs text-base-content/60">{m.amb_form_review_your_entry()}</div>
                  <div>{formatValue(row.field, formData, aboutByVocab)}</div>
                </div>
                <div>
                  <div class="text-xs text-base-content/60">
                    {m.amb_form_review_ai_suggestion()}
                  </div>
                  <div>{formatAiValue(row.field, aiSuggestions)}</div>
                </div>
              </div>
              {#if aiSuggestions?.evidence?.[row.field]}
                <div class="text-xs text-base-content/60 italic">
                  "{aiSuggestions.evidence[row.field]}"
                </div>
              {/if}
              <div class="mt-2 flex gap-2">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onclick={() => onapply(row.field, 'dismiss')}
                >
                  {m.amb_form_review_keep_mine()}
                </button>
                {#if isStringField(row.field)}
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    onclick={() => onapply(row.field, 'replace')}
                  >
                    {m.amb_form_review_use_ai()}
                  </button>
                {:else if row.state === 'additive'}
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    onclick={() => onapply(row.field, 'merge')}
                  >
                    {m.amb_form_review_add()}
                  </button>
                {:else}
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    onclick={() => onapply(row.field, 'replace')}
                  >
                    {m.amb_form_review_replace()}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm"
                    onclick={() => onapply(row.field, 'merge')}
                  >
                    {m.amb_form_review_merge()}
                  </button>
                {/if}
              </div>
            </li>
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
