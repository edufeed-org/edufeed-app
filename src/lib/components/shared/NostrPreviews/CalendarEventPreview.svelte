<!--
  CalendarEventPreview Component
  Displays a rich preview card for calendar events (kinds 31922/31923)
  Fetches the event and renders key details with a link to the full event page
-->

<script>
  import { resolve as _resolve } from '$app/paths';
  /** @type {(path: string) => string} */
  const resolve = /** @type {any} */ (_resolve);
  import { fetchEventById } from '$lib/helpers/nostrUtils.js';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { CalendarIcon, ClockIcon } from '$lib/components/icons';
  import LocationLink from '../LocationLink.svelte';
  import { CopyIcon } from '$lib/components/icons';
  import { getCalendarEventStart, getCalendarEventEnd } from 'applesauce-common/helpers';
  import MarkdownRenderer from '../MarkdownRenderer.svelte';
  import InlineRsvp from '$lib/components/calendar/InlineRsvp.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';

  let { identifier, decoded: _decoded, inline: _inline = false } = $props();

  const getActiveUser = useActiveUser();
  let activeUser = $derived(getActiveUser());

  /** @type {any} */
  let event = $state(null);
  let isLoading = $state(true);
  let error = $state('');

  $effect(() => {
    isLoading = true;
    error = '';

    fetchEventById(identifier)
      .then((rawEvent) => {
        if (rawEvent) {
          // Parse event tags to extract metadata
          const titleTag = rawEvent.tags.find((t) => t[0] === 'name' || t[0] === 'title');
          const summaryTag = rawEvent.tags.find(
            (t) => t[0] === 'summary' || t[0] === 'description'
          );
          const imageTag = rawEvent.tags.find((t) => t[0] === 'image');
          const locationTags = rawEvent.tags.filter((t) => t[0] === 'location');

          /** @type {import('$lib/types/calendar.js').CalendarEvent} */
          const parsedEvent = {
            id: rawEvent.id,
            pubkey: rawEvent.pubkey,
            kind: /** @type {import('$lib/types/calendar.js').CalendarEventKind} */ (rawEvent.kind),
            title: titleTag?.[1] || 'Untitled Event',
            summary: summaryTag?.[1] || '',
            image: imageTag?.[1] || '',
            start: getCalendarEventStart(rawEvent) || 0,
            end: getCalendarEventEnd(rawEvent) || 0,
            location: locationTags.map((t) => t[1]).join(', '),
            participants: [],
            hashtags: [],
            references: [],
            eventReferences: [],
            communityPubkey: '',
            createdAt: rawEvent.created_at,
            originalEvent: rawEvent
          };
          event = parsedEvent;
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
  let eventUrl = $derived(resolve(`/calendar/event/${identifier}`));
  /** @type {Date | null} */
  let startDate = $derived(event?.start ? new Date(event.start * 1000) : null);
  /** @type {Date | null} */
  let endDate = $derived(event?.end ? new Date(event.end * 1000) : null);
  /** @type {boolean} */
  let isAllDay = $derived(event?.kind === 31922);
  /** @type {string} */
  let locationString = $derived(event?.location || '');

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
    class="card my-2 block border-l-4 border-l-primary bg-base-200 no-underline transition-colors hover:bg-base-300"
  >
    <div class="card-body p-4">
      <div class="flex items-start gap-3">
        {#if event.image}
          <img
            src={event.image}
            alt={event.title}
            class="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
          />
        {/if}

        <div class="min-w-0 flex-1">
          <h3 class="mb-2 card-title text-base text-base-content">{event.title}</h3>

          <div class="flex flex-col gap-1 text-sm text-base-content/70">
            {#if startDate}
              <div class="flex items-center gap-2">
                <CalendarIcon class_="w-4 h-4 flex-shrink-0" />
                <span>{formatCalendarDate(startDate, 'short')}</span>
              </div>
            {/if}

            {#if !isAllDay && startDate}
              <div class="flex items-center gap-2">
                <ClockIcon class_="w-4 h-4 flex-shrink-0" />
                <span>
                  {formatCalendarDate(startDate, 'time')}
                  {#if endDate}
                    - {formatCalendarDate(endDate, 'time')}
                  {/if}
                </span>
              </div>
            {/if}

            {#if locationString}
              <div class="flex items-center gap-2">
                <span>📍</span>
                <LocationLink location={locationString} />
              </div>
            {/if}
          </div>

          {#if event.summary}
            <MarkdownRenderer
              content={event.summary}
              class="mt-2 line-clamp-2 text-sm text-base-content/60"
            />
          {/if}
        </div>
      </div>

      <div class="mt-2 card-actions justify-end">
        <div class="badge badge-sm badge-primary">Calendar Event</div>
      </div>
    </div>
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->

  {#if !_inline && activeUser && event.originalEvent}
    <div class="-mt-1 mb-2 pl-1">
      <InlineRsvp calendarEvent={event.originalEvent} size="sm" compact={true} />
    </div>
  {/if}
{/if}
