<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} AvailableQuestion
   * @property {string} id
   * @property {string} label
   * @property {string} type
   * @property {{id: string, label: string}[]} [selectOptions]
   *
   * @typedef {Object} Rule
   * @property {string} [questionId]
   * @property {string} [operator]
   * @property {string} [value]
   *
   * @typedef {Object} Props
   * @property {{ rules: Rule[] } | undefined} [value]
   * @property {AvailableQuestion[]} [availableQuestions]
   * @property {(v: any) => void} onchange
   */

  /** @type {Props} */
  let { value = undefined, availableQuestions = [], onchange } = $props();

  /** @type {Rule} */
  const rule = $derived(value?.rules?.[0] || {});
  const referenced = $derived(availableQuestions.find((q) => q.id === rule.questionId));
  const isChoice = $derived(!!referenced?.selectOptions?.length);

  /** @param {Partial<Rule>} patch */
  function update(patch) {
    const next = { ...rule, ...patch };
    if (!next.questionId) return onchange(undefined); // cleared
    onchange({
      rules: [
        {
          questionId: next.questionId,
          operator: next.operator || 'equals',
          value: next.value ?? ''
        }
      ]
    });
  }
</script>

{#if availableQuestions.length > 0}
  <div class="flex flex-wrap items-center gap-2 text-sm">
    <span class="text-xs text-base-content/50">{m.form_builder_showif_label()}</span>
    <select
      class="select-bordered select select-xs"
      value={rule.questionId || ''}
      onchange={(e) => update({ questionId: e.currentTarget.value, value: '' })}
    >
      <option value="">{m.form_builder_showif_always()}</option>
      {#each availableQuestions as q (q.id)}<option value={q.id}>{q.label || q.id}</option>{/each}
    </select>
    {#if rule.questionId}
      <select
        class="select-bordered select select-xs"
        value={rule.operator || 'equals'}
        onchange={(e) => update({ operator: e.currentTarget.value })}
      >
        <option value="equals">{m.form_builder_showif_equals()}</option>
        <option value="notEquals">{m.form_builder_showif_notEquals()}</option>
        <option value="contains">{m.form_builder_showif_contains()}</option>
      </select>
      {#if isChoice}
        <select
          class="select-bordered select select-xs"
          value={rule.value || ''}
          onchange={(e) => update({ value: e.currentTarget.value })}
        >
          <option value="">—</option>
          {#each referenced?.selectOptions || [] as o (o.id)}<option value={o.id}
              >{o.label || o.id}</option
            >{/each}
        </select>
      {:else}
        <input
          class="input-bordered input input-xs"
          value={rule.value || ''}
          oninput={(e) => update({ value: e.currentTarget.value })}
        />
      {/if}
    {/if}
  </div>
{/if}
