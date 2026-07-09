<!--
  RichFeedEntry — renders a feed event with its kind-specific rich card
  (same renderers as the follows feed / ProfileFeedView). Kinds without a
  rich renderer fall back to the snippet passed by the parent (compact
  FeedCard in the dashboard feed).
-->

<script>
  import { kindToFeedCategory } from '$lib/helpers/profile-feed.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';
  import { formatAMBResource } from '$lib/helpers/educational/index.js';
  import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';
  import NoteCard from '$lib/components/notes/NoteCard.svelte';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';

  /**
   * @type {{
   *   event: any,
   *   authorProfile?: any,
   *   activeUser?: any,
   *   fallback?: import('svelte').Snippet
   * }}
   */
  let { event, authorProfile = null, activeUser = null, fallback } = $props();

  let category = $derived(kindToFeedCategory(event.kind));
</script>

{#if category === 'notes'}
  <NoteCard note={event} {authorProfile} {activeUser} extraRelays={getProfileLookupRelays()} />
{:else if category === 'calendar'}
  {@const calendarEvent = getCalendarEventMetadata(event)}
  {#if calendarEvent}
    <CalendarEventCard event={calendarEvent} compact={false} {authorProfile} />
  {:else}
    {@render fallback?.()}
  {/if}
{:else if category === 'resources'}
  {@const resource = formatAMBResource(event)}
  {#if resource}
    <AMBResourceCard {resource} {authorProfile} compact={false} />
  {:else}
    {@render fallback?.()}
  {/if}
{:else if category === 'articles'}
  <ArticleCard article={event} {authorProfile} compact={false} />
{:else if category === 'polls'}
  <PollCard {event} truncate={true} />
{:else}
  {@render fallback?.()}
{/if}
