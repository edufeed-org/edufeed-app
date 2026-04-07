<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { nip19 } from 'nostr-tools';
  import { normalizeIdentifier } from 'nostr-tools/nip54';
  import { ChevronLeftIcon } from '$lib/components/icons';
  import { fetchEventById } from '$lib/helpers/nostrUtils';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { createWiki, updateWiki } from '$lib/stores/wiki-actions.svelte.js';
  import MarkdownEditor from '$lib/components/shared/MarkdownEditor.svelte';
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
  let topic = $state('');
  let summary = $state('');
  let editorContent = $state('');
  let hashtags = $state(/** @type {string[]} */ ([]));

  // UI state
  let isPublishing = $state(false);
  let validationError = $state('');

  // Preview of normalized topic
  const normalizedTopic = $derived(topic.trim() ? normalizeIdentifier(topic.trim()) : '');

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
          editError = m.create_edit_error_wiki_not_found();
          return;
        }

        editEvent = event;
        const titleTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'title');
        title = titleTag?.[1] || '';
        const dTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'd');
        topic = dTag?.[1] || '';
        const summaryTag = event.tags?.find((/** @type {any} */ t) => t[0] === 'summary');
        summary = summaryTag?.[1] || '';
        editorContent = event.content || '';
        hashtags =
          event.tags
            ?.filter((/** @type {any} */ t) => t[0] === 't')
            .map((/** @type {any} */ t) => t[1]) || [];
      } catch (err) {
        console.error('Error loading wiki for edit:', err);
        editError = m.create_edit_error_wiki_load();
      } finally {
        isLoadingEdit = false;
      }
    })();
  });

  function handleBack() {
    history.back();
  }

  async function handlePublish() {
    validationError = '';

    if (!title.trim()) {
      validationError = m.wiki_editor_validation_title();
      return;
    }
    if (!topic.trim()) {
      validationError = m.wiki_editor_validation_topic();
      return;
    }
    if (!editorContent.trim()) {
      validationError = m.wiki_editor_validation_content();
      return;
    }

    isPublishing = true;
    try {
      /** @type {import('$lib/stores/wiki-actions.svelte.js').WikiFormData} */
      const formData = {
        title: title.trim(),
        content: editorContent,
        topic: topic.trim(),
        summary: summary.trim() || undefined,
        hashtags: hashtags.length > 0 ? hashtags : undefined
      };

      let naddr;
      if (isEditMode && editEvent) {
        const result = await updateWiki(formData, editEvent);
        naddr = result.naddr;
      } else {
        const result = await createWiki(formData, data.communityPubkey || undefined, undefined);
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
    {isEditMode ? m.wiki_editor_page_title_edit() : m.wiki_editor_page_title_create()} - {runtimeConfig.appName}
  </title>
</svelte:head>

<div class="min-h-[calc(100vh-4rem)]">
  <!-- Top bar -->
  <div class="border-b border-base-300 bg-base-100">
    <div class="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
      <button class="btn btn-ghost btn-sm" onclick={handleBack} aria-label={m.aria_go_back()}>
        <ChevronLeftIcon class_="w-5 h-5" />
      </button>
      <h1 class="text-lg font-semibold text-base-content">
        {isEditMode ? m.wiki_editor_page_title_edit() : m.wiki_editor_page_title_create()}
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
        placeholder={m.wiki_editor_title_placeholder()}
        bind:value={title}
      />

      <!-- Topic -->
      <div>
        <label class="label" for="wiki-topic">
          <span class="label-text font-medium">{m.wiki_editor_topic_label()}</span>
        </label>
        <input
          id="wiki-topic"
          type="text"
          class="input w-full"
          placeholder={m.wiki_editor_topic_placeholder()}
          bind:value={topic}
          disabled={isEditMode}
        />
        <div class="label">
          <span class="label-text-alt text-base-content/60">{m.wiki_editor_topic_help()}</span>
        </div>
        {#if normalizedTopic && !isEditMode}
          <div class="mt-1">
            <span class="badge badge-sm badge-secondary">{normalizedTopic}</span>
          </div>
        {/if}
      </div>

      <!-- Summary -->
      <textarea
        class="textarea w-full"
        rows="2"
        placeholder={m.wiki_editor_summary_placeholder()}
        bind:value={summary}
      ></textarea>

      <!-- Markdown Editor -->
      <MarkdownEditor
        bind:content={editorContent}
        placeholder={m.wiki_editor_content_placeholder()}
      />

      <!-- Hashtags -->
      <EditableList
        bind:items={hashtags}
        label={m.wiki_editor_hashtags_label()}
        placeholder={m.wiki_editor_hashtags_placeholder()}
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
          {m.wiki_editor_publishing()}
        {:else if isEditMode}
          {m.wiki_editor_update()}
        {:else}
          {m.wiki_editor_publish()}
        {/if}
      </button>
    </div>
  {/if}
</div>
