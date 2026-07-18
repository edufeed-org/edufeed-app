<script>
  import FormConceptPicker from './FormConceptPicker.svelte';
  import CustomValueAffordance from './CustomValueAffordance.svelte';

  /**
   * @type {{
   *   fields: import('$lib/helpers/forms.js').FormField[],
   *   values: Record<string, any>,
   *   errors: Record<string, string | null>,
   *   onchange: (id: string, value: any) => void,
   *   customValues?: Record<string, string>,
   *   oncustomchange?: (id: string, value: string) => void,
   *   readonly?: boolean
   * }}
   */
  let {
    fields,
    values,
    errors,
    onchange,
    customValues = {},
    oncustomchange = () => {},
    readonly = false
  } = $props();
</script>

<div class="space-y-5">
  {#each fields as field (field.id)}
    <div class="form-control">
      {#if field.label}
        <label class="label" for={field.id}>
          <span class="label-text font-semibold">
            {field.label}
            {#if field.options?.required}<span class="text-error">*</span>{/if}
          </span>
        </label>
      {/if}

      {#if field.vocab}
        <FormConceptPicker
          {field}
          multiple={field.options?.multiple === true || field.type === 'checkbox'}
          value={values[field.id] || []}
          disabled={readonly}
          onchange={(v) => onchange(field.id, v)}
        />
        {#if field.options?.allowCustom}
          <CustomValueAffordance
            value={customValues[field.id] ?? ''}
            label={field.options?.customLabel ?? ''}
            buttonLabel={field.options?.customButtonLabel ?? '+ custom'}
            placeholder={field.options?.customPlaceholder ?? ''}
            {readonly}
            onchange={(v) => oncustomchange(field.id, v)}
          />
        {/if}
      {:else if field.type === 'text' || field.type === 'email' || field.type === 'url' || field.type === 'number' || field.type === 'date'}
        <input
          id={field.id}
          type={field.type}
          class="input-bordered input w-full"
          class:input-error={errors[field.id]}
          placeholder={field.options?.placeholder || ''}
          disabled={readonly}
          value={values[field.id] ?? ''}
          oninput={(e) =>
            onchange(field.id, /** @type {HTMLInputElement} */ (e.currentTarget).value)}
        />
      {:else if field.type === 'textarea'}
        <textarea
          id={field.id}
          class="textarea-bordered textarea w-full"
          class:textarea-error={errors[field.id]}
          placeholder={field.options?.placeholder || ''}
          disabled={readonly}
          rows="4"
          value={values[field.id] ?? ''}
          oninput={(e) =>
            onchange(field.id, /** @type {HTMLTextAreaElement} */ (e.currentTarget).value)}
        ></textarea>
      {:else if field.type === 'checkbox'}
        <label class="label cursor-pointer justify-start gap-2">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            class:checkbox-error={errors[field.id]}
            disabled={readonly}
            checked={values[field.id] === true || values[field.id] === 'true'}
            onchange={(e) =>
              onchange(field.id, /** @type {HTMLInputElement} */ (e.currentTarget).checked)}
          />
        </label>
      {:else if field.type === 'text-array'}
        <div class="space-y-2">
          {#each values[field.id] ?? [''] as _ref, i (i)}
            <div class="flex gap-2">
              <input
                type="text"
                class="input-bordered input flex-1"
                disabled={readonly}
                placeholder={field.options?.placeholder || ''}
                value={values[field.id]?.[i] ?? ''}
                oninput={(e) => {
                  const arr = [...(values[field.id] ?? [''])];
                  arr[i] = /** @type {HTMLInputElement} */ (e.currentTarget).value;
                  onchange(field.id, arr);
                }}
              />
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                disabled={readonly}
                aria-label="Entfernen"
                onclick={() => {
                  const arr = (values[field.id] ?? []).filter(
                    (/** @type {string} */ _v, /** @type {number} */ j) => j !== i
                  );
                  onchange(field.id, arr.length > 0 ? arr : ['']);
                }}>×</button
              >
            </div>
          {/each}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            disabled={readonly}
            onclick={() => onchange(field.id, [...(values[field.id] ?? []), ''])}
            >+ Hinzufügen</button
          >
        </div>
      {:else if field.type === 'select' && field.options?.multiple}
        <div class="mt-1 flex flex-col gap-2">
          {#each field.options?.options || [] as opt (opt.id)}
            {@const selected = (values[field.id] || '').split(';').filter(Boolean)}
            <label class="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                value={opt.id}
                disabled={readonly}
                checked={selected.includes(opt.id)}
                onchange={(e) => {
                  const current = (values[field.id] || '').split(';').filter(Boolean);
                  if (/** @type {HTMLInputElement} */ (e.currentTarget).checked)
                    current.push(opt.id);
                  else {
                    const idx = current.indexOf(opt.id);
                    if (idx !== -1) current.splice(idx, 1);
                  }
                  onchange(field.id, current.join(';'));
                }}
              />
              <span class="label-text">{opt.label}</span>
            </label>
          {/each}
        </div>
      {:else if field.type === 'select'}
        <select
          id={field.id}
          class="select-bordered select w-full"
          class:select-error={errors[field.id]}
          disabled={readonly}
          value={values[field.id] ?? ''}
          onchange={(e) =>
            onchange(field.id, /** @type {HTMLSelectElement} */ (e.currentTarget).value)}
        >
          <option value=""></option>
          {#each field.options?.options || [] as opt (opt.id)}
            <option value={opt.id}>{opt.label}</option>
          {/each}
        </select>
      {:else if field.type === 'radio'}
        <div class="mt-1 flex flex-col gap-2">
          {#each field.options?.options || [] as opt (opt.id)}
            <label class="label cursor-pointer justify-start gap-2">
              <input
                type="radio"
                class="radio radio-sm"
                name={field.id}
                value={opt.id}
                disabled={readonly}
                checked={values[field.id] === opt.id}
                onchange={() => onchange(field.id, opt.id)}
              />
              <span class="label-text">{opt.label}</span>
            </label>
          {/each}
        </div>
      {/if}

      {#if errors[field.id]}
        <div class="label">
          <span class="label-text-alt text-error">{errors[field.id]}</span>
        </div>
      {/if}
    </div>
  {/each}
</div>
