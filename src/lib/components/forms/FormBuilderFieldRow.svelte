<script>
  import { nip19 } from 'nostr-tools';
  import { useSchemeConcepts } from '$lib/stores/vocab-store.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { generateFieldId } from '$lib/helpers/forms.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} FieldState
   * @property {string} id
   * @property {string} type
   * @property {string} label
   * @property {string} defaultValue
   * @property {boolean} required
   * @property {string} placeholder
   * @property {number | undefined} min
   * @property {number | undefined} max
   * @property {string[]} selectOptions
   * @property {boolean} multiple
   * @property {{ address: string, relay: string } | undefined} [vocab]
   * @property {string} [output]
   * @property {string} [vocabNaddrInput]
   * @property {string} [vocabError]
   *
   * @typedef {Object} Props
   * @property {FieldState} field
   * @property {FieldState[]} fields
   * @property {number} fieldIndex
   * @property {boolean} existing
   */

  /** @type {Props} */
  let { field = $bindable(), fields, fieldIndex, existing } = $props();

  const FIELD_TYPES = [
    'text',
    'textarea',
    'number',
    'email',
    'url',
    'select',
    'checkbox',
    'radio',
    'date'
  ];

  // Common AMB output targets — extendable without a code change to the spec
  const AMB_OUTPUTS = [
    'amb:name',
    'amb:description',
    'amb:about',
    'amb:learningResourceType',
    'amb:audience',
    'amb:educationalLevel',
    'amb:interactivityType',
    'amb:conditionsOfAccess',
    'amb:license',
    'amb:inLanguage',
    'amb:keywords'
  ];

  // Concept-count preview — reactive via useSchemeConcepts
  const getConcepts = useSchemeConcepts(
    () => (field.vocab?.address ? field.vocab.address : undefined),
    () => /** @type {string[]} */ ([field.vocab?.relay, ...getAllLookupRelays()].filter(Boolean))
  );
  const conceptCount = $derived(field.vocab?.address ? getConcepts().length : undefined);

  /**
   * Attempt to decode a naddr into { address, relay } when the user blurs the input.
   * @param {FocusEvent & { currentTarget: HTMLInputElement }} e
   */
  function handleVocabBlur(e) {
    const raw = e.currentTarget.value.trim();
    if (!raw) {
      field.vocab = undefined;
      field.vocabError = '';
      return;
    }
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type !== 'naddr' || decoded.data.kind !== 39737) {
        field.vocabError = m.form_builder_field_vocab_invalid();
        return;
      }
      const address = `39737:${decoded.data.pubkey}:${decoded.data.identifier}`;
      const relay = (decoded.data.relays || [])[0] || '';
      field.vocab = { address, relay };
      field.vocabError = '';
    } catch {
      field.vocabError = m.form_builder_field_vocab_invalid();
    }
  }

  /** @param {Event & { currentTarget: HTMLSelectElement }} e */
  function handleOutputChange(e) {
    field.output = e.currentTarget.value;
  }
</script>

