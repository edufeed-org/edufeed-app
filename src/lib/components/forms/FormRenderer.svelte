<script>
  import { parseFormTemplate, validateField } from '$lib/helpers/forms.js';
  import {
    orderedSections,
    resolveNextSectionId,
    visibleFields
  } from '$lib/helpers/forms/branching.js';
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

  const sections = $derived(form ? orderedSections(form) : []);
  const hasSections = $derived(sections.length > 0);

  let currentSectionId = $state('');
  /** @type {string[]} navigation history for Back */
  let sectionHistory = $state([]);

  $effect(() => {
    if (hasSections && !currentSectionId) currentSectionId = sections[0].id;
  });

  const currentSection = $derived(sections.find((s) => s.id === currentSectionId));
  const currentIndex = $derived(sections.findIndex((s) => s.id === currentSectionId));

  /** displayIf-filtered fields belonging to one section. */
  function sectionFields(
    /** @type {import('$lib/helpers/forms/format.js').FormSection} */ section
  ) {
    const inSection = new Set(section.questionIds || []);
    return visibleFields(form?.fields || [], values).filter((f) => inSection.has(f.id));
  }

  /** Fields of the current section, displayIf-filtered (all fields when no sections). */
  const currentFields = $derived.by(() => {
    if (!hasSections || !currentSection) return visibleFields(form?.fields || [], values);
    return sectionFields(currentSection);
  });

  const nextSectionId = $derived(
    hasSections && currentSection
      ? resolveNextSectionId(currentSection.id, sections, form.fields, values)
      : null
  );
  const isLastSection = $derived(hasSections && nextSectionId === null);

  /** Validate a set of fields into `errors`; returns true when clean. */
  function validateFields(/** @type {import('$lib/helpers/forms.js').FormField[]} */ fieldList) {
    /** @type {Record<string, string | null>} */
    const newErrors = { ...errors };
    let hasError = false;
    for (const field of fieldList) {
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
    return !hasError;
  }

  function goNext() {
    if (!validateFields(currentFields)) return;
    if (nextSectionId) {
      sectionHistory.push(currentSectionId);
      currentSectionId = nextSectionId;
    }
  }

  function goBack() {
    const prev = sectionHistory.pop();
    if (prev) currentSectionId = prev;
  }

  function handleSubmit() {
    // validate ALL currently-visible fields (across sections) before submitting
    if (!validateFields(visibleFields(form.fields, values))) return;
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

  {#if readonly && hasSections}
    <!-- readonly preview: all sections flat, no wizard chrome -->
    {#each sections as section (section.id)}
      {#if section.title}
        <h3 class="font-semibold">{section.title}</h3>
      {/if}
      {#if section.description}
        <p class="text-sm text-base-content/60">{section.description}</p>
      {/if}
      <FieldsRenderer
        fields={sectionFields(section)}
        {values}
        {errors}
        {readonly}
        onchange={handleFieldChange}
      />
    {/each}
  {:else}
    {#if hasSections && currentSection}
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">{currentSection.title}</h3>
        <span class="text-sm text-base-content/50"
          >{m.form_section_progress({ current: currentIndex + 1, total: sections.length })}</span
        >
      </div>
      {#if currentSection.description}
        <p class="text-sm text-base-content/60">{currentSection.description}</p>
      {/if}
    {/if}

    <FieldsRenderer
      fields={currentFields}
      {values}
      {errors}
      {readonly}
      onchange={handleFieldChange}
    />
  {/if}

  {#if !readonly}
    {#if hasSections && !isLastSection}
      <div class="flex gap-2">
        {#if sectionHistory.length > 0}
          <button class="btn btn-ghost" onclick={goBack}>{m.form_section_back()}</button>
        {/if}
        <button class="btn flex-1 btn-primary" onclick={goNext}>{m.form_section_next()}</button>
      </div>
    {:else}
      <div class="flex gap-2">
        {#if hasSections && sectionHistory.length > 0}
          <button class="btn btn-ghost" onclick={goBack}>{m.form_section_back()}</button>
        {/if}
        <button class="btn flex-1 btn-primary" onclick={handleSubmit}>Submit</button>
      </div>
    {/if}
  {/if}
</div>
