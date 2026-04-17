<script>
  import { parseFormTemplate, validateField } from '$lib/helpers/forms.js';
  import * as m from '$lib/paraglide/messages';
  import FormConceptPicker from './FormConceptPicker.svelte';

  /**
   * @type {{
   *   formEvent: import('nostr-tools').NostrEvent,
   *   onsubmit?: (values: Record<string, any>) => void,
   *   readonly?: boolean
   * }}
   */
  let { formEvent, onsubmit, readonly = false } = $props();

  const form = $derived(parseFormTemplate(formEvent));

  /** @type {Record<string, any>} */
  let values = $state({});
  /** @type {Record<string, string | null>} */
  let errors = $state({});

  // Initialize values from defaults (only once)
  let initialized = false;
  $effect(() => {
    if (form && !initialized) {
      initialized = true;
      /** @type {Record<string, any>} */
      const initial = {};
      for (const field of form.fields) {
        initial[field.id] = field.vocab ? [] : field.defaultValue || '';
      }
      values = initial;
    }
  });

  function handleSubmit() {
    /** @type {Record<string, string | null>} */
    const newErrors = {};
    let hasError = false;

    for (const field of form.fields) {
      const err = validateField(field, values[field.id] || '');
      newErrors[field.id] = err;
      if (err) hasError = true;
    }

    errors = newErrors;
    if (hasError) return;

    onsubmit?.(values);
  }
</script>

<div class="space-y-5">
  <!-- Form header -->
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

  <!-- Fields -->
  {#each form.fields as field (field.id)}
    <div class="form-control">
      <label class="label" for={field.id}>
        <span class="label-text font-semibold">
          {field.label}
          {#if field.options?.required}<span class="text-error">*</span>{/if}
        </span>
      </label>

      {#if field.vocab}
        <FormConceptPicker
          {field}
          multiple={field.options?.multiple === true || field.type === 'checkbox'}
          value={values[field.id] || []}
          onchange={(v) => (values[field.id] = v)}
        />
      {:else if field.type === 'text' || field.type === 'email' || field.type === 'url' || field.type === 'number' || field.type === 'date'}
        <input
          id={field.id}
          type={field.type}
          class="input-bordered input w-full"
          class:input-error={errors[field.id]}
          placeholder={field.options?.placeholder || ''}
          bind:value={values[field.id]}
          disabled={readonly}
        />
      {:else if field.type === 'textarea'}
        <textarea
          id={field.id}
          class="textarea-bordered textarea w-full"
          class:textarea-error={errors[field.id]}
          placeholder={field.options?.placeholder || ''}
          bind:value={values[field.id]}
          disabled={readonly}
          rows="4"
        ></textarea>
        {#if field.options?.min}
          <div class="label">
            <span class="label-text-alt text-base-content/40"
              >{m.form_min_characters({ min: field.options.min })}</span
            >
          </div>
        {/if}
      {:else if field.type === 'select' && field.options?.multiple}
        <div class="mt-1 flex flex-col gap-2">
          {#each field.options?.options || [] as opt (opt)}
            {@const selected = (values[field.id] || '').split(',').filter(Boolean)}
            <label class="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                value={opt}
                checked={selected.includes(opt)}
                onchange={(e) => {
                  const current = (values[field.id] || '').split(',').filter(Boolean);
                  if (e.currentTarget.checked) {
                    current.push(opt);
                  } else {
                    const idx = current.indexOf(opt);
                    if (idx !== -1) current.splice(idx, 1);
                  }
                  values[field.id] = current.join(',');
                }}
                disabled={readonly}
              />
              <span class="label-text">{opt}</span>
            </label>
          {/each}
        </div>
      {:else if field.type === 'select'}
        <select
          id={field.id}
          class="select-bordered select w-full"
          class:select-error={errors[field.id]}
          bind:value={values[field.id]}
          disabled={readonly}
        >
          <option value="">{m.form_select_placeholder()}</option>
          {#each field.options?.options || [] as opt (opt)}
            <option value={opt}>{opt}</option>
          {/each}
        </select>
      {:else if field.type === 'radio'}
        <div class="mt-1 flex flex-col gap-2">
          {#each field.options?.options || [] as opt (opt)}
            <label class="label cursor-pointer justify-start gap-2">
              <input
                type="radio"
                class="radio radio-sm"
                name={field.id}
                value={opt}
                checked={values[field.id] === opt}
                onchange={() => (values[field.id] = opt)}
                disabled={readonly}
              />
              <span class="label-text">{opt}</span>
            </label>
          {/each}
        </div>
      {:else if field.type === 'checkbox'}
        <label class="label cursor-pointer justify-start gap-2">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            class:checkbox-error={errors[field.id]}
            checked={values[field.id] === 'true'}
            onchange={(e) => (values[field.id] = String(e.currentTarget.checked))}
            disabled={readonly}
          />
          <span class="label-text">{field.label}</span>
        </label>
      {/if}

      {#if errors[field.id]}
        <div class="label">
          <span class="label-text-alt text-error">{errors[field.id]}</span>
        </div>
      {/if}
    </div>
  {/each}

  <!-- Submit -->
  {#if !readonly}
    <button class="btn w-full btn-primary" onclick={handleSubmit}>Submit</button>
  {/if}
</div>
