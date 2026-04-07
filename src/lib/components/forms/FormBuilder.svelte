<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { EventFactory } from 'applesauce-core/event-factory';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import { buildFormTemplateTags, parseFormTemplate, generateFieldId } from '$lib/helpers/forms.js';
  import { TrashIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ existingEvent?: import('nostr-tools').NostrEvent }} */
  let { existingEvent = undefined } = $props();

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

  // existingEvent is only used for initial population — it won't change after mount
  // svelte-ignore state_referenced_locally
  const existing = existingEvent ? parseFormTemplate(existingEvent) : null;

  let formName = $state(existing?.name || '');
  let formDescription = $state(existing?.description || '');
  let dTag = $state(existing?.dTag || '');
  let isPublic = $state(existing?.isPublic || false);
  let confirmationMessage = $state(existing?.confirmationMessage || '');

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
   */

  /** @type {FieldState[]} */
  let fields = $state(
    existing?.fields.map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      defaultValue: f.defaultValue || '',
      required: f.options?.required || false,
      placeholder: f.options?.placeholder || '',
      min: f.options?.min,
      max: f.options?.max,
      selectOptions: f.options?.options || [],
      multiple: f.options?.multiple || false
    })) || []
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
      multiple: false
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
      const formFields = fields.map((f) => ({
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
          ...(f.multiple && { multiple: true })
        }
      }));

      const tags = buildFormTemplateTags(dTag, formFields, {
        name: formName,
        description: formDescription,
        public: isPublic,
        confirmationMessage
      });

      const factory = new EventFactory({ signer: manager.active.signer });
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
  <div class="mb-6 flex items-center justify-between">
    <div class="text-sm tracking-wide text-base-content/50 uppercase">
      {m.form_builder_header()}
    </div>
    <div class="flex gap-2">
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

          <!-- Field config -->
          <div class="flex-1 space-y-2">
            <div class="flex items-center gap-2">
              <input
                type="text"
                class="input-bordered input input-sm flex-1 font-semibold"
                placeholder={m.form_builder_field_name_placeholder()}
                bind:value={field.label}
                onchange={() => {
                  if (!existing) {
                    const existingIds = fields.filter((_, j) => j !== i).map((f) => f.id);
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
                <input
                  type="number"
                  class="input-bordered input input-xs w-16"
                  bind:value={field.min}
                />
                <span
                  class="text-xs text-base-content/50"
                  title={isNumeric ? 'Maximum allowed value' : 'Maximum character length'}
                  >{isNumeric ? m.form_builder_max_value() : m.form_builder_max_length()}</span
                >
                <input
                  type="number"
                  class="input-bordered input input-xs w-16"
                  bind:value={field.max}
                />
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
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      bind:checked={field.multiple}
                    />
                    <span class="label-text text-xs">{m.form_builder_field_allow_multiple()}</span>
                  </label>
                {/if}
              </div>
            {/if}
          </div>

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
