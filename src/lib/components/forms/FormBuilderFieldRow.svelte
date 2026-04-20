<script>
  import { nip19 } from 'nostr-tools';
  import { getSeenRelays, normalizeURL } from 'applesauce-core/helpers';
  import { useSchemeConcepts, useConceptSchemes } from '$lib/stores/vocab-store.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { generateFieldId } from '$lib/helpers/forms.js';
  import {
    schemeEventsToSkosConcepts,
    pickSchemeDescription
  } from '$lib/helpers/educational/schemeEventsToSkosConcepts.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import SKOSDropdown from '$lib/components/educational/SKOSDropdown.svelte';
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

  // Common AMB output targets — human-readable label + machine value.
  const AMB_OUTPUTS = [
    { value: 'amb:name', label: () => m.form_builder_field_output_amb_name() },
    { value: 'amb:description', label: () => m.form_builder_field_output_amb_description() },
    { value: 'amb:about', label: () => m.form_builder_field_output_amb_about() },
    {
      value: 'amb:learningResourceType',
      label: () => m.form_builder_field_output_amb_learningResourceType()
    },
    { value: 'amb:audience', label: () => m.form_builder_field_output_amb_audience() },
    {
      value: 'amb:educationalLevel',
      label: () => m.form_builder_field_output_amb_educationalLevel()
    },
    {
      value: 'amb:interactivityType',
      label: () => m.form_builder_field_output_amb_interactivityType()
    },
    {
      value: 'amb:conditionsOfAccess',
      label: () => m.form_builder_field_output_amb_conditionsOfAccess()
    },
    { value: 'amb:license', label: () => m.form_builder_field_output_amb_license() },
    { value: 'amb:inLanguage', label: () => m.form_builder_field_output_amb_inLanguage() },
    { value: 'amb:keywords', label: () => m.form_builder_field_output_amb_keywords() }
  ];

  // Concept-count preview — reactive via useSchemeConcepts
  const getConcepts = useSchemeConcepts(
    () => (field.vocab?.address ? field.vocab.address : undefined),
    () => /** @type {string[]} */ ([field.vocab?.relay, ...getAllLookupRelays()].filter(Boolean))
  );
  const conceptCount = $derived(field.vocab?.address ? getConcepts().length : undefined);

  // Discover published ConceptScheme events on the lookup relays.
  const getDiscoveredSchemes = useConceptSchemes(() => getAllLookupRelays());
  /** @type {import('$lib/helpers/educational/skosLoader.js').SKOSConcept[]} */
  const pickerConcepts = $derived(schemeEventsToSkosConcepts(getDiscoveredSchemes(), getLocale()));

  // Picker is a one-shot trigger; we clear selection after each pick so the
  // dropdown returns to idle. Bindable prop on SKOSDropdown requires $state.
  /** @type {{id: string, label: string}[]} */
  let vocabPickerSelected = $state([]);

  /**
   * Resolve the scheme the author just picked: populate field.vocab, mirror
   * an naddr into the text input, clear the error.
   * @param {{id: string, label: string}[]} selection
   */
  function handleVocabPicked(selection) {
    const pick = selection[0];
    if (!pick) return;

    const [, pubkey, d] = pick.id.split(':');
    const event = getDiscoveredSchemes().find(
      (e) => e.pubkey === pubkey && e.tags.some((t) => t[0] === 'd' && t[1] === d)
    );

    const seen = event ? getSeenRelays(event) : undefined;
    const fromSeen = seen && seen.size > 0 ? [...seen][0] : undefined;
    const relay = fromSeen ? normalizeURL(fromSeen) : getAllLookupRelays()[0] || '';

    field.vocab = { address: pick.id, relay };
    field.vocabNaddrInput = nip19.naddrEncode({
      kind: 39737,
      pubkey,
      identifier: d,
      relays: relay ? [relay] : []
    });
    field.vocabError = '';

    // Reset so the combobox returns to its idle state — picker is one-shot.
    vocabPickerSelected = [];
  }

  /**
   * Reset all vocab state so the picker returns to idle — used by the
   * "Change vocabulary" button on the post-selection preview card.
   */
  function clearVocabSelection() {
    field.vocab = undefined;
    field.vocabNaddrInput = '';
    field.vocabError = '';
    vocabPickerSelected = [];
  }

  // Post-selection preview: description + sample concept labels.
  const selectedParts = $derived(field.vocab?.address?.split(':') || []);
  const selectedPubkey = $derived(selectedParts[1] || '');
  const selectedDTag = $derived(selectedParts[2] || '');
  const selectedSchemeEvent = $derived(
    field.vocab?.address
      ? getDiscoveredSchemes().find(
          (e) =>
            e.pubkey === selectedPubkey && e.tags.some((t) => t[0] === 'd' && t[1] === selectedDTag)
        )
      : undefined
  );
  const selectedDescription = $derived(
    selectedSchemeEvent ? pickSchemeDescription(selectedSchemeEvent, getLocale()) : ''
  );
  /**
   * Read the best-matching prefLabel from a Concept event's tags, using the
   * same locale → de → en → first fallback chain as schemeEventsToSkosConcepts.
   * Falls back to the d-tag (and finally the event id prefix) so we never
   * render an empty chip.
   * @param {import('nostr-tools').NostrEvent} evt
   * @param {string} locale
   * @returns {string}
   */
  function pickConceptLabel(evt, locale) {
    /** @type {Record<string, string>} */
    const byLang = {};
    for (const t of evt.tags) {
      if (t[0] === 'prefLabel' && t[1] && t[2]) byLang[t[2]] = t[1];
    }
    return (
      byLang[locale] ||
      byLang.de ||
      byLang.en ||
      Object.values(byLang)[0] ||
      evt.tags.find((t) => t[0] === 'd')?.[1] ||
      evt.id.slice(0, 8)
    );
  }

  const sampleConceptLabels = $derived(
    field.vocab?.address
      ? getConcepts()
          .slice(0, 5)
          .map((c) => pickConceptLabel(c, getLocale()))
          .filter(Boolean)
      : []
  );

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

  // Vocab binding is only meaningful for choice-based fields. Everything else
  // (text, number, email, date, …) must hide the entire options/vocab section.
  const CHOICE_TYPES = ['select', 'checkbox', 'radio'];
  const isChoiceType = $derived(CHOICE_TYPES.includes(field.type));

  /**
   * Three-state source chooser: `unset` (show CTA pair), `manual` (show badge
   * editor), `vocab` (show combobox + preview + output). Seed from persisted
   * field state on mount; user clicks drive it thereafter.
   *
   * @type {'unset' | 'manual' | 'vocab'}
   */
  let fieldMode = $state(
    field.vocab?.address ? 'vocab' : field.selectOptions.length > 0 ? 'manual' : 'unset'
  );

  /** Swap to the manual editor — clears any vocab binding the field had. */
  function switchToManual() {
    field.vocab = undefined;
    field.vocabNaddrInput = '';
    field.vocabError = '';
    field.output = '';
    vocabPickerSelected = [];
    fieldMode = 'manual';
  }

  /** Swap to the vocab editor — clears any manual options the field had. */
  function switchToVocab() {
    field.selectOptions = [];
    field.multiple = false;
    fieldMode = 'vocab';
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
    {#if !isChoiceType}
      <input
        type="text"
        class="input-bordered input input-xs flex-1"
        placeholder={m.form_builder_field_placeholder_text()}
        bind:value={field.placeholder}
      />
    {/if}
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

  {#if isChoiceType}
    {#if fieldMode === 'unset'}
      <div class="rounded bg-base-200/30 p-2 text-sm">
        <div class="mb-2 text-xs text-base-content/60">
          {m.form_builder_field_source_prompt()}
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-outline btn-sm" onclick={switchToManual}>
            {m.form_builder_field_source_manual()}
          </button>
          <button type="button" class="btn btn-outline btn-sm" onclick={switchToVocab}>
            {m.form_builder_field_source_vocab()}
          </button>
        </div>
      </div>
    {:else if fieldMode === 'manual'}
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
        <div class="mt-1">
          <button type="button" class="btn px-0 text-xs btn-link btn-xs" onclick={switchToVocab}>
            {m.form_builder_field_source_switch_to_vocab()}
          </button>
        </div>
      </div>
    {:else}
      <!-- fieldMode === 'vocab' -->
      <div class="rounded bg-base-200/30 p-2 text-sm">
        <div class="mb-2">
          <SKOSDropdown
            concepts={pickerConcepts}
            isLoading={pickerConcepts.length === 0}
            bind:selected={vocabPickerSelected}
            multiple={false}
            maxSelections={1}
            label={m.form_builder_field_vocab_picker_label()}
            placeholder={m.form_builder_field_vocab_picker_placeholder()}
            compact
            onchange={handleVocabPicked}
          />
        </div>
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
          <div class="mb-1 rounded border border-base-300 bg-base-100 p-2 text-xs">
            {#if selectedDescription}
              <p class="mb-1 text-base-content/80">{selectedDescription}</p>
            {/if}
            <div class="text-base-content/50">
              {#if conceptCount !== undefined && conceptCount > 0}
                {m.form_builder_field_vocab_concepts_count({ n: conceptCount })}
              {:else}
                {m.form_builder_field_vocab_loading()}
              {/if}
              {#if sampleConceptLabels.length > 0}
                — <span
                  >{m.form_builder_field_vocab_samples_label()}
                  {sampleConceptLabels.join(', ')}…</span
                >
              {/if}
            </div>
            <button type="button" class="btn mt-1 btn-ghost btn-xs" onclick={clearVocabSelection}
              >{m.form_builder_field_vocab_clear()}</button
            >
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
            {#each AMB_OUTPUTS as out (out.value)}
              <option value={out.value}>{out.label()}</option>
            {/each}
            <option value="ext">{m.form_builder_field_output_ext()}</option>
          </select>
        </div>
        <div class="mt-1">
          <button type="button" class="btn px-0 text-xs btn-link btn-xs" onclick={switchToManual}>
            {m.form_builder_field_source_switch_to_manual()}
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>
