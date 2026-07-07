<!--
  ProfileContentTab — generic per-type tab panel of the redesigned profile
  page (content / articles / events / polls / bookmarks). Model-only: the
  page-level useProfileContent hook runs the network loaders; this component
  just subscribes to the EventStore for its tab's kinds and renders the
  matching card component.
-->
<script>
  import { TimelineModel } from 'applesauce-core/models';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { TAB_KINDS } from '$lib/helpers/profile-tabs.js';
  import { getCalendarEventMetadata } from '$lib/helpers/eventUtils.js';
  import { formatAMBResource } from '$lib/helpers/educational/index.js';
  import { filterSocialBookmarks, groupByUrl, groupByEventRef } from '$lib/helpers/urlGrouping.js';
  import AMBResourceCard from '$lib/components/educational/AMBResourceCard.svelte';
  import ArticleCard from '$lib/components/article/ArticleCard.svelte';
  import CalendarEventCard from '$lib/components/calendar/CalendarEventCard.svelte';
  import PollCard from '$lib/components/polls/PollCard.svelte';
  import UrlCard from '$lib/components/bookmarks/UrlCard.svelte';
  import EventHighlightCard from '$lib/components/bookmarks/EventHighlightCard.svelte';
  import { FilesIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pubkey: string,
   *   tabId: 'content' | 'articles' | 'events' | 'polls' | 'bookmarks'
   * }}
   */
  let { pubkey, tabId } = $props();

  let events = $state.raw(/** @type {any[]} */ ([]));

  $effect(() => {
    const kinds = TAB_KINDS[tabId];
    if (!pubkey || !kinds) {
      events = [];
      return;
    }
    const sub = eventStore.model(TimelineModel, { kinds, authors: [pubkey] }).subscribe({
      next: (loaded) => {
        events = loaded || [];
      },
      error: (err) => console.error('ProfileContentTab: Model error:', err)
    });
    return () => sub.unsubscribe();
  });

  const getAuthorProfiles = useProfileMap(() => events.map((e) => e.pubkey));
  let authorProfiles = $derived(getAuthorProfiles());

  // Bookmarks group into URL / event-ref cards instead of raw events.
  let bookmarkGroups = $derived.by(() => {
    if (tabId !== 'bookmarks') return { urls: [], refs: [] };
    return {
      urls: groupByUrl(filterSocialBookmarks(events)),
      refs: groupByEventRef(events)
    };
  });

  let isEmpty = $derived(
    tabId === 'bookmarks'
      ? bookmarkGroups.urls.length === 0 && bookmarkGroups.refs.length === 0
      : events.length === 0
  );
</script>

<div class="py-4">
  {#if isEmpty}
    <div class="pf-empty" data-testid="tab-empty">
      <FilesIcon class_="w-10 h-10" />
      <h3>{m.profile_tab_empty_title()}</h3>
      <p>{m.profile_tab_empty_description()}</p>
    </div>
  {:else if tabId === 'content'}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      {#each events as event (event.id)}
        {@const resource = formatAMBResource(event)}
        {#if resource}
          <AMBResourceCard
            {resource}
            authorProfile={authorProfiles.get(event.pubkey) || null}
            compact={false}
          />
        {/if}
      {/each}
    </div>
  {:else if tabId === 'articles'}
    <div class="space-y-4">
      {#each events as event (event.id)}
        <ArticleCard
          article={event}
          authorProfile={authorProfiles.get(event.pubkey) || null}
          compact={false}
        />
      {/each}
    </div>
  {:else if tabId === 'events'}
    <div class="space-y-3">
      {#each events as event (event.id)}
        {@const calendarEvent = getCalendarEventMetadata(event)}
        {#if calendarEvent}
          <CalendarEventCard
            event={calendarEvent}
            compact={false}
            authorProfile={authorProfiles.get(event.pubkey) || null}
          />
        {/if}
      {/each}
    </div>
  {:else if tabId === 'polls'}
    <div class="space-y-4">
      {#each events as event (event.id)}
        <PollCard {event} truncate={true} />
      {/each}
    </div>
  {:else if tabId === 'bookmarks'}
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      {#each bookmarkGroups.urls as group (group.url)}
        <UrlCard {group} {authorProfiles} />
      {/each}
      {#each bookmarkGroups.refs as group (group.aTagValue)}
        <EventHighlightCard {group} {authorProfiles} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .pf-empty {
    background: var(--c-paper);
    border: 1.5px dashed var(--c-rule);
    border-radius: 14px;
    padding: 40px 24px;
    text-align: center;
    color: var(--c-ink-soft);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .pf-empty h3 {
    font-family: var(--pf-display);
    font-weight: 700;
    font-size: 16px;
    color: var(--c-ink);
    margin: 0;
  }
  .pf-empty p {
    margin: 0;
    font-size: 14px;
    max-width: 420px;
  }
</style>
