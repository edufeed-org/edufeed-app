<!--
  AMBResourceForm Component
  Paginated wizard for creating/editing educational resources (kind:30142)
  Used as a full-page form (not a modal).
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { getLocale } from '$lib/paraglide/runtime.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, CloseIcon } from '$lib/components/icons';
  import SKOSDropdown from './SKOSDropdown.svelte';
  import BlossomUploader from './BlossomUploader.svelte';
  import CreatorInput from './CreatorInput.svelte';
  import ExternalUrlInput from './ExternalUrlInput.svelte';
  import { createEducationalActions } from '$lib/stores/educational-actions.svelte.js';
  import { fetchProfileData } from '$lib/helpers/profile.js';

  /**
   * @typedef {{ id: string, label: string }} SelectedConcept
   * @typedef {{ url: string, name: string, type: string, size: number, sha256: string }} UploadedFile
   * @typedef {{ name: string, type: 'Person' | 'Organization', pubkey?: string, affiliationName?: string, honorificPrefix?: string }} Creator
   */

  /**
   * @type {{
   *   communityPubkey?: string,
   *   editEvent?: any,
   *   editResource?: any
   * }}
   */
  let { communityPubkey = '', editEvent = null, editResource = null } = $props();

  // Determine if we're in edit mode
  const isEditMode = $derived(editEvent !== null && editResource !== null);

  // Current wizard step (1-4)
  let currentStep = $state(1);
  const totalSteps = 4;

  // Form data state
  let formData = $state({
    // Basic Info (Step 1)
    name: '',
    description: '',
    inLanguage: 'de',
    image: '',
    identifier: '',

    // Classification (Step 2)
    learningResourceType: /** @type {SelectedConcept[]} */ ([]),
    about: /** @type {SelectedConcept[]} */ ([]),
    keywords: /** @type {string[]} */ ([]),

    // Content & Creators (Step 3)
    creators: /** @type {Creator[]} */ ([]),
    encodings: /** @type {UploadedFile[]} */ ([]),
    externalUrls: /** @type {string[]} */ ([]),

    // Rights (Step 4)
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true
  });

  // Validation and submission state
  let validationErrors = $state(/** @type {string[]} */ ([]));
  let isSubmitting = $state(false);
  let submitError = $state('');

  // URL validation for identifier field
  let identifierUrlError = $state('');

  // Get active user
  let activeUser = $state(manager.active);
  $effect(() => {
    const subscription = manager.active$.subscribe(async (user) => {
      activeUser = user;
      // Auto-add logged-in user as first creator with fetched profile name
      if (user && formData.creators.length === 0) {
        formData.creators = [
          {
            name: 'Loading...',
            type: 'Person',
            pubkey: user.pubkey
          }
        ];

        try {
          /** @type {{ name?: string, display_name?: string }} */
          const profile = await fetchProfileData(user.pubkey);
          if (
            activeUser?.pubkey === user.pubkey &&
            formData.creators.length === 1 &&
            formData.creators[0].pubkey === user.pubkey
          ) {
            formData.creators = [
              {
                name: profile.name || '',
                type: 'Person',
                pubkey: user.pubkey
              }
            ];
          }
        } catch (error) {
          console.warn('Failed to fetch profile for creator:', error);
          if (
            activeUser?.pubkey === user.pubkey &&
            formData.creators.length === 1 &&
            formData.creators[0].pubkey === user.pubkey
          ) {
            formData.creators = [
              {
                name: '',
                type: 'Person',
                pubkey: user.pubkey
              }
            ];
          }
        }
      }
    });
    return () => subscription.unsubscribe();
  });

  // License options
  const licenseOptions = [
    { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
    { id: 'https://creativecommons.org/licenses/by-sa/4.0/', label: 'CC BY-SA 4.0' },
    { id: 'https://creativecommons.org/licenses/by-nc/4.0/', label: 'CC BY-NC 4.0' },
    { id: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', label: 'CC BY-NC-SA 4.0' },
    { id: 'https://creativecommons.org/publicdomain/zero/1.0/', label: 'CC0 (Public Domain)' },
    { id: 'https://opensource.org/licenses/MIT', label: 'MIT License' }
  ];

  // Language options
  const languageOptions = [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'it', label: 'Italiano' }
  ];

  // Step titles
  const stepTitles = [
    'Basic Information',
    'Classification',
    'Content & Creators',
    'License & Publish'
  ];

  // Import helper functions for extracting data from events
  import {
    getAMBName,
    getAMBDescription,
    getAMBImage,
    getAMBIdentifier,
    getAMBLanguages,
    getAMBLearningResourceTypes,
    getAMBSubjects,
    getAMBKeywords,
    getAMBLicense,
    isAMBFree,
    getAMBEncodings,
    getAMBCreatorNames,
    getAMBExternalUrls
  } from '$lib/helpers/educational/ambHelpers.js';

  // Prefill form with edit data when in edit mode
  $effect(() => {
    if (isEditMode && editEvent && editResource) {
      prefillEditData();
    }
  });

  /**
   * Prefill form with existing data for edit mode
   */
  async function prefillEditData() {
    // Extract creators from p-tags and creator:name tags
    const creatorPubkeys =
      editEvent.tags
        ?.filter((/** @type {string[]} */ t) => t[0] === 'p' && t[3] === 'creator')
        .map((/** @type {string[]} */ t) => t[1]) || [];

    const creatorNames = getAMBCreatorNames(editEvent);

    // Combine pubkey-based creators with name-only creators
    /** @type {Creator[]} */
    const editCreators = [];

    // Add pubkey-based creators
    for (const pubkey of creatorPubkeys) {
      try {
        const profile = /** @type {any} */ (await fetchProfileData(pubkey));
        editCreators.push({
          name: profile.name || '',
          type: 'Person',
          pubkey: pubkey
        });
      } catch (error) {
        console.warn('Failed to fetch profile for creator:', error);
        editCreators.push({
          name: '',
          type: 'Person',
          pubkey: pubkey
        });
      }
    }

    // Add name-only creators (those without pubkeys)
    for (const name of creatorNames) {
      if (!editCreators.some((c) => c.name === name)) {
        editCreators.push({
          name: name,
          type: 'Person'
        });
      }
    }

    // Get learning resource types and subjects
    const lrtTypes = getAMBLearningResourceTypes(editEvent, getLocale());
    const subjects = getAMBSubjects(editEvent, getLocale());

    formData = {
      name: getAMBName(editEvent),
      description: getAMBDescription(editEvent),
      inLanguage: getAMBLanguages(editEvent)[0] || 'de',
      image: getAMBImage(editEvent) || '',
      identifier: getAMBIdentifier(editEvent) || '',
      learningResourceType: lrtTypes.map((t) => ({ id: t.id, label: t.label })),
      about: subjects.map((s) => ({ id: s.id, label: s.label })),
      keywords: getAMBKeywords(editEvent),
      creators:
        editCreators.length > 0
          ? editCreators
          : activeUser
            ? [
                {
                  name: 'Loading...',
                  type: 'Person',
                  pubkey: activeUser.pubkey
                }
              ]
            : [],
      encodings: /** @type {any} */ (
        getAMBEncodings(editEvent).map((enc) => ({
          url: enc.url,
          name: enc.name,
          type: enc.mimeType,
          size: enc.size,
          sha256: enc.sha256
        }))
      ),
      externalUrls: getAMBExternalUrls(editEvent),
      license: getAMBLicense(editEvent)?.id || 'https://creativecommons.org/licenses/by/4.0/',
      isAccessibleForFree: isAMBFree(editEvent)
    };
  }

  /**
   * Validate URL format
   * @param {string} url
   * @returns {boolean}
   */
  function isValidUrl(url) {
    if (!url?.trim()) return true;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Handle identifier URL blur - validate on focus loss
   */
  function handleIdentifierBlur() {
    if (formData.identifier?.trim() && !isValidUrl(formData.identifier)) {
      identifierUrlError = 'Please enter a valid URL or leave empty';
    } else {
      identifierUrlError = '';
    }
  }

  /**
   * Validate current step
   * @returns {boolean}
   */
  function validateCurrentStep() {
    validationErrors = [];

    switch (currentStep) {
      case 1:
        if (formData.identifier?.trim() && !isValidUrl(formData.identifier)) {
          validationErrors.push('Resource URL must be a valid URL or left empty');
          identifierUrlError = 'Please enter a valid URL or leave empty';
        }
        if (!formData.name.trim()) {
          validationErrors.push('Title is required');
        }
        if (!formData.description.trim()) {
          validationErrors.push('Description is required');
        }
        break;
      case 2:
        if (formData.learningResourceType.length === 0) {
          validationErrors.push('Please select at least one resource type');
        }
        if (formData.about.length === 0) {
          validationErrors.push('Please select at least one subject');
        }
        break;
      case 3:
        break;
      case 4:
        if (!formData.license) {
          validationErrors.push('Please select a license');
        }
        break;
    }

    return validationErrors.length === 0;
  }

  function nextStep() {
    if (validateCurrentStep() && currentStep < totalSteps) {
      currentStep++;
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
      validationErrors = [];
    }
  }

  /**
   * Handle form submission
   */
  async function handleSubmit() {
    if (!validateCurrentStep()) return;
    if (!activeUser) {
      submitError = 'Please log in to publish';
      return;
    }

    isSubmitting = true;
    submitError = '';

    try {
      const actions = createEducationalActions();

      const resourceData = {
        name: formData.name,
        description: formData.description,
        slug: formData.identifier?.trim() || '',
        learningResourceType: formData.learningResourceType[0]?.id || '',
        learningResourceTypeLabel: formData.learningResourceType[0]?.label || '',
        about: formData.about.map((s) => s.id),
        aboutLabels: formData.about.map((s) => ({ id: s.id, label: s.label })),
        inLanguage: formData.inLanguage,
        license: formData.license,
        creators: formData.creators,
        keywords: formData.keywords,
        files: formData.encodings,
        isAccessibleForFree: formData.isAccessibleForFree,
        externalUrls: formData.externalUrls
      };

      let result;
      if (isEditMode && editEvent) {
        result = await actions.updateResource(/** @type {any} */ (resourceData), editEvent);
      } else {
        result = await actions.createResource(/** @type {any} */ (resourceData), communityPubkey);
      }

      if (result.naddr) {
        if (isEditMode) {
          // Navigate back to the resource page
          await goto(resolve(`/${result.naddr}`));
        } else {
          await goto(resolve(`/${result.naddr}`));
        }
      }
    } catch (error) {
      console.error('Error publishing resource:', error);
      submitError = error instanceof Error ? error.message : 'Failed to publish';
    } finally {
      isSubmitting = false;
    }
  }

  /**
   * Handle cancel / back navigation
   */
  function handleCancel() {
    if (isSubmitting) return;
    history.back();
  }

  /**
   * Add keyword
   * @param {Event} e
   */
  function handleAddKeyword(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (e instanceof KeyboardEvent && e.key === 'Enter') {
      e.preventDefault();
      const keyword = input.value.trim();
      if (keyword && !formData.keywords.includes(keyword)) {
        formData.keywords = [...formData.keywords, keyword];
      }
      input.value = '';
    }
  }

  /**
   * Remove keyword
   * @param {string} keyword
   */
  function removeKeyword(keyword) {
    formData.keywords = formData.keywords.filter((k) => k !== keyword);
  }

  /**
   * Create remove keyword handler
   * @param {string} keyword
   */
  function handleRemoveKeyword(keyword) {
    return () => removeKeyword(keyword);
  }
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-6">
  <!-- Header -->
  <div class="mb-6">
    <h2 id="form-title" class="text-xl font-semibold text-base-content">
      {isEditMode ? 'Edit Educational Resource' : 'Create Educational Resource'}
    </h2>
    <p class="mt-1 text-sm text-base-content/60">
      Step {currentStep} of {totalSteps}: {stepTitles[currentStep - 1]}
    </p>
  </div>

  <!-- Progress Steps -->
  <div class="mb-8 flex items-center justify-center gap-2">
    {#each Array(totalSteps) as _, i (i)}
      <div
        class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors {i +
          1 <=
        currentStep
          ? 'bg-primary text-primary-content'
          : 'bg-base-200 text-base-content/50'}"
      >
        {#if i + 1 < currentStep}
          <CheckIcon class_="w-4 h-4" />
        {:else}
          {i + 1}
        {/if}
      </div>
      {#if i < totalSteps - 1}
        <div
          class="h-1 w-12 rounded transition-colors"
          class:bg-primary={i + 1 < currentStep}
          class:bg-base-300={i + 1 >= currentStep}
        ></div>
      {/if}
    {/each}
  </div>

  <!-- Form Content -->
  <div class="min-h-[40vh]">
    <!-- Step 1: Basic Info -->
    {#if currentStep === 1}
      <div class="space-y-4">
        <!-- Resource URL (Identifier) -->
        <div class="form-control">
          <label class="label" for="amb-identifier">
            <span class="label-text font-medium">Resource URL (optional)</span>
          </label>
          <input
            id="amb-identifier"
            type="url"
            class="input-bordered input w-full"
            class:input-error={identifierUrlError}
            bind:value={formData.identifier}
            onblur={handleIdentifierBlur}
            placeholder="https://example.com/my-resource"
            readonly={isEditMode}
            disabled={isEditMode}
          />
          {#if identifierUrlError}
            <div class="label">
              <span class="label-text-alt text-error">{identifierUrlError}</span>
            </div>
          {:else}
            <div class="label">
              <span class="label-text-alt text-base-content/60">
                {isEditMode
                  ? 'URL cannot be changed when editing.'
                  : 'Enter the URL where this content is hosted. Leave empty to auto-generate an identifier.'}
              </span>
            </div>
          {/if}
        </div>

        <!-- Title -->
        <div class="form-control">
          <label class="label" for="amb-title">
            <span class="label-text font-medium">Title <span class="text-error">*</span></span>
          </label>
          <input
            id="amb-title"
            type="text"
            class="input-bordered input w-full"
            bind:value={formData.name}
            placeholder="Enter a descriptive title"
          />
        </div>

        <!-- Description -->
        <div class="form-control">
          <label class="label" for="amb-description">
            <span class="label-text font-medium">Description <span class="text-error">*</span></span
            >
          </label>
          <textarea
            id="amb-description"
            class="textarea-bordered resize-vertical textarea w-full"
            bind:value={formData.description}
            placeholder="Describe the educational content"
            rows="4"
          ></textarea>
        </div>

        <!-- Language -->
        <div class="form-control">
          <label class="label" for="amb-language">
            <span class="label-text font-medium">Language <span class="text-error">*</span></span>
          </label>
          <select
            id="amb-language"
            class="select-bordered select w-full"
            bind:value={formData.inLanguage}
          >
            {#each languageOptions as lang (lang.code)}
              <option value={lang.code}>{lang.label}</option>
            {/each}
          </select>
        </div>

        <!-- Image URL -->
        <div class="form-control">
          <label class="label" for="amb-image">
            <span class="label-text font-medium">Thumbnail Image URL (optional)</span>
          </label>
          <input
            id="amb-image"
            type="url"
            class="input-bordered input w-full"
            bind:value={formData.image}
            placeholder="https://..."
          />
        </div>
      </div>
    {/if}

    <!-- Step 2: Classification -->
    {#if currentStep === 2}
      <div class="space-y-4">
        <!-- Resource Type -->
        <SKOSDropdown
          vocabularyKey="learningResourceType"
          bind:selected={formData.learningResourceType}
          label="Resource Type"
          placeholder="Select resource type(s)"
          required={true}
          multiple={true}
          helpText="What type of educational content is this?"
        />

        <!-- Subject -->
        <SKOSDropdown
          vocabularyKey="about"
          bind:selected={formData.about}
          label="Subject / Topic"
          placeholder="Select subject(s)"
          required={true}
          multiple={true}
          helpText="What subjects does this resource cover?"
        />

        <!-- Keywords -->
        <div class="form-control">
          <label class="label" for="amb-keywords">
            <span class="label-text font-medium">Keywords (optional)</span>
          </label>
          <input
            id="amb-keywords"
            type="text"
            class="input-bordered input w-full"
            placeholder="Type and press Enter to add"
            onkeydown={handleAddKeyword}
          />
          {#if formData.keywords.length > 0}
            <div class="mt-2 flex flex-wrap gap-2">
              {#each formData.keywords as keyword (keyword)}
                <span class="badge gap-1 badge-outline">
                  {keyword}
                  <button
                    type="button"
                    class="hover:text-error"
                    onclick={handleRemoveKeyword(keyword)}
                  >
                    <CloseIcon class_="w-3 h-3" />
                  </button>
                </span>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Step 3: Content & Creators -->
    {#if currentStep === 3}
      <div class="space-y-4">
        <!-- Creators -->
        <CreatorInput
          bind:creators={formData.creators}
          label="Creators / Authors"
          helpText="Add the people or organizations who created this content"
        />

        <!-- File Upload -->
        <BlossomUploader
          bind:files={formData.encodings}
          label="Content Files (optional)"
          helpText="Upload PDFs, videos, or other content files"
          multiple={true}
        />

        <!-- External URLs -->
        <ExternalUrlInput
          bind:urls={formData.externalUrls}
          label="External References (optional)"
          helpText="Add links to external content (YouTube, Vimeo, websites, etc.)"
        />
      </div>
    {/if}

    <!-- Step 4: License & Publish -->
    {#if currentStep === 4}
      <div class="space-y-4">
        <!-- License -->
        <div class="form-control">
          <label class="label" for="amb-license">
            <span class="label-text font-medium">License <span class="text-error">*</span></span>
          </label>
          <select
            id="amb-license"
            class="select-bordered select w-full"
            bind:value={formData.license}
          >
            {#each licenseOptions as license (license.id)}
              <option value={license.id}>{license.label}</option>
            {/each}
          </select>
          <div class="label">
            <!-- eslint-disable svelte/no-navigation-without-resolve -- external: license URL -->
            <a
              href={formData.license}
              target="_blank"
              rel="noopener noreferrer"
              class="label-text-alt link link-primary"
            >
              View license details →
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          </div>
        </div>

        <!-- Free Access -->
        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              class="checkbox checkbox-primary"
              bind:checked={formData.isAccessibleForFree}
            />
            <span class="label-text">This resource is freely accessible</span>
          </label>
        </div>

        <!-- Preview Summary -->
        <div class="rounded-lg bg-base-200 p-4">
          <h3 class="mb-3 font-medium">Summary</h3>
          <dl class="space-y-2 text-sm">
            <div class="flex">
              <dt class="w-28 text-base-content/60">Title:</dt>
              <dd class="flex-1 font-medium">{formData.name || '—'}</dd>
            </div>
            <div class="flex">
              <dt class="w-28 text-base-content/60">Language:</dt>
              <dd class="flex-1">
                {languageOptions.find((l) => l.code === formData.inLanguage)?.label}
              </dd>
            </div>
            <div class="flex">
              <dt class="w-28 text-base-content/60">Type:</dt>
              <dd class="flex-1">
                {formData.learningResourceType.map((t) => t.label).join(', ') || '—'}
              </dd>
            </div>
            <div class="flex">
              <dt class="w-28 text-base-content/60">Subject:</dt>
              <dd class="flex-1">{formData.about.map((s) => s.label).join(', ') || '—'}</dd>
            </div>
            <div class="flex">
              <dt class="w-28 text-base-content/60">Creators:</dt>
              <dd class="flex-1">{formData.creators.map((c) => c.name).join(', ') || '—'}</dd>
            </div>
            <div class="flex">
              <dt class="w-28 text-base-content/60">Files:</dt>
              <dd class="flex-1">{formData.encodings.length} file(s)</dd>
            </div>
            <div class="flex">
              <dt class="w-28 text-base-content/60">License:</dt>
              <dd class="flex-1">
                {licenseOptions.find((l) => l.id === formData.license)?.label}
              </dd>
            </div>
            {#if formData.externalUrls.length > 0}
              <div class="flex">
                <dt class="w-28 text-base-content/60">External URLs:</dt>
                <dd class="flex-1">{formData.externalUrls.length} link(s)</dd>
              </div>
            {/if}
          </dl>
        </div>

        <!-- Community Info -->
        {#if communityPubkey}
          <div class="alert alert-info">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-6 w-6 shrink-0 stroke-current"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>This resource will be shared with the community.</span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Validation Errors -->
  {#if validationErrors.length > 0}
    <div class="mt-4 alert alert-error">
      <ul class="list-inside list-disc text-sm">
        {#each validationErrors as error, index (index)}
          <li>{error}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Submit Error -->
  {#if submitError}
    <div class="mt-4 alert alert-error">
      <span>{submitError}</span>
    </div>
  {/if}

  <!-- Footer / Navigation -->
  <div class="mt-6 flex items-center justify-between border-t border-base-300 pt-4">
    {#if currentStep === 1}
      <button type="button" class="btn btn-outline" onclick={handleCancel} disabled={isSubmitting}>
        Cancel
      </button>
    {:else}
      <button type="button" class="btn btn-outline" onclick={prevStep} disabled={isSubmitting}>
        <ChevronLeftIcon class_="w-4 h-4" />
        Back
      </button>
    {/if}

    {#if currentStep < totalSteps}
      <button type="button" class="btn btn-primary" onclick={nextStep}>
        Next
        <ChevronRightIcon class_="w-4 h-4" />
      </button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={handleSubmit} disabled={isSubmitting}>
        {#if isSubmitting}
          <span class="loading loading-sm loading-spinner"></span>
          {isEditMode ? 'Updating...' : 'Publishing...'}
        {:else}
          {isEditMode ? 'Update Resource' : 'Publish Resource'}
        {/if}
      </button>
    {/if}
  </div>
</div>
