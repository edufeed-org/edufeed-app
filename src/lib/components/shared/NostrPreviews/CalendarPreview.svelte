<!--
  CalendarPreview Component
  Displays a rich preview card for calendars (kind 31924)
  Fetches the calendar and renders key details with a link to the full calendar page
-->

<script>
  import { resolve } from '$app/paths';
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { CalendarIcon } from '$lib/components/icons';
  import { CopyIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';

  let { identifier, decoded: _decoded, inline: _inline = false } = $props();

  /** @type {{name: string, description: string, image: string | null, eventCount: number} | null} */
  let calendar = $state(null);
  let isLoading = $state(true);
  let error = $state('');

  $effect(() => {
    isLoading = true;
    error = '';

    fetchEventById(identifier)
      .then((rawEvent) => {
        if (rawEvent && rawEvent.kind === 31924) {
          // Parse calendar metadata from tags
          const dTag = rawEvent.tags.find((t) => t[0] === 'd')?.[1] || 'untitled';
          const descriptionTag = rawEvent.tags.find((t) => t[0] === 'description');
          const imageTag = rawEvent.tags.find((t) => t[0] === 'image');
          const eventRefs = rawEvent.tags.filter((t) => t[0] === 'a');

          calendar = {
            name: dTag,
            description: descriptionTag?.[1] || '',
            image: imageTag?.[1] || null,
            eventCount: eventRefs.length
          };
        } else {
          error = 'Calendar not found';
        }
      })
      .catch((err) => {
        error = err.message || 'Failed to load calendar';
      })
      .finally(() => {
        isLoading = false;
      });
  });

  /** @type {string} */
  let calendarUrl = $derived(resolve(`/calendar/${identifier}`));

  function copyIdentifier() {
    navigator.clipboard.writeText(identifier);
  }
</script>

{#if isLoading}
  <div class="my-2 h-20 w-full skeleton rounded-lg"></div>
{:else if error}
  <div class="my-2 alert text-sm alert-error">
    <div class="flex w-full items-center justify-between">
      <span>⚠️ {error}</span>
      <button class="btn btn-ghost btn-xs" onclick={copyIdentifier} title="Copy identifier">
        <CopyIcon class_="w-3 h-3" />
      </button>
    </div>
  </div>
{:else if calendar}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- internal: already resolved via resolve() -->
  <a
    href={calendarUrl}
    class="card my-2 block bg-base-200 no-underline transition-colors hover:bg-base-300"
  >
    <div class="card-body p-4">
      <div class="flex items-center gap-3">
        {#if calendar.image}
          <ImageWithFallback
            src={calendar.image}
            alt={calendar.name}
            fallbackType="event"
            class="h-12 w-12 rounded-lg object-cover"
          />
        {:else}
          <div
            class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10"
          >
            <CalendarIcon class_="w-6 h-6 text-primary" />
          </div>
        {/if}

        <div class="min-w-0 flex-1">
          <h3 class="font-semibold text-base-content">{calendar.name}</h3>
          {#if calendar.description}
            <p class="line-clamp-1 text-sm text-base-content/60">
              {calendar.description}
            </p>
          {/if}
          <p class="mt-1 text-xs text-base-content/50">
            {calendar.eventCount} event{calendar.eventCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div class="card-actions justify-end">
        <div class="badge badge-sm badge-secondary">Calendar</div>
      </div>
    </div>
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}
