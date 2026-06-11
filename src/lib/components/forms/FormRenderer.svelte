<script>
  import { parseFormTemplate, validateField } from '$lib/helpers/forms.js';
  import * as m from '$lib/paraglide/messages';
  import FieldsRenderer from './FieldsRenderer.svelte';

  /**
   * @type {{
   *   formEvent: import('nostr-tools').NostrEvent,
   *   onsubmit?: (values: Record<string, any>) => void,
   *   readonly?: boolean,
   *   initialValues?: Record<string, any>
   * }}
   */
  let { formEvent, onsubmit, readonly = false, initialValues } = $props();

  const form = $derived(parseFormTemplate(formEvent));

  /** @type {Record<string, any>} */
  let values = $state({});
  /** @type {Record<string, string | null>} */
  let errors = $state({});

  let initialized = false;
  $effect(() => {
    if (form && !initialized) {
      initialized = true;
      /** @type {Record<string, any>} */
      const initial = {};
      for (const field of form.fields) {
        const provided = initialValues?.[field.id];
        if (field.type === 'text-array') {
          if (Array.isArray(provided) && provided.length > 0) {
            initial[field.id] = provided;
          } else if (provided !== undefined && provided !== null && provided !== '') {
            initial[field.id] = [String(provided)];
          } else {
            initial[field.id] = [''];
          }
        } else if (provided !== undefined) {
          initial[field.id] = provided;
        } else {
          initial[field.id] = field.vocab ? [] : field.defaultValue || '';
        }
      }
      values = initial;
    }
  });

  function handleFieldChange(/** @type {string} */ id, /** @type {any} */ value) {
    // checkbox in FieldsRenderer emits boolean; FormRenderer's original
    // behavior used 'true'/'false' strings — translate at this boundary.
    const field = form.fields.find((f) => f.id === id);
    if (field?.type === 'checkbox' && typeof value === 'boolean') {
      values[id] = String(value);
    } else {
      values[id] = value;
    }
  }

  function handleSubmit() {
    /** @type {Record<string, string | null>} */
    const newErrors = {};
    let hasError = false;

    for (const field of form.fields) {
      const raw = values[field.id];
      let toCheck = raw;
      if (field.type === 'text-array') {
        const arr = Array.isArray(raw)
          ? raw.map((/** @type string */ s) => s.trim()).filter(Boolean)
          : [];
        values[field.id] = arr;
        toCheck = arr;
      }
      const err = validateField(field, toCheck || '');
      newErrors[field.id] = err;
      if (err) hasError = true;
    }

    errors = newErrors;
    if (hasError) return;

    onsubmit?.(values);
  }
</script>

<div class="space-y-5">
  <div>
    {#if form.name}
      <h2 class="text-xl font-bold">{form.name}</h2>
    {/if}
    {#if form.description}
      <p class="mt-1 text-base-content/60">{form.description}</p>
    {/if}
    {#if !form.isPublic}
      <div class="mt-2 flex items-center gap-2 text-xs text-base-content/50">
        <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
        {m.form_encrypted_info()}
      </div>
    {/if}
  </div>

  <FieldsRenderer fields={form.fields} {values} {errors} {readonly} onchange={handleFieldChange} />

  {#if !readonly}
    <button class="btn w-full btn-primary" onclick={handleSubmit}>Submit</button>
  {/if}
</div>
