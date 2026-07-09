<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { fetchEventById } from '$lib/helpers/nostrUtils';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { getArticleTitle, getArticleSummary, getArticleImage } from 'applesauce-common/helpers';
  import { createArticle, updateArticle } from '$lib/stores/article-actions.svelte.js';
  import MarkdownEditor from '$lib/components/shared/MarkdownEditor.svelte';
  import EditableList from '$lib/components/shared/EditableList.svelte';
  import LicensedImageInput from '$lib/components/shared/LicensedImageInput.svelte';
  import { useLicenseForHash } from '$lib/stores/image-license.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
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
  let summary = $state('');
  let editorContent = $state('');
  let imageUrl = $state('');
  let imageWasUploaded = $state(false);
  /** @type {any} */
  let imageLicenseEvent = $state(null);
  let hashtags = $state(/** @type {string[]} */ ([]));

  // UI state
  let isPublishing = $state(false);
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

  function handleBack() {
    history.back();
  }

  async function handlePublish() {
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

    isPublishing = true;
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
        hashtags: hashtags.length > 0 ? hashtags : undefined
      };

      let naddr;
      if (isEditMode && editEvent) {
        const result = await updateArticle(formData, editEvent);
        naddr = result.naddr;
      } else {
        const result = await createArticle(formData, data.communityPubkey || undefined, undefined);
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
      />

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

      <!-- Publish Button -->
      <button class="btn w-full btn-primary" onclick={handlePublish} disabled={isPublishing}>
        {#if isPublishing}
          <span class="loading loading-sm loading-spinner"></span>
          {m.article_editor_publishing()}
        {:else if isEditMode}
          {m.article_editor_update()}
        {:else}
          {m.article_editor_publish()}
        {/if}
      </button>
    </div>
  {/if}
</div>
