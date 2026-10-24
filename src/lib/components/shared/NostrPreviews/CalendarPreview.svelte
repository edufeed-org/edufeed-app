<!--
  CalendarPreview Component
  Displays a rich preview card for calendars (kind 31924)
  Fetches the calendar and renders key details with a link to the full calendar page
-->

<script>
  import { resolve } from '$app/paths';
  import { useReferencedEvent } from '$lib/stores/referenced-event.svelte.js';
  import { decodeNostrIdentifier } from '$lib/helpers/nostrUtils.js';
  import FallbackIdentifier from './FallbackIdentifier.svelte';
  import { CalendarIcon } from '$lib/components/icons';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';

  let {
    identifier,
    decoded = decodeNostrIdentifier(identifier),
    inline: _inline = false
  } = $props();

  // Store first: the referenced calendar (kind 31924) from the EventStore,
  // loaded on a miss and upgraded when it arrives late.
  const ref = useReferencedEvent(() => decoded);
  const isLoading = $derived(ref.isLoading);
  /** @type {{name: string, description: string, image: string | null, eventCount: number} | null} */
  const calendar = $derived.by(() => {
    const rawEvent = ref.event;
    if (!rawEvent || rawEvent.kind !== 31924) return null;
    return {
      name: rawEvent.tags.find((/** @type {any} */ t) => t[0] === 'd')?.[1] || 'untitled',
      description: rawEvent.tags.find((/** @type {any} */ t) => t[0] === 'description')?.[1] || '',
      image: rawEvent.tags.find((/** @type {any} */ t) => t[0] === 'image')?.[1] || null,
      eventCount: rawEvent.tags.filter((/** @type {any} */ t) => t[0] === 'a').length
    };
  });

  /** @type {string} */
  let calendarUrl = $derived(resolve(`/calendar/${identifier}`));
</script>

{#if isLoading}
  <div class="my-2 h-20 w-full skeleton rounded-lg"></div>
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
{:else}
  <!-- Not (yet) available: a plain badge, never an error — the store subscription
       keeps listening and the card appears if the event arrives later -->
  <FallbackIdentifier {identifier} {decoded} />
{/if}
