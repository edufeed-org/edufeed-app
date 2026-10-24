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
  import { useReferencedEvent } from '$lib/stores/referenced-event.svelte.js';
  import { decodeNostrIdentifier } from '$lib/helpers/nostrUtils.js';
  import FallbackIdentifier from './FallbackIdentifier.svelte';
  import { getTagValue, getLabelsWithFallback } from '$lib/helpers/educational/ambTransform.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import ResourceCover from '$lib/components/educational/ResourceCover.svelte';

  let {
    identifier,
    decoded = decodeNostrIdentifier(identifier),
    inline: _inline = false
  } = $props();

  // Store first: the referenced resource from the EventStore, loaded on a
  // miss and upgraded when it arrives late (see referenced-event.svelte.js).
  const ref = useReferencedEvent(() => decoded);
  const event = $derived(ref.event);
  const isLoading = $derived(ref.isLoading);
  const tags = $derived(event?.tags || []);
  const identifierDTag = $derived(getTagValue(tags, 'd') || '');
  const title = $derived(
    event ? getTagValue(tags, 'name') || identifierDTag || 'Untitled Resource' : ''
  );
  const summary = $derived(getTagValue(tags, 'description') || '');
  const image = $derived(getTagValue(tags, 'image'));
  // Every learningResourceType label (AMB flattens them as
  // `learningResourceType:prefLabel:<lang>`, one tag per type).
  const resourceTypes = $derived(
    getLabelsWithFallback(tags, 'learningResourceType', getLocale())
      .map((t) => t.label)
      .filter(Boolean)
  );

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
</script>

{#if isLoading}
  <div class="my-2 h-24 w-full skeleton rounded-lg"></div>
{:else if event}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- internal: already resolved via resolve() -->
  <a
    href={eventUrl}
    class="card my-2 block border-l-4 border-l-accent bg-base-200 no-underline transition-colors hover:bg-base-300"
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
          {#each resourceTypes as resourceType, i (i)}
            <div class="badge badge-outline badge-sm">{resourceType}</div>
          {/each}
          <div class="badge badge-sm badge-accent">Resource</div>
        </div>
      </div>
    </div>
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
  <!-- Not (yet) available: a plain badge, never an error — the store subscription
       keeps listening and the card appears if the event arrives later -->
  <FallbackIdentifier {identifier} {decoded} />
{/if}
