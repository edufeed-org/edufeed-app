<!--
  AMBResourcePreview Component
  Displays a rich preview card for AMB educational resources (kind 30142).
  Fetches the event, extracts the AMB-flattened metadata (name, description,
  image, learningResourceType label), and links to the resource detail page.
  Mirrors WikiPreview's structure.
-->

<script>
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { getTagValue, getNestedTagValues } from '$lib/helpers/educational/ambTransform.js';
  import { CopyIcon } from '$lib/components/icons';
  import ResourceCover from '$lib/components/educational/ResourceCover.svelte';

  let { identifier, decoded: _decoded, inline: _inline = false } = $props();

  /** @type {any} */
  let event = $state(null);
  let isLoading = $state(true);
  let error = $state('');

  /** @type {string} */
  let title = $state('');
  /** @type {string} */
  let summary = $state('');
  /** @type {string | null} */
  let image = $state(null);
  /** @type {string} */
  let resourceType = $state('');
  /** @type {string} */
  let identifierDTag = $state('');

  $effect(() => {
    isLoading = true;
    error = '';

    fetchEventById(identifier)
      .then((rawEvent) => {
        if (rawEvent) {
          event = rawEvent;
          const tags = rawEvent.tags || [];
          title = getTagValue(tags, 'name') || getTagValue(tags, 'd') || 'Untitled Resource';
          summary = getTagValue(tags, 'description') || '';
          image = getTagValue(tags, 'image');
          identifierDTag = getTagValue(tags, 'd') || '';
          // Pick the first learningResourceType prefLabel if present
          const types = getNestedTagValues(tags, 'learningResourceType:0:prefLabel');
          resourceType = types[0] || '';
        } else {
          error = 'Resource not found';
        }
      })
      .catch((err) => {
        error = err.message || 'Failed to load resource';
      })
      .finally(() => {
        isLoading = false;
      });
  });

  /** @type {string} */
  let eventUrl = $derived(resolve(`/${identifier}`));

  /**
   * Minimal AMB resource shape ResourceCover consumes. Only the fields it
   * actually reads — image, name, identifier, tags, pubkey.
   */
  let previewResource = $derived({
    image,
    name: title,
    identifier: identifierDTag,
    tags: event?.tags ?? [],
    pubkey: event?.pubkey ?? ''
  });

  function copyIdentifier() {
    navigator.clipboard.writeText(identifier);
  }
</script>

{#if isLoading}
  <div class="my-2 h-24 w-full skeleton rounded-lg"></div>
{:else if error}
  <div class="my-2 alert text-sm alert-error">
    <div class="flex w-full items-center justify-between">
      <span>⚠️ {error}</span>
      <button class="btn btn-ghost btn-xs" onclick={copyIdentifier} title="Copy identifier">
        <CopyIcon class_="w-3 h-3" />
      </button>
    </div>
  </div>
{:else if event}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- internal: already resolved via resolve() -->
  <a
    href={eventUrl}
    class="card my-2 block border-l-4 border-l-accent bg-base-200 no-underline shadow-md transition-all hover:bg-base-300 hover:shadow-lg"
  >
    <div class="card-body flex-row gap-3 p-4">
      <ResourceCover
        resource={previewResource}
        size="thumbnail"
        aspect="square"
        class="h-16 w-16 flex-shrink-0 sm:h-20 sm:w-20"
      />
      <div class="min-w-0 flex-1">
        <h3 class="mb-1 card-title text-base text-base-content">{title}</h3>
        {#if summary}
          <p class="line-clamp-2 text-sm text-base-content/60">{summary}</p>
        {/if}
        <div class="mt-2 flex flex-wrap gap-1">
          {#if resourceType}
            <div class="badge badge-outline badge-sm">{resourceType}</div>
          {/if}
          <div class="badge badge-sm badge-accent">Resource</div>
        </div>
      </div>
    </div>
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}
