<!--
  ResourceFormWizard Component
  Paginated wizard for creating/editing educational resources (kind:30142).

  Step layout:
    1. Bildungsbereich       (new in create flow; inferred in edit flow)
    2. URL / naddr           (new; MetadataFetchStep-driven)
    3. Basic                 (identifier is read-only, derives from step 2)
    4. Classification        (adds educationalLevel + multi-vocab `about`)
    5. Content & Creators    (unchanged)
    6. Relations             (hasPart / isPartOf links to other AMB resources)
    7. Rights                (unchanged)
    8. Share to communities  (new, create-only — uses NIP-18 reposts)

  Edit mode: steps 1 + 2 are still shown (for transparency / re-selection) but
  the URL field is read-only (d-tag is immutable on a replaceable event) and
  step 8 is skipped (post-hoc sharing is done from the resource page via
  CommunityShare.svelte).
-->

<script>
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages';
  import { manager } from '$lib/stores/accounts.svelte';
  import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, CloseIcon } from '$lib/components/icons';
  import SKOSDropdown from './SKOSDropdown.svelte';
  import LicensedFileInput from '../shared/LicensedFileInput.svelte';
  import LicensedImageInput from '$lib/components/shared/LicensedImageInput.svelte';
  import CreatorInput from './CreatorInput.svelte';
  import ExternalUrlInput from './ExternalUrlInput.svelte';
  import MetadataFetchStep from './MetadataFetchStep.svelte';
  import AMBResourceSearchInput from './AMBResourceSearchInput.svelte';
  import BibleReferenceInput from './BibleReferenceInput.svelte';
  import CurriculumPicker from './CurriculumPicker.svelte';
  import FormConceptPicker from '$lib/components/forms/FormConceptPicker.svelte';
  import { createEducationalActions } from '$lib/stores/educational-actions.svelte.js';
  import { createCommunityReposts } from '$lib/helpers/communityRepost.js';
  import { fetchProfileData } from '$lib/helpers/profile.js';
  import {
    BILDUNGSBEREICHE,
    inferBildungsbereichFromEducationalLevels,
    getSubjectVocabLabel
  } from '$lib/helpers/educational/bildungsbereich.js';
  import { getBildungsbereichKeysForVariant } from '$lib/config/resource-form-variants.js';
  import {
    resolveVocabField,
    resolveSchemeNaddrsMap
  } from '$lib/helpers/educational/vocabResolver.js';
  import { parseEkwTagsToFormData } from '$lib/helpers/educational/parseEkwTagsToFormData.js';
  import { splitKeywordInput, mergeKeywords } from '$lib/helpers/educational/keywordInput.js';
  import {
    ambJsonLdToPrefillEvent,
    ogToFormDataPrefill
  } from '$lib/helpers/educational/ambJsonLdToFormData.js';
  import { EKW_NAMESPACE_IRI } from '$lib/helpers/educational/ekwNamespace.js';
  import { useSchemeConcepts } from '$lib/stores/vocab-store.svelte.js';
  import { getAllLookupRelays } from '$lib/helpers/relay-helper.js';
  import { ekwKeywordsFromConcepts } from '$lib/helpers/educational/ekwKeywordsFromConcepts.js';
  import { enrichFromUrl } from '$lib/helpers/educational/enrichFromUrl.js';
  import {
    applyEnrichedPayload,
    dropUnlabeled
  } from '$lib/helpers/educational/applyEnrichedPayload.js';
  import { bucketSubjectsForBildungsbereich } from '$lib/helpers/educational/bucketSubjectsForBildungsbereich.js';
  import { getLicenseOptions } from '$lib/helpers/educational/licenseOptions.js';
  import SmartFillBadge from './SmartFillBadge.svelte';
  import EnrichmentStatusBanner from './EnrichmentStatusBanner.svelte';
  import AMBResourceCard from './AMBResourceCard.svelte';
  import { fly } from 'svelte/transition';
  import { buildPreviewResource } from '$lib/helpers/educational/buildPreviewResource.js';
  import { loadDraft, saveDraft, clearDraft } from '$lib/helpers/educational/draftStore.js';
  import { createInitialFormData } from '$lib/helpers/educational/wizardInitialState.js';
  import { attachWizardHistoryNav } from '$lib/helpers/educational/wizardHistoryNav.js';
  import { validateWizardStep } from '$lib/helpers/educational/validateWizardStep.js';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { applySuggestionAction } from '$lib/helpers/educational/applySuggestionAction.js';
  import FieldAiSuggestionBadge from './FieldAiSuggestionBadge.svelte';
  import { inferBildungsbereich } from '$lib/helpers/educational/inferBildungsbereich.js';
  import { parseKonfiTagsToFormData } from '$lib/helpers/educational/parseKonfiTagsToFormData.js';
  import { formDataToKonfiTags } from '$lib/helpers/educational/formDataToKonfiTags.js';
  import { subStepToFormFields } from '$lib/helpers/educational/konfiStep4.js';
  import { buildKonfiSummaryRows } from '$lib/helpers/educational/konfiSummary.js';
  import {
    advanceStepOrSubStep,
    retreatStepOrSubStep,
    jumpToStep
  } from '$lib/helpers/educational/konfiNavigation.js';
  import FieldsRenderer from '$lib/components/forms/FieldsRenderer.svelte';

  /**
   * @typedef {{ id: string, label: string }} CompactConcept
   * @typedef {{ url: string, name: string, type: string, size: number, sha256: string }} UploadedFile
   * @typedef {{ name: string, type: 'Person' | 'Organization', pubkey?: string, affiliationName?: string, honorificPrefix?: string }} Creator
   * @typedef {keyof typeof BILDUNGSBEREICHE} BildungsbereichKey
   * @typedef {{
   *   coordinate: string,
   *   pubkey: string,
   *   dTag: string,
   *   relayHint?: string | undefined,
   *   event?: import('nostr-tools').NostrEvent
   * }} AMBRelationRef
   */

  /**
   * `communityPubkey` is now a **preselection hint** for step 7, not a write
   * target. The event itself no longer carries an implicit h-tag.
   *
   * `variantId` identifies which metadata-form variant this wizard instance
   * represents (e.g. `'amb'` or `'ekw'`). Phase 1: the variant id only
   * affects the NIP-32 label tag emitted on the event. Step content is
   * currently identical across variants.
   *
   * @type {{
   *   communityPubkey?: string,
   *   editEvent?: any,
   *   editResource?: any,
   *   variantId?: string
   * }}
   */
  let { communityPubkey = '', editEvent = null, editResource = null, variantId = 'amb' } = $props();

  // Determine if we're in edit mode
  const isEditMode = $derived(editEvent !== null && editResource !== null);

  // EKW variant exposes additional metadata fields in steps 4 and 5.
  const isEkw = $derived(variantId === 'ekw');

  // Total step count — share step is skipped in edit mode.
  const totalSteps = $derived(isEditMode ? 7 : 8);

  // Current wizard step (1..totalSteps)
  let currentStep = $state(1);

  // Highest step the user has reached via successful `nextStep()`. Lets the
  // step-indicator buttons act as fast-jump shortcuts both backward AND
  // forward into already-validated steps after going back. Monotonically
  // grows; never decreases on prev/jump.
  let maxVisitedStep = $state(1);

  // "No URL" escape hatch — allows advancing past step 2 without a URL/naddr.
  // When true: the URL input is replaced with a state card, step 3 hides the
  // read-only URL field, step 5 requires ≥1 attachment, and handleSubmit sends
  // an empty slug (which formDataToAmb.js auto-generates a random id for).
  let hasNoUrl = $state(false);

  // AI metadata helper — Step 2 button-driven enrichment.
  // The "✨ Mit KI ergänzen" button on step 2 is the ONLY way to trigger an
  // LLM call. We dedup against `enrichedForUrl` so navigating back/forth or
  // re-clicking on the same URL never pays the LLM cost twice.
  /** @type {'idle' | 'pending' | 'success' | 'error' | 'skipped-amb'} */
  let enrichmentStatus = $state('idle');
  /**
   * Reason code attached to the most recent `error` status, surfaced by
   * `/api/enrich` (e.g. `'overloaded'` when Anthropic is at capacity,
   * `'network'` on transport failure, `'tool_error'` for upstream tool
   * exceptions). `''` while status is not `'error'`. Drives the banner copy
   * so the user knows whether to wait + retry vs. fill in manually.
   * @type {'' | 'overloaded' | 'page_too_large' | 'tool_error' | 'network' | 'unknown'}
   */
  let enrichmentErrorCode = $state('');
  /** Stores the URL we last enriched, so re-clicking the button is a no-op. */
  let enrichedForUrl = $state('');
  /** Source of the most recent metadata fetch; gates the enrichment button. */
  /** @type {'amb-jsonld' | 'opengraph' | 'none' | ''} */
  let metadataFetchSource = $state('');

  // True while MetadataFetchStep is fetching OG data for the current input.
  // Surfaced from the child via its `onbusychange` callback.
  let metadataFetchBusy = $state(false);

  // Image preview error flag for step 3 image field
  let imagePreviewError = $state(false);

  // Form data state
  let formData = $state(createInitialFormData());

  // Konfi sub-step state and config (must come after formData is declared).
  const bildungsbereichConfig = $derived(
    /** @type {any} */ (BILDUNGSBEREICHE)[formData.bildungsbereich]
  );
  const step4SubSteps = $derived(bildungsbereichConfig?.step4SubSteps);
  /** @type {string | null} */
  let currentSubStep = $state(null);
  const currentSubStepConfig = $derived(
    step4SubSteps?.find((/** @type {any} */ s) => s.key === currentSubStep)
  );

  // Browser history integration: mouse-back / browser-back walks wizard steps
  // until the user is past step 1, at which point the default route handler
  // navigates away. Without this, the wizard's step state lives only in
  // component memory and back leaves the wizard mid-flow.
  /** @type {import('$lib/helpers/educational/wizardHistoryNav.js').WizardHistoryNav | undefined} */
  let historyNav;
  $effect(() => {
    // untrack so this effect runs exactly once on mount — reading currentStep
    // reactively here would re-attach (and reset the wizardInstanceId) every
    // time the user advances, leaving the back stack orphaned.
    historyNav = attachWizardHistoryNav({
      initial: untrack(() => ({ step: currentStep, subStep: currentSubStep })),
      onPop: ({ step, subStep }) => {
        currentStep = step;
        currentSubStep = subStep;
        advanceAttempted = false;
      }
    });
    return () => {
      historyNav?.destroy();
      historyNav = undefined;
    };
  });
  $effect(() => {
    const step = currentStep;
    const subStep = currentSubStep;
    historyNav?.pushIfChanged({ step, subStep });
  });
  // Decode the raw naddr map from runtimeConfig into the `{address, relay}`
  // shape `subStepToFormFields` and `FormConceptPicker` expect. `runtimeConfig`
  // stores naddrs as strings; without this decode, `FormConceptPicker` reads
  // `field.vocab?.address` as undefined and the loader never fires.
  const schemeNaddrs = $derived(resolveSchemeNaddrsMap());

  // Per-vocab subject selection (merged into formData.about on submit).
  // Keys are vocab slugs (e.g. 'schulfaecher', 'hochschulfaecher').
  let aboutByVocab = $state(/** @type {Record<string, CompactConcept[]>} */ ({}));

  // Per-field provenance for the Smart-fill / AMB badges. Populated by the
  // metadata-fetch step (AMB JSON-LD → 'amb-jsonld'; LLM enrichment →
  // 'llm-enriched' with optional evidence quote). Cleared on user-initiated
  // edit or when the user clicks ✗ on a badge.
  /**
   * @typedef {{ source: 'llm-enriched' | 'amb-jsonld', evidence?: string }} FieldProvenance
   */
  let provenance = $state(/** @type {Record<string, FieldProvenance>} */ ({}));

  // The full enriched payload from runEnrichment(), retained so the user can
  // review/apply suggestions for fields that were not auto-filled.
  /** @type {import('$lib/helpers/educational/applyEnrichedPayload.js').ExtractMetadataResult | null} */

  let aiSuggestions = $state(null);
  /** @type {Set<string>} */
  let dismissedSuggestionFields = $state.raw(new Set());

  let showStartOverConfirm = $state(false);

  /**
   * @param {string} field
   * @param {'replace' | 'merge' | 'dismiss'} action
   */
  function handleSuggestionAction(field, action) {
    if (action === 'dismiss') {
      dismissedSuggestionFields = new Set([...dismissedSuggestionFields, field]);
      return;
    }
    const result = applySuggestionAction(
      field,
      action,
      formData,
      aboutByVocab,
      aiSuggestions,
      provenance
    );
    formData = result.formData;
    aboutByVocab = result.aboutByVocab;
    provenance = result.provenance;
  }

  const canStartOver = $derived(
    !isEditMode &&
      (currentStep > 1 || !!formData.identifier || !!formData.name || !!formData.description)
  );

  function startOver() {
    resetWizardState();
    showStartOverConfirm = false;
  }

  /**
   * Reset a single field to its empty/default and drop its provenance entry,
   * so the Smart-fill badge disappears from the UI. Field-name-driven so we
   * don't have to repeat the cleanup at every badge render site.
   * @param {string} field
   */
  function clearField(field) {
    switch (field) {
      case 'name':
      case 'description':
      case 'image':
      case 'methodOther':
        formData[field] = '';
        break;
      case 'inLanguage':
        formData.inLanguage = 'de';
        break;
      case 'license':
        formData.license = 'https://creativecommons.org/licenses/by/4.0/';
        break;
      case 'learningResourceType':
      case 'educationalLevels':
      case 'keywords':
      case 'creators':
        // @ts-ignore - dynamic key
        formData[field] = [];
        break;
      case 'ekwFachrichtung':
        aboutByVocab = { ...aboutByVocab, ekwFachrichtung: [] };
        break;
      case 'gradeLevels':
      case 'schoolTypes':
      case 'didacticConcepts':
      case 'methods': {
        // @ts-ignore - dynamic key
        formData[field] = [];
        // @ts-ignore - dynamic key
        formData[`${field}Labels`] = [];
        break;
      }
      case 'bibleReferences':
        formData.bibleReferences = [''];
        break;
    }
    const next = { ...provenance };
    delete next[field];
    provenance = next;
  }

  // Step 7: which communities to share into (hex pubkeys).
  let selectedCommunityPubkeys = $state(/** @type {string[]} */ ([]));

  // Joined communities (reactive).
  const getJoinedCommunities = useJoinedCommunitiesList();
  const joinedCommunities = $derived(getJoinedCommunities());

  // Batch-load profiles for joined communities (used by the Share step to show
  // name + avatar instead of raw hex pubkeys).
  const getJoinedCommunityProfiles = useProfileMap(() => joinedCommunities);
  const joinedCommunityProfiles = $derived(getJoinedCommunityProfiles());

  // Live preview: synthesize a kind-30142 AMB resource from the in-progress
  // formData and render it via AMBResourceCard. Updates reactively as the
  // user fills fields; `null` until the form has something displayable.
  const activePubkey = $derived(manager.active?.pubkey);
  const getPreviewAuthorProfile = useProfileMap(() => (activePubkey ? [activePubkey] : []));
  const previewAuthorProfile = $derived(
    activePubkey ? (getPreviewAuthorProfile()?.get(activePubkey) ?? null) : null
  );

  // Edit mode: rehydrate the image license event from EventStore when the
  // resource being edited carries an x tag. The hook fires a loader to
  // populate EventStore if the event isn't already cached.
  const editImageHash = $derived(
    editEvent?.tags?.find((/** @type {string[]} */ t) => t[0] === 'x')?.[1] ?? null
  );
  const getEditLicense = useLicenseForHash(() => editImageHash);
  $effect(() => {
    // Only populate when the user hasn't already changed the image in this
    // session (i.e., LicensedImageInput hasn't yet set its own license).
    if (editImageHash && !formData.imageLicenseEvent) {
      const lic = getEditLicense();
      if (lic) formData.imageLicenseEvent = lic;
    }
  });
  const previewResource = $derived.by(() => {
    if (currentStep < 3) return null;
    // `about` lives in the wizard-internal `aboutByVocab` (one bucket per
    // subject vocab). Flatten via mergedAbout() so the preview card sees the
    // full picture; bucket keys include `ekwFachrichtung` for the EKW variant.
    /** @type {any} */
    const previewFormData = { ...formData, about: mergedAbout() };
    return buildPreviewResource(previewFormData, activePubkey, getLocale());
  });

  // Preselect the community that was passed via `?community=` if the user is a member.
  $effect(() => {
    if (!communityPubkey || isEditMode) return;
    if (
      joinedCommunities.includes(communityPubkey) &&
      !selectedCommunityPubkeys.includes(communityPubkey)
    ) {
      selectedCommunityPubkeys = [...selectedCommunityPubkeys, communityPubkey];
    }
  });

  // ---- Draft persistence (create flow only) -----------------------------
  // Load any previously-saved draft once on mount; subsequently autosave
  // formData (debounced) and clear the draft after a successful publish.
  // Edit mode opts out — drafts are only meaningful when authoring fresh
  // content.
  let draftRestoredAt = $state(/** @type {number | null} */ (null));
  let draftRestoreDone = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let draftSaveTimer;

  $effect(() => {
    if (draftRestoreDone) return;
    if (isEditMode) {
      draftRestoreDone = true;
      return;
    }
    const draft = loadDraft(variantId);
    if (draft && draft.formData) {
      formData = { ...formData, ...draft.formData };
      draftRestoredAt = draft.savedAt || Date.now();
    }
    draftRestoreDone = true;
  });

  $effect(() => {
    // $state.snapshot reads every property → effect re-runs on any change.
    const snapshot = $state.snapshot(formData);
    if (isEditMode || !draftRestoreDone) return;
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      saveDraft(variantId, snapshot);
    }, 500);
    return () => clearTimeout(draftSaveTimer);
  });

  /**
   * Discard the restored draft: clear localStorage, hide the banner, and
   * actually reset the wizard state so the user starts fresh from step 1.
   * Without the state reset the URL/name/etc. fields stay populated and
   * "verwerfen" feels broken.
   */
  function resetWizardState() {
    formData = createInitialFormData();
    aboutByVocab = {};
    provenance = {};
    touchedFields = {};
    advanceAttempted = false;
    currentStep = 1;
    maxVisitedStep = 1;
    hasNoUrl = false;
    enrichmentStatus = 'idle';
    enrichmentErrorCode = '';
    enrichedForUrl = '';
    metadataFetchSource = '';
    imagePreviewError = false;
    aiSuggestions = null;
    dismissedSuggestionFields = new Set();
  }

  function discardDraft() {
    clearDraft(variantId);
    draftRestoredAt = null;
    resetWizardState();
  }

  // Bildungsbereich options available in step 1 depend on the variant.
  const bildungsbereichKeys = $derived(getBildungsbereichKeysForVariant(variantId));

  // Resolve vocab field descriptors for the pickers that depend on Bildungsbereich.
  const subjectVocabFields = $derived.by(() => {
    if (!formData.bildungsbereich)
      return /** @type {Array<{key: string, field: NonNullable<ReturnType<typeof resolveVocabField>>}>} */ ([]);
    const keys = BILDUNGSBEREICHE[formData.bildungsbereich]?.subjectVocabKeys ?? [];
    return /** @type {Array<{key: string, field: NonNullable<ReturnType<typeof resolveVocabField>>}>} */ (
      keys.map((k) => ({ key: k, field: resolveVocabField(k) })).filter((e) => e.field !== null)
    );
  });

  const educationalLevelField = $derived(resolveVocabField('educationalLevel'));

  // EKW vocab field resolvers (null when the matching SCHEME_NADDR_* env var
  // is unset, e.g. before the EKW vocabs have been published).
  const ekwFachField = $derived(resolveVocabField('ekwFach'));
  const klassenstufenField = $derived(resolveVocabField('klassenstufen'));
  const schulartField = $derived(resolveVocabField('schulart'));
  const didaktischesKonzeptField = $derived(resolveVocabField('didaktischesKonzept'));
  const methodeField = $derived(resolveVocabField('methode'));
  const ekwLrtField = $derived(resolveVocabField('ekwLrt'));
  const ekwKeywordsField = $derived(resolveVocabField('ekwKeywords'));

  // EKW keyword typeahead: pull the published kind-39738 concepts off the
  // relay and project them to a flat, German-locale-sorted, dedup'd label
  // list. Replaces the static `EKW_KEYWORD_SUGGESTIONS` data file — the
  // suggestion list is now sourced from the same NIP-VOCAB scheme published
  // by `pnpm run publish:vocabs`.
  const getEkwKeywordsConcepts = useSchemeConcepts(
    () => ekwKeywordsField?.vocab?.address,
    () =>
      /** @type {string[]} */ (
        [ekwKeywordsField?.vocab?.relay, ...getAllLookupRelays()].filter(Boolean)
      )
  );
  const ekwKeywordSuggestionList = $derived(
    ekwKeywordsField ? ekwKeywordsFromConcepts(getEkwKeywordsConcepts()) : []
  );

  // Validation and submission state. `fieldErrors` is the canonical map
  // (field key → localized error message) computed for the current step.
  // Inline error rendering is gated on `touchedFields[field]` so the form
  // is silent until the user interacts with that field; the bottom summary
  // alert is gated on `advanceAttempted` so it appears only when the user
  // tries to advance and is blocked.
  let touchedFields = $state(/** @type {Record<string, boolean>} */ ({}));
  let advanceAttempted = $state(false);
  let isSubmitting = $state(false);
  let submitError = $state('');

  // Step 2 renders its own error state; the parent only reacts to `onresult`
  // to prefill form fields or navigate into edit mode.

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

  // License options. Extracted to $lib/helpers/educational/licenseOptions.js so
  // the image-license modal can reuse the same list.
  const licenseOptions = $derived(getLicenseOptions(formData.license));

  // Language options
  const languageOptions = [
    { code: 'de', label: 'Deutsch' },
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'it', label: 'Italiano' }
  ];

  // Step titles
  const stepTitles = $derived([
    m.amb_form_step_bildungsbereich?.() ?? 'Bildungsbereich',
    m.amb_form_step_url?.() ?? 'Resource URL',
    m.amb_form_step_basic(),
    m.amb_form_step_classification(),
    m.amb_form_step_content(),
    m.amb_form_step_relations?.() ?? 'Relations',
    m.amb_form_step_license(),
    m.amb_form_step_share?.() ?? 'Share'
  ]);

  // Import helper functions for extracting data from events
  import {
    getAMBName,
    getAMBDescription,
    getAMBImage,
    getAMBIdentifier,
    getAMBLanguages,
    getAMBLearningResourceTypes,
    getAMBSubjects,
    getAMBEducationalLevels,
    getAMBKeywords,
    getAMBLicense,
    isAMBFree,
    getAMBEncodings,
    getAMBCreatorNames,
    getAMBExternalUrls,
    getAMBHasPart,
    getAMBIsPartOf
  } from '$lib/helpers/educational/ambHelpers.js';

  // Self-coordinate: in edit mode the resource cannot reference itself.
  const editCoordinate = $derived(
    editEvent && editEvent.pubkey
      ? `30142:${editEvent.pubkey}:${editEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? ''}`
      : undefined
  );

  // Prefill form with edit data when in edit mode.
  //
  // The guard is essential: `prefillEditData()` is async, but when the
  // resource has no `["p", <pubkey>, "", "creator"]` tags, no `await` is
  // reached before its synchronous `formData = { ...formData, ... }` writes.
  // Those spread reads + assignment make the effect read/write the same
  // `$state` in one tracked run — Svelte detects this as
  // `effect_update_depth_exceeded` and the form fails to load. Running once
  // (we re-mount when the user navigates to a different edit naddr, so
  // editEvent never changes after first hydration) avoids the loop.
  let didPrefillEdit = false;
  $effect(() => {
    if (didPrefillEdit) return;
    if (isEditMode && editEvent && editResource) {
      didPrefillEdit = true;
      prefillEditData();
    }
  });

  /**
   * Adapt a compact `{id, label}` to the rich shape FormConceptPicker takes.
   * @param {CompactConcept} c
   * @param {string} [vocabRelay]
   * @returns {import('$lib/helpers/form-to-amb.js').SelectedConcept}
   */
  function toRichConcept(c, vocabRelay = '') {
    const locale = getLocale();
    return {
      id: c.id,
      nostrCoord: '',
      relay: vocabRelay,
      labels: c.label ? { [locale]: c.label } : {}
    };
  }

  /**
   * Inverse adapter — FormConceptPicker emits rich concepts; keep only the bits
   * the form data shape cares about.
   * @param {import('$lib/helpers/form-to-amb.js').SelectedConcept} rich
   * @returns {CompactConcept}
   */
  function toCompactConcept(rich) {
    const locale = getLocale();
    const labels = rich.labels || {};
    return {
      id: rich.id,
      label: labels[locale] || labels.de || labels.en || Object.values(labels)[0] || ''
    };
  }

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

    const lrtTypes = getAMBLearningResourceTypes(editEvent, getLocale());
    const subjects = getAMBSubjects(editEvent, getLocale());
    const eduLevels = getAMBEducationalLevels(editEvent, getLocale());

    const inferred =
      inferBildungsbereich(editEvent ?? { tags: [] }) ||
      inferBildungsbereichFromEducationalLevels(eduLevels.map((l) => l.id));
    const identifier = getAMBIdentifier(editEvent) || '';
    const isUrlIdentifier = /^https?:\/\//i.test(identifier);
    hasNoUrl = !isUrlIdentifier;

    formData = {
      ...formData,
      bildungsbereich: /** @type {'' | BildungsbereichKey} */ (inferred ?? ''),
      urlInput: isUrlIdentifier ? identifier : '',
      name: getAMBName(editEvent),
      description: getAMBDescription(editEvent),
      inLanguage: getAMBLanguages(editEvent)[0] || 'de',
      image: getAMBImage(editEvent) || '',
      imageWasUploaded: !!editEvent.tags?.find((/** @type {string[]} */ t) => t[0] === 'x'),
      imageLicenseEvent: null, // resolved reactively below
      identifier: isUrlIdentifier ? identifier : '',
      learningResourceType: isEkw
        ? lrtTypes
            .map((t) => ({ id: t.id, label: t.label }))
            .filter((c) => c.id.startsWith(`${EKW_NAMESPACE_IRI}lrt/`))
        : lrtTypes.map((t) => ({ id: t.id, label: t.label })),
      educationalLevels: eduLevels.map((t) => ({ id: t.id, label: t.label })),
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
      hasPart: /** @type {AMBRelationRef[]} */ (getAMBHasPart(editEvent)),
      isPartOf: /** @type {AMBRelationRef[]} */ (getAMBIsPartOf(editEvent)),
      license: getAMBLicense(editEvent)?.id || 'https://creativecommons.org/licenses/by/4.0/',
      isAccessibleForFree: isAMBFree(editEvent)
    };

    // Merge EKW fields parsed from ekw:* tags (no-op for non-EKW events).
    const ekw = parseEkwTagsToFormData(editEvent);
    formData = {
      ...formData,
      gradeLevels: ekw.gradeLevels,
      gradeLevelLabels: ekw.gradeLevelLabels,
      schoolTypes: ekw.schoolTypes,
      schoolTypeLabels: ekw.schoolTypeLabels,
      didacticConcepts: ekw.didacticConcepts,
      didacticConceptLabels: ekw.didacticConceptLabels,
      methods: ekw.methods,
      methodLabels: ekw.methodLabels,
      methodOther: ekw.methodOther,
      bibleReferences: ekw.bibleReferences.length > 0 ? ekw.bibleReferences : ['']
    };

    // Merge Konfi facets parsed from ext:ekw:konfi:* tags (no-op for non-Konfi).
    if (inferred === 'konfi') {
      const subSteps = BILDUNGSBEREICHE.konfi.step4SubSteps ?? [];
      const konfi = parseKonfiTagsToFormData(editEvent, subSteps);
      formData = { ...formData, ...konfi };
    }

    // Bucket pre-existing subjects into a single vocab slot for display.
    // In edit mode we don't know which vocab each subject came from, so we
    // surface them under the first vocab key of the inferred Bildungsbereich.
    if (inferred) {
      const firstKey =
        BILDUNGSBEREICHE[/** @type {BildungsbereichKey} */ (inferred)].subjectVocabKeys[0];
      aboutByVocab = { [firstKey]: subjects.map((s) => ({ id: s.id, label: s.label })) };
    } else {
      aboutByVocab = {};
    }
  }

  /**
   * Accept the result from MetadataFetchStep and act on it.
   *
   * Applies the URL/identifier and any cheap-fast prefill (AMB JSON-LD or OG
   * tags). Does NOT trigger the LLM — enrichment is button-driven via
   * `runEnrichment()` so the user owns the cost and re-navigation is free.
   *
   * @param {import('$lib/helpers/educational/resolveMetadataInput.js').ResolveResult} result
   */
  async function handleMetadataResult(result) {
    switch (result.kind) {
      case 'empty':
      case 'invalid':
      case 'naddr-wrong-kind':
      case 'naddr-not-owned':
        // Error states are rendered by MetadataFetchStep itself.
        return;
      case 'naddr-edit':
        await goto(resolve(`/create/resource?edit=${result.naddrString}`));
        return;
      case 'url': {
        formData.identifier = result.url;
        if (result.metadata.source === 'amb-jsonld' && result.metadata.amb) {
          const prefillEvent = ambJsonLdToPrefillEvent(result.metadata.amb);
          if (prefillEvent) {
            applyPrefillFromAmbEvent(prefillEvent);
          }
          // AMB JSON-LD already provides everything; no need to enrich.
          metadataFetchSource = 'amb-jsonld';
          enrichmentStatus = 'skipped-amb';
          return;
        }
        if (result.metadata.source === 'opengraph' && result.metadata.og) {
          const og = ogToFormDataPrefill(result.metadata.og);
          if (og.name) formData.name = og.name;
          if (og.description) formData.description = og.description;
          if (og.image) formData.image = og.image;
          if (og.inLanguage) formData.inLanguage = og.inLanguage;
          metadataFetchSource = 'opengraph';
        } else {
          metadataFetchSource = 'none';
        }
        // Reset enrichment status when a *new* URL is loaded.
        if (enrichedForUrl !== result.url) {
          enrichmentStatus = 'idle';
          aiSuggestions = null;
          dismissedSuggestionFields = new Set();
        }
      }
    }
  }

  /**
   * User-triggered LLM enrichment for the current URL.
   *
   * Idempotent: re-clicking against the same URL is a no-op (we already paid
   * the LLM cost). Only meaningful on step 2 after a URL has been fetched
   * with non-AMB metadata; the wizard renders the trigger button only then.
   */
  async function runEnrichment() {
    const url = formData.identifier;
    if (!url) return;
    if (enrichedForUrl === url && enrichmentStatus === 'success') return;
    if (enrichmentStatus === 'pending') return;

    enrichmentStatus = 'pending';
    enrichmentErrorCode = '';
    try {
      // Konfi-Arbeit uses its own MCP variant so the LLM gets konfi-specific
      // SKOS vocabs + field guidance (see /api/enrich + amb-mcp/src/lib/llm.ts).
      // It's only reachable when the user picked the EKW variant + bildungsbereich=konfi.
      const enrichVariant =
        isEkw && formData.bildungsbereich === 'konfi'
          ? /** @type {const} */ ('konfi')
          : isEkw
            ? /** @type {const} */ ('ekw')
            : /** @type {const} */ ('amb');
      const enriched = await enrichFromUrl(url, enrichVariant, {
        bildungsbereich: formData.bildungsbereich
      });
      if (!enriched) {
        enrichmentStatus = 'error';
        enrichmentErrorCode = 'unknown';
        return;
      }
      // Server signalled the upstream extractor is unavailable (529 from
      // Anthropic, network error, etc.). The error envelope carries a `code`
      // so we can pick specific wording — see EnrichmentStatusBanner.
      if ('error' in enriched) {
        enrichmentStatus = 'error';
        const code = /** @type {string} */ (enriched.code) ?? 'unknown';
        enrichmentErrorCode = /** @type {typeof enrichmentErrorCode} */ (
          ['overloaded', 'page_too_large', 'tool_error', 'network', 'unknown'].includes(code)
            ? code
            : 'unknown'
        );
        return;
      }
      aiSuggestions = enriched;
      const out = applyEnrichedPayload.withProvenance(formData, enriched, {
        activeUserPubkey: activeUser?.pubkey
      });
      formData = out.formData;
      provenance = { ...provenance, ...out.provenance };

      // EKW Fachrichtung lives in aboutByVocab (not formData), so applyEnrichedPayload
      // can't fill it. Bucket the LLM-emitted Fachrichtung concepts into the
      // `ekwFachrichtung` slot — they publish as standard AMB `about` tags.
      const fachPayload = dropUnlabeled(
        /** @type {Array<{id: string, prefLabel?: string, label?: string}>} */ (
          /** @type {any} */ (enriched.payload).ekwFachrichtung ?? []
        )
      );
      if (fachPayload.length > 0 && (aboutByVocab.ekwFachrichtung ?? []).length === 0) {
        aboutByVocab = {
          ...aboutByVocab,
          ekwFachrichtung: fachPayload.map((c) => ({
            id: c.id,
            label: c.prefLabel || c.label || c.id
          }))
        };
        const quote = /** @type {Record<string, string>} */ (enriched.evidence ?? {})[
          'ekwFachrichtung'
        ];
        provenance = {
          ...provenance,
          ekwFachrichtung:
            typeof quote === 'string' && quote.length > 0
              ? { source: 'llm-enriched', evidence: quote }
              : { source: 'llm-enriched' }
        };
      }

      // `about` lives in the wizard-internal `aboutByVocab` (not formData),
      // so the helper can't fill it. Bucket the LLM-emitted concepts into
      // the current Bildungsbereich's first subject vocab — same heuristic
      // the AMB-JSON-LD prefill path uses.
      const aboutPayload = dropUnlabeled(
        /** @type {Array<{id: string, prefLabel?: string, label?: string}>} */ (
          /** @type {any} */ (enriched.payload).about ?? []
        )
      );
      if (aboutPayload.length > 0 && Object.values(aboutByVocab).every((arr) => arr.length === 0)) {
        const bucketed = bucketSubjectsForBildungsbereich(aboutPayload, formData.bildungsbereich);
        if (bucketed) {
          aboutByVocab = { ...aboutByVocab, ...bucketed };
          const quote = /** @type {Record<string, string>} */ (enriched.evidence ?? {})['about'];
          provenance = {
            ...provenance,
            about:
              typeof quote === 'string' && quote.length > 0
                ? { source: 'llm-enriched', evidence: quote }
                : { source: 'llm-enriched' }
          };
        }
      }
      enrichedForUrl = url;
      enrichmentStatus = 'success';
      enrichmentErrorCode = '';
    } catch {
      enrichmentStatus = 'error';
      enrichmentErrorCode = 'unknown';
    }
  }

  /**
   * Reuse the edit-mode prefill path: feed the synthetic 30142 event from
   * amb-nostr-converter into the same `getAMB*` helpers that edit mode uses.
   * @param {any} prefillEvent
   */
  function applyPrefillFromAmbEvent(prefillEvent) {
    const lrtTypes = getAMBLearningResourceTypes(prefillEvent, getLocale());
    const subjects = getAMBSubjects(prefillEvent, getLocale());
    const eduLevels = getAMBEducationalLevels(prefillEvent, getLocale());

    /** @type {Record<string, FieldProvenance>} */
    const ambProv = {};
    /** @param {string} field */
    const mark = (field) => {
      ambProv[field] = { source: 'amb-jsonld' };
    };

    const ambName = getAMBName(prefillEvent);
    if (ambName) {
      formData.name = ambName;
      mark('name');
    }
    const ambDesc = getAMBDescription(prefillEvent);
    if (ambDesc) {
      formData.description = ambDesc;
      mark('description');
    }
    const img = getAMBImage(prefillEvent);
    if (img) {
      formData.image = img;
      mark('image');
    }
    const lang = getAMBLanguages(prefillEvent)[0];
    if (lang) {
      formData.inLanguage = lang;
      mark('inLanguage');
    }

    if (lrtTypes.length > 0) {
      const compact = lrtTypes.map((t) => ({ id: t.id, label: t.label }));
      formData.learningResourceType = isEkw
        ? compact.filter((c) => c.id.startsWith(`${EKW_NAMESPACE_IRI}lrt/`))
        : compact;
      mark('learningResourceType');
    }
    if (eduLevels.length > 0) {
      formData.educationalLevels = eduLevels.map((t) => ({ id: t.id, label: t.label }));
      mark('educationalLevels');
    }

    if (subjects.length > 0 && formData.bildungsbereich) {
      const firstKey = BILDUNGSBEREICHE[formData.bildungsbereich].subjectVocabKeys[0];
      aboutByVocab = {
        ...aboutByVocab,
        [firstKey]: subjects.map((s) => ({ id: s.id, label: s.label }))
      };
    }

    const kw = getAMBKeywords(prefillEvent);
    if (kw.length > 0) {
      formData.keywords = kw;
      mark('keywords');
    }
    const license = getAMBLicense(prefillEvent);
    if (license) {
      formData.license = license.id;
      mark('license');
    }

    provenance = { ...provenance, ...ambProv };
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

  // Pure-helper validation context: derived from form state + step ctx so
  // `fieldErrors` updates live as the user types (which is what powers the
  // "error vanishes once you fix it" behaviour for inline messages).
  const validationContext = $derived({
    isEkw,
    hasNoUrl,
    hasSubjectVocab: subjectVocabFields.length > 0,
    subjectsCount: Object.values(aboutByVocab).reduce((n, arr) => n + arr.length, 0),
    isValidUrl,
    schemeNaddrs,
    messages: {
      bildungsbereich: () =>
        m.amb_form_validation_bildungsbereich?.() ?? 'Please choose a Bildungsbereich.',
      urlRequired: () =>
        m.amb_form_validation_url_required?.() ?? 'Please enter a URL or naddr before continuing.',
      identifier: m.amb_form_validation_identifier,
      title: m.amb_form_validation_title,
      description: m.amb_form_validation_description,
      resourceType: m.amb_form_validation_resource_type,
      subject: m.amb_form_validation_subject,
      noUrlNeedsAttachment: () =>
        m.amb_form_validation_no_url_needs_attachment?.() ??
        'Pure Nostr resources must have at least one file or external reference.',
      license: m.amb_form_validation_license,
      imageLicenseMissing: m.amb_form_validation_image_license_missing,
      encodingLicenseMissing: m.amb_form_validation_encoding_license_missing
    }
  });

  /** Map of fieldKey → error message for the current step. */
  const fieldErrors = $derived(
    validateWizardStep(currentStep, formData, validationContext, currentSubStepConfig ?? undefined)
  );

  /** Flat list used by the bottom-of-step summary alert. */
  const validationErrors = $derived(Object.values(fieldErrors));

  /**
   * True while async work that may fill required fields is in flight:
   * - Step 2: OG-data fetch via MetadataFetchStep
   * - Steps 3+: LLM enrichment (`enrichmentStatus === 'pending'`)
   *
   * The Next button is disabled while this is true so users don't see
   * misleading "field required" errors before the async fill completes.
   */
  const isAsyncBusy = $derived(
    metadataFetchBusy || /** @type {string} */ (enrichmentStatus) === 'pending'
  );

  /**
   * Should the inline error for `field` be shown right now? True iff there
   * IS an error AND the user has either touched the field or tried to
   * advance the step.
   * @param {string} field
   * @returns {boolean}
   */
  function showError(field) {
    return Boolean(fieldErrors[field]) && (touchedFields[field] || advanceAttempted);
  }

  /**
   * Mark a field as "touched" so its inline error becomes visible. Called
   * from input `onblur`. Idempotent.
   * @param {string} field
   */
  function markTouched(field) {
    if (touchedFields[field]) return;
    touchedFields = { ...touchedFields, [field]: true };
  }

  /**
   * Run the current-step validation and set up the visual state for
   * blocked-advance: every erroring field is marked touched and the
   * summary banner is unhidden.
   * @returns {boolean}
   */
  function validateCurrentStep() {
    const errs = fieldErrors;
    const errorKeys = Object.keys(errs);
    if (errorKeys.length > 0) {
      const next = { ...touchedFields };
      for (const k of errorKeys) next[k] = true;
      touchedFields = next;
      advanceAttempted = true;
      return false;
    }
    return true;
  }

  function nextStep() {
    // Konfi step-4 sub-step: validate the active sub-step before walking.
    if (currentStep === 4 && step4SubSteps?.length) {
      const errs = validateWizardStep(4, formData, validationContext, currentSubStepConfig);
      if (Object.keys(errs).length > 0) {
        const next = { ...touchedFields };
        for (const k of Object.keys(errs)) next[k] = true;
        touchedFields = next;
        advanceAttempted = true;
        return;
      }
    } else if (!validateCurrentStep()) {
      return;
    }
    if (currentStep < totalSteps) {
      const nextState = advanceStepOrSubStep({ currentStep, currentSubStep }, step4SubSteps);
      currentStep = nextState.currentStep;
      currentSubStep = nextState.currentSubStep;
      if (currentStep > maxVisitedStep) maxVisitedStep = currentStep;
      advanceAttempted = false;
      if (draftRestoredAt !== null) draftRestoredAt = null;
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      const prevState = retreatStepOrSubStep({ currentStep, currentSubStep }, step4SubSteps);
      currentStep = prevState.currentStep;
      currentSubStep = prevState.currentSubStep;
      advanceAttempted = false;
    }
  }

  /**
   * Merge per-vocab `about` selections into a single array for submission.
   * @returns {CompactConcept[]}
   */
  function mergedAbout() {
    /** @type {CompactConcept[]} */
    const out = [];
    /** @type {Record<string, true>} */
    const seen = {};
    for (const arr of Object.values(aboutByVocab)) {
      for (const c of arr) {
        if (!seen[c.id]) {
          seen[c.id] = true;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Handle form submission
   */
  async function handleSubmit() {
    if (!validateCurrentStep()) return;
    if (!activeUser) {
      submitError = m.amb_form_validation_login();
      return;
    }

    isSubmitting = true;
    submitError = '';

    try {
      const actions = createEducationalActions();
      const about = mergedAbout();

      const resourceData = {
        name: formData.name,
        description: formData.description,
        slug: hasNoUrl ? '' : formData.identifier?.trim() || '',
        learningResourceType: formData.learningResourceType[0]?.id || '',
        learningResourceTypeLabel: formData.learningResourceType[0]?.label || '',
        about: about.map((s) => s.id),
        aboutLabels: about.map((s) => ({ id: s.id, label: s.label })),
        educationalLevels: formData.educationalLevels.map((e) => e.id),
        educationalLevelLabels: formData.educationalLevels.map((e) => ({
          id: e.id,
          label: e.label
        })),
        inLanguage: formData.inLanguage,
        license: formData.license,
        creators: formData.creators,
        keywords: formData.keywords,
        files: formData.encodings,
        isAccessibleForFree: formData.isAccessibleForFree,
        externalUrls: formData.externalUrls,
        hasPart: formData.hasPart,
        isPartOf: formData.isPartOf,
        // EKW-variant facets — `formDataToEkwTags` no-ops when these are
        // empty/undefined, so it's safe to forward unconditionally rather
        // than gating on `variantId === 'ekw'`.
        gradeLevels: formData.gradeLevels,
        gradeLevelLabels: formData.gradeLevelLabels,
        schoolTypes: formData.schoolTypes,
        schoolTypeLabels: formData.schoolTypeLabels,
        didacticConcepts: formData.didacticConcepts,
        didacticConceptLabels: formData.didacticConceptLabels,
        methods: formData.methods,
        methodLabels: formData.methodLabels,
        methodOther: formData.methodOther,
        bibleReferences: formData.bibleReferences,
        konfiTags: formDataToKonfiTags(
          formData,
          bildungsbereichConfig?.step4SubSteps ?? [],
          bildungsbereichConfig?.bildungsbereichTag
        )
      };

      let result;
      if (isEditMode && editEvent) {
        result = await actions.updateResource(
          /** @type {any} */ (resourceData),
          editEvent,
          null,
          variantId
        );
      } else {
        result = await actions.createResource(/** @type {any} */ (resourceData), variantId);
      }

      // Share into selected communities (NIP-18 reposts) — create mode only.
      if (
        !isEditMode &&
        result?.event &&
        selectedCommunityPubkeys.length > 0 &&
        activeUser?.signer
      ) {
        try {
          await createCommunityReposts(result.event, selectedCommunityPubkeys, activeUser.signer);
        } catch (err) {
          console.error('Failed to share to communities:', err);
          // Non-fatal — the resource is already published. Surface a warning.
          submitError =
            (err instanceof Error ? err.message : 'Community share failed') +
            ' — the resource was published but community shares did not all succeed.';
        }
      }

      if (result.naddr) {
        // Successful publish — drop any saved draft so the next visit
        // starts clean. Skip in edit mode (no draft was ever saved).
        if (!isEditMode) clearDraft(variantId);
        await goto(resolve(`/${result.naddr}`));
      }
    } catch (error) {
      console.error('Error publishing resource:', error);
      submitError = error instanceof Error ? error.message : m.amb_form_error_publish_failed();
    } finally {
      isSubmitting = false;
    }
  }

  // Map formData's konfi slots into the {fieldId: value} shape FieldsRenderer expects.
  const konfiFieldValues = $derived.by(() => {
    if (!currentSubStepConfig) return {};
    /** @type {Record<string, any>} */
    const v = {};
    /** @type {any} */
    const fd = formData;
    for (const f of /** @type {any[]} */ (currentSubStepConfig.fields)) {
      if (f.kind === 'vocab') {
        // FormConceptPicker expects rich SelectedConcept[]
        const ids = fd[`${f.schemeKey}Ids`] || [];
        const labels = fd[`${f.schemeKey}Labels`] || [];
        const labelById = new Map(
          labels.map((/** @type {{id:string,label:string}} */ l) => [l.id, l.label])
        );
        v[f.schemeKey] = ids.map((/** @type string */ id) => ({
          id,
          nostrCoord: '',
          relay: '',
          labels: labelById.has(id) ? { de: labelById.get(id) } : {}
        }));
      } else {
        v[f.tagSlug] = fd[f.tagSlug];
      }
    }
    return v;
  });

  function handleKonfiFieldChange(/** @type string */ id, /** @type any */ value) {
    if (!currentSubStepConfig) return;
    const field = /** @type {any[]} */ (currentSubStepConfig.fields).find(
      (/** @type {any} */ f) => (f.kind === 'vocab' ? f.schemeKey : f.tagSlug) === id
    );
    if (!field) return;
    /** @type {any} */
    const fd = formData;
    if (field.kind === 'vocab') {
      const arr = Array.isArray(value) ? value : [];
      fd[`${field.schemeKey}Ids`] = arr.map((c) => c.id);
      fd[`${field.schemeKey}Labels`] = arr.map((c) => ({
        id: c.id,
        label: c.labels?.de || c.labels?.en || c.id
      }));
    } else {
      fd[field.tagSlug] = value;
    }
  }

  // Map formData's <schemeKey>Custom slots into the {fieldId: string} shape FieldsRenderer expects.
  const konfiCustomValues = $derived.by(() => {
    if (!currentSubStepConfig) return /** @type {Record<string, string>} */ ({});
    /** @type {Record<string, string>} */
    const v = {};
    /** @type {any} */
    const fd = formData;
    for (const f of /** @type {any[]} */ (currentSubStepConfig.fields)) {
      if (f.kind === 'vocab' && f.allowCustom) {
        v[f.schemeKey] = fd[`${f.schemeKey}Custom`] ?? '';
      }
    }
    return v;
  });

  function handleKonfiCustomChange(/** @type string */ id, /** @type string */ value) {
    if (!currentSubStepConfig) return;
    const field = /** @type {any[]} */ (currentSubStepConfig.fields).find(
      (/** @type {any} */ f) => f.kind === 'vocab' && f.schemeKey === id && f.allowCustom
    );
    if (!field) return;
    /** @type {any} */
    const fd = formData;
    fd[`${field.schemeKey}Custom`] = value;
  }

  /**
   * Handle cancel / back navigation
   */
  function handleCancel() {
    if (isSubmitting) return;
    history.back();
  }

  /**
   * Commit the current input value as one or more keywords.
   * @param {HTMLInputElement} input
   */
  function commitKeywordInput(input) {
    const tokens = splitKeywordInput(input.value);
    if (tokens.length === 0) {
      input.value = '';
      keywordInputValue = '';
      return;
    }
    formData.keywords = mergeKeywords(formData.keywords, tokens);
    input.value = '';
    keywordInputValue = '';
  }

  /**
   * Handle keydown on the keyword input — Enter, Tab, comma all commit.
   * @param {KeyboardEvent} e
   */
  function handleAddKeyword(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      // Don't trap Shift+Tab (keyboard backward nav out of field).
      if (e.key === 'Tab' && e.shiftKey) return;
      // Only trap Tab if there's content to commit — otherwise let focus move.
      if (e.key === 'Tab' && !input.value.trim()) return;
      e.preventDefault();
      commitKeywordInput(input);
    }
  }

  /**
   * Commit pending content when the input loses focus.
   * @param {FocusEvent} e
   */
  function handleKeywordBlur(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (input.value.trim()) commitKeywordInput(input);
  }

  /**
   * Handle paste: split comma / newline separated blobs into tokens.
   * @param {ClipboardEvent} e
   */
  function handleKeywordPaste(e) {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (!pasted) return;
    // Only take over if the paste contains separators — otherwise let default
    // paste behavior run so single-word pastes go into the input as-is.
    if (!/[,\n\r]/.test(pasted)) return;
    e.preventDefault();
    const input = /** @type {HTMLInputElement} */ (e.target);
    const tokens = splitKeywordInput(pasted);
    if (tokens.length > 0) {
      formData.keywords = mergeKeywords(formData.keywords, tokens);
    }
    input.value = '';
    keywordInputValue = '';
  }

  // Keyword typeahead state (EKW variant only). `keywordInputValue` is the
  // single source of truth for the input text — bound via `bind:value` so it
  // stays in sync with both user typing and programmatic clears in
  // commitKeywordInput / handleKeywordPaste.
  let keywordInputValue = $state('');
  let keywordSuggestionsOpen = $state(false);
  let keywordSuggestionActiveIndex = $state(-1);
  /** @type {ReturnType<typeof setTimeout> | null} */
  let keywordBlurTimer = null;

  /**
   * Accent/case-insensitive normalization for the keyword typeahead match.
   * @param {string} s
   * @returns {string}
   */
  function normalizeKeyword(s) {
    return s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  const keywordSuggestions = $derived.by(() => {
    if (!isEkw) return /** @type {string[]} */ ([]);
    const q = normalizeKeyword((keywordInputValue ?? '').trim());
    if (!q) return /** @type {string[]} */ ([]);
    const skip = new Set(formData.keywords);
    /** @type {string[]} */
    const out = [];
    for (const candidate of ekwKeywordSuggestionList) {
      if (skip.has(candidate)) continue;
      if (normalizeKeyword(candidate).includes(q)) {
        out.push(candidate);
        if (out.length >= 8) break;
      }
    }
    return out;
  });

  /**
   * @param {string} suggestion
   */
  function pickKeywordSuggestion(suggestion) {
    formData.keywords = mergeKeywords(formData.keywords, [suggestion]);
    keywordInputValue = '';
    keywordSuggestionsOpen = false;
    keywordSuggestionActiveIndex = -1;
  }

  /**
   * Keydown handler for the EKW-variant keyword input. Delegates to the
   * existing free-text handler (`handleAddKeyword`) when the suggestions
   * dropdown is closed/empty or the key isn't a navigation/selection key.
   * @param {KeyboardEvent} e
   */
  function handleKeywordKeydownEkw(e) {
    if (!isEkw || !keywordSuggestionsOpen || keywordSuggestions.length === 0) {
      handleAddKeyword(e);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      keywordSuggestionActiveIndex = (keywordSuggestionActiveIndex + 1) % keywordSuggestions.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      keywordSuggestionActiveIndex =
        keywordSuggestionActiveIndex <= 0
          ? keywordSuggestions.length - 1
          : keywordSuggestionActiveIndex - 1;
    } else if (e.key === 'Escape') {
      keywordSuggestionsOpen = false;
      keywordSuggestionActiveIndex = -1;
    } else if (e.key === 'Enter' && keywordSuggestionActiveIndex >= 0) {
      e.preventDefault();
      pickKeywordSuggestion(keywordSuggestions[keywordSuggestionActiveIndex]);
    } else {
      handleAddKeyword(e);
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

  /**
   * Toggle a community on/off in the share-step selection.
   * @param {string} pubkey
   */
  function toggleCommunity(pubkey) {
    if (selectedCommunityPubkeys.includes(pubkey)) {
      selectedCommunityPubkeys = selectedCommunityPubkeys.filter((p) => p !== pubkey);
    } else {
      selectedCommunityPubkeys = [...selectedCommunityPubkeys, pubkey];
    }
  }

  /**
   * FormConceptPicker change handler for the educationalLevel picker.
   * @param {import('$lib/helpers/form-to-amb.js').SelectedConcept[]} rich
   */
  function handleEduLevelChange(rich) {
    formData.educationalLevels = rich.map(toCompactConcept);
  }

  /**
   * FormConceptPicker change handler for a specific subject vocab bucket.
   * @param {string} vocabKey
   */
  function makeAboutHandler(vocabKey) {
    return (/** @type {import('$lib/helpers/form-to-amb.js').SelectedConcept[]} */ rich) => {
      aboutByVocab = { ...aboutByVocab, [vocabKey]: rich.map(toCompactConcept) };
    };
  }

  /**
   * Build a paired-state EKW handler that updates two formData fields:
   *   - the `ids` field with concept URIs
   *   - the `labels` field with `{id, label}[]` pairs
   *
   * @param {'gradeLevels'|'schoolTypes'|'didacticConcepts'|'methods'} idsKey
   * @param {'gradeLevelLabels'|'schoolTypeLabels'|'didacticConceptLabels'|'methodLabels'} labelsKey
   */
  function makeEkwPairHandler(idsKey, labelsKey) {
    return (/** @type {import('$lib/helpers/form-to-amb.js').SelectedConcept[]} */ rich) => {
      const compact = rich.map(toCompactConcept);
      formData[idsKey] = compact.map((c) => c.id);
      formData[labelsKey] = compact;
    };
  }
</script>

<!-- Wizard wrapper: centered (max-w-2xl) on steps 1–2 where there is no
     preview; on step 3+ widens to max-w-6xl and switches to a 2-col grid so
     the live preview can slide in from the right. The max-width transition
     gives the form a gentle leftward slide as the preview fades in. -->
<div
  class="mx-auto w-full max-w-2xl px-4 py-6 transition-[max-width] duration-300 ease-out"
  class:lg:max-w-6xl={previewResource}
  class:lg:grid={previewResource}
  class:lg:grid-cols-[minmax(0,42rem)_minmax(0,22rem)]={previewResource}
  class:lg:items-start={previewResource}
  class:lg:gap-8={previewResource}
>
  <div class="w-full">
    <!-- Step indicator — the page's top-bar <h1> provides the stable title;
       this line tells the user where they are in the wizard. -->
    <div class="mb-6 flex items-center justify-between">
      <p class="text-base font-medium text-base-content/70">
        {m.amb_form_step_indicator({
          currentStep: currentSubStep
            ? `${currentStep}${currentSubStep.slice(1)}`
            : String(currentStep),
          totalSteps: String(totalSteps)
        })}
        {stepTitles[currentStep - 1]}
      </p>
      {#if canStartOver}
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onclick={() => (showStartOverConfirm = true)}
        >
          {m.amb_form_start_over()}
        </button>
      {/if}
    </div>

    <!-- Progress Steps -->
    <div class="mb-8 flex items-center justify-center gap-2">
      {#each Array(totalSteps) as _, i (i)}
        {@const stepNum = i + 1}
        {@const isCompleted = stepNum < currentStep}
        {@const isCurrent = stepNum === currentStep}
        {@const wasVisited = stepNum <= maxVisitedStep}
        {@const canJump = wasVisited && !isCurrent}
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors {wasVisited
            ? 'bg-primary text-primary-content'
            : 'bg-base-200 text-base-content/50'} {canJump
            ? 'cursor-pointer hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-base-100'
            : 'cursor-default'}"
          aria-current={isCurrent ? 'step' : undefined}
          aria-label={canJump
            ? `${stepTitles[i]} (Schritt ${stepNum}) — springen`
            : `${stepTitles[i]} (Schritt ${stepNum})`}
          title={`${stepTitles[i]} (Schritt ${stepNum})`}
          disabled={!canJump}
          onclick={canJump
            ? () => {
                const next = jumpToStep(stepNum, step4SubSteps);
                currentStep = next.currentStep;
                currentSubStep = next.currentSubStep;
              }
            : undefined}
        >
          {#if isCompleted}
            <CheckIcon class_="w-4 h-4" />
          {:else}
            {stepNum}
          {/if}
        </button>
        {#if i < totalSteps - 1}
          <div
            class="h-1 w-6 rounded transition-colors"
            class:bg-primary={i + 1 < maxVisitedStep}
            class:bg-base-300={i + 1 >= maxVisitedStep}
          ></div>
        {/if}
      {/each}
    </div>

    <!-- Mobile live preview (collapsible). On lg+ the preview lives in the
       side rail at the bottom of this file; here we cover screens where a
       sticky rail would steal too much vertical space. -->
    {#if previewResource}
      <details class="mb-4 rounded-lg border border-base-300 bg-base-100 p-3 lg:hidden">
        <summary class="cursor-pointer text-sm font-medium text-base-content/80">
          👁 {m.forms_preview_tab()}
        </summary>
        <div class="mt-3">
          <AMBResourceCard
            resource={previewResource}
            authorProfile={previewAuthorProfile}
            variant="card"
            preview={true}
          />
        </div>
      </details>
    {/if}

    <!-- Form Content -->
    <div class="min-h-[40vh]">
      <!-- Restored-draft banner: shown when localStorage held a draft for
         this variant on mount and the user has not yet dismissed it. -->
      {#if draftRestoredAt !== null && !isEditMode}
        <div class="mb-3 alert text-sm alert-info" role="status">
          <span class="flex-1">
            {m.amb_form_draft_restored({
              time: new Date(draftRestoredAt).toLocaleString(getLocale())
            })}
          </span>
          <button type="button" class="btn btn-ghost btn-sm" onclick={discardDraft}>
            {m.amb_form_draft_discard()}
          </button>
        </div>
      {/if}

      <!-- AI metadata helper status banner — only the error case is shown
         on Steps 3+. The pending/success/skipped-amb states are redundant
         now that Step 2 blocks Next while enrichment is in flight: by the
         time the user reaches Step 3, success is implicit and the inline
         "Smart fill ✨" badges already mark each filled field. -->
      {#if currentStep > 2 && enrichmentStatus === 'error'}
        <EnrichmentStatusBanner
          status={enrichmentStatus}
          errorCode={enrichmentErrorCode}
          ondismiss={() => {
            enrichmentStatus = 'idle';
            enrichmentErrorCode = '';
          }}
        />
      {/if}

      <!-- Step 1: Bildungsbereich -->
      {#if currentStep === 1}
        <div class="space-y-3">
          <p class="text-sm text-base-content/70">
            {m.amb_form_help_bildungsbereich?.() ??
              'Pick the educational area. This preselects subject vocabulary and educational level.'}
          </p>
          <div class="grid gap-2">
            {#each bildungsbereichKeys as key (key)}
              {@const cfg = BILDUNGSBEREICHE[key]}
              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 p-3 transition-colors hover:bg-base-200"
                class:border-primary={formData.bildungsbereich === key}
                class:bg-base-200={formData.bildungsbereich === key}
              >
                <input
                  type="radio"
                  name="bildungsbereich"
                  class="radio mt-1 radio-primary"
                  value={key}
                  bind:group={formData.bildungsbereich}
                  onchange={() => {
                    // Auto-advance after a brief delay so the selected-card
                    // styling visibly registers before the transition.
                    setTimeout(() => nextStep(), 200);
                  }}
                />
                <span>
                  <span class="block font-medium">{cfg.label[getLocale()] ?? cfg.label.en}</span>
                </span>
              </label>
            {/each}
          </div>
          {#if showError('bildungsbereich')}
            <p class="text-xs text-error">{fieldErrors.bildungsbereich}</p>
          {/if}
        </div>
      {/if}

      <!-- Step 2: URL / naddr -->
      {#if currentStep === 2}
        <div class="space-y-3">
          {#if hasNoUrl}
            <div
              class="rounded-lg border border-base-300 bg-base-200 p-4 text-sm"
              data-testid="no-url-state-card"
            >
              <p>{m.amb_form_no_url_state_card()}</p>
              {#if !isEditMode}
                <button
                  type="button"
                  class="btn mt-2 btn-ghost btn-sm"
                  onclick={() => {
                    hasNoUrl = false;
                    formData.urlInput = '';
                    formData.identifier = '';
                  }}
                >
                  {m.amb_form_no_url_cancel()}
                </button>
              {/if}
            </div>
          {:else}
            <MetadataFetchStep
              bind:value={formData.urlInput}
              activeUserPubkey={activeUser?.pubkey ?? null}
              readOnly={isEditMode}
              onresult={handleMetadataResult}
              onbusychange={(busy) => (metadataFetchBusy = busy)}
            />
            {#if !isEditMode && metadataFetchSource && metadataFetchSource !== 'amb-jsonld' && formData.identifier}
              <div class="mt-3">
                {#if enrichmentStatus === 'success' && enrichedForUrl === formData.identifier}
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <p class="flex items-center gap-2 text-success">
                      <span aria-hidden="true">✓</span>
                      {m.amb_form_enrich_done?.() ?? 'KI hat passende Felder ergänzt.'}
                    </p>
                  </div>
                {:else if enrichmentStatus === 'pending'}
                  <button type="button" class="btn btn-sm btn-primary" disabled>
                    <span class="loading loading-xs loading-spinner"></span>
                    {m.amb_form_enrich_running?.() ?? 'KI ergänzt Felder…'}
                  </button>
                {:else}
                  <!-- Button + hint on a single horizontal row (wraps on
                     narrow viewports). Keeps the call-to-action visually
                     paired with its explanation instead of stacking them. -->
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button type="button" class="btn btn-sm btn-primary" onclick={runEnrichment}>
                      {#if enrichmentStatus === 'error'}
                        {m.amb_form_enrich_retry?.() ?? '✨ Erneut mit KI ergänzen'}
                      {:else}
                        {m.amb_form_enrich_button?.() ?? '✨ Mit KI ergänzen'}
                      {/if}
                    </button>
                    {#if enrichmentStatus === 'error'}
                      <p class="text-sm text-error">
                        {#if enrichmentErrorCode === 'overloaded'}
                          {m.amb_form_enrich_error_overloaded?.() ??
                            'KI-Dienst gerade überlastet — bitte gleich nochmal versuchen.'}
                        {:else if enrichmentErrorCode === 'page_too_large'}
                          {m.amb_form_enrich_error_page_too_large?.() ??
                            'Die Datei ist für die KI-Analyse zu groß — bitte manuell ausfüllen.'}
                        {:else}
                          {m.amb_form_enrich_error?.() ?? 'KI-Ergänzung ist fehlgeschlagen.'}
                        {/if}
                      </p>
                    {:else}
                      <p class="text-sm text-base-content/60">
                        {m.amb_form_enrich_hint?.() ??
                          'Optional: KI füllt Klassifikationen vor — du behältst die Kontrolle.'}
                      </p>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
            {#if !isEditMode}
              <div class="flex items-center gap-3 py-1 text-xs text-base-content/50 uppercase">
                <span class="h-px flex-1 bg-base-300"></span>
                <span>{m.amb_form_no_url_or_divider()}</span>
                <span class="h-px flex-1 bg-base-300"></span>
              </div>
              <button
                type="button"
                class="flex w-full cursor-pointer items-start gap-3 rounded-lg border border-base-300 p-4 text-left hover:bg-base-200"
                data-testid="no-url-button"
                onclick={() => {
                  hasNoUrl = true;
                  formData.urlInput = '';
                  formData.identifier = '';
                  // Hide any prior step-2 advance error; the user just
                  // resolved the "URL required" branch by opting out.
                  advanceAttempted = false;
                  setTimeout(() => nextStep(), 200);
                }}
              >
                <span class="flex-1">
                  <span class="block font-medium">{m.amb_form_no_url_button()}</span>
                  <span class="mt-1 block text-sm text-base-content/70">
                    {m.amb_form_no_url_button_description()}
                  </span>
                </span>
                <span aria-hidden="true" class="text-base-content/40">→</span>
              </button>
            {/if}
          {/if}
          {#if isEditMode && !hasNoUrl}
            <p class="text-xs text-base-content/60">
              {m.amb_form_help_url_no_edit?.() ??
                'The resource URL cannot be changed after publishing.'}
            </p>
          {/if}
        </div>
      {/if}

      <!-- Step 3: Basic Info -->
      {#if currentStep === 3}
        <div class="space-y-4">
          <!-- Image preview — surfaced at the top so the resource has a visual anchor.
             The Image URL input itself stays below with the other optional fields. -->
          {#if formData.image && !imagePreviewError}
            <img
              src={formData.image}
              alt=""
              data-testid="amb-image-preview"
              class="mx-auto block max-h-64 max-w-full rounded border border-base-300"
              onerror={() => {
                imagePreviewError = true;
              }}
            />
          {/if}

          <!-- Resource URL (Identifier) — derived from step 2, read-only here -->
          {#if !hasNoUrl}
            <div class="form-control">
              <label class="label" for="amb-identifier">
                <span class="label-text font-medium">{m.amb_form_label_identifier()}</span>
              </label>
              <input
                id="amb-identifier"
                type="url"
                class="input-bordered input w-full"
                value={formData.identifier}
                readonly
                disabled
              />
              <p class="mt-1 text-xs text-base-content/60">
                {m.amb_form_help_url_no_edit?.() ?? 'Change the URL in step 2 to update it here.'}
              </p>
            </div>
          {/if}

          <!-- Title -->
          <div class="form-control">
            <label class="label flex items-center gap-2" for="amb-title">
              <span class="label-text font-medium"
                >{m.amb_form_label_title()} <span class="text-error">*</span></span
              >
              <SmartFillBadge provenance={provenance.name} onclear={() => clearField('name')} />
            </label>
            <input
              id="amb-title"
              type="text"
              class="input-bordered input w-full"
              class:input-error={showError('name')}
              aria-invalid={showError('name')}
              aria-describedby={showError('name') ? 'amb-title-error' : undefined}
              bind:value={formData.name}
              placeholder={m.amb_form_placeholder_title()}
              onblur={() => markTouched('name')}
            />
            <FieldAiSuggestionBadge
              field="name"
              {formData}
              {aboutByVocab}
              {aiSuggestions}
              dismissedFields={dismissedSuggestionFields}
              onapply={handleSuggestionAction}
            />
            {#if showError('name')}
              <p id="amb-title-error" class="mt-1 text-xs text-error">{fieldErrors.name}</p>
            {/if}
          </div>

          <!-- Description -->
          <div class="form-control">
            <label class="label flex items-center gap-2" for="amb-description">
              <span class="label-text font-medium"
                >{m.amb_form_label_description()} <span class="text-error">*</span></span
              >
              <SmartFillBadge
                provenance={provenance.description}
                onclear={() => clearField('description')}
              />
            </label>
            <textarea
              id="amb-description"
              class="textarea-bordered resize-vertical textarea w-full"
              class:textarea-error={showError('description')}
              aria-invalid={showError('description')}
              aria-describedby={showError('description') ? 'amb-description-error' : undefined}
              bind:value={formData.description}
              placeholder={m.amb_form_placeholder_description()}
              rows="4"
              onblur={() => markTouched('description')}
            ></textarea>
            <FieldAiSuggestionBadge
              field="description"
              {formData}
              {aboutByVocab}
              {aiSuggestions}
              dismissedFields={dismissedSuggestionFields}
              onapply={handleSuggestionAction}
            />
            {#if showError('description')}
              <p id="amb-description-error" class="mt-1 text-xs text-error">
                {fieldErrors.description}
              </p>
            {/if}
          </div>

          <!-- Language -->
          <div class="form-control">
            <label class="label flex items-center gap-2" for="amb-language">
              <span class="label-text font-medium"
                >{m.amb_form_label_language()} <span class="text-error">*</span></span
              >
              <SmartFillBadge
                provenance={provenance.inLanguage}
                onclear={() => clearField('inLanguage')}
              />
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
            <FieldAiSuggestionBadge
              field="inLanguage"
              {formData}
              {aboutByVocab}
              {aiSuggestions}
              dismissedFields={dismissedSuggestionFields}
              onapply={handleSuggestionAction}
            />
          </div>

          <!-- Image (upload + URL paste, with NIP-94 license attestation) -->
          <div class="form-control">
            <label class="label flex items-center gap-2" for="amb-image">
              <span class="label-text font-medium">{m.amb_form_label_image()}</span>
              <SmartFillBadge provenance={provenance.image} onclear={() => clearField('image')} />
            </label>
            <LicensedImageInput
              bind:imageUrl={formData.image}
              bind:imageWasUploaded={formData.imageWasUploaded}
              bind:licenseEvent={formData.imageLicenseEvent}
              errors={fieldErrors}
              activeUserDisplayName={previewAuthorProfile?.display_name ??
                previewAuthorProfile?.name ??
                ''}
            />
            <FieldAiSuggestionBadge
              field="image"
              {formData}
              {aboutByVocab}
              {aiSuggestions}
              dismissedFields={dismissedSuggestionFields}
              onapply={handleSuggestionAction}
            />
          </div>
        </div>
      {/if}

      <!-- Step 4: Classification -->
      {#if currentStep === 4}
        {#if currentSubStepConfig}
          {@const konfiFields = subStepToFormFields(currentSubStepConfig, schemeNaddrs)}
          {@const subStepHeading =
            /** @type {any} */ (m)[currentSubStepConfig.titleKey]?.() ??
            currentSubStepConfig.titleKey}
          <div class="space-y-4">
            <h2 class="text-lg font-semibold text-base-content">{subStepHeading}</h2>
            {#if currentSubStepConfig.key === '4b' && fieldErrors._topicOrDimension}
              <p class="text-xs text-error">{m.konfi_topic_or_dimension_required()}</p>
            {/if}
            <FieldsRenderer
              fields={konfiFields}
              values={konfiFieldValues}
              errors={fieldErrors}
              customValues={konfiCustomValues}
              onchange={handleKonfiFieldChange}
              oncustomchange={handleKonfiCustomChange}
            />
          </div>
        {:else}
          <div class="space-y-4">
            <!-- Resource Type — HCRT for AMB, EKW vocab (relay-fetched) for EKW variant -->
            <div data-skos-vocab="learningResourceType">
              {#if isEkw}
                {#if ekwLrtField}
                  <div class="form-control">
                    <div class="label flex items-center gap-2">
                      <span class="label-text font-medium">
                        {m.amb_form_label_resource_type()}
                        <span class="text-error">*</span>
                      </span>
                      <SmartFillBadge
                        provenance={provenance.learningResourceType}
                        onclear={() => clearField('learningResourceType')}
                      />
                    </div>
                    <FormConceptPicker
                      field={ekwLrtField}
                      multiple={true}
                      value={formData.learningResourceType.map((c) =>
                        toRichConcept(c, ekwLrtField.vocab.relay)
                      )}
                      onchange={(rich) => {
                        formData.learningResourceType = rich.map(toCompactConcept);
                      }}
                    />
                    <p class="mt-1 text-xs text-base-content/60">
                      {m.amb_form_help_resource_type()}
                    </p>
                  </div>
                {/if}
              {:else}
                <SKOSDropdown
                  vocabularyKey="learningResourceType"
                  bind:selected={formData.learningResourceType}
                  label={m.amb_form_label_resource_type()}
                  placeholder={m.amb_form_placeholder_resource_type()}
                  required={true}
                  multiple={true}
                  helpText={m.amb_form_help_resource_type()}
                />
                {#if provenance.learningResourceType}
                  <div class="mt-1">
                    <SmartFillBadge
                      provenance={provenance.learningResourceType}
                      onclear={() => clearField('learningResourceType')}
                    />
                  </div>
                {/if}
              {/if}
              <FieldAiSuggestionBadge
                field="learningResourceType"
                {formData}
                {aboutByVocab}
                {aiSuggestions}
                dismissedFields={dismissedSuggestionFields}
                onapply={handleSuggestionAction}
              />
              {#if showError('learningResourceType')}
                <p class="mt-1 text-xs text-error">{fieldErrors.learningResourceType}</p>
              {/if}
            </div>

            <!--
          Bildungsstufe + Fach/Thema are AMB-shared classification fields.
          For the EKKW variant they're hidden because the EKKW-specific
          Klassenstufe / Schulart / Fachrichtung pickers below cover the
          same ground (and are the canonical source for that path).
        -->
            {#if !isEkw}
              <!-- Educational level (Nostr concept picker, driven by Bildungsbereich preselection) -->
              {#if educationalLevelField}
                <div class="form-control">
                  <div class="label">
                    <span class="label-text font-medium">
                      {m.amb_form_label_educational_level?.() ?? 'Educational level'}
                    </span>
                    <SmartFillBadge
                      provenance={provenance.educationalLevels}
                      onclear={() => clearField('educationalLevels')}
                    />
                  </div>
                  <FormConceptPicker
                    field={educationalLevelField}
                    multiple={true}
                    value={formData.educationalLevels.map((c) =>
                      toRichConcept(c, educationalLevelField.vocab.relay)
                    )}
                    onchange={handleEduLevelChange}
                  />
                  <FieldAiSuggestionBadge
                    field="educationalLevels"
                    {formData}
                    {aboutByVocab}
                    {aiSuggestions}
                    dismissedFields={dismissedSuggestionFields}
                    onapply={handleSuggestionAction}
                  />
                </div>
              {/if}

              <!-- Subject pickers — one per Bildungsbereich vocab -->
              {#if subjectVocabFields.length === 0}
                <p class="text-sm text-base-content/60">
                  {m.amb_form_help_subject_pick_bildungsbereich?.() ??
                    'Pick a Bildungsbereich in step 1 to show subject vocabulary.'}
                </p>
              {/if}
              {#each subjectVocabFields as entry (entry.key)}
                <div class="form-control">
                  <div class="label">
                    <span class="label-text font-medium">
                      {m.amb_form_label_subject()}
                      <span class="text-error">*</span>
                    </span>
                  </div>
                  {#if subjectVocabFields.length > 1}
                    <p class="-mt-1 mb-1 text-xs text-base-content/60">
                      {getSubjectVocabLabel(entry.key, getLocale())}
                    </p>
                  {/if}
                  <FormConceptPicker
                    field={entry.field}
                    multiple={true}
                    value={(aboutByVocab[entry.key] ?? []).map((c) =>
                      toRichConcept(c, entry.field.vocab.relay)
                    )}
                    onchange={makeAboutHandler(entry.key)}
                  />
                </div>
              {/each}
              {#if showError('about')}
                <p class="mt-1 text-xs text-error">{fieldErrors.about}</p>
              {/if}
            {/if}

            <!-- Keywords -->
            <div class="form-control">
              <label class="label flex items-center gap-2" for="amb-keywords">
                <span class="label-text font-medium">{m.amb_form_label_keywords()}</span>
                <SmartFillBadge
                  provenance={provenance.keywords}
                  onclear={() => clearField('keywords')}
                />
              </label>
              <div class="relative">
                <input
                  id="amb-keywords"
                  type="text"
                  class="input-bordered input w-full"
                  placeholder={m.amb_form_placeholder_keywords()}
                  role={isEkw ? 'combobox' : undefined}
                  aria-expanded={isEkw ? keywordSuggestionsOpen : undefined}
                  aria-controls={isEkw ? 'ekw-keyword-suggestions' : undefined}
                  aria-autocomplete={isEkw ? 'list' : undefined}
                  aria-activedescendant={isEkw && keywordSuggestionActiveIndex >= 0
                    ? `ekw-keyword-suggestion-${keywordSuggestionActiveIndex}`
                    : undefined}
                  autocomplete="off"
                  bind:value={keywordInputValue}
                  oninput={() => {
                    if (isEkw) {
                      keywordSuggestionsOpen = true;
                      keywordSuggestionActiveIndex = -1;
                    }
                  }}
                  onfocus={() => {
                    if (keywordBlurTimer) {
                      clearTimeout(keywordBlurTimer);
                      keywordBlurTimer = null;
                    }
                    if (isEkw) keywordSuggestionsOpen = true;
                  }}
                  onkeydown={isEkw ? handleKeywordKeydownEkw : handleAddKeyword}
                  onblur={(e) => {
                    if (keywordBlurTimer) clearTimeout(keywordBlurTimer);
                    keywordBlurTimer = setTimeout(() => {
                      keywordSuggestionsOpen = false;
                      keywordSuggestionActiveIndex = -1;
                      keywordBlurTimer = null;
                    }, 120);
                    handleKeywordBlur(e);
                  }}
                  onpaste={handleKeywordPaste}
                />
                {#if isEkw && keywordSuggestionsOpen && keywordSuggestions.length > 0}
                  <ul
                    id="ekw-keyword-suggestions"
                    role="listbox"
                    data-testid="ekw-keyword-suggestions"
                    class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-base-300 bg-base-100 shadow"
                    aria-label={m.ekw_keywords_suggestions_label()}
                  >
                    {#each keywordSuggestions as suggestion, i (suggestion)}
                      <!-- Keyboard interaction lives on the input via aria-activedescendant; the option click is reachable through Enter on the focused input. -->
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <li
                        id="ekw-keyword-suggestion-{i}"
                        role="option"
                        aria-selected={i === keywordSuggestionActiveIndex}
                        class="cursor-pointer px-3 py-2 hover:bg-base-200"
                        class:bg-base-200={i === keywordSuggestionActiveIndex}
                        onmousedown={(e) => e.preventDefault()}
                        onclick={() => pickKeywordSuggestion(suggestion)}
                      >
                        {suggestion}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <p class="mt-1 text-xs text-base-content/60">{m.amb_form_help_keywords()}</p>
              {#if formData.keywords.length > 0}
                <div class="mt-2 flex flex-wrap gap-2">
                  {#each formData.keywords as keyword (keyword)}
                    <span class="badge gap-1 badge-outline" data-testid="keyword-chip">
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
              <FieldAiSuggestionBadge
                field="keywords"
                {formData}
                {aboutByVocab}
                {aiSuggestions}
                dismissedFields={dismissedSuggestionFields}
                onapply={handleSuggestionAction}
              />
            </div>

            <!-- EKW-only step 4 pickers: Fachrichtung, Klassenstufe, Schulart -->
            {#if isEkw}
              {#if ekwFachField}
                <div class="form-control">
                  <div class="label">
                    <span class="label-text font-medium">
                      {m.amb_form_label_ekw_fachrichtung()}
                      {#if subjectVocabFields.length > 0}<span class="text-error">*</span>{/if}
                    </span>
                    <SmartFillBadge
                      provenance={provenance.ekwFachrichtung}
                      onclear={() => clearField('ekwFachrichtung')}
                    />
                  </div>
                  <FormConceptPicker
                    field={ekwFachField}
                    multiple={true}
                    value={(aboutByVocab.ekwFachrichtung ?? []).map((c) =>
                      toRichConcept(c, ekwFachField.vocab.relay)
                    )}
                    onchange={makeAboutHandler('ekwFachrichtung')}
                  />
                  <FieldAiSuggestionBadge
                    field="ekwFachrichtung"
                    {formData}
                    {aboutByVocab}
                    {aiSuggestions}
                    dismissedFields={dismissedSuggestionFields}
                    onapply={handleSuggestionAction}
                  />
                </div>
                {#if showError('about')}
                  <p class="mt-1 text-xs text-error">{fieldErrors.about}</p>
                {/if}
              {/if}

              {#if klassenstufenField}
                <div class="form-control">
                  <div class="label">
                    <span class="label-text font-medium">{m.amb_form_label_ekw_klassenstufe()}</span
                    >
                    <SmartFillBadge
                      provenance={provenance.gradeLevels}
                      onclear={() => clearField('gradeLevels')}
                    />
                  </div>
                  <FormConceptPicker
                    field={klassenstufenField}
                    multiple={true}
                    value={formData.gradeLevelLabels.map((c) =>
                      toRichConcept(c, klassenstufenField.vocab.relay)
                    )}
                    onchange={makeEkwPairHandler('gradeLevels', 'gradeLevelLabels')}
                  />
                  <FieldAiSuggestionBadge
                    field="gradeLevels"
                    {formData}
                    {aboutByVocab}
                    {aiSuggestions}
                    dismissedFields={dismissedSuggestionFields}
                    onapply={handleSuggestionAction}
                  />
                </div>
              {/if}

              {#if schulartField}
                <div class="form-control">
                  <div class="label">
                    <span class="label-text font-medium">{m.amb_form_label_ekw_schulart()}</span>
                    <SmartFillBadge
                      provenance={provenance.schoolTypes}
                      onclear={() => clearField('schoolTypes')}
                    />
                  </div>
                  <FormConceptPicker
                    field={schulartField}
                    multiple={true}
                    value={formData.schoolTypeLabels.map((c) =>
                      toRichConcept(c, schulartField.vocab.relay)
                    )}
                    onchange={makeEkwPairHandler('schoolTypes', 'schoolTypeLabels')}
                  />
                  <FieldAiSuggestionBadge
                    field="schoolTypes"
                    {formData}
                    {aboutByVocab}
                    {aiSuggestions}
                    dismissedFields={dismissedSuggestionFields}
                    onapply={handleSuggestionAction}
                  />
                </div>
              {/if}

              {#if didaktischesKonzeptField}
                <div class="form-control">
                  <div class="label">
                    <span class="label-text font-medium"
                      >{m.amb_form_label_ekw_didactic_concept()}</span
                    >
                    <SmartFillBadge
                      provenance={provenance.didacticConcepts}
                      onclear={() => clearField('didacticConcepts')}
                    />
                  </div>
                  <FormConceptPicker
                    field={didaktischesKonzeptField}
                    multiple={true}
                    value={formData.didacticConceptLabels.map((c) =>
                      toRichConcept(c, didaktischesKonzeptField.vocab.relay)
                    )}
                    onchange={makeEkwPairHandler('didacticConcepts', 'didacticConceptLabels')}
                  />
                  <FieldAiSuggestionBadge
                    field="didacticConcepts"
                    {formData}
                    {aboutByVocab}
                    {aiSuggestions}
                    dismissedFields={dismissedSuggestionFields}
                    onapply={handleSuggestionAction}
                  />
                </div>
              {/if}

              {#if methodeField}
                <div class="form-control">
                  <div class="label">
                    <span class="label-text font-medium">{m.amb_form_label_ekw_method()}</span>
                    <SmartFillBadge
                      provenance={provenance.methods}
                      onclear={() => clearField('methods')}
                    />
                  </div>
                  <FormConceptPicker
                    field={methodeField}
                    multiple={true}
                    value={formData.methodLabels.map((c) =>
                      toRichConcept(c, methodeField.vocab.relay)
                    )}
                    onchange={makeEkwPairHandler('methods', 'methodLabels')}
                  />
                  <FieldAiSuggestionBadge
                    field="methods"
                    {formData}
                    {aboutByVocab}
                    {aiSuggestions}
                    dismissedFields={dismissedSuggestionFields}
                    onapply={handleSuggestionAction}
                  />
                </div>
              {/if}

              <div class="form-control">
                <label class="label flex items-center gap-2" for="ekw-method-other">
                  <span class="label-text font-medium">{m.amb_form_label_ekw_method_free()}</span>
                  <SmartFillBadge
                    provenance={provenance.methodOther}
                    onclear={() => clearField('methodOther')}
                  />
                </label>
                <textarea
                  id="ekw-method-other"
                  class="textarea-bordered textarea w-full"
                  rows="4"
                  bind:value={formData.methodOther}
                ></textarea>
                <FieldAiSuggestionBadge
                  field="methodOther"
                  {formData}
                  {aboutByVocab}
                  {aiSuggestions}
                  dismissedFields={dismissedSuggestionFields}
                  onapply={handleSuggestionAction}
                />
              </div>

              <div class="form-control">
                <div class="label">
                  <span class="label-text font-medium"
                    >{m.amb_form_label_ekw_bible_reference()}</span
                  >
                  <SmartFillBadge
                    provenance={provenance.bibleReferences}
                    onclear={() => clearField('bibleReferences')}
                  />
                </div>
                <div class="space-y-2">
                  {#each formData.bibleReferences as _ref, i (i)}
                    <BibleReferenceInput
                      bind:value={formData.bibleReferences[i]}
                      onremove={formData.bibleReferences.length > 1
                        ? () => {
                            formData.bibleReferences = formData.bibleReferences.filter(
                              (_, j) => j !== i
                            );
                          }
                        : undefined}
                    />
                  {/each}
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    onclick={() => (formData.bibleReferences = [...formData.bibleReferences, ''])}
                    >+ Hinzufügen</button
                  >
                </div>
                <FieldAiSuggestionBadge
                  field="bibleReferences"
                  {formData}
                  {aboutByVocab}
                  {aiSuggestions}
                  dismissedFields={dismissedSuggestionFields}
                  onapply={handleSuggestionAction}
                />
              </div>

              {#if !ekwFachField && !klassenstufenField && !schulartField && !didaktischesKonzeptField && !methodeField && !ekwLrtField}
                <div class="alert text-sm alert-warning">
                  <div>
                    <p class="font-medium">Klassifikationsfelder sind nicht verfügbar</p>
                    <p class="mt-1">
                      Die EKKW-Vokabulare sind auf diesem Server noch nicht hinterlegt. Bitte wende
                      Dich an die Administration der Plattform – das Formular lässt sich aktuell
                      nicht vollständig ausfüllen.
                    </p>
                    <details class="mt-2">
                      <summary class="cursor-pointer text-xs text-base-content/60">
                        Technische Details
                      </summary>
                      <p class="mt-1 text-xs text-base-content/60">
                        Fehlende Vokabular-Konfiguration:
                        <code>SCHEME_NADDR_EKW_FACH</code>, <code>SCHEME_NADDR_KLASSENSTUFEN</code>,
                        <code>SCHEME_NADDR_SCHULART</code>,
                        <code>SCHEME_NADDR_DIDAKTISCHES_KONZEPT</code>,
                        <code>SCHEME_NADDR_METHODE</code>, <code>SCHEME_NADDR_EKW_LRT</code>.
                      </p>
                    </details>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      {/if}

      <!-- Step 5: Content & Creators -->
      {#if currentStep === 5}
        <div class="space-y-4">
          {#if hasNoUrl}
            <div class="alert text-sm alert-info">
              {m.amb_form_help_step_5_no_url()}
            </div>
          {/if}
          {#if showError('attachments')}
            <p class="text-xs text-error">{fieldErrors.attachments}</p>
          {/if}
          <CreatorInput
            bind:creators={formData.creators}
            label={m.amb_form_label_creators()}
            helpText={m.amb_form_help_creators()}
          />
          <FieldAiSuggestionBadge
            field="creators"
            {formData}
            {aboutByVocab}
            {aiSuggestions}
            dismissedFields={dismissedSuggestionFields}
            onapply={handleSuggestionAction}
          />

          <LicensedFileInput
            bind:files={formData.encodings}
            label={m.amb_form_label_content_files()}
            helpText={m.amb_form_help_content_files()}
            multiple={true}
            activeUserDisplayName={previewAuthorProfile?.display_name ??
              previewAuthorProfile?.name ??
              ''}
          />
          {#if showError('encodings')}
            <p class="text-xs text-error">{fieldErrors.encodings}</p>
          {/if}

          <ExternalUrlInput
            bind:urls={formData.externalUrls}
            label={m.amb_form_label_external_refs()}
            helpText={m.amb_form_help_external_refs()}
          />
        </div>
      {/if}

      <!-- Step 6: Relations (hasPart / isPartOf) -->
      {#if currentStep === 6}
        <div class="space-y-6">
          <p class="text-sm text-base-content/70">
            {m.amb_form_relations_description?.() ??
              'Optionally link this resource to other AMB resources that contain it, or that are contained within it.'}
          </p>

          <!-- isPartOf -->
          <div class="form-control">
            <div class="label">
              <span class="label-text font-medium">
                {m.amb_form_label_is_part_of?.() ?? 'Is part of'}
              </span>
            </div>
            <p class="mb-2 text-xs text-base-content/60">
              {m.amb_form_help_is_part_of?.() ??
                'Resources this one belongs to — e.g. the course or series it is part of.'}
            </p>
            <AMBResourceSearchInput
              exclude={formData.isPartOf.map((r) => r.coordinate)}
              excludeSelf={editCoordinate}
              placeholder={m.amb_picker_search_placeholder?.() ?? 'Search AMB resources…'}
              onselect={(ref) => {
                formData.isPartOf = [...formData.isPartOf, ref];
              }}
            />
            {#if formData.isPartOf.length > 0}
              <ul class="mt-3 space-y-2">
                {#each formData.isPartOf as ref, i (ref.coordinate)}
                  <li
                    class="flex items-start gap-2 rounded-lg border border-base-300 bg-base-100 p-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium">
                        {ref.event?.tags?.find((t) => t[0] === 'name')?.[1] ??
                          m.amb_reference_unresolvable?.() ??
                          'Unresolved reference'}
                      </div>
                      <div class="truncate font-mono text-xs text-base-content/60">
                        {ref.coordinate}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      aria-label="Remove"
                      onclick={() => {
                        formData.isPartOf = formData.isPartOf.toSpliced(i, 1);
                      }}
                    >
                      <CloseIcon class_="w-4 h-4" />
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- hasPart -->
          <div class="form-control">
            <div class="label">
              <span class="label-text font-medium">
                {m.amb_form_label_has_part?.() ?? 'Has part'}
              </span>
            </div>
            <p class="mb-2 text-xs text-base-content/60">
              {m.amb_form_help_has_part?.() ??
                'Resources contained within this one — e.g. the individual videos of this course.'}
            </p>
            <AMBResourceSearchInput
              exclude={formData.hasPart.map((r) => r.coordinate)}
              excludeSelf={editCoordinate}
              placeholder={m.amb_picker_search_placeholder?.() ?? 'Search AMB resources…'}
              onselect={(ref) => {
                formData.hasPart = [...formData.hasPart, ref];
              }}
            />
            {#if formData.hasPart.length > 0}
              <ul class="mt-3 space-y-2">
                {#each formData.hasPart as ref, i (ref.coordinate)}
                  <li
                    class="flex items-start gap-2 rounded-lg border border-base-300 bg-base-100 p-2"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium">
                        {ref.event?.tags?.find((t) => t[0] === 'name')?.[1] ??
                          m.amb_reference_unresolvable?.() ??
                          'Unresolved reference'}
                      </div>
                      <div class="truncate font-mono text-xs text-base-content/60">
                        {ref.coordinate}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      aria-label="Remove"
                      onclick={() => {
                        formData.hasPart = formData.hasPart.toSpliced(i, 1);
                      }}
                    >
                      <CloseIcon class_="w-4 h-4" />
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!--
            AMB-only Lehrplanbezug (curriculum reference). Cascading picker
            (Bundesland → Schulart → Schulfach → Lehrplan) plus a lazy-loaded
            tree of topic nodes. Each tree action appends a SKOS Concept into
            one of teaches / assesses / competencyRequired (independent
            arrays — a resource can teach X, assess Y, require Z at once).
            Collapsed by default since it's optional.
          -->
          {#if variantId === 'amb'}
            <details class="rounded-md border border-base-300 p-3">
              <summary class="cursor-pointer text-sm font-medium">
                {m.amb_form_label_curriculum()}
              </summary>
              <p class="mt-2 mb-3 text-xs text-base-content/60">
                {m.amb_form_help_curriculum()}
              </p>
              <CurriculumPicker
                teaches={formData.teaches ?? []}
                assesses={formData.assesses ?? []}
                competencyRequired={formData.competencyRequired ?? []}
                onadd={(concept, relation) => {
                  // Toggle: clicking +T/+A/+R on an already-selected node removes
                  // it instead of being a confusing no-op. Removal via the chip ×
                  // still flows through onremove below.
                  const current = formData[relation] ?? [];
                  if (current.some((c) => c.id === concept.id)) {
                    formData[relation] = current.filter((c) => c.id !== concept.id);
                    return;
                  }
                  formData[relation] = [...current, concept];
                }}
                onremove={(conceptId, relation) => {
                  const current = formData[relation] ?? [];
                  formData[relation] = current.filter((c) => c.id !== conceptId);
                }}
              />
            </details>
          {/if}
        </div>
      {/if}

      <!-- Step 7: License & (in edit mode) Publish -->
      {#if currentStep === 7}
        <div class="space-y-4">
          <!-- License -->
          <div class="form-control">
            <label class="label" for="amb-license">
              <span class="label-text font-medium"
                >{m.amb_form_label_license()} <span class="text-error">*</span></span
              >
            </label>
            <select
              id="amb-license"
              class="select-bordered select w-full"
              class:select-error={showError('license')}
              aria-invalid={showError('license')}
              aria-describedby={showError('license') ? 'amb-license-error' : undefined}
              bind:value={formData.license}
              onblur={() => markTouched('license')}
            >
              {#each licenseOptions as license (license.id)}
                <option value={license.id}>{license.label}</option>
              {/each}
            </select>
            <FieldAiSuggestionBadge
              field="license"
              {formData}
              {aboutByVocab}
              {aiSuggestions}
              dismissedFields={dismissedSuggestionFields}
              onapply={handleSuggestionAction}
            />
            {#if showError('license')}
              <p id="amb-license-error" class="mt-1 text-xs text-error">{fieldErrors.license}</p>
            {/if}
            <div class="label">
              <!-- eslint-disable svelte/no-navigation-without-resolve -- external: license URL -->
              <a
                href={formData.license}
                target="_blank"
                rel="noopener noreferrer"
                class="label-text-alt link link-primary"
              >
                {m.amb_form_link_license_details()}
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
              <span class="label-text">{m.amb_form_checkbox_free_access()}</span>
            </label>
          </div>

          <!-- Preview Summary -->
          <div class="rounded-lg bg-base-200 p-4">
            <h3 class="mb-3 font-medium">{m.amb_form_label_summary()}</h3>
            <dl class="space-y-2 text-sm">
              <div class="flex">
                <dt class="w-32 shrink-0 text-base-content/60">{m.amb_form_summary_title()}</dt>
                <dd class="flex-1 font-medium">{formData.name || '—'}</dd>
              </div>
              {#if formData.identifier}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_url?.() ?? 'URL:'}
                  </dt>
                  <dd class="flex-1 truncate font-mono text-xs">{formData.identifier}</dd>
                </div>
              {/if}
              {#if formData.description}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_description?.() ?? 'Description:'}
                  </dt>
                  <dd class="line-clamp-3 flex-1 text-base-content/80">{formData.description}</dd>
                </div>
              {/if}
              {#if formData.bildungsbereich}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">Bildungsbereich:</dt>
                  <dd class="flex-1">
                    {BILDUNGSBEREICHE[formData.bildungsbereich]?.label?.de ??
                      formData.bildungsbereich}
                  </dd>
                </div>
              {/if}
              {#if formData.image}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">Vorschaubild:</dt>
                  <dd class="flex-1 truncate font-mono text-xs">{formData.image}</dd>
                </div>
              {/if}
              <div class="flex">
                <dt class="w-32 shrink-0 text-base-content/60">{m.amb_form_summary_language()}</dt>
                <dd class="flex-1">
                  {languageOptions.find((l) => l.code === formData.inLanguage)?.label}
                </dd>
              </div>
              <div class="flex">
                <dt class="w-32 shrink-0 text-base-content/60">{m.amb_form_summary_type()}</dt>
                <dd class="flex-1">
                  {formData.learningResourceType.map((t) => t.label).join(', ') || '—'}
                </dd>
              </div>
              {#if formData.educationalLevels.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_educational_level?.() ?? 'Level:'}
                  </dt>
                  <dd class="flex-1">
                    {formData.educationalLevels.map((e) => e.label || e.id).join(', ')}
                  </dd>
                </div>
              {/if}
              {#if mergedAbout().length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">{m.amb_form_summary_subject()}</dt>
                  <dd class="flex-1">
                    {mergedAbout()
                      .map((s) => s.label || s.id)
                      .join(', ')}
                  </dd>
                </div>
              {/if}
              {#if formData.keywords.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_keywords?.() ?? 'Keywords:'}
                  </dt>
                  <dd class="flex-1">{formData.keywords.join(', ')}</dd>
                </div>
              {/if}
              {#if isEkw}
                {#if formData.gradeLevelLabels.length > 0}
                  <div class="flex">
                    <dt class="w-32 shrink-0 text-base-content/60">
                      {m.amb_form_summary_ekw_klassenstufe()}
                    </dt>
                    <dd class="flex-1">
                      {formData.gradeLevelLabels.map((c) => c.label || c.id).join(', ')}
                    </dd>
                  </div>
                {/if}
                {#if formData.schoolTypeLabels.length > 0}
                  <div class="flex">
                    <dt class="w-32 shrink-0 text-base-content/60">
                      {m.amb_form_summary_ekw_schulart()}
                    </dt>
                    <dd class="flex-1">
                      {formData.schoolTypeLabels.map((c) => c.label || c.id).join(', ')}
                    </dd>
                  </div>
                {/if}
                {#if formData.didacticConceptLabels.length > 0}
                  <div class="flex">
                    <dt class="w-32 shrink-0 text-base-content/60">
                      {m.amb_form_summary_ekw_didactic_concept()}
                    </dt>
                    <dd class="flex-1">
                      {formData.didacticConceptLabels.map((c) => c.label || c.id).join(', ')}
                    </dd>
                  </div>
                {/if}
                {#if formData.methodLabels.length > 0}
                  <div class="flex">
                    <dt class="w-32 shrink-0 text-base-content/60">
                      {m.amb_form_summary_ekw_method()}
                    </dt>
                    <dd class="flex-1">
                      {formData.methodLabels.map((c) => c.label || c.id).join(', ')}
                    </dd>
                  </div>
                {/if}
                {#if formData.methodOther?.trim()}
                  <div class="flex">
                    <dt class="w-32 shrink-0 text-base-content/60">
                      {m.amb_form_summary_ekw_method_free()}
                    </dt>
                    <dd class="line-clamp-3 flex-1 text-base-content/80">{formData.methodOther}</dd>
                  </div>
                {/if}
                {@const bibleRefs = formData.bibleReferences
                  .map((/** @type {string} */ s) => s.trim())
                  .filter(Boolean)}
                {#if bibleRefs.length > 0}
                  <div class="flex">
                    <dt class="w-32 shrink-0 text-base-content/60">
                      {m.amb_form_summary_ekw_bible_reference()}
                    </dt>
                    <dd class="flex-1">{bibleRefs.join(', ')}</dd>
                  </div>
                {/if}
              {/if}
              {#if isEkw && formData.bildungsbereich === 'konfi'}
                {@const konfiSummaryRows = buildKonfiSummaryRows(formData, {
                  yes: m.common_yes(),
                  no: m.common_no()
                })}
                {#each konfiSummaryRows as row (row.labelKey)}
                  {@const labelFn = /** @type {Record<string, any>} */ (m)[row.labelKey]}
                  {@const label = typeof labelFn === 'function' ? labelFn() : row.labelKey}
                  <div class="flex">
                    <dt class="w-32 shrink-0 text-base-content/60">{label}</dt>
                    <dd class="flex-1 {row.multiline ? 'line-clamp-3 text-base-content/80' : ''}">
                      {row.value}
                    </dd>
                  </div>
                {/each}
              {/if}
              {#if formData.creators.some((c) => c.name)}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_creators()}
                  </dt>
                  <dd class="flex-1">
                    {formData.creators
                      .map((c) => c.name)
                      .filter(Boolean)
                      .join(', ')}
                  </dd>
                </div>
              {/if}
              {#if formData.encodings.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">{m.amb_form_summary_files()}</dt>
                  <dd class="flex-1">{formData.encodings.length} file(s)</dd>
                </div>
              {/if}
              {#if formData.externalUrls.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_external_urls()}
                  </dt>
                  <dd class="flex-1">{formData.externalUrls.length} link(s)</dd>
                </div>
              {/if}
              {#if formData.isPartOf.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_is_part_of?.() ?? 'Part of:'}
                  </dt>
                  <dd class="flex-1">
                    {formData.isPartOf
                      .map((r) => r.event?.tags?.find((t) => t[0] === 'name')?.[1] ?? r.coordinate)
                      .join(', ')}
                  </dd>
                </div>
              {/if}
              {#if formData.hasPart.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.amb_form_summary_has_part?.() ?? 'Contains:'}
                  </dt>
                  <dd class="flex-1">
                    {formData.hasPart
                      .map((r) => r.event?.tags?.find((t) => t[0] === 'name')?.[1] ?? r.coordinate)
                      .join(', ')}
                  </dd>
                </div>
              {/if}
              {#if formData.teaches?.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.curriculum_picker_section_teaches()}:
                  </dt>
                  <dd class="flex-1">
                    {formData.teaches.map((c) => c.prefLabel?.de ?? c.id).join(', ')}
                  </dd>
                </div>
              {/if}
              {#if formData.assesses?.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.curriculum_picker_section_assesses()}:
                  </dt>
                  <dd class="flex-1">
                    {formData.assesses.map((c) => c.prefLabel?.de ?? c.id).join(', ')}
                  </dd>
                </div>
              {/if}
              {#if formData.competencyRequired?.length > 0}
                <div class="flex">
                  <dt class="w-32 shrink-0 text-base-content/60">
                    {m.curriculum_picker_section_competency_required()}:
                  </dt>
                  <dd class="flex-1">
                    {formData.competencyRequired.map((c) => c.prefLabel?.de ?? c.id).join(', ')}
                  </dd>
                </div>
              {/if}
              <div class="flex">
                <dt class="w-32 shrink-0 text-base-content/60">{m.amb_form_summary_license()}</dt>
                <dd class="flex-1">
                  {licenseOptions.find((l) => l.id === formData.license)?.label}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      {/if}

      <!-- Step 8: Share to communities (create mode only) -->
      {#if currentStep === 8 && !isEditMode}
        <div class="space-y-3">
          <p class="text-sm text-base-content/70">
            {m.amb_form_help_share?.() ??
              'Share this resource into communities you belong to. Each share is a NIP-18 repost you can remove later.'}
          </p>
          {#if joinedCommunities.length === 0}
            <div class="alert text-sm alert-info">
              {m.amb_form_share_no_communities?.() ??
                'You are not a member of any community yet. You can still publish the resource and share it later.'}
            </div>
          {:else}
            <ul class="space-y-2">
              {#each joinedCommunities as pubkey (pubkey)}
                {@const profile = joinedCommunityProfiles.get(pubkey)}
                {@const displayName =
                  getDisplayName(profile) || `${pubkey.slice(0, 12)}…${pubkey.slice(-8)}`}
                {@const picture = profile ? getProfilePicture(profile) : undefined}
                <li>
                  <label
                    class="flex cursor-pointer items-center gap-3 rounded-lg border border-base-300 p-3 hover:bg-base-200"
                  >
                    <input
                      type="checkbox"
                      class="checkbox checkbox-primary"
                      checked={selectedCommunityPubkeys.includes(pubkey)}
                      onchange={() => toggleCommunity(pubkey)}
                    />
                    {#if picture}
                      <img
                        src={picture}
                        alt=""
                        class="h-8 w-8 rounded-full border border-base-300 object-cover"
                      />
                    {:else}
                      <div
                        class="h-8 w-8 shrink-0 rounded-full border border-base-300 bg-base-200"
                      ></div>
                    {/if}
                    <span class="truncate text-sm" data-testid="community-name">{displayName}</span>
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Validation summary — appears once the user tries to advance and is
       blocked. Each error is also shown inline next to the offending field. -->
    {#if advanceAttempted && validationErrors.length > 0}
      <div class="mt-4 alert alert-error" role="alert" aria-live="polite">
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
        <button
          type="button"
          class="btn btn-outline"
          onclick={handleCancel}
          disabled={isSubmitting}
        >
          {m.common_cancel()}
        </button>
      {:else}
        <button type="button" class="btn btn-outline" onclick={prevStep} disabled={isSubmitting}>
          <ChevronLeftIcon class_="w-4 h-4" />
          {m.common_back()}
        </button>
      {/if}

      {#if currentStep < totalSteps}
        <div class="flex items-center gap-3">
          {#if isAsyncBusy}
            <span
              class="flex items-center gap-2 text-sm text-base-content/60"
              role="status"
              aria-live="polite"
            >
              <span class="loading loading-xs loading-spinner"></span>
              {metadataFetchBusy ? m.amb_form_busy_metadata_fetch() : m.amb_form_busy_enrichment()}
            </span>
          {/if}
          <button type="button" class="btn btn-primary" onclick={nextStep} disabled={isAsyncBusy}>
            {m.common_next()}
            <ChevronRightIcon class_="w-4 h-4" />
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="btn btn-primary"
          onclick={handleSubmit}
          disabled={isSubmitting}
        >
          {#if isSubmitting}
            <span class="loading loading-sm loading-spinner"></span>
            {isEditMode ? m.amb_form_button_updating() : m.amb_form_button_publishing()}
          {:else}
            {isEditMode ? m.amb_form_button_update() : m.amb_form_button_publish()}
          {/if}
        </button>
      {/if}
    </div>
  </div>

  <!-- Live preview side rail (lg+). Mirrors the published kind-30142
       resource as the user fills fields. Hidden on mobile to save vertical
       space — the mobile <details> below the progress dots covers that case. -->
  {#if previewResource}
    <aside class="hidden lg:sticky lg:top-6 lg:block" in:fly={{ x: 24, duration: 280, delay: 80 }}>
      <p class="mb-2 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
        👁 {m.forms_preview_tab()}
      </p>
      <AMBResourceCard
        resource={previewResource}
        authorProfile={previewAuthorProfile}
        variant="card"
        preview={true}
      />
    </aside>
  {/if}
</div>

{#if showStartOverConfirm}
  <div role="dialog" aria-modal="true" class="modal-open modal">
    <div class="modal-box">
      <h3 class="text-lg font-bold">{m.amb_form_start_over_confirm_title()}</h3>
      <p class="py-3 text-sm">{m.amb_form_start_over_confirm_body()}</p>
      <div class="modal-action">
        <button type="button" class="btn btn-sm" onclick={() => (showStartOverConfirm = false)}>
          {m.amb_form_start_over_confirm_cancel()}
        </button>
        <button type="button" class="btn btn-sm btn-error" onclick={startOver}>
          {m.amb_form_start_over_confirm_ok()}
        </button>
      </div>
    </div>
    <button
      type="button"
      class="modal-backdrop"
      aria-label={m.amb_form_start_over_confirm_cancel()}
      onclick={() => (showStartOverConfirm = false)}
    ></button>
  </div>
{/if}
