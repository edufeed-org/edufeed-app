<!--
  FeedEntryCard — the ONE place mapping a feed event to its rich card
  (issue #45). Used by ProfileFeedView (incl. repost targets) and
  RichFeedEntry, so a category added here renders everywhere. Unknown
  categories render the fallback snippet or nothing — never a blank shell.
-->
<script>
  import { kindToFeedCategory } from '$lib/helpers/profile-feed.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';
  import { formatAMBResource } from '$lib/helpers/educational/index.js';
  import { getProfileLookupRelays } from '$lib/helpers/relay-helper.js';
  import { groupByUrl } from '$lib/helpers/urlGrouping.js';
  import NoteCard from '$lib/components/notes/NoteCard.svelte';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import PageNoteItem from '$lib/components/bookmarks/PageNoteItem.svelte';
  import UrlCard from '$lib/components/bookmarks/UrlCard.svelte';
  import HighlightCard from '$lib/components/bookmarks/HighlightCard.svelte';

  /**
   * @type {{
   *   event: any,
   *   authorProfile?: any,
   *   authorProfiles?: Map<string, any>,
   *   activeUser?: any,
   *   fallback?: import('svelte').Snippet
   * }}
   */
  let {
    event,
    authorProfile = null,
    authorProfiles = new Map(),
    activeUser = null,
    fallback = undefined
  } = $props();

  const category = $derived(kindToFeedCategory(event.kind));
  // Single 39701 events reuse the URL-group card by grouping just themselves.
  const soloUrlGroup = $derived(
    category === 'bookmarks' && event.kind === 39701 ? (groupByUrl([event])[0] ?? null) : null
  );
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
{:else if category === 'highlights'}
  <HighlightCard {event} {authorProfile} />
{:else if category === 'bookmarks' && event.kind === 1111}
  <PageNoteItem {event} {authorProfile} {activeUser} />
{:else if soloUrlGroup}
  <UrlCard group={soloUrlGroup} {authorProfiles} />
{:else}
  {@render fallback?.()}
{/if}