<div class="flex-1 space-y-2">
  <div class="flex items-center gap-2">
    <input
      type="text"
      class="input-bordered input input-sm flex-1 font-semibold"
      placeholder={m.form_builder_field_name_placeholder()}
      bind:value={field.label}
      onchange={() => {
        if (!existing) {
          const existingIds = fields.filter((_, j) => j !== fieldIndex).map((f) => f.id);
          field.id = generateFieldId(field.label, existingIds);
        }
      }}
    />
    <select class="select-bordered select select-sm" bind:value={field.type}>
      {#each FIELD_TYPES as t (t)}
        <option value={t}>{t}</option>
      {/each}
    </select>
  </div>

  <div class="flex items-center gap-3 text-sm">
    <label class="label cursor-pointer gap-1">
      <input type="checkbox" class="checkbox checkbox-xs" bind:checked={field.required} />
      <span class="label-text text-xs">{m.form_builder_field_required()}</span>
    </label>
    <input
      type="text"
      class="input-bordered input input-xs flex-1"
      placeholder={m.form_builder_field_placeholder_text()}
      bind:value={field.placeholder}
    />
  </div>

  {#if field.type === 'text' || field.type === 'textarea' || field.type === 'number'}
    {@const isNumeric = field.type === 'number'}
    <div class="flex items-center gap-2 text-sm">
      <span
        class="text-xs text-base-content/50"
        title={isNumeric ? 'Minimum allowed value' : 'Minimum character length'}
        >{isNumeric ? m.form_builder_min_value() : m.form_builder_min_length()}</span
      >
      <input type="number" class="input-bordered input input-xs w-16" bind:value={field.min} />
      <span
        class="text-xs text-base-content/50"
        title={isNumeric ? 'Maximum allowed value' : 'Maximum character length'}
        >{isNumeric ? m.form_builder_max_value() : m.form_builder_max_length()}</span
      >
      <input type="number" class="input-bordered input input-xs w-16" bind:value={field.max} />
    </div>
  {/if}

  {#if field.type === 'select' || field.type === 'radio'}
    <div class="rounded bg-base-200/50 p-2">
      <div class="mb-1 text-xs text-base-content/50">
        {m.form_builder_field_options_label()}
      </div>
      <div class="flex flex-wrap gap-2">
        {#each field.selectOptions as opt, j (opt + '-' + j)}
          <span class="badge gap-1 badge-outline">
            {opt}
            <button
              class="text-xs opacity-50 hover:opacity-100"
              onclick={() => field.selectOptions.splice(j, 1)}>×</button
            >
          </span>
        {/each}
        <span class="inline-flex items-center gap-0.5">
          <input
            type="text"
            class="input-bordered input input-xs w-24 border-dashed"
            placeholder={m.form_builder_field_option_new()}
            onkeydown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value) {
                field.selectOptions.push(e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
          <button
            class="btn px-1 btn-ghost btn-xs"
            title={m.form_builder_add_option()}
            onclick={(e) => {
              const input = /** @type {HTMLInputElement | null} */ (
                e.currentTarget.previousElementSibling
              );
              if (input?.value) {
                field.selectOptions.push(input.value);
                input.value = '';
                input.focus();
              }
            }}>+</button
          >
        </span>
      </div>
      {#if field.type === 'select'}
        <label class="label mt-1 cursor-pointer justify-start gap-1">
          <input type="checkbox" class="checkbox checkbox-xs" bind:checked={field.multiple} />
          <span class="label-text text-xs">{m.form_builder_field_allow_multiple()}</span>
        </label>
      {/if}
    </div>
  {/if}

  <!-- Vocab binding + output target -->
  <div class="rounded bg-base-200/30 p-2 text-sm">
    <div class="mb-1 flex items-center gap-2">
      <span class="text-xs text-base-content/50">{m.form_builder_field_vocab_label()}</span>
      <input
        type="text"
        class="input-bordered input input-xs flex-1 font-mono"
        placeholder={m.form_builder_field_vocab_placeholder()}
        data-testid="field-vocab-input"
        value={field.vocabNaddrInput || ''}
        oninput={(e) => (field.vocabNaddrInput = e.currentTarget.value)}
        onblur={handleVocabBlur}
      />
    </div>
    {#if field.vocabError}
      <div class="mb-1 text-xs text-error">{field.vocabError}</div>
    {/if}
    {#if field.vocab?.address}
      <div class="mb-1 text-xs text-base-content/50">
        {#if conceptCount !== undefined && conceptCount > 0}
          {m.form_builder_field_vocab_concepts_count({ n: conceptCount })}
        {:else}
          {m.form_builder_field_vocab_loading()}
        {/if}
      </div>
    {/if}
    <div class="flex items-center gap-2">
      <span class="text-xs text-base-content/50">{m.form_builder_field_output_label()}</span>
      <select
        class="select-bordered select flex-1 select-xs"
        data-testid="field-output-select"
        value={field.output || ''}
        onchange={handleOutputChange}
      >
        <option value="">{m.form_builder_field_output_auto({ id: field.id || 'id' })}</option>
        <option value={`amb:${field.id}`}>amb:{field.id}</option>
        {#each AMB_OUTPUTS as out (out)}
          <option value={out}>{out}</option>
        {/each}
        <option value="ext">ext</option>
      </select>
    </div>
  </div>
</div>
