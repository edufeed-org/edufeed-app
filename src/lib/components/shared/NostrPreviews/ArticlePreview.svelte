<!--
  ArticlePreview Component
  Displays a rich preview card for long-form articles (kind 30023 / NIP-23)
  Fetches the event and renders title, summary, and a thumbnail image with a
  link to the full article page. Mirrors WikiPreview's structure.
-->

<script>
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { useReferencedEvent } from '$lib/stores/referenced-event.svelte.js';
  import { decodeNostrIdentifier } from '$lib/helpers/nostrUtils.js';
  import FallbackIdentifier from './FallbackIdentifier.svelte';
  import { getArticleTitle, getArticleSummary, getArticleImage } from 'applesauce-common/helpers';
  import ImageWithFallback from '../ImageWithFallback.svelte';

  let {
    identifier,
    decoded = decodeNostrIdentifier(identifier),
    inline: _inline = false
  } = $props();

  // Store first: the referenced article from the EventStore, loaded on a miss
  // and upgraded when it arrives late (see referenced-event.svelte.js).
  const ref = useReferencedEvent(() => decoded);
  const event = $derived(ref.event);
  const isLoading = $derived(ref.isLoading);
  const title = $derived(event ? getArticleTitle(event) || 'Untitled Article' : '');
  const summary = $derived(event ? getArticleSummary(event) || '' : '');
  const image = $derived(event ? getArticleImage(event) : undefined);

  /** @type {string} */
  let eventUrl = $derived(resolve(`/${identifier}`));
</script>

{#if isLoading}
  <div class="my-2 h-24 w-full skeleton rounded-lg"></div>
{:else if event}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- internal: already resolved via resolve() -->
  <a
    href={eventUrl}
    class="card my-2 block border-l-4 border-l-primary bg-base-200 no-underline transition-colors hover:bg-base-300"
  >
    <div class="card-body flex-row gap-3 p-4">
      {#if image}
        <div class="h-16 w-16 flex-shrink-0 overflow-hidden rounded bg-base-300 sm:h-20 sm:w-20">
          <ImageWithFallback
            src={image}
            alt={title}
            fallbackType="article"
            size="thumbnail"
            class="h-full w-full object-cover"
          />
        </div>
      {/if}
      <div class="min-w-0 flex-1">
        <h3 class="mb-1 card-title text-base text-base-content">{title}</h3>
        {#if summary}
          <p class="line-clamp-2 text-sm text-base-content/60">{summary}</p>
        {/if}
        <div class="mt-2">
          <div class="badge badge-sm badge-primary">Article</div>
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
