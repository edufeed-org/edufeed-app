<!--
  LearningContentFilters Component
  Filter panel for educational content with NIP-50 search support
  Includes free-text search and SKOS vocabulary dropdowns
-->

<script>
  import { getLocale } from '$lib/paraglide/runtime.js';
  import SKOSDropdown from './SKOSDropdown.svelte';
  import ExtFacetField from './ExtFacetField.svelte';
  import { parseFormTemplate } from '$lib/helpers/forms.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} SelectedConcept
   * @property {string} id
   * @property {string} label
   */

  /**
   * @typedef {import('$lib/helpers/educational/searchQueryBuilder.js').SearchFilters} SearchFilters
   * @typedef {import('$lib/helpers/educational/searchQueryBuilder.js').ExtFieldValue} ExtFieldValue
   */

  /**
   * @type {{
   *   onfilterchange: (filters: SearchFilters) => void,
   *   isSearching?: boolean,
   *   searchText?: string,
   *   form?: import('nostr-tools').NostrEvent | null
   * }}
   */
  let {
    onfilterchange,
    isSearching: _isSearching = false,
    searchText = '',
    form = null
  } = $props();

  // Filter state
  let learningResourceType = $state(/** @type {SelectedConcept[]} */ ([]));
  let about = $state(/** @type {SelectedConcept[]} */ ([]));
  let audience = $state(/** @type {SelectedConcept[]} */ ([]));

  // Ext-field state keyed by full ext path "30168:<pub>:<d>:<fieldId>"
  let extFields = $state(/** @type {Record<string, ExtFieldValue[]>} */ ({}));

  // Parse the form (if provided) to extract ext fields
  let parsedForm = $derived(form ? parseFormTemplate(form) : null);
  let formPubkey = $derived(form?.pubkey || '');
  let extFieldDefs = $derived(
    parsedForm ? parsedForm.fields.filter((f) => f.output === 'ext') : []
  );

  /**
   * @param {import('$lib/helpers/forms.js').FormField} field
   */
  function extKeyFor(field) {
    return `30168:${formPubkey}:${parsedForm?.dTag || ''}:${field.id}`;
  }

  // Get current locale
  const locale = $derived(getLocale());

  // Check if any filters are active (excluding searchText which is shown in parent)
  const hasActiveExtFilters = $derived(Object.values(extFields).some((vs) => vs.length > 0));
  const hasActiveFilters = $derived(
    learningResourceType.length > 0 ||
      about.length > 0 ||
      audience.length > 0 ||
      hasActiveExtFilters
  );

  // Check if search text is active (for display purposes)
  const hasSearchText = $derived(searchText.trim() !== '');

  /**
   * Emit filter change immediately (debouncing handled by parent for search)
   */
  function emitFilterChange() {
    /** @type {SearchFilters} */
    const filters = {
      searchText,
      learningResourceType: learningResourceType.map((c) => ({
        id: c.id,
        label: c.label,
        prefLabel: { [locale]: c.label }
      })),
      about: about.map((c) => ({
        id: c.id,
        label: c.label,
        prefLabel: { [locale]: c.label }
      })),
      audience: audience.map((c) => ({
        id: c.id,
        label: c.label,
        prefLabel: { [locale]: c.label }
      })),
      extFields: { ...extFields }
    };
    onfilterchange(filters);
  }

  /**
   * @param {import('$lib/helpers/forms.js').FormField} field
   * @param {ExtFieldValue[]} values
   */
  function handleExtFieldChange(field, values) {
    const key = extKeyFor(field);
    const next = { ...extFields };
    if (values.length === 0) delete next[key];
    else next[key] = values;
    extFields = next;
    emitFilterChange();
  }

  /**
   * Clear all filters (except search which is controlled by parent)
   */
  function clearAllFilters() {
    learningResourceType = [];
    about = [];
    audience = [];
    extFields = {};
    emitFilterChange();
  }

  /**
   * Handle dropdown change
   * @param {'learningResourceType' | 'about' | 'audience'} field
   * @param {SelectedConcept[]} selected
   */
  function handleDropdownChange(field, selected) {
    if (field === 'learningResourceType') {
      learningResourceType = selected;
    } else if (field === 'about') {
      about = selected;
    } else if (field === 'audience') {
      audience = selected;
    }
    emitFilterChange();
  }
</script>

<div class="learning-content-filters space-y-4">
  <!-- Filter Dropdowns -->
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <!-- Learning Resource Type -->
    <SKOSDropdown
      vocabularyKey="learningResourceType"
      bind:selected={learningResourceType}
      multiple={true}
      label={m.learning_filter_resource_type()}
      placeholder={m.learning_filter_resource_type_placeholder()}
      maxSelections={5}
      onchange={(selected) => handleDropdownChange('learningResourceType', selected)}
    />

    <!-- Subject/Topic -->
    <SKOSDropdown
      vocabularyKey="about"
      bind:selected={about}
      multiple={true}
      label={m.learning_filter_subject()}
      placeholder={m.learning_filter_subject_placeholder()}
      maxSelections={5}
      onchange={(selected) => handleDropdownChange('about', selected)}
    />

    <!-- Target Audience -->
    <!-- disabled for now, fetching not working -->
    <!-- <SKOSDropdown
			vocabularyKey="intendedEndUserRole"
			bind:selected={audience}
			multiple={true}
			label={m.learning_filter_audience()}
			placeholder={m.learning_filter_audience_placeholder()}
			maxSelections={5}
			onchange={(selected) => handleDropdownChange('audience', selected)}
		/> -->
  </div>

  <!-- Form-driven ext facets (optional, rendered below the AMB-core dropdowns) -->
  {#if extFieldDefs.length > 0}
    <div
      class="space-y-3 rounded-lg border border-base-300 bg-base-100/50 p-3"
      data-testid="ext-facet-section"
    >
      <h4 class="text-sm font-semibold text-base-content/80">
        {m.learning_filter_ext_heading()}
      </h4>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        {#each extFieldDefs as field (field.id)}
          {@const key = extKeyFor(field)}
          <ExtFacetField
            {field}
            value={extFields[key] || []}
            onchange={(v) => handleExtFieldChange(field, v)}
          />
        {/each}
      </div>
    </div>
  {/if}

  <!-- Active Filters Summary & Clear Button -->
  {#if hasActiveFilters || hasSearchText}
    <div class="flex items-center justify-between rounded-lg bg-base-200 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm text-base-content/70">{m.learning_filter_active()}:</span>
        {#if hasSearchText}
          <span class="badge gap-1 badge-outline">
            {m.learning_filter_search_label()}: "{searchText}"
          </span>
        {/if}
        {#each learningResourceType as item (item.id)}
          <span class="badge gap-1 badge-primary">{item.label}</span>
        {/each}
        {#each about as item (item.id)}
          <span class="badge gap-1 badge-secondary">{item.label}</span>
        {/each}
        {#each audience as item (item.id)}
          <span class="badge gap-1 badge-accent">{item.label}</span>
        {/each}
      </div>
      {#if hasActiveFilters}
        <button type="button" class="btn btn-ghost btn-sm" onclick={clearAllFilters}>
          {m.learning_filter_clear_all()}
        </button>
      {/if}
    </div>
  {/if}
</div>
