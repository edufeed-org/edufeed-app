<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { fetchEventById } from '$lib/helpers/nostrUtils';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getArticleTitle, getArticleSummary, getArticleImage } from 'applesauce-common/helpers';
  import {
    createArticle,
    updateArticle,
    ARTICLE_DRAFT_KIND
  } from '$lib/stores/article-actions.svelte.js';
  import MarkdownEditor from '$lib/components/shared/MarkdownEditor.svelte';
  import EditableList from '$lib/components/shared/EditableList.svelte';
  import CreatorInput from '$lib/components/educational/CreatorInput.svelte';
  import { getLicenseOptions } from '$lib/helpers/educational/licenseOptions.js';
  import { fetchProfileData } from '$lib/helpers/profile.js';
  import { articlePeopleToForm, getArticleProvenance } from '$lib/helpers/article-attribution.js';
  import LicensedImageInput from '$lib/components/shared/LicensedImageInput.svelte';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { takeExport, exportTitle } from '$lib/webxdc/export-share.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ data: { communityPubkey: string, editNaddr: string, prefill: string } }} */
  let { data } = $props();

  // Edit mode state
  let editEvent = $state(/** @type {any} */ (null));
  let isLoadingEdit = $state(false);
  let editError = $state('');

  const isEditMode = $derived(!!data.editNaddr);
  // Editing a NIP-23 draft (kind 30024): it can be saved again or published.
  // A published article never goes back to draft.
  const isDraftEdit = $derived(isEditMode && editEvent?.kind === ARTICLE_DRAFT_KIND);
  const canSaveDraft = $derived(!isEditMode || isDraftEdit);

  // Form state
  let title = $state('');
  let summary = $state('');
  let editorContent = $state('');
  let imageUrl = $state('');
  let imageWasUploaded = $state(false);
  /** @type {any} */
  let imageLicenseEvent = $state(null);
  /**
   * Body images inserted this session (upload or library pick) with their
   * NIP-94 fields — buildArticleTags turns the ones still in the markdown
   * into NIP-92 imeta tags. Previous versions' imeta tags are carried over
   * by updateArticle from the existing event.
   * @type {import('$lib/helpers/imeta.js').MediaAttachment[]}
   */
  let bodyMedia = $state.raw([]);
  let hashtags = $state(/** @type {string[]} */ ([]));

  // Authorship & license (all optional): credit someone else as the author,
  // name the license, where the text came from and what was changed (TULLU).
  let creators = $state(
    /** @type {import('$lib/stores/educational-actions.svelte.js').Creator[]} */ ([])
  );
  let license = $state('');
  let source = $state('');
  let changes = $state('');
  const licenseOptions = $derived(getLicenseOptions(license));
  const hasAttribution = $derived(
    creators.length > 0 || !!license || !!source.trim() || !!changes.trim()
  );
  let attributionOpen = $state(false);

  // Prefill from a channel app export (webxdc sendToChat → sessionStorage handoff).
  if (data.prefill === 'webxdc') {
    const exported = takeExport();
    if (exported) {
      title = exportTitle(exported.name);
      editorContent = exported.plainText;
    }
  }

  // UI state
  let isPublishing = $state(false);
  let isSavingDraft = $state(false);
  let validationError = $state('');

  // Active user display name for the license modal's "I created this" auto-credit.
  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());
  const getActiveUserProfile = useUserProfile(() => activeUser?.pubkey);
  const activeUserProfile = $derived(getActiveUserProfile());
  const activeUserDisplayName = $derived(
    activeUser ? getDisplayName(activeUserProfile, activeUser.pubkey.slice(0, 8)) : ''
  );

  // Resolve edit naddr to event
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
          editError = m.create_edit_error_article_not_found();
          return;
        }

        editEvent = event;
        title = getArticleTitle(event) || '';
        summary = getArticleSummary(event) || '';
        editorContent = event.content || '';
        const img = getArticleImage(event);
        if (img) {
          imageUrl = img;
          // Re-gate on edit if the existing article carries an x tag (prior upload).
          // The reactive $effect below will load a matching license event from
          // EventStore; if found, imageLicenseEvent is set and the gate passes.
          imageWasUploaded = !!event.tags?.find((/** @type {any} */ t) => t[0] === 'x');
        }
        hashtags =
          event.tags
            ?.filter((/** @type {any} */ t) => t[0] === 't')
            .map((/** @type {any} */ t) => t[1]) || [];
        creators = articlePeopleToForm(event);
        const provenance = getArticleProvenance(event);
        license = provenance.license?.id || '';
        source = provenance.source || '';
        changes = provenance.changes || '';
        attributionOpen = creators.length > 0 || !!license || !!source || !!changes;
        resolveLinkedCreatorNames();
      } catch (err) {
        console.error('Error loading article for edit:', err);
        editError = m.create_edit_error_article_load();
      } finally {
        isLoadingEdit = false;
      }
    })();
  });

  // Edit-flow license rehydration via existing `x` tag on the article event.
  const editImageHash = $derived(
    editEvent?.tags?.find((/** @type {any} */ t) => t[0] === 'x')?.[1] ?? null
  );
  const getEditLicense = useLicenseForHash(() => editImageHash);
  $effect(() => {
    if (editImageHash && !imageLicenseEvent) {
      const lic = getEditLicense();
      if (lic) imageLicenseEvent = lic;
    }
  });

  // Linked people arrive from the event without a name (NIP-AMB: only the
  // p-tag is on the wire). Fill the list rows from their profiles in the
  // background — best effort, never blocking the form on slow relays.
  function resolveLinkedCreatorNames() {
    for (const entry of creators) {
      if (!entry.pubkey || entry.name) continue;
      const pubkey = entry.pubkey;
      fetchProfileData(pubkey)
        .then((profile) => {
          const name = typeof profile?.name === 'string' ? profile.name : '';
          if (!name) return;
          creators = creators.map((c) => (c.pubkey === pubkey && !c.name ? { ...c, name } : c));
        })
        .catch(() => {});
    }
  }

  function handleBack() {
    history.back();
  }

  /** @param {boolean} [asDraft] - save as NIP-23 draft (kind 30024) instead of publishing */
  async function handlePublish(asDraft = false) {
    validationError = '';

    if (!title.trim()) {
      validationError = m.article_editor_validation_title();
      return;
    }
    if (!editorContent.trim()) {
      validationError = m.article_editor_validation_content();
      return;
    }
    if (imageUrl && imageWasUploaded && !imageLicenseEvent) {
      validationError = m.amb_form_validation_image_license_missing();
      return;
    }
    if (source.trim() && !/^https?:\/\//i.test(source.trim())) {
      validationError = m.article_editor_validation_source();
      attributionOpen = true;
      return;
    }

    isPublishing = true;
    isSavingDraft = asDraft;
    try {
      const imageHash =
        imageLicenseEvent?.tags?.find((/** @type {any} */ t) => t[0] === 'x')?.[1] || undefined;

      /** @type {import('$lib/stores/article-actions.svelte.js').ArticleFormData} */
      const formData = {
        title: title.trim(),
        content: editorContent,
        summary: summary.trim() || undefined,
        image: imageUrl || undefined,
        imageHash,
        imageLicenseEvent: imageLicenseEvent ?? null,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        media: bodyMedia,
        creators,
        license: license || undefined,
        source: source.trim() || undefined,
        changes: changes.trim() || undefined
      };

      const options = { draft: asDraft };
      let naddr;
      if (isEditMode && editEvent) {
        const result = await updateArticle(formData, editEvent, null, options);
        naddr = result.naddr;
      } else {
        const result = await createArticle(
          formData,
          data.communityPubkey || undefined,
          undefined,
          options
        );
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
      isSavingDraft = false;
    }
  }
</script>

<svelte:head>
  <title>
    {isEditMode ? m.article_editor_page_title_edit() : m.article_editor_page_title_create()} - {runtimeConfig.appName}
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
        {isEditMode ? m.article_editor_page_title_edit() : m.article_editor_page_title_create()}
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
      <input
        type="text"
        class="input w-full text-2xl font-bold"
        placeholder={m.article_editor_title_placeholder()}
        bind:value={title}
      />

      <!-- Cover Image with license attestation -->
      <div>
        <div class="label mb-1">
          <span class="label-text">{m.article_editor_cover_image()}</span>
        </div>
        <LicensedImageInput
          bind:imageUrl
          bind:imageWasUploaded
          bind:licenseEvent={imageLicenseEvent}
          {activeUserDisplayName}
        />
      </div>

      <!-- Summary -->
      <!-- plain textarea on purpose: the summary is a metadata tag, not content —
        a mention here would neither be p-tagged nor rendered as a name -->
      <textarea
        class="textarea w-full"
        rows="2"
        placeholder={m.article_editor_summary_placeholder()}
        bind:value={summary}
      ></textarea>

      <!-- Markdown Editor -->
      <MarkdownEditor
        bind:content={editorContent}
        placeholder={m.article_editor_content_placeholder()}
        onmediainsert={(att) => (bodyMedia = [...bodyMedia, att])}
      />

      <!-- Authorship & license (collapsed unless something is set) -->
      <details
        class="collapse-arrow collapse rounded-lg border border-base-300 bg-base-100"
        bind:open={attributionOpen}
        data-testid="article-attribution"
      >
        <summary class="collapse-title font-medium">
          {m.article_editor_attribution_heading()}
          {#if hasAttribution && !attributionOpen}
            <span class="ml-2 badge badge-sm badge-primary">{creators.length || '✓'}</span>
          {/if}
        </summary>
        <div class="collapse-content space-y-4">
          <p class="text-sm text-base-content/70">{m.article_editor_attribution_hint()}</p>

          <CreatorInput
            bind:creators
            label={m.article_editor_creators_label()}
            helpText={m.article_editor_creators_help()}
            activeUserPubkey={activeUser?.pubkey ?? ''}
          />

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="article-license">
                <span class="label-text">{m.article_editor_license_label()}</span>
              </label>
              <select id="article-license" class="select w-full" bind:value={license}>
                <option value="">{m.article_editor_license_none()}</option>
                {#each licenseOptions as option (option.id)}
                  <option value={option.id}>{option.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="label" for="article-source">
                <span class="label-text">{m.article_editor_source_label()}</span>
              </label>
              <input
                id="article-source"
                type="url"
                class="input w-full"
                placeholder={m.article_editor_source_placeholder()}
                bind:value={source}
              />
            </div>
          </div>

          <div>
            <label class="label" for="article-changes">
              <span class="label-text">{m.article_editor_changes_label()}</span>
            </label>
            <input
              id="article-changes"
              type="text"
              class="input w-full"
              placeholder={m.article_editor_changes_placeholder()}
              bind:value={changes}
            />
          </div>
        </div>
      </details>

      <!-- Hashtags -->
      <EditableList
        bind:items={hashtags}
        label={m.article_editor_hashtags_label()}
        placeholder={m.article_editor_hashtags_placeholder()}
        buttonText="+"
        itemType="hashtag"
      />

      <!-- Validation Error -->
      {#if validationError}
        <div class="alert alert-error">
          <span>{validationError}</span>
        </div>
      {/if}

      <!-- Save as draft (NIP-23 kind 30024: unlisted, shareable preview link) -->
      {#if canSaveDraft}
        <button
          class="btn w-full btn-outline"
          onclick={() => handlePublish(true)}
          disabled={isPublishing}
          data-testid="article-save-draft"
        >
          {#if isPublishing && isSavingDraft}
            <span class="loading loading-sm loading-spinner"></span>
            {m.article_editor_saving_draft()}
          {:else if isDraftEdit}
            {m.article_editor_update_draft()}
          {:else}
            {m.article_editor_save_draft()}
          {/if}
        </button>
        <p class="-mt-4 text-center text-xs text-base-content/60">
          {m.article_editor_draft_hint()}
        </p>
      {/if}

      <!-- Publish Button -->
      <button
        class="btn w-full btn-primary"
        onclick={() => handlePublish(false)}
        disabled={isPublishing}
      >
        {#if isPublishing && !isSavingDraft}
          <span class="loading loading-sm loading-spinner"></span>
          {m.article_editor_publishing()}
        {:else if isEditMode && !isDraftEdit}
          {m.article_editor_update()}
        {:else}
          {m.article_editor_publish()}
        {/if}
      </button>
    </div>
  {/if}
</div>
