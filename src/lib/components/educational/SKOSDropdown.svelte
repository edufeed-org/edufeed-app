<!--
  SKOSDropdown Component
  A reusable dropdown for selecting SKOS concepts with search, multi-select,
  collapsible hierarchy, keyboard navigation, and accessibility support.
  Using DaisyUI 5 dropdown component.
-->

<script>
  import { onMount } from 'svelte';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import {
    fetchVocabulary,
    getConceptLabel,
    sortConceptsByLabel,
    filterConcepts
  } from '$lib/helpers/educational/skosLoader.js';
  import { CloseIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon } from '$lib/components/icons';
  import { setCachedConcepts } from '$lib/stores/skos-cache.svelte.js';
  import { SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {import('$lib/helpers/educational/skosLoader.js').SKOSConcept} SKOSConcept
   */

  /**
   * @typedef {Object} SelectedConcept
   * @property {string} id - The concept URI
   * @property {string} label - The display label
   */

  /** @type {{ vocabularyKey?: 'learningResourceType' | 'about' | 'intendedEndUserRole', concepts?: SKOSConcept[], isLoading?: boolean, error?: string | null, selected?: SelectedConcept[], multiple?: boolean, required?: boolean, label?: string, placeholder?: string, helpText?: string, disabled?: boolean, maxSelections?: number, compact?: boolean, onchange?: (selected: SelectedConcept[]) => void }} */
  let {
    vocabularyKey,
    concepts: propConcepts = undefined,
    isLoading: propIsLoading = undefined,
    error: propError = undefined,
    selected = $bindable([]),
    multiple = true,
    required = false,
    label = '',
    placeholder = '',
    helpText = '',
    disabled = false,
    maxSelections = 10,
    compact = false,
    onchange = () => {}
  } = $props();

  // Internal state used only when concepts/isLoading/error are not provided by the caller.
  let internalConcepts = $state(/** @type {SKOSConcept[]} */ ([]));
  let internalIsLoading = $state(true);
  let internalError = $state(/** @type {string | null} */ (null));

  // Effective data — props take precedence over internal fetch state.
  const concepts = $derived(propConcepts ?? internalConcepts);
  const isLoading = $derived(propIsLoading ?? internalIsLoading);
  const error = $derived(propError ?? internalError);

  // Stable id seed for ARIA so multiple instances without a vocabularyKey do not collide.
  // Falls back to a per-mount random token; tracks vocabularyKey reactively if it changes.
  const _fallbackInstanceId = `skos-${Math.random().toString(36).slice(2, 9)}`;
  const instanceId = $derived(vocabularyKey ?? _fallbackInstanceId);
  let isOpen = $state(false);
  let searchTerm = $state('');
  /** @type {HTMLDivElement | null} */
  let dropdownRef = $state(null);
  /** @type {HTMLInputElement | null} */
  let inputRef = $state(null);
  /** @type {HTMLDivElement | null} */
  let listRef = $state(null);
  /** @type {HTMLButtonElement | null} */
  let triggerRef = $state(null);

  // Keyboard navigation state
  let activeIndex = $state(-1);

  // Collapsible hierarchy state
  /** @type {Set<string>} */
  let collapsedCategories = new SvelteSet();

  // Get current locale
  const locale = $derived(getLocale());

  // Panel max-height: compact mode for constrained contexts (e.g., modals)
  const panelMaxHeight = $derived(compact ? 'max-h-[min(40vh,280px)]' : 'max-h-[min(60vh,480px)]');

  // Set of concept IDs that have children
  const parentIds = $derived(new Set(concepts.filter((c) => c.parentId).map((c) => c.parentId)));

  // Filtered and sorted concepts
  const filteredConcepts = $derived.by(() => {
    let filtered = filterConcepts(concepts, searchTerm, locale);
    return sortConceptsByLabel(filtered, locale);
  });

  // Visible concepts (respects collapse state, bypassed when searching)
  const visibleConcepts = $derived.by(() => {
    if (searchTerm.trim()) return filteredConcepts;
    return filteredConcepts.filter((c) => {
      if (!c.level || c.level === 0) return true;
      return !collapsedCategories.has(c.parentId ?? '');
    });
  });

  // Load vocabulary on mount — skipped when data is supplied via props.
  onMount(async () => {
    if (propConcepts !== undefined) {
      // Caller supplies the vocabulary — clear the internal loading flag so
      // the panel renders options instead of staying on the loading spinner.
      internalIsLoading = false;
      return;
    }
    if (!vocabularyKey) {
      internalIsLoading = false;
      return;
    }
    try {
      internalConcepts = await fetchVocabulary(vocabularyKey);
      setCachedConcepts(vocabularyKey, internalConcepts);
      internalIsLoading = false;
    } catch (e) {
      internalError = e instanceof Error ? e.message : 'Failed to load vocabulary';
      internalIsLoading = false;
    }
  });

  // Default collapsed for large vocabularies
  $effect(() => {
    if (concepts.length > 30) {
      collapsedCategories.clear();
      for (const c of concepts) {
        if (c.parentId) collapsedCategories.add(c.parentId);
      }
    }
  });

  // When selected concepts live inside collapsed parents (e.g. an AI suggestion
  // populates the field while the parent is auto-collapsed), expand the chain
  // up to the root so the marked rows are visible. Only ever DELETES from
  // collapsedCategories — never re-adds — so it cannot trample the user's
  // manual collapse of unrelated parents.
  $effect(() => {
    if (!concepts.length || !selected.length) return;
    const byId = new Map(concepts.map((c) => [c.id, c]));
    for (const s of selected) {
      let c = byId.get(s.id);
      while (c?.parentId) {
        collapsedCategories.delete(c.parentId);
        c = byId.get(c.parentId);
      }
    }
  });

  // Reset active index when search term changes
  $effect(() => {
    void searchTerm;
    activeIndex = -1;
  });

  // Close dropdown when clicking outside
  /** @param {MouseEvent} event */
  function handleClickOutside(event) {
    if (dropdownRef && event.target instanceof Node && !dropdownRef.contains(event.target)) {
      isOpen = false;
      activeIndex = -1;
    }
  }

  // Add/remove event listener
  $effect(() => {
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      setTimeout(() => inputRef?.focus(), 0);
    } else {
      document.removeEventListener('click', handleClickOutside);
      searchTerm = '';
    }
    return () => document.removeEventListener('click', handleClickOutside);
  });

  /**
   * Toggle selection of a concept
   * @param {SKOSConcept} concept
   */
  function toggleSelection(concept) {
    const conceptLabel = getConceptLabel(concept, locale);
    const isAlreadySelected = selected.some((s) => s.id === concept.id);

    if (isAlreadySelected) {
      selected = selected.filter((s) => s.id !== concept.id);
    } else {
      if (multiple) {
        if (selected.length < maxSelections) {
          selected = [...selected, { id: concept.id, label: conceptLabel }];
        }
      } else {
        selected = [{ id: concept.id, label: conceptLabel }];
        isOpen = false;
      }
    }

    onchange(selected);
  }

  /**
   * Remove a selected item
   * @param {string} id
   * @param {Event} event
   */
  function removeSelection(id, event) {
    event.stopPropagation();
    selected = selected.filter((s) => s.id !== id);
    onchange(selected);
  }

  /**
   * Check if a concept is selected
   * @param {string} id
   * @returns {boolean}
   */
  function isSelected(id) {
    return selected.some((s) => s.id === id);
  }

  /**
   * Toggle collapse/expand of a parent category
   * @param {string} conceptId
   * @param {Event} event
   */
  function toggleCategory(conceptId, event) {
    event.stopPropagation();
    if (collapsedCategories.has(conceptId)) {
      collapsedCategories.delete(conceptId);
    } else {
      collapsedCategories.add(conceptId);
    }
  }

  /** Scroll the active option into view */
  function scrollActiveIntoView() {
    if (!listRef || activeIndex < 0) return;
    const el = listRef.querySelector(`[data-option-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Handle keyboard navigation
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    if (!isOpen) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        isOpen = true;
        activeIndex = -1;
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        isOpen = false;
        activeIndex = -1;
        triggerRef?.focus();
        break;

      case 'ArrowDown':
        event.preventDefault();
        if (activeIndex < visibleConcepts.length - 1) {
          activeIndex++;
          scrollActiveIntoView();
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (activeIndex > 0) {
          activeIndex--;
          scrollActiveIntoView();
        } else if (activeIndex === 0) {
          activeIndex = -1;
          inputRef?.focus();
        }
        break;

      case 'Enter':
      case ' ':
        if (activeIndex >= 0 && activeIndex < visibleConcepts.length) {
          event.preventDefault();
          toggleSelection(visibleConcepts[activeIndex]);
        }
        break;

      case 'Home':
        event.preventDefault();
        activeIndex = 0;
        scrollActiveIntoView();
        break;

      case 'End':
        event.preventDefault();
        activeIndex = visibleConcepts.length - 1;
        scrollActiveIntoView();
        break;
    }
  }

  /**
   * Split a label into segments for search highlighting
   * @param {string} labelText
   * @param {string} term
   * @returns {{ text: string, highlight: boolean }[]}
   */
  function getHighlightSegments(labelText, term) {
    if (!term.trim()) return [{ text: labelText, highlight: false }];
    const lowerLabel = labelText.toLowerCase();
    const lowerTerm = term.toLowerCase().trim();
    const idx = lowerLabel.indexOf(lowerTerm);
    if (idx === -1) return [{ text: labelText, highlight: false }];
    return [
      { text: labelText.slice(0, idx), highlight: false },
      { text: labelText.slice(idx, idx + lowerTerm.length), highlight: true },
      { text: labelText.slice(idx + lowerTerm.length), highlight: false }
    ].filter((s) => s.text);
  }
</script>

<div class="form-control w-full">
  <!-- Label -->
  {#if label}
    <div class="label">
      <span class="label-text font-medium">
        {label}
        {#if required}
          <span class="text-error">*</span>
        {/if}
      </span>
    </div>
  {/if}

  <!-- Dropdown wrapper -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dropdown w-full"
    class:dropdown-open={isOpen}
    bind:this={dropdownRef}
    onkeydown={handleKeydown}
  >
    <!-- Trigger button -->
    <button
      type="button"
      bind:this={triggerRef}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={isOpen}
      aria-controls="skos-listbox-{instanceId}"
      aria-activedescendant={activeIndex >= 0
        ? `skos-option-${instanceId}-${activeIndex}`
        : undefined}
      class="select-bordered select-trigger select w-full pr-8"
      class:select-disabled={disabled}
      onclick={() => !disabled && (isOpen = !isOpen)}
      {disabled}
    >
      {#if isLoading}
        <span class="loading loading-sm loading-spinner"></span>
        <span class="text-base-content/50">{m.skos_loading()}</span>
      {:else if error}
        <span class="text-sm text-error">{error}</span>
      {:else if selected.length === 0}
        <span class="text-base-content/70">{placeholder || m.skos_dropdown_select()}</span>
      {:else}
        <!-- Selected items as badges -->
        <div class="flex flex-wrap gap-1.5">
          {#each selected as item (item.id)}
            <span class="badge gap-1 py-2 badge-primary" data-skos-chip-id={item.id}>
              {item.label}
              <span
                role="button"
                tabindex="0"
                class="hover:bg-primary-focus cursor-pointer rounded-full p-0.5"
                onclick={(e) => removeSelection(item.id, e)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    removeSelection(item.id, e);
                  }
                }}
                aria-label="Remove {item.label}"
              >
                <CloseIcon class_="w-3 h-3" />
              </span>
            </span>
          {/each}
        </div>
      {/if}
    </button>

    <!-- Dropdown arrow -->
    <div
      class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 transition-transform"
      class:rotate-180={isOpen}
    >
      <ChevronDownIcon class_="w-4 h-4 text-base-content/50" />
    </div>

    <!-- Dropdown panel -->
    {#if !error && isOpen}
      <div
        class="dropdown-content z-[100] mt-1 flex {panelMaxHeight} w-full min-w-[min(20rem,100%)] flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg sm:min-w-[min(24rem,100%)]"
      >
        {#if isLoading}
          <!-- Loading state inside panel -->
          <div
            class="flex items-center justify-center gap-2 p-6 text-base-content/60"
            data-testid="skos-panel-loading"
          >
            <span class="loading loading-sm loading-spinner"></span>
            <span>{m.skos_loading()}</span>
          </div>
        {:else}
          <!-- Search Input -->
          <div class="sticky top-0 z-10 border-b border-base-300 bg-base-100 p-2">
            <div class="relative">
              <SearchIcon
                class_="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50"
              />
              <input
                type="text"
                bind:this={inputRef}
                bind:value={searchTerm}
                placeholder={m.skos_dropdown_search()}
                aria-label={m.skos_dropdown_search()}
                class="input-bordered input input-sm w-full pl-9"
                onclick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          <!-- Options List -->
          <div
            bind:this={listRef}
            class="flex-1 overflow-y-auto"
            role="listbox"
            id="skos-listbox-{instanceId}"
            aria-multiselectable={multiple}
          >
            {#if visibleConcepts.length === 0}
              <div class="p-4 text-center text-base-content/50">
                {m.skos_dropdown_no_results()}
              </div>
            {:else}
              {#each visibleConcepts as concept, index (concept.id)}
                {@const conceptLabel = getConceptLabel(concept, locale)}
                {@const conceptSelected = isSelected(concept.id)}
                {@const indentLevel = concept.level || 0}
                {@const hasChildren = parentIds.has(concept.id)}
                {@const isCollapsed = collapsedCategories.has(concept.id)}
                {@const isActive = index === activeIndex}

                <div
                  data-option-index={index}
                  id="skos-option-{instanceId}-{index}"
                  role="option"
                  aria-selected={conceptSelected}
                  class="flex min-h-[2.75rem] w-full items-center transition-colors hover:bg-base-200 {conceptSelected
                    ? 'bg-primary/10'
                    : ''} {isActive
                    ? 'bg-base-200 outline outline-2 -outline-offset-2 outline-primary/30'
                    : ''}"
                  style="padding-left: {8 + indentLevel * 20}px; padding-right: 8px;"
                >
                  <!-- Collapse/expand toggle for parent concepts -->
                  {#if hasChildren && !searchTerm.trim()}
                    <button
                      type="button"
                      class="flex-shrink-0 rounded p-1 transition-transform hover:bg-base-300"
                      class:rotate-90={!isCollapsed}
                      onclick={(e) => toggleCategory(concept.id, e)}
                      aria-label={isCollapsed
                        ? m.skos_dropdown_expand()
                        : m.skos_dropdown_collapse()}
                      tabindex="-1"
                    >
                      <ChevronRightIcon class_="w-3.5 h-3.5 text-base-content/50" />
                    </button>
                  {:else if indentLevel > 0 && !searchTerm.trim()}
                    <!-- Spacer for leaf nodes to align with parents that have toggles -->
                    <span class="w-[1.625rem] flex-shrink-0"></span>
                  {/if}

                  <!-- Label/selection button. The whole row label selects (parents
                       included — broader concepts are independently taggable in SKOS).
                       The chevron next to it owns expand/collapse. -->
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                    onclick={() => toggleSelection(concept)}
                    tabindex="-1"
                  >
                    {#if multiple}
                      <input
                        type="checkbox"
                        class="checkbox flex-shrink-0 checkbox-sm checkbox-primary"
                        checked={conceptSelected}
                        readonly
                        tabindex="-1"
                      />
                    {/if}
                    <span
                      class="flex-1 {indentLevel > 0 && !conceptSelected
                        ? 'text-base-content/70'
                        : ''}"
                      class:font-semibold={indentLevel === 0 && hasChildren}
                      class:font-medium={conceptSelected}
                    >
                      {#if searchTerm.trim()}
                        {#each getHighlightSegments(conceptLabel, searchTerm) as segment, i (i)}
                          {#if segment.highlight}
                            <mark class="rounded-sm bg-warning/30 text-inherit">{segment.text}</mark
                            >
                          {:else}
                            {segment.text}
                          {/if}
                        {/each}
                      {:else}
                        {conceptLabel}
                      {/if}
                    </span>
                    <!-- Child count badge for collapsed parents -->
                    {#if hasChildren && isCollapsed && !searchTerm.trim()}
                      {@const childCount = concepts.filter((c) => c.parentId === concept.id).length}
                      <span class="badge flex-shrink-0 badge-ghost badge-xs">{childCount}</span>
                    {/if}
                    {#if conceptSelected && !multiple}
                      <svg
                        class="h-4 w-4 flex-shrink-0 text-primary"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    {/if}
                  </button>
                </div>
              {/each}
            {/if}
          </div>

          <!-- Selection count (for multi-select) -->
          {#if multiple && selected.length > 0}
            <div
              class="flex items-center justify-between border-t border-base-300 bg-base-200 p-2 text-xs text-base-content/70"
            >
              <span>{m.skos_selected({ count: String(selected.length) })}</span>
              {#if selected.length >= maxSelections}
                <span class="text-warning">{m.skos_maximum_reached()}</span>
              {/if}
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Help Text -->
  {#if helpText}
    <p class="mt-1 text-xs text-base-content/60">{helpText}</p>
  {/if}
</div>
