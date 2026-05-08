<!--
  Inline per-field AI suggestion review badge. Renders nothing when the AI
  state is 'match' / 'none' or when the field has been dismissed; otherwise
  shows the AI value with action buttons appropriate to the conflict shape
  (string vs additive array vs conflicting array).
-->
<script>
  import { getFieldConflict, STRING_FIELDS } from '$lib/helpers/educational/getFieldConflict.js';
  import { formatAiFieldValue } from '$lib/helpers/educational/formatFieldValue.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {string} field
   * @property {Record<string, any>} formData
   * @property {Record<string, Array<{id: string, label?: string}>>} aboutByVocab
   * @property {{ payload?: Record<string, any>, evidence?: Record<string, string> } | null} aiSuggestions
   * @property {Set<string>} dismissedFields
   * @property {(field: string, action: 'replace' | 'merge' | 'dismiss') => void} onapply
   */
  /** @type {Props} */
  let { field, formData, aboutByVocab, aiSuggestions, dismissedFields, onapply } = $props();

  const state = $derived(getFieldConflict(field, formData, aboutByVocab, aiSuggestions));
  const aiValue = $derived(formatAiFieldValue(field, aiSuggestions));
  const evidence = $derived(aiSuggestions?.evidence?.[field]);
  const isString = $derived(STRING_FIELDS.has(field));
  const visible = $derived(
    (state === 'conflict' || state === 'additive') && !dismissedFields.has(field)
  );
  const valueTitle = $derived(evidence ? `${aiValue}\n\n${evidence}` : aiValue);
</script>

{#if visible}
  <div
    data-testid={`field-ai-badge-${field}`}
    data-state={state}
    class="flex flex-wrap items-center gap-2 text-xs text-base-content/70"
  >
    <span aria-hidden="true">✨</span>
    <span>{m.amb_form_review_ai_suggestion()}:</span>
    <span title={valueTitle}>{aiValue}</span>

    {#if isString}
      <button
        type="button"
        class="btn btn-xs btn-primary"
        onclick={() => onapply(field, 'replace')}
      >
        {m.amb_form_review_use_ai()}
      </button>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => onapply(field, 'dismiss')}>
        {m.amb_form_review_keep_mine()}
      </button>
    {:else if state === 'additive'}
      <button type="button" class="btn btn-xs btn-primary" onclick={() => onapply(field, 'merge')}>
        {m.amb_form_review_add()}
      </button>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => onapply(field, 'dismiss')}>
        {m.amb_form_review_keep_mine()}
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-xs btn-primary"
        onclick={() => onapply(field, 'replace')}
      >
        {m.amb_form_review_replace()}
      </button>
      <button type="button" class="btn btn-xs" onclick={() => onapply(field, 'merge')}>
        {m.amb_form_review_merge()}
      </button>
      <button type="button" class="btn btn-ghost btn-xs" onclick={() => onapply(field, 'dismiss')}>
        {m.amb_form_review_keep_mine()}
      </button>
    {/if}

    {#if evidence}
      <span class="basis-full italic">"{evidence}"</span>
    {/if}
  </div>
{/if}
