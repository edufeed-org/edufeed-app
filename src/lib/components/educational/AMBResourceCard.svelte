<!--
  AMBResourceCard Component
  Displays AMB educational resource preview in card format for feed views
-->

<script>
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import BookmarkButton from '../bookmarks/BookmarkButton.svelte';
  import EventTags from '../calendar/EventTags.svelte';
  import EventDebugPanel from '../shared/EventDebugPanel.svelte';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import {
    getLabelsWithFallback,
    getLanguageDisplayName
  } from '$lib/helpers/educational/ambTransform.js';
  import { getCachedConcepts, ensureVocabularyLoaded } from '$lib/stores/skos-cache.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import * as m from '$lib/paraglide/messages.js';
  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { RepliesModel } from 'applesauce-common/models';
  import { ChatIcon } from '$lib/components/icons';
  import ResourceCover from './ResourceCover.svelte';

  // Trigger SKOS vocabulary loading for label resolution
  ensureVocabularyLoaded('learningResourceType');
  ensureVocabularyLoaded('about');

  // Helper to determine if identifier is a nostr URI
  /**
   * @param {string|null|undefined} identifier
   */
  function isNostrUri(identifier) {
    return identifier?.startsWith('nostr:') || identifier?.startsWith('naddr1');
  }

  /**
   * @typedef {Object} Props
   * @property {any} resource - Formatted AMB resource object
   * @property {any} [authorProfile] - Author's profile
   * @property {boolean} [compact=false] - Compact display mode
   * @property {'card'|'list'} [variant='card'] - Display variant
   * @property {string} [communityNpub] - Community npub for route construction
   * @property {boolean} [preview=false] - Preview mode: non-interactive, no bookmark/reactions/debug
   */

  /** @type {Props} */
  let {
    resource,
    authorProfile = null,
    compact = false,
    variant = 'card',
    communityNpub = undefined,
    preview = false
  } = $props();

  const isList = $derived(variant === 'list');

  // Get author info
  const authorName = $derived(getDisplayName(authorProfile, resource.pubkey.slice(0, 8) + '...'));

  // Get published date
  const publishedAt = $derived(new Date(resource.publishedDate * 1000));

  // Reactive SKOS concepts for URI-to-label resolution
  const resourceTypeConcepts = $derived(getCachedConcepts('learningResourceType'));
  const aboutConcepts = $derived(getCachedConcepts('about'));

  // Language-aware labels - reactive to locale changes and SKOS cache!
  // Fallback chain: user's language → English → SKOS concept → URI label
  const localizedLearningResourceTypes = $derived(
    getLabelsWithFallback(resource.tags, 'learningResourceType', getLocale(), resourceTypeConcepts)
  );
  const localizedSubjects = $derived(
    getLabelsWithFallback(resource.tags, 'about', getLocale(), aboutConcepts)
  );
  const localizedEducationalLevels = $derived(
    getLabelsWithFallback(resource.tags, 'educationalLevel', getLocale())
  );

  // Generate naddr for navigation to detail view with relay hints
  const resourceNaddr = $derived.by(() => {
    // Get relay hints from resource's seen relays or use AMB relays from config
    const relayHints = resource.event?.seen_on
      ? Array.from(resource.event.seen_on).slice(0, 3)
      : runtimeConfig.appRelays.educational.slice(0, 3);

    return nip19.naddrEncode({
      kind: resource.kind,
      pubkey: resource.pubkey,
      identifier: resource.identifier,
      relays: relayHints.length > 0 ? relayHints : undefined
    });
  });

  let commentCount = $state(0);

  // Subscribe to RepliesModel for cached comment counts (no relay fetching).
  // Detail view handles relay fetching when the user navigates to the resource.
  $effect(() => {
    const rawEvent = resource?.rawEvent;
    if (!rawEvent?.id) return;

    const modelSub = eventStore.model(RepliesModel, rawEvent).subscribe((replies) => {
      commentCount = (replies || []).length;
    });

    return () => modelSub.unsubscribe();
  });

  // Content type detection - only show "Open Content" for valid external URLs or nostr URIs
  const hasExternalUrl = $derived(
    resource.identifier?.startsWith('http://') || resource.identifier?.startsWith('https://')
  );
  const shouldShowOpenContentButton = $derived(hasExternalUrl || isNostrUri(resource.identifier));

  /**
   * Build the resolved route for this resource.
   * @returns {string | null}
   */
  function getResourceHref() {
    if (!resourceNaddr) return null;
    if (communityNpub) return resolve(`/c/${communityNpub}/r/${resourceNaddr}`);
    return resolve(`/${resourceNaddr}`);
  }

  /**
   * Navigate to resource detail view
   */
  function navigateToDetail() {
    const href = getResourceHref();
    if (href) goto(href);
  }

  /**
   * Navigate to content - handles both nostr identifiers and external URLs
   */
  function openContent() {
    if (!resource.identifier) return;

    if (isNostrUri(resource.identifier)) {
      // Handle nostr identifiers - strip 'nostr:' prefix if present
      const naddr = resource.identifier.replace(/^nostr:/, '');
      goto(resolve(`/${naddr}`));
    } else {
      // External URL - open in new tab
      window.open(resource.identifier, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Handle keyboard navigation
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigateToDetail();
    }
  }
</script>

{#if isList}
  <!-- List variant: horizontal row -->
  <div
    class="amb-card-list focus:ring-opacity-50 relative flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 bg-base-100 p-3 transition-shadow hover:shadow-sm focus:ring-2 focus:ring-primary focus:outline-none"
    role="button"
    tabindex="0"
    onclick={navigateToDetail}
    onkeydown={handleKeydown}
  >
    {#if resource.rawEvent}
      <div
        class="absolute top-1 right-1"
        role="toolbar"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <BookmarkButton event={resource.rawEvent} />
      </div>
    {/if}
    <ResourceCover
      {resource}
      size="thumbnail"
      aspect="square"
      class="h-16 w-16 flex-shrink-0 sm:h-20 sm:w-20"
    />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate font-semibold text-base-content">{resource.name}</span>
        {#if localizedLearningResourceTypes.length > 0}
          <span class="badge flex-shrink-0 badge-xs badge-primary"
            >{localizedLearningResourceTypes[0]
              .label}{#if localizedLearningResourceTypes[0].fallbackLang}
              ({getLanguageDisplayName(
                localizedLearningResourceTypes[0].fallbackLang,
                getLocale()
              )}){/if}</span
          >
        {/if}
      </div>
      <div class="truncate text-sm text-base-content/60">
        {authorName} · {formatCalendarDate(publishedAt, 'short')}
        {#if resource.license}
          · {resource.license.label}
        {/if}
      </div>
      {#if resource.description}
        <div class="hidden text-sm text-base-content/50 sm:line-clamp-2 sm:block">
          {resource.description}
        </div>
      {/if}
      <!-- Metadata badges -->
      {#if localizedEducationalLevels.length > 0 || resource.isFree || resource.languages.length > 0}
        <div class="mt-1 flex flex-wrap gap-1">
          {#if localizedEducationalLevels.length > 0}
            <span class="badge badge-xs badge-secondary">{localizedEducationalLevels[0].label}</span
            >
          {/if}
          {#if resource.isFree}
            <span class="badge badge-xs badge-success">{m.amb_resource_free()}</span>
          {/if}
          {#each resource.languages.slice(0, 2) as lang (lang)}
            <span class="badge badge-ghost badge-xs">{lang.toUpperCase()}</span>
          {/each}
        </div>
      {/if}
      <!-- Subject tags (desktop only) -->
      {#if localizedSubjects.length > 0}
        <div class="mt-1 hidden flex-wrap gap-1 sm:flex">
          {#each localizedSubjects.slice(0, 3) as subject (subject.id)}
            <span class="rounded bg-base-200 px-1.5 py-0.5 text-xs text-base-content/60"
              >{subject.label}{#if subject.fallbackLang}
                ({getLanguageDisplayName(subject.fallbackLang, getLocale())}){/if}</span
            >
          {/each}
          {#if localizedSubjects.length > 3}
            <span class="rounded bg-base-200 px-1.5 py-0.5 text-xs text-base-content/60"
              >+{localizedSubjects.length - 3}</span
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>
{:else}
  <div
    class="amb-card rounded-lg border border-base-300 bg-base-100 shadow-sm {preview
      ? ''
      : 'cursor-pointer transition-shadow hover:shadow-md'} {compact ? 'p-3' : 'p-4'}"
    class:focus:outline-none={!preview}
    class:focus:ring-2={!preview}
    class:focus:ring-primary={!preview}
    class:focus:ring-opacity-50={!preview}
    role={preview ? undefined : 'button'}
    tabindex={preview ? undefined : 0}
    onclick={preview ? undefined : navigateToDetail}
    onkeydown={preview ? undefined : handleKeydown}
  >
    <!-- Author Header -->
    <div class="mb-3 flex items-center gap-3">
      <ProfileAvatar
        pubkey={resource.pubkey}
        profile={authorProfile}
        size="md"
        linkToProfile
        showHoverCard
        fallbackType="robohash"
      />
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium text-base-content">{authorName}</div>
        <div class="text-sm text-base-content/60">
          {formatCalendarDate(publishedAt, 'short')}
        </div>
      </div>
      <!-- Resource Type Badge -->
      {#if localizedLearningResourceTypes.length > 0}
        <div class="badge badge-sm badge-primary">
          {localizedLearningResourceTypes[0]
            .label}{#if localizedLearningResourceTypes[0].fallbackLang}
            ({getLanguageDisplayName(
              localizedLearningResourceTypes[0].fallbackLang,
              getLocale()
            )}){/if}
        </div>
      {/if}
    </div>

    <!-- Resource cover — image at 2:1 when present, typo cover at 3:4 (capped) when absent. -->
    {#if !compact}
      <div class="mb-3">
        <ResourceCover {resource} size="full" aspect="wide" />
      </div>
    {/if}

    <!-- Resource Content -->
    <div class="space-y-2">
      <!-- Title with License Badge -->
      <div class="flex items-start gap-2">
        <h2
          class="line-clamp-2 flex-1 text-xl font-bold text-base-content {compact ? 'text-lg' : ''}"
        >
          {resource.name}
        </h2>
        {#if resource.license}
          <!-- eslint-disable svelte/no-navigation-without-resolve -- external: license URL -->
          <a
            href={resource.license.id}
            target="_blank"
            rel="noopener noreferrer"
            class="badge shrink-0 badge-outline badge-sm"
            title={resource.license.label}
            onclick={(e) => {
              e.stopPropagation();
            }}
          >
            {resource.license.label}
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        {/if}
      </div>

      <!-- Description -->
      {#if resource.description && !compact}
        <MarkdownRenderer
          content={resource.description}
          class="line-clamp-3 text-sm text-base-content/70"
        />
      {/if}

      <!-- Metadata Badges -->
      {#if !compact}
        <div class="flex flex-wrap gap-2">
          <!-- Educational Level -->
          {#if localizedEducationalLevels.length > 0}
            <div class="badge badge-sm badge-secondary">
              {localizedEducationalLevels[0].label}
            </div>
          {/if}

          <!-- Free/Paid Indicator -->
          {#if resource.isFree}
            <div class="badge badge-sm badge-success">{m.amb_resource_free()}</div>
          {/if}

          <!-- Languages -->
          {#each resource.languages.slice(0, 2) as lang (lang)}
            <div class="badge badge-ghost badge-sm">{lang.toUpperCase()}</div>
          {/each}
        </div>
      {/if}

      <!-- Subjects/Topics -->
      {#if localizedSubjects.length > 0 && !compact}
        <div class="flex flex-wrap gap-1">
          {#each localizedSubjects.slice(0, 3) as subject (subject.id)}
            <span class="rounded bg-base-200 px-2 py-1 text-xs text-base-content/60">
              {subject.label}{#if subject.fallbackLang}
                ({getLanguageDisplayName(subject.fallbackLang, getLocale())}){/if}
            </span>
          {/each}
          {#if localizedSubjects.length > 3}
            <span class="rounded bg-base-200 px-2 py-1 text-xs text-base-content/60">
              +{localizedSubjects.length - 3} more
            </span>
          {/if}
        </div>
      {/if}

      <!-- Keywords (Tags) -->
      {#if resource.keywords.length > 0 && !compact}
        <div class="flex flex-wrap gap-1">
          <EventTags tags={resource.keywords.slice(0, 5)} size="sm" targetRoute="/discover" />
        </div>
      {/if}

      <!-- Action Button - Only show for external URLs or nostr URIs -->
      {#if shouldShowOpenContentButton}
        <div class="pt-2">
          <button
            class="btn btn-sm btn-primary"
            onclick={(e) => {
              e.stopPropagation();
              openContent();
            }}
          >
            {#if isNostrUri(resource.identifier)}
              <!-- Play/View icon for internal content -->
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
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {m.amb_resource_view_content()}
            {:else}
              <!-- External link icon -->
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
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              {m.amb_resource_open_content()}
            {/if}
          </button>
        </div>
      {/if}

      <!-- Reactions & Comments -->
      {#if !compact && !preview && resource.rawEvent}
        <div
          class="flex items-center gap-2 pt-2"
          role="toolbar"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          {#if commentCount > 0}
            <span class="flex items-center gap-1 text-sm text-base-content/60">
              <ChatIcon class_="w-4 h-4" />
              {commentCount}
            </span>
          {/if}
          <ReactionBar event={resource.rawEvent} />
          <BookmarkButton event={resource.rawEvent} />
        </div>
      {/if}

      <!-- Debug Panel -->
      {#if !compact && !preview}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div data-testid="amb-debug-wrapper" onclick={(e) => e.stopPropagation()}>
          <EventDebugPanel event={resource} />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .amb-card {
    display: flex;
    flex-direction: column;
  }
</style>
