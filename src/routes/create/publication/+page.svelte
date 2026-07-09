<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { fetchEventById } from '$lib/helpers/nostrUtils';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { createPublication, updatePublication } from '$lib/stores/publication-actions.svelte.js';
  import { parsePublicationEvent } from '$lib/helpers/publication/publicationTags.js';
  import { normalizeDoi } from '$lib/helpers/publication/doi.js';
  import { fetchPublicationPrefill } from '$lib/helpers/publication/urlMetadata.js';
  import { getLicenseOptions } from '$lib/helpers/educational/licenseOptions.js';
  import { resolveVocabField } from '$lib/helpers/educational/vocabResolver.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import CreatorInput from '$lib/components/educational/CreatorInput.svelte';
  import FormConceptPicker from '$lib/components/forms/FormConceptPicker.svelte';
  import EditableList from '$lib/components/shared/EditableList.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: { communityPubkey: string, editNaddr: string } }} */
  let { data } = $props();

  // Edit mode state
  let editEvent = $state(/** @type {any} */ (null));
  let isLoadingEdit = $state(false);
  let editError = $state('');

  const isEditMode = $derived(!!data.editNaddr);

  // Form state
  let title = $state('');
  let abstract = $state('');
  let doiInput = $state('');
  let url = $state('');
  let journal = $state('');
  let datePublished = $state('');
  let inLanguage = $state('de');
  let license = $state('');
  let keywords = $state(/** @type {string[]} */ ([]));
  /** @type {import('$lib/stores/educational-actions.svelte.js').Creator[]} */
  let creators = $state([]);
  /** @type {Array<{id: string, label: string}>} */
  let subjects = $state([]);

  // UI state
  let isPublishing = $state(false);
  let validationError = $state('');

  // URL → metadata prefill (Highwire citation_* tags via /api/reader)
  let isInspectingUrl = $state(false);
  let urlPrefillApplied = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let urlInspectTimer;
  let lastInspectedUrl = '';

  const licenseOptions = $derived(getLicenseOptions(license));
  const subjectField = $derived(resolveVocabField('hochschulfaecher'));

  const languageOptions = [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'it', label: 'Italiano' }
  ];

  /**
   * FormConceptPicker adapters (same shapes as ResourceFormWizard)
   * @param {{id: string, label: string}} c
   */
  function toRichConcept(c) {
    const locale = getLocale();
    return {
      id: c.id,
      nostrCoord: '',
      relay: subjectField?.vocab?.relay ?? '',
      labels: c.label ? { [locale]: c.label } : {}
    };
  }

  /** @param {import('$lib/helpers/form-to-amb.js').SelectedConcept} rich */
  function toCompactConcept(rich) {
    const locale = getLocale();
    const labels = rich.labels || {};
    return {
      id: rich.id,
      label: labels[locale] || labels.de || labels.en || Object.values(labels)[0] || ''
    };
  }

  // Resolve edit naddr to event and prefill
  $effect(() => {
    if (!data.editNaddr) return;

    isLoadingEdit = true;
    editError = '';

    (async () => {
      try {
        const decoded = nip19.decode(data.editNaddr);
        if (decoded.type !== 'naddr') {
          editError = m.create_edit_error_invalid_address();
          return;
        }

        const event = await fetchEventById(data.editNaddr);
        if (!event) {
          editError = m.publication_edit_error_not_found();
          return;
        }

        editEvent = event;
        const parsed = parsePublicationEvent(event);
        title = parsed.title;
        abstract = parsed.abstract || '';
        doiInput = parsed.doi || '';
        url = parsed.url || '';
        journal = parsed.journal || '';
        datePublished = parsed.datePublished || '';
        inLanguage = parsed.inLanguage || 'de';
        license = parsed.license || '';
        keywords = parsed.keywords;
        creators = parsed.creators;
        subjects = parsed.subjects;
      } catch (err) {
        console.error('Error loading publication for edit:', err);
        editError = m.publication_edit_error_load();
      } finally {
        isLoadingEdit = false;
      }
    })();
  });

  // Debounced auto-inspect of the article URL: derive metadata from the
  // page's citation_*/OG tags and fill EMPTY fields only, so user input and
  // edit-mode prefill are never overwritten.
  $effect(() => {
    const current = url.trim();
    if (urlInspectTimer) clearTimeout(urlInspectTimer);
    if (!current || current === lastInspectedUrl || isLoadingEdit) return;
    if (!/^https?:\/\/.+\..+/.test(current)) return;

    urlInspectTimer = setTimeout(async () => {
      lastInspectedUrl = current;
      isInspectingUrl = true;
      try {
        const prefill = await fetchPublicationPrefill(current);
        let applied = false;
        if (prefill.title && !title.trim()) {
          title = prefill.title;
          applied = true;
        }
        if (prefill.creators?.length && creators.length === 0) {
          creators = prefill.creators;
          applied = true;
        }
        if (prefill.doi && !doiInput.trim()) {
          doiInput = prefill.doi;
          applied = true;
        }
        if (prefill.datePublished && !datePublished) {
          datePublished = prefill.datePublished;
          applied = true;
        }
        if (prefill.journal && !journal.trim()) {
          journal = prefill.journal;
          applied = true;
        }
        if (prefill.abstract && !abstract.trim()) {
          abstract = prefill.abstract;
          applied = true;
        }
        if (prefill.keywords?.length && keywords.length === 0) {
          keywords = prefill.keywords;
          applied = true;
        }
        if (prefill.inLanguage) {
          inLanguage = prefill.inLanguage;
        }
        urlPrefillApplied = applied;
      } finally {
        isInspectingUrl = false;
      }
    }, 600);

    return () => {
      if (urlInspectTimer) clearTimeout(urlInspectTimer);
    };
  });

  function handleBack() {
    history.back();
  }

  async function handlePublish() {
    validationError = '';

    if (!title.trim()) {
      validationError = m.publication_form_validation_title();
      return;
    }

    const doi = doiInput.trim() ? normalizeDoi(doiInput) : '';
    if (doiInput.trim() && !doi) {
      validationError = m.publication_form_error_doi_invalid();
      return;
    }

    isPublishing = true;
    try {
      /** @type {import('$lib/helpers/publication/publicationTags.js').PublicationFormData} */
      const formData = {
        title: title.trim(),
        abstract: abstract.trim() || undefined,
        doi: doi || undefined,
        url: url.trim() || undefined,
        journal: journal.trim() || undefined,
        datePublished: datePublished || undefined,
        inLanguage,
        license: license || undefined,
        keywords,
        creators,
        subjects
      };

      let naddr;
      if (isEditMode && editEvent) {
        const result = await updatePublication(formData, editEvent);
        naddr = result.naddr;
      } else {
        const result = await createPublication(formData, data.communityPubkey || undefined);
        naddr = result.naddr;
      }

      if (naddr) {
        goto(resolve(`/${naddr}`));
      } else {
        handleBack();
      }
    } catch (err) {
      console.error('Publish failed:', err);
      validationError = err instanceof Error ? err.message : m.toast_publish_failed();
    } finally {
      isPublishing = false;
    }
  }
