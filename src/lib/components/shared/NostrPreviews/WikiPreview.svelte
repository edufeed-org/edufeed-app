<!--
  WikiPreview Component
  Displays a rich preview card for wiki events (kind 30818 / NIP-54)
  Fetches the event and renders title, summary, and topic with a link to the full page
-->

<script>
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { CopyIcon } from '$lib/components/icons';

  let { identifier, decoded: _decoded, inline: _inline = false } = $props();

  /** @type {any} */
  let event = $state(null);
  let isLoading = $state(true);
  let error = $state('');

  /** @type {string} */
  let title = $state('');
  /** @type {string} */
  let summary = $state('');
  /** @type {string} */
  let topic = $state('');

  $effect(() => {
    isLoading = true;
    error = '';

    fetchEventById(identifier)
      .then((rawEvent) => {
        if (rawEvent) {
          event = rawEvent;
          const titleTag = rawEvent.tags.find((/** @type {any} */ t) => t[0] === 'title');
          const dTag = rawEvent.tags.find((/** @type {any} */ t) => t[0] === 'd');
          const summaryTag = rawEvent.tags.find((/** @type {any} */ t) => t[0] === 'summary');

          title = titleTag?.[1] || dTag?.[1] || 'Untitled Wiki';
          summary = summaryTag?.[1] || '';
          topic = dTag?.[1] || '';
        } else {
          error = 'Event not found';
        }
      })
      .catch((err) => {
        error = err.message || 'Failed to load event';
      })
      .finally(() => {
        isLoading = false;
      });
  });

  /** @type {string} */
  let eventUrl = $derived(resolve(`/${identifier}`));

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
    class="card my-2 block border-l-4 border-l-secondary bg-base-200 no-underline shadow-md transition-all hover:bg-base-300 hover:shadow-lg"
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
{/if}
