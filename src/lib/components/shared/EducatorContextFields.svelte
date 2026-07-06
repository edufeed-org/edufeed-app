<!--
  EducatorContextFields — the "Pädagogischer Kontext" block shared by the
  profile edit modal and the signup wizard: Bildungsbereich multi-select,
  subject vocab picker(s) driven by the selected Bildungsbereiche, and
  free-form interests. Dumb component: emits the full edufeed value via
  `onchange`, publishing happens in the caller.
-->
<script>
  import SKOSDropdown from '$lib/components/educational/SKOSDropdown.svelte';
  import FormConceptPicker from '$lib/components/forms/FormConceptPicker.svelte';
  import InterestsInput from '$lib/components/shared/InterestsInput.svelte';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages';
  import {
    getBildungsbereichProfileConcepts,
    getSubjectVocabKeysForConcepts,
    subjectsToPickerValue,
    mergeSubjectsForVocab
  } from '$lib/helpers/educational/educatorProfile.js';
  import { getSubjectVocabLabel } from '$lib/helpers/educational/bildungsbereich.js';
  import { resolveVocabField } from '$lib/helpers/educational/vocabResolver.js';

  /**
   * @typedef {import('$lib/helpers/educational/educatorProfile.js').EdufeedProfile} EdufeedProfile
   */

  /**
   * @typedef {Object} Props
   * @property {EdufeedProfile} value
   * @property {(value: EdufeedProfile) => void} [onchange]
   * @property {boolean} [compact] - Compact dropdown panels for modal contexts
   */
  /** @type {Props} */
  let {
    value = { interests: [], educationalLevels: [], subjects: [] },
    onchange,
    compact = false
  } = $props();

  const locale = $derived(getLocale());

  const levelProfileConcepts = getBildungsbereichProfileConcepts();
  // SKOSDropdown expects the skosLoader SKOSConcept shape (`labels`).
  const levelDropdownConcepts = levelProfileConcepts.map((c) => ({
    id: c.id,
    labels: c.prefLabel ?? {}
  }));

  /** @param {Record<string, string> | undefined} prefLabel */
  function pickLabel(prefLabel) {
    if (!prefLabel) return '';
    return prefLabel[locale] || prefLabel.de || prefLabel.en || '';
  }

  const levelSelected = $derived(
    value.educationalLevels.map((c) => ({ id: c.id, label: pickLabel(c.prefLabel) || c.id }))
  );

  /** @param {{ id: string, label: string }[]} arr */
  function handleLevelsChange(arr) {
    const educationalLevels = arr.map(
      (item) =>
        levelProfileConcepts.find((c) => c.id === item.id) ?? {
          id: item.id,
          prefLabel: { [locale]: item.label }
        }
    );
    onchange?.({ ...value, educationalLevels });
  }

  const vocabFields = $derived(
    getSubjectVocabKeysForConcepts(value.educationalLevels)
      .map((key) => ({ key, field: resolveVocabField(key) }))
      .filter((entry) => entry.field !== null)
  );

  /**
   * @param {string} vocabKey
   * @param {import('$lib/helpers/educational/educatorProfile.js').PickerConcept[]} picked
   */
  function handleSubjectsChange(vocabKey, picked) {
    onchange?.({ ...value, subjects: mergeSubjectsForVocab(value.subjects, vocabKey, picked) });
  }

  /** @param {string[]} interests */
  function handleInterestsChange(interests) {
    onchange?.({ ...value, interests });
  }
</script>

<div class="flex flex-col gap-4">
  <div class="form-control">
    <label class="label" for="educator-levels">
      <span class="label-text">{m.educator_context_levels_label()}</span>
    </label>
    <div id="educator-levels">
      <SKOSDropdown
        concepts={levelDropdownConcepts}
        isLoading={false}
        selected={levelSelected}
        multiple={true}
        {compact}
        maxSelections={levelDropdownConcepts.length}
        onchange={handleLevelsChange}
      />
    </div>
  </div>

  {#each vocabFields as { key, field } (key)}
    <div class="form-control">
      <label class="label" for="educator-subjects-{key}">
        <span class="label-text">
          {m.educator_context_subjects_label()}{#if vocabFields.length > 1}
            ({getSubjectVocabLabel(key, locale)}){/if}
        </span>
      </label>
      <div id="educator-subjects-{key}">
        <FormConceptPicker
          {field}
          value={subjectsToPickerValue(value.subjects, key)}
          multiple={true}
          onchange={(picked) => handleSubjectsChange(key, picked)}
        />
      </div>
    </div>
  {/each}

  <div class="form-control">
    <label class="label" for="educator-interests">
      <span class="label-text">{m.educator_context_interests_label()}</span>
    </label>
    <div id="educator-interests">
      <InterestsInput value={value.interests} onchange={handleInterestsChange} />
    </div>
  </div>
</div>
