<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { createAppEventFactory } from '$lib/helpers/event-factory.js';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { buildFormTemplateTags, parseFormTemplate, generateFieldId } from '$lib/helpers/forms.js';
  import {
    extractSections,
    interleaveSections,
    isSectionMarker
  } from '$lib/helpers/forms/builder-sections.js';
  import { TrashIcon } from '$lib/components/icons';
  import FormBuilderFieldRow from './FormBuilderFieldRow.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { firstValueFrom, timeout } from 'rxjs';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ existingEvent?: import('nostr-tools').NostrEvent }} */
  let { existingEvent = undefined } = $props();

  const FIELD_TYPES = [
    'text',
    'textarea',
    'text-array',
    'number',
    'email',
    'url',
    'select',
    'checkbox',
    'radio',
    'date'
  ];

  // existingEvent is only used for initial population — it won't change after mount
  // svelte-ignore state_referenced_locally
  const existing = existingEvent ? parseFormTemplate(existingEvent) : null;

  let formName = $state(existing?.name || '');
  let formDescription = $state(existing?.description || '');
  let dTag = $state(existing?.dTag || '');
  let isPublic = $state(existing?.isPublic || false);
  let confirmationMessage = $state(existing?.confirmationMessage || '');

  /** @type {{ address: string, relay: string } | undefined} */
  let forkOf = $state(existing?.forkOf);
  let forkDialogOpen = $state(false);
  let forkNaddrInput = $state('');
  let forkError = $state('');
  let forkLoading = $state(false);
  let parentFormName = $state('');

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
   * @property {import('$lib/helpers/forms.js').FormFieldOption[]} selectOptions
   * @property {boolean} multiple
   * @property {{ address: string, relay: string } | undefined} [vocab]
   * @property {string} [output]
   * @property {string} [vocabNaddrInput]
   * @property {string} [vocabError]
   * @property {any} [displayIf] - conditional-visibility rules, passed through unchanged (no authoring UI yet)
   * @property {string} [title] - only used when type === 'section'
   * @property {string} [description] - only used when type === 'section'
   */

  /**
   * Encode a vocab {address, relay} back to an naddr for the UI.
   * @param {{ address: string, relay: string } | undefined} vocab
   * @returns {string}
   */
  function vocabToNaddr(vocab) {
    if (!vocab?.address) return '';
    const [kindStr, pubkey, ...rest] = vocab.address.split(':');
    const identifier = rest.join(':');
    try {
      return nip19.naddrEncode({
        kind: Number(kindStr),
        pubkey,
        identifier,
        relays: vocab.relay ? [vocab.relay] : []
      });
    } catch {
      return '';
    }
  }

  /**
   * Map a parsed FormField to builder FieldState.
   * @param {import('$lib/helpers/forms.js').FormField} f
   * @returns {FieldState}
   */
  function fieldToState(f) {
    return {
      id: f.id,
      type: f.type,
      label: f.label,
      defaultValue: f.defaultValue || '',
      required: f.options?.required || false,
      placeholder: f.options?.placeholder || '',
      min: f.options?.min,
      max: f.options?.max,
      selectOptions: f.options?.options || [],
      multiple: f.options?.multiple || false,
      vocab: f.vocab,
      output: f.output,
      vocabNaddrInput: vocabToNaddr(f.vocab),
      vocabError: '',
      displayIf: f.options?.displayIf
    };
  }

  /**
   * Map a section marker (from interleaveSections) to builder FieldState.
   * @param {import('$lib/helpers/forms/builder-sections.js').SectionMarker} m
   * @returns {FieldState}
   */
  function markerToState(m) {
    return {
      id: m.id,
      type: 'section',
      title: m.title || '',
      description: m.description || '',
      label: '',
      defaultValue: '',
      required: false,
      placeholder: '',
      min: undefined,
      max: undefined,
      selectOptions: [],
      multiple: false,
      vocab: undefined,
      output: '',
      vocabNaddrInput: '',
      vocabError: ''
    };
  }

  /** @type {FieldState[]} */
  let fields = $state(
    existing
      ? interleaveSections(existing.fields, existing.sections || []).map((it) =>
          isSectionMarker(it) ? markerToState(it) : fieldToState(it)
        )
      : []
  );

  let isPublishing = $state(false);
  let error = $state('');

  $effect(() => {
    if (!existing && formName) {
      dTag = formName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  });

  /** @param {string} type */
  function addField(type) {
    const existingIds = fields.map((f) => f.id);
    fields.push({
      id: generateFieldId(type, existingIds),
      type,
      label: '',
      defaultValue: '',
      required: false,
      placeholder: '',
      min: undefined,
      max: undefined,
      selectOptions: [],
      multiple: false,
      vocab: undefined,
      output: '',
      vocabNaddrInput: '',
      vocabError: ''
    });
  }

  function addSection() {
    const existingIds = fields.map((f) => f.id);
    fields.push({
      id: generateFieldId('section', existingIds),
      type: 'section',
      title: '',
      description: '',
      // unused-for-sections FieldState fields, kept for shape uniformity:
      label: '',
      defaultValue: '',
      required: false,
      placeholder: '',
      min: undefined,
      max: undefined,
      selectOptions: [],
      multiple: false,
      vocab: undefined,
      output: '',
      vocabNaddrInput: '',
      vocabError: ''
    });
  }

  /** @param {number} index */
  function removeField(index) {
    fields.splice(index, 1);
  }

  /**
   * @param {number} from
   * @param {number} to
   */
  function moveField(from, to) {
    if (to < 0 || to >= fields.length) return;
    const [item] = fields.splice(from, 1);
    fields.splice(to, 0, item);
  }

  let dragIndex = $state(-1);

  /** @param {DragEvent & { currentTarget: HTMLElement }} e */
  function handleDragStart(e) {
    dragIndex = Number(e.currentTarget.dataset.index);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  /** @param {DragEvent & { currentTarget: HTMLElement }} e */
  function handleDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  /** @param {DragEvent & { currentTarget: HTMLElement }} e */
  function handleDrop(e) {
    e.preventDefault();
    const toIndex = Number(e.currentTarget.dataset.index);
    if (dragIndex !== -1 && dragIndex !== toIndex) {
      moveField(dragIndex, toIndex);
    }
    dragIndex = -1;
  }

  async function loadParentForm() {
    forkError = '';
    if (!forkNaddrInput.trim()) {
      forkError = m.form_builder_fork_error_empty();
      return;
    }
    let decoded;
    try {
      decoded = nip19.decode(forkNaddrInput.trim());
    } catch {
      forkError = m.form_builder_fork_error_invalid_naddr();
      return;
    }
    if (decoded.type !== 'naddr') {
      forkError = m.form_builder_fork_error_invalid_naddr();
      return;
    }
    const d = /** @type {any} */ (decoded.data);
    if (d.kind !== 30168) {
      forkError = m.form_builder_fork_error_not_form();
      return;
    }

    forkLoading = true;
    try {
      const relays = [...(d.relays || []), ...getCommunikeyRelays()];
      await firstValueFrom(
        addressLoader({ kind: 30168, pubkey: d.pubkey, identifier: d.identifier, relays }).pipe(
          timeout({ first: 5000 })
        )
      ).catch(() => null);
      const parentEvent = eventStore.getReplaceable(30168, d.pubkey, d.identifier);
      if (!parentEvent) {
        forkError = m.form_builder_fork_error_not_found();
        return;
      }
      const parsed = parseFormTemplate(parentEvent);

      // Copy fields (+ sections) into current builder state
      fields = interleaveSections(parsed.fields, parsed.sections || []).map((it) =>
        isSectionMarker(it) ? markerToState(it) : fieldToState(it)
      );

      // Pre-fill metadata when empty
      if (!formName) formName = parsed.name ? `${parsed.name} (fork)` : '';
      if (!formDescription) formDescription = parsed.description;

      // Record fork provenance
      const relayHint = d.relays?.[0] || '';
      forkOf = { address: `30168:${d.pubkey}:${d.identifier}`, relay: relayHint };
      parentFormName = parsed.name;
      forkDialogOpen = false;
      forkNaddrInput = '';
    } catch (err) {
      forkError = err instanceof Error ? err.message : m.form_builder_fork_error_load_failed();
    } finally {
      forkLoading = false;
    }
  }

  function clearFork() {
    forkOf = undefined;
    parentFormName = '';
  }

  async function publish() {
    if (!manager.active) {
      error = m.form_builder_error_login();
      return;
    }
    if (!dTag) {
      error = m.form_builder_error_identifier();
      return;
    }

    isPublishing = true;
    error = '';

    try {
      /**
       * @type {(import('$lib/helpers/forms.js').FormField | import('$lib/helpers/forms/builder-sections.js').SectionMarker)[]}
       */
      const items = fields.map((f) =>
        f.type === 'section'
          ? {
              id: f.id,
              type: 'section',
              title: f.title || '',
              ...(f.description ? { description: f.description } : {})
            }
          : {
              id: f.id,
              type: f.type,
              label: f.label,
              defaultValue: f.defaultValue,
              options: {
                ...(f.required && { required: true }),
                ...(f.placeholder && { placeholder: f.placeholder }),
                ...(f.min !== undefined && { min: f.min }),
                ...(f.max !== undefined && { max: f.max }),
                ...((f.type === 'select' || f.type === 'radio') &&
                  f.selectOptions.length > 0 && { options: f.selectOptions }),
                ...(f.multiple && { multiple: true }),
                ...(f.displayIf ? { displayIf: f.displayIf } : {})
              },
              ...(f.vocab?.address ? { vocab: f.vocab } : {}),
              ...(f.output ? { output: f.output } : {})
            }
      );
      const { fields: formFields, sections } = extractSections(items);

      const tags = buildFormTemplateTags(dTag, formFields, {
        name: formName,
        description: formDescription,
        public: isPublic,
        confirmationMessage,
        ...(forkOf ? { forkOf } : {}),
        ...(sections.length > 0 ? { sections } : {})
      });

      const factory = createAppEventFactory({ signer: manager.active.signer });
      const template = await factory.build({ kind: 30168, tags, content: '' });
      const signed = await factory.sign(template);
      await publishEvent(signed);
      eventStore.add(signed);

      const naddr = nip19.naddrEncode({
        kind: 30168,
        pubkey: signed.pubkey,
        identifier: dTag,
        relays: getCommunikeyRelays().slice(0, 2)
      });
      goto(`/forms/${naddr}`);
    } catch (err) {
      error = err instanceof Error ? err.message : m.form_builder_error_publish_failed();
    } finally {
      isPublishing = false;
    }
  }
</script>

<div class="container mx-auto max-w-3xl p-4">
  <!-- Header -->
  <div class="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="text-sm tracking-wide text-base-content/50 uppercase">
      {m.form_builder_header()}
    </div>
    <div class="flex flex-wrap gap-2">
      {#if !existingEvent}
        <button class="btn btn-ghost btn-sm" onclick={() => (forkDialogOpen = true)}>
          {m.form_builder_fork_from()}
        </button>
      {/if}
      <a href="/forms" class="btn btn-ghost btn-sm">{m.common_cancel()}</a>
      <button class="btn btn-sm btn-primary" onclick={publish} disabled={isPublishing}>
        {isPublishing
          ? m.form_builder_publishing()
          : existingEvent
            ? m.common_save()
            : m.form_builder_publish()}
      </button>
    </div>
  </div>

  {#if forkOf}
    <div class="mb-4 flex items-center justify-between rounded-lg bg-base-200 px-4 py-2 text-sm">
      <span>
        {m.form_builder_fork_badge()}
        {#if parentFormName}
          <span class="font-semibold">{parentFormName}</span>
        {:else}
          <code class="text-xs">{forkOf.address}</code>
        {/if}
      </span>
      {#if !existingEvent}
        <button class="btn btn-ghost btn-xs" onclick={clearFork}>{m.common_remove()}</button>
      {/if}
    </div>
  {/if}

  {#if forkDialogOpen}
    <dialog class="modal-open modal">
      <div class="modal-box">
        <h3 class="mb-2 text-lg font-bold">{m.form_builder_fork_dialog_title()}</h3>
        <p class="mb-4 text-sm text-base-content/70">{m.form_builder_fork_dialog_help()}</p>
        <input
          type="text"
          class="input-bordered input w-full"
          placeholder="naddr1..."
          bind:value={forkNaddrInput}
        />
        {#if forkError}
          <div class="mt-2 text-sm text-error">{forkError}</div>
        {/if}
        <div class="modal-action">
          <button
            class="btn btn-ghost btn-sm"
            onclick={() => {
              forkDialogOpen = false;
              forkError = '';
            }}
            disabled={forkLoading}
          >
            {m.common_cancel()}
          </button>
          <button class="btn btn-sm btn-primary" onclick={loadParentForm} disabled={forkLoading}>
            {forkLoading ? m.form_builder_fork_loading() : m.form_builder_fork_load()}
          </button>
        </div>
      </div>
    </dialog>
  {/if}

  {#if error}
    <div class="mb-4 alert alert-error">{error}</div>
  {/if}

  <!-- Metadata -->
  <div class="mb-6 space-y-3 border-b border-base-content/10 pb-6">
    <input
      type="text"
      class="input-bordered input w-full text-lg font-semibold"
      placeholder={m.form_builder_name_placeholder()}
      bind:value={formName}
    />
    <input
      type="text"
      class="input-bordered input w-full"
      placeholder={m.form_builder_description_placeholder()}
      bind:value={formDescription}
    />
    <div class="flex gap-4">
      <label class="label cursor-pointer gap-2">
        <input type="checkbox" class="checkbox checkbox-sm" bind:checked={isPublic} />
        <span class="label-text">{m.form_builder_public_responses()}</span>
      </label>
    </div>
  </div>

  <!-- Fields -->
  <div class="mb-6">
    <div class="mb-3 text-sm tracking-wide text-base-content/50 uppercase">
      {m.form_builder_fields_label()}
    </div>

    {#each fields as field, i (field.id + '-' + i)}
      <div
        class="mb-3 rounded-lg border border-base-content/15 bg-base-200/30 p-4"
        draggable="true"
        role="listitem"
        data-index={i}
        data-item-type={field.type === 'section' ? 'section' : 'field'}
        ondragstart={handleDragStart}
        ondragover={handleDragOver}
        ondrop={handleDrop}
      >
        <div class="flex items-start gap-3">
          <!-- Drag handle + arrow buttons -->
          <div class="flex flex-col items-center gap-1 pt-1">
            <span
              class="cursor-grab text-lg opacity-30 select-none"
              title={m.form_builder_drag_reorder()}>⠿</span
            >
            <button
              class="btn px-1 btn-ghost btn-xs"
              onclick={() => moveField(i, i - 1)}
              disabled={i === 0}
              title={m.form_builder_move_up()}>▲</button
            >
            <button
              class="btn px-1 btn-ghost btn-xs"
              onclick={() => moveField(i, i + 1)}
              disabled={i === fields.length - 1}
              title={m.form_builder_move_down()}>▼</button
            >
          </div>

          {#if field.type === 'section'}
            <!-- Section divider -->
            <div class="flex-1 space-y-2">
              <input
                type="text"
                class="input-bordered input input-sm w-full font-semibold"
                placeholder={m.form_builder_section_title_placeholder()}
                bind:value={fields[i].title}
              />
              <input
                type="text"
                class="input-bordered input input-sm w-full"
                placeholder={m.form_builder_section_description_placeholder()}
                bind:value={fields[i].description}
              />
            </div>
          {:else}
            <!-- Field config -->
            <FormBuilderFieldRow
              bind:field={fields[i]}
              {fields}
              fieldIndex={i}
              existing={!!existing}
            />
          {/if}

          <!-- Delete -->
          <button
            class="btn opacity-30 btn-ghost btn-sm hover:opacity-100"
            onclick={() => removeField(i)}
            title={m.form_builder_remove_field()}
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
      </div>
    {/each}

    <!-- Add field buttons -->
    <div class="rounded-lg border-2 border-dashed border-base-content/10 p-4 text-center">
      <div class="mb-2 text-sm text-base-content/50">{m.form_builder_add_field()}</div>
      <div class="flex flex-wrap justify-center gap-2">
        {#each FIELD_TYPES as type (type)}
          <button class="btn btn-outline btn-xs" onclick={() => addField(type)}>{type}</button>
        {/each}
        <button class="btn btn-outline btn-sm" onclick={addSection}
          >{m.form_builder_add_section()}</button
        >
      </div>
    </div>
  </div>

  <!-- Confirmation message -->
  <input
    type="text"
    class="input-bordered input w-full"
    placeholder={m.form_builder_confirm_placeholder()}
    bind:value={confirmationMessage}
  />
</div>