</script>

<svelte:head>
  <title>
    {isEditMode ? m.publication_editor_page_title_edit() : m.publication_editor_page_title_create()}
    - {runtimeConfig.appName}
  </title>
</svelte:head>

<div class="min-h-[calc(100vh-4rem)]">
  <!-- Top bar -->
  <div>
    <div class="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
      <button class="btn btn-ghost btn-sm" onclick={handleBack} aria-label={m.aria_go_back()}>
        <ChevronLeftIcon class_="w-5 h-5" />
      </button>
      <h1 class="text-lg font-semibold text-base-content">
        {isEditMode
          ? m.publication_editor_page_title_edit()
          : m.publication_editor_page_title_create()}
      </h1>
    </div>
  </div>

  <!-- Content -->
  {#if isLoadingEdit}
    <div class="flex items-center justify-center py-20">
      <span class="loading loading-lg loading-spinner text-primary"></span>
    </div>
  {:else if editError}
    <div class="mx-auto max-w-3xl px-4 py-10">
      <div class="alert alert-error">
        <span>{editError}</span>
      </div>
      <button class="btn mt-4 btn-outline" onclick={handleBack}>Go Back</button>
    </div>
  {:else}
    <div class="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <!-- Title -->
      <div class="form-control">
        <label class="label" for="publication-title">
          <span class="label-text font-medium">
            {m.publication_form_label_title()} <span class="text-error">*</span>
          </span>
        </label>
        <input
          id="publication-title"
          type="text"
          class="input w-full text-xl font-bold"
          placeholder={m.publication_form_placeholder_title()}
          bind:value={title}
        />
      </div>

      <!-- Authors -->
      <CreatorInput
        bind:creators
        label={m.publication_form_label_authors()}
        helpText={m.publication_form_help_authors()}
      />

      <!-- DOI + URL -->
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="form-control">
          <label class="label" for="publication-doi">
            <span class="label-text font-medium">DOI</span>
          </label>
          <input
            id="publication-doi"
            type="text"
            class="input w-full"
            placeholder={m.publication_form_placeholder_doi()}
            bind:value={doiInput}
          />
        </div>
        <div class="form-control">
          <label class="label" for="publication-url">
            <span class="label-text flex items-center gap-2 font-medium">
              {m.publication_form_label_url()}
              {#if isInspectingUrl}
                <span class="loading loading-xs loading-spinner"></span>
              {/if}
            </span>
          </label>
          <input
            id="publication-url"
            type="url"
            class="input w-full"
            placeholder="https://..."
            bind:value={url}
          />
          <p class="mt-1 text-xs text-base-content/60">{m.publication_form_url_inspect_hint()}</p>
          {#if urlPrefillApplied}
            <p class="mt-1 text-xs text-success">{m.publication_form_url_prefill_applied()}</p>
          {/if}
        </div>
      </div>

      <!-- Journal + publication date -->
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="form-control">
          <label class="label" for="publication-journal">
            <span class="label-text font-medium">{m.publication_form_label_journal()}</span>
          </label>
          <input
            id="publication-journal"
            type="text"
            class="input w-full"
            placeholder={m.publication_form_placeholder_journal()}
            bind:value={journal}
          />
        </div>
        <div class="form-control">
          <label class="label" for="publication-date">
            <span class="label-text font-medium">{m.publication_form_label_date()}</span>
          </label>
          <input
            id="publication-date"
            type="date"
            class="input w-full"
            bind:value={datePublished}
          />
        </div>
      </div>

      <!-- Abstract -->
      <div class="form-control">
        <label class="label" for="publication-abstract">
          <span class="label-text font-medium">{m.publication_form_label_abstract()}</span>
        </label>
        <textarea
          id="publication-abstract"
          class="textarea w-full"
          rows="5"
          placeholder={m.publication_form_placeholder_abstract()}
          bind:value={abstract}
        ></textarea>
      </div>

      <!-- Subjects (DeStatis Fachsystematik) -->
      {#if subjectField}
        <div class="form-control">
          <div class="label">
            <span class="label-text font-medium">{m.publication_form_label_subjects()}</span>
          </div>
          <FormConceptPicker
            field={subjectField}
            multiple={true}
            value={subjects.map(toRichConcept)}
            onchange={(/** @type {any[]} */ rich) => {
              subjects = rich.map(toCompactConcept);
            }}
          />
          <p class="mt-1 text-xs text-base-content/60">{m.publication_form_help_subjects()}</p>
        </div>
      {/if}

      <!-- Language + license -->
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="form-control">
          <label class="label" for="publication-language">
            <span class="label-text font-medium">{m.publication_form_label_language()}</span>
          </label>
          <select id="publication-language" class="select w-full" bind:value={inLanguage}>
            {#each languageOptions as lang (lang.code)}
              <option value={lang.code}>{lang.label}</option>
            {/each}
          </select>
        </div>
        <div class="form-control">
          <label class="label" for="publication-license">
            <span class="label-text font-medium">{m.publication_form_label_license()}</span>
          </label>
          <select id="publication-license" class="select w-full" bind:value={license}>
            <option value="">{m.publication_form_license_none()}</option>
            {#each licenseOptions as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <!-- Keywords -->
      <EditableList
        bind:items={keywords}
        label={m.publication_form_label_keywords()}
        placeholder={m.publication_form_placeholder_keywords()}
        buttonText="+"
        itemType="keyword"
      />

      <!-- Validation Error -->
      {#if validationError}
        <div class="alert alert-error">
          <span>{validationError}</span>
        </div>
      {/if}

      <!-- Publish Button -->
      <button class="btn w-full btn-primary" onclick={handlePublish} disabled={isPublishing}>
        {#if isPublishing}
          <span class="loading loading-sm loading-spinner"></span>
          {m.article_editor_publishing()}
        {:else if isEditMode}
          {m.publication_editor_update()}
        {:else}
          {m.publication_editor_publish()}
        {/if}
      </button>
    </div>
  {/if}
</div>
