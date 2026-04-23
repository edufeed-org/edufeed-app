<!--
  AMBResourceView Component
  Full page viewer for AMB educational resources (kind 30142)
  Follows Nostr-first approach with comments/reactions as primary interaction
-->

<script>
  import { getProfilePicture, getDisplayName } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import EventTags from '../calendar/EventTags.svelte';

  import { getLocale } from '$lib/paraglide/runtime.js';
  import {
    getLabelsWithFallback,
    getLanguageDisplayName
  } from '$lib/helpers/educational/ambTransform.js';
  import { getCachedConcepts, ensureVocabularyLoaded } from '$lib/stores/skos-cache.svelte.js';
  import { buildAMBJsonLd } from '$lib/helpers/educational/ambJsonLd.js';
  import { page } from '$app/stores';
  import * as m from '$lib/paraglide/messages.js';
  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import { getFormReferenceFromResource } from '$lib/helpers/form-to-amb.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { EditIcon, TrashIcon } from '$lib/components/icons';
  import EventContextMenu from '../shared/EventContextMenu.svelte';
  import DeleteConfirmModal from '../shared/DeleteConfirmModal.svelte';

  // Trigger SKOS vocabulary loading for label resolution
  ensureVocabularyLoaded('learningResourceType');
  ensureVocabularyLoaded('about');

  /**
   * @typedef {Object} Props
   * @property {any} event - Raw Nostr event (kind 30142)
   * @property {any} resource - Formatted resource object (from formatAMBResource)
   */

  /** @type {Props} */
  let { event, resource } = $props();

  // Reactive SKOS concepts for URI-to-label resolution
  const resourceTypeConcepts = $derived(getCachedConcepts('learningResourceType'));
  const aboutConcepts = $derived(getCachedConcepts('about'));

  // Language-aware labels - reactive to locale changes and SKOS cache!
  // Fallback chain: user's language → English → SKOS concept → URI label
  const localizedLearningResourceTypes = $derived(
    getLabelsWithFallback(event.tags, 'learningResourceType', getLocale(), resourceTypeConcepts)
  );
  const localizedSubjects = $derived(
    getLabelsWithFallback(event.tags, 'about', getLocale(), aboutConcepts)
  );
  const localizedEducationalLevels = $derived(
    getLabelsWithFallback(event.tags, 'educationalLevel', getLocale())
  );

  // Get active user (reactive to login/logout)
  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  // Delete state
  let showDeleteConfirmation = $state(false);
  let isDeleting = $state(false);

  // Check if current user owns this resource
  const isOwner = $derived(activeUser?.pubkey === event.pubkey);

  /**
   * Handle edit button click - navigate to edit page
   */
  function handleEditClick() {
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const editNaddr = nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: dTag
    });
    goto(resolve(`/create/resource?edit=${editNaddr}`));
  }

  // Form back-reference: if the resource was produced by a kind-30168 form, offer
  // "Edit in form" that routes through the form-driven create-resource page.
  const formRef = $derived(getFormReferenceFromResource(event));

  function handleEditInFormClick() {
    if (!formRef) return;
    const [kindStr, pubkey, identifier] = formRef.address.split(':');
    const formNaddr = nip19.naddrEncode({
      kind: Number(kindStr),
      pubkey,
      identifier,
      relays: formRef.relay ? [formRef.relay] : undefined
    });
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const editNaddr = nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: dTag
    });
    goto(resolve(`/forms/${formNaddr}/create-resource?edit=${editNaddr}`));
  }

  /**
   * Handle resource deletion
   */
  async function handleDeleteResource() {
    if (!activeUser || !event) return;

    isDeleting = true;
    try {
      const result = await deleteEvent(event, activeUser);

      if (result.success) {
        showToast(m.toast_resource_deleted(), 'success');
        showDeleteConfirmation = false;
        // Navigate to discover page
        goto(resolve('/discover'));
      } else {
        showToast(result.error || m.toast_resource_delete_failed(), 'error');
      }
    } catch (error) {
      console.error('Failed to delete resource:', error);
      showToast(m.toast_resource_delete_error(), 'error');
    } finally {
      isDeleting = false;
    }
  }

  // Parse related resources from marker 'a' tags (hasPart / isPartOf / …).
  // Only a-tags with a relation marker in slot 3 are treated as related
  // resources — bare `a`-tags are ignored so we don't pick up unrelated refs.
  const relatedResources = $derived.by(() => {
    return (
      event.tags
        ?.filter((/** @type {any} */ t) => t[0] === 'a' && t[3])
        .map((/** @type {any} */ t) => {
          try {
            const coord = t[1] ?? '';
            // Bounded split so URL d-tags (containing ':') survive intact.
            const i = coord.indexOf(':');
            const j = i >= 0 ? coord.indexOf(':', i + 1) : -1;
            if (i < 0 || j < 0) return null;
            const kind = coord.slice(0, i);
            const pubkey = coord.slice(i + 1, j);
            const identifier = coord.slice(j + 1);
            if (!kind || !pubkey) return null;
            const relayHint = t[2]; // a-tag format: ['a', 'kind:pubkey:d-tag', 'relay-hint', marker]
            return {
              naddr: nip19.naddrEncode({
                kind: parseInt(kind),
                pubkey,
                identifier,
                relays: relayHint ? [relayHint] : undefined
              }),
              raw: coord,
              label: identifier || coord
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) || []
    );
  });

  // Parse creators from event tags (p-tags)
  const creators = $derived.by(() => {
    const creatorPubkeys =
      event.tags
        ?.filter((/** @type {any} */ t) => t[0] === 'p')
        .map((/** @type {any} */ t) => t[1]) || [];

    return creatorPubkeys.map((/** @type {string} */ pubkey) => ({
      pubkey,
      hasProfile: true
    }));
  });

  // Check if we have educational metadata to display (using localized versions)
  const hasEducationalMetadata = $derived(
    localizedLearningResourceTypes.length > 0 ||
      localizedEducationalLevels.length > 0 ||
      localizedSubjects.length > 0
  );

  // Published date
  const publishedAt = $derived(
    resource.publishedDate ? new Date(resource.publishedDate * 1000) : null
  );

  // JSON-LD structured data for SEO
  const pageUrl = $derived($page.url.href);
  const jsonLd = $derived(buildAMBJsonLd(event, resource, pageUrl));
  // Pre-computed script tag to avoid ESLint parsing issues with template literals
  // Split closing tag to prevent parser from thinking script block is ending
  const jsonLdScriptTag = $derived(
    '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</' + 'script>'
  );

  // Content type detection
  // Check if d-tag (identifier) contains a URL - this means the resource itself IS an external link
  const hasIdentifierUrl = $derived(
    resource.identifier?.startsWith('http://') || resource.identifier?.startsWith('https://')
  );
  // Check if r-tags contain external reference URLs (for display)
  const hasExternalRefs = $derived(resource.externalUrls && resource.externalUrls.length > 0);
  const hasUploadedFiles = $derived(resource.encodings && resource.encodings.length > 0);
  const isNostrNativeOnly = $derived(hasUploadedFiles && !hasIdentifierUrl);

  /**
   * Navigate to content URL (from d-tag identifier)
   */
  function navigateToContent() {
    if (!resource.identifier) return;
    window.open(resource.identifier, '_blank', 'noopener,noreferrer');
  }

  /**
   * Format file size for display
   * @param {number} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Get file icon based on MIME type
   * @param {string} mimeType
   * @returns {string}
   */
  function getFileIcon(mimeType) {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return '📎';
  }
</script>

<svelte:head>
  <title>{resource.name} - {runtimeConfig.appName}</title>
  <meta
    name="description"
    content={resource.description || `Educational resource on ${runtimeConfig.appName}`}
  />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: JSON.stringify output -->
  {@html jsonLdScriptTag}
</svelte:head>

<article class="amb-resource-view mx-auto max-w-4xl">
  <!-- HEADER SECTION -->
  <header class="mb-6">
    <!-- Title -->
    <h1 class="mb-4 text-4xl font-bold text-base-content md:text-5xl">
      {resource.name}
    </h1>

    <!-- Learning Resource Type Badge (prominent) -->
    {#if localizedLearningResourceTypes.length > 0}
      <div class="mb-4 flex flex-wrap gap-2">
        {#each localizedLearningResourceTypes.slice(0, 2) as type (type.id)}
          <span class="badge badge-lg badge-primary"
            >{type.label}{#if type.fallbackLang}
              <span class="ml-1 text-xs opacity-60"
                >({getLanguageDisplayName(type.fallbackLang, getLocale())})</span
              >{/if}</span
          >
        {/each}
      </div>
    {/if}

    <!-- Description -->
    {#if resource.description}
      <MarkdownRenderer
        content={resource.description}
        class="prose prose-lg mb-6 max-w-none text-base-content/80"
      />
    {/if}

    <!-- Metadata bar -->
    <div class="flex flex-col gap-4 border-y border-base-300 py-4 md:flex-row md:items-center">
      <!-- Creator Info -->
      <div class="flex flex-1 items-center gap-3">
        {#if creators.length > 0}
          {@const firstCreator = creators[0]}
          {@const getCreatorProfile = useUserProfile(firstCreator.pubkey)}
          {@const creatorProfile = getCreatorProfile()}
          <div class="avatar">
            <div class="h-12 w-12 rounded-full">
              <img
                src={getProfilePicture(creatorProfile) ||
                  `https://robohash.org/${firstCreator.pubkey}`}
                alt={m.amb_resource_creator_alt()}
              />
            </div>
          </div>
          <div>
            <div class="font-semibold text-base-content">
              {getDisplayName(creatorProfile, firstCreator.pubkey.slice(0, 8) + '...')}
            </div>
            {#if creators.length > 1}
              <div class="text-sm text-base-content/60">
                {m.amb_resource_more_creators({ count: creators.length - 1 })}
              </div>
            {/if}
          </div>
        {:else if resource.creatorNames.length > 0}
          <!-- Fallback to name-only creators -->
          <div class="avatar">
            <div class="h-12 w-12 rounded-full">
              <img
                src={`https://robohash.org/${encodeURIComponent(resource.creatorNames[0])}`}
                alt={m.amb_resource_creator_alt()}
              />
            </div>
          </div>
          <div>
            <div class="font-semibold text-base-content">{resource.creatorNames[0]}</div>
            {#if resource.creatorNames.length > 1}
              <div class="text-sm text-base-content/60">
                +{resource.creatorNames.length - 1} more
              </div>
            {/if}
          </div>
        {/if}

        <!-- Published date -->
        {#if publishedAt}
          <div class="ml-auto text-sm text-base-content/60">
            {m.amb_resource_published({ date: formatCalendarDate(publishedAt, 'short') })}
          </div>
        {/if}
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2">
        {#if isOwner}
          <button
            class="btn btn-outline btn-sm"
            onclick={handleEditClick}
            aria-label={m.common_edit()}
          >
            <EditIcon class="h-4 w-4" />
            {m.common_edit()}
          </button>
          {#if formRef}
            <button
              class="btn btn-outline btn-sm"
              onclick={handleEditInFormClick}
              aria-label={m.amb_resource_edit_in_form()}
            >
              <EditIcon class="h-4 w-4" />
              {m.amb_resource_edit_in_form()}
            </button>
          {/if}
          <button
            class="btn btn-outline btn-sm btn-error"
            onclick={() => (showDeleteConfirmation = true)}
            aria-label={m.common_delete()}
          >
            <TrashIcon class="h-4 w-4" />
            {m.common_delete()}
          </button>
        {/if}
        <EventContextMenu {event} />
      </div>
    </div>
  </header>

  <!-- FEATURED IMAGE -->
  {#if resource.image}
    <div class="mb-8">
      <div class="aspect-[16/9] w-full overflow-hidden rounded-lg">
        <ImageWithFallback
          src={resource.image}
          alt={resource.name}
          fallbackType="article"
          size="hero"
          class="h-full w-full object-cover"
        />
      </div>
    </div>
  {/if}

  <!-- VIEW CONTENT CTA - Only show when d-tag identifier contains a URL -->
  {#if hasIdentifierUrl}
    <div class="mb-8 rounded-lg border-2 border-primary bg-primary/10 p-6">
      <h2 class="mb-3 text-xl font-bold text-base-content">
        {m.amb_resource_access_content_title()}
      </h2>
      <p class="mb-4 text-sm text-base-content/70">
        {m.amb_resource_access_content_external_desc()}
      </p>
      <button onclick={navigateToContent} class="btn btn-lg btn-primary">
        <!-- External link icon -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="mr-2 h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
        {m.amb_resource_open_content()}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="ml-2 h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <div class="mt-3 text-xs break-all text-base-content/60">
        {resource.identifier}
      </div>
    </div>
  {/if}

  <!-- EDUCATIONAL METADATA -->
  {#if hasEducationalMetadata}
    <div class="mb-8">
      <h2 class="mb-4 text-2xl font-bold text-base-content">
        {m.amb_resource_educational_details()}
      </h2>

      <div class="grid gap-6 md:grid-cols-2">
        <!-- Educational Levels -->
        {#if localizedEducationalLevels.length > 0}
          <div class="rounded-lg bg-base-200 p-4">
            <h3 class="mb-2 text-sm font-semibold text-base-content/70">
              {m.amb_resource_educational_level()}
            </h3>
            <div class="flex flex-wrap gap-2">
              {#each localizedEducationalLevels as level (level.id)}
                <span class="badge badge-secondary"
                  >{level.label}{#if level.fallbackLang}
                    <span class="ml-1 text-xs opacity-60"
                      >({getLanguageDisplayName(level.fallbackLang, getLocale())})</span
                    >{/if}</span
                >
              {/each}
            </div>
          </div>
        {/if}

        <!-- Subjects -->
        {#if localizedSubjects.length > 0}
          <div class="rounded-lg bg-base-200 p-4">
            <h3 class="mb-2 text-sm font-semibold text-base-content/70">
              {m.amb_resource_subjects()}
            </h3>
            <div class="flex flex-wrap gap-2">
              {#each localizedSubjects as subject (subject.id)}
                <span class="badge badge-outline"
                  >{subject.label}{#if subject.fallbackLang}
                    <span class="ml-1 text-xs opacity-60"
                      >({getLanguageDisplayName(subject.fallbackLang, getLocale())})</span
                    >{/if}</span
                >
              {/each}
            </div>
          </div>
        {/if}

        <!-- Languages -->
        {#if resource.languages.length > 0}
          <div class="rounded-lg bg-base-200 p-4">
            <h3 class="mb-2 text-sm font-semibold text-base-content/70">
              {m.amb_resource_available_languages()}
            </h3>
            <div class="flex flex-wrap gap-2">
              {#each resource.languages as lang (lang)}
                <span class="badge badge-ghost">{lang.toUpperCase()}</span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Free/Paid -->
        <div class="rounded-lg bg-base-200 p-4">
          <h3 class="mb-2 text-sm font-semibold text-base-content/70">{m.amb_resource_access()}</h3>
          <span class="badge {resource.isFree ? 'badge-success' : 'badge-warning'} badge-lg">
            {resource.isFree ? m.amb_resource_free() : m.amb_resource_paid()}
          </span>
        </div>
      </div>
    </div>
  {/if}

  <!-- LICENSE INFORMATION -->
  {#if resource.license}
    <div class="mb-8 rounded-lg border border-info bg-info/10 p-6">
      <h2 class="mb-3 text-xl font-bold text-base-content">{m.amb_resource_license()}</h2>
      <div class="flex items-center gap-4">
        <span class="badge badge-lg badge-info">{resource.license.label}</span>
        <!-- eslint-disable svelte/no-navigation-without-resolve -- external: license URL -->
        <a
          href={resource.license.id}
          target="_blank"
          rel="noopener noreferrer"
          class="link text-sm link-primary"
        >
          {m.amb_resource_view_license()}
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </div>
    </div>
  {/if}

  <!-- KEYWORDS/TAGS -->
  {#if resource.keywords.length > 0}
    <div class="mb-8">
      <h3 class="mb-3 text-lg font-semibold text-base-content">
        {m.amb_resource_topics_keywords()}
      </h3>
      <EventTags tags={resource.keywords} size="md" targetRoute="/discover" />
    </div>
  {/if}

  <!-- ALL CREATORS LIST -->
  {#if creators.length > 1 || resource.creatorNames.length > 1}
    <div class="mb-8">
      <h3 class="mb-3 text-lg font-semibold text-base-content">
        {m.amb_resource_all_contributors()}
      </h3>
      <div class="grid gap-3 md:grid-cols-2">
        {#each creators as creator (creator.pubkey)}
          {@const getCreatorProfile = useUserProfile(creator.pubkey)}
          {@const creatorProfile = getCreatorProfile()}
          <div class="flex items-center gap-3 rounded-lg bg-base-200 p-3">
            <div class="avatar">
              <div class="h-10 w-10 rounded-full">
                <img
                  src={getProfilePicture(creatorProfile) ||
                    `https://robohash.org/${creator.pubkey}`}
                  alt={m.amb_resource_creator_alt()}
                />
              </div>
            </div>
            <div class="flex-1">
              <div class="font-medium text-base-content">
                {getDisplayName(creatorProfile, creator.pubkey.slice(0, 8) + '...')}
              </div>
            </div>
          </div>
        {/each}

        {#each resource.creatorNames as name (name)}
          <div class="flex items-center gap-3 rounded-lg bg-base-200 p-3">
            <div class="avatar">
              <div class="h-10 w-10 rounded-full">
                <img src={`https://robohash.org/${encodeURIComponent(name)}`} alt="Creator" />
              </div>
            </div>
            <div class="font-medium text-base-content">{name}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- RELATED RESOURCES -->
  {#if relatedResources.length > 0}
    <div class="mb-8">
      <h3 class="mb-3 text-lg font-semibold text-base-content">
        {m.amb_resource_related_resources()}
      </h3>
      <div class="space-y-2">
        {#each relatedResources as related (related.naddr)}
          <a
            href={resolve(`/${related.naddr}`)}
            class="block rounded-lg bg-base-200 p-3 transition-colors hover:bg-base-300"
          >
            <div class="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 shrink-0 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
              <span class="font-medium text-base-content">{related.label}</span>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/if}

  <!-- UPLOADED FILES - Promoted for Nostr-native content -->
  {#if resource.encodings && resource.encodings.length > 0}
    <div
      class="mb-8 {isNostrNativeOnly ? 'rounded-lg border-2 border-primary bg-primary/10 p-6' : ''}"
    >
      <h3 class="mb-3 text-lg font-semibold text-base-content">
        {#if isNostrNativeOnly}
          {m.amb_resource_access_content_title()}
        {:else}
          {m.amb_resource_uploaded_files()}
        {/if}
      </h3>
      {#if isNostrNativeOnly}
        <p class="mb-4 text-sm text-base-content/70">
          {m.amb_resource_nostr_native_description()}
        </p>
      {/if}
      <div class="space-y-2">
        {#each resource.encodings as file (file.url)}
          <div class="flex items-center gap-3 rounded-lg bg-base-200 p-3">
            <span class="text-2xl">{getFileIcon(file.mimeType)}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-base-content">{file.name}</div>
              <div class="text-xs text-base-content/60">
                {file.mimeType} • {formatFileSize(file.size)}
              </div>
            </div>
            <!-- eslint-disable svelte/no-navigation-without-resolve -- external: uploaded file URLs -->
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-ghost btn-sm"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              {m.amb_resource_view_file()}
            </a>
            <a href={file.url} download class="btn btn-ghost btn-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {m.amb_resource_download_file()}
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- EXTERNAL REFERENCES (r-tags) - Additional reference URLs -->
  {#if hasExternalRefs}
    <div class="mb-8">
      <h3 class="mb-3 text-lg font-semibold text-base-content">
        {resource.externalUrls.length > 1
          ? m.amb_resource_external_references()
          : m.amb_resource_external_reference()}
      </h3>
      <div class="space-y-2">
        {#each resource.externalUrls as url (url)}
          <div class="flex items-center gap-3 rounded-lg bg-base-200 p-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5 flex-shrink-0 text-base-content/60"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            <!-- eslint-disable svelte/no-navigation-without-resolve -- external: reference URL -->
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              class="flex-1 link truncate link-primary"
            >
              {url}
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 flex-shrink-0 text-base-content/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- REACTIONS (Nostr-first: Primary interaction) -->
  <div class="mb-8 border-y border-base-300 py-4">
    <ReactionBar {event} />
  </div>

  <!-- COMMENTS SECTION (Nostr-first: Primary interaction) -->
  <div class="mt-8">
    <h2 class="mb-4 text-2xl font-bold text-base-content">{m.amb_resource_discussion()}</h2>
    <CommentList rootEvent={event} {activeUser} />
  </div>
</article>

<DeleteConfirmModal
  open={showDeleteConfirmation}
  title={m.common_delete() + '?'}
  itemName={resource.name}
  {isDeleting}
  onconfirm={handleDeleteResource}
  oncancel={() => (showDeleteConfirmation = false)}
/>
