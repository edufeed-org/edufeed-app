<!--
  WikiPreview Component
  Displays a rich preview card for wiki events (kind 30818 / NIP-54)
  Fetches the event and renders title, summary, and topic with a link to the full page
-->

<script>
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { useReferencedEvent } from '$lib/stores/referenced-event.svelte.js';
  import { decodeNostrIdentifier } from '$lib/helpers/nostrUtils.js';
  import FallbackIdentifier from './FallbackIdentifier.svelte';

  let {
    identifier,
    decoded = decodeNostrIdentifier(identifier),
    inline: _inline = false
  } = $props();

  // Store first: the referenced wiki page from the EventStore, loaded on a
  // miss and upgraded when it arrives late (see referenced-event.svelte.js).
  const ref = useReferencedEvent(() => decoded);
  const event = $derived(ref.event);
  const isLoading = $derived(ref.isLoading);
  /** @param {string} name */
  const tag = (name) => event?.tags.find((/** @type {any} */ t) => t[0] === name)?.[1];
  const topic = $derived(tag('d') || '');
  const title = $derived(event ? tag('title') || topic || 'Untitled Wiki' : '');
  const summary = $derived(tag('summary') || '');

  /** @type {string} */
  let eventUrl = $derived(resolve(`/${identifier}`));
</script>

{#if isLoading}
  <div class="my-2 h-24 w-full skeleton rounded-lg"></div>
{:else if event}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- internal: already resolved via resolve() -->
  <a
    href={eventUrl}
    class="card my-2 block border-l-4 border-l-secondary bg-base-200 no-underline transition-colors hover:bg-base-300"
  >
    <div class="card-body p-4">
      <div class="min-w-0">
        <h3 class="mb-2 card-title text-base text-base-content">{title}</h3>

        {#if summary}
          <p class="line-clamp-2 text-sm text-base-content/60">{summary}</p>
        {/if}
      </div>

      <div class="mt-2 card-actions justify-end">
        {#if topic}
          <div class="badge badge-outline badge-sm">{topic}</div>
        {/if}
        <div class="badge badge-sm badge-secondary">Wiki</div>
      </div>
    </div>
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
  <!-- Not (yet) available: a plain badge, never an error — the store subscription
       keeps listening and the card appears if the event arrives later -->
  <FallbackIdentifier {identifier} {decoded} />
{/if}
