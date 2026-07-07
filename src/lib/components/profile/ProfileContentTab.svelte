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
  import { isEntryPinned } from '$lib/helpers/profile-feed.js';
  import { pinEvent, unpinEvent } from '$lib/services/pin-list-service.js';
  import { showToast } from '$lib/helpers/toast';
  import { PinIcon } from '$lib/components/icons';
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
   *   tabId: 'content' | 'articles' | 'events' | 'polls' | 'bookmarks',
   *   pinnedPointers?: import('$lib/helpers/profile-feed.js').PinPointer[],
   *   canPin?: boolean
   * }}
   */
  let { pubkey, tabId, pinnedPointers = [], canPin = false } = $props();

  let rawEvents = $state.raw(/** @type {any[]} */ ([]));

  // Pinned items first (the pin list is the user's global kind 10001 —
  // a-tags cover the addressable kinds shown here, e-tags the rest).
  let events = $derived.by(() => {
    if (!pinnedPointers.length) return rawEvents;
    /** @type {any[]} */
    const pinned = [];
    /** @type {any[]} */
    const rest = [];
    for (const event of rawEvents) {
      (isEntryPinned({ data: event }, pinnedPointers) ? pinned : rest).push(event);
    }
    return [...pinned, ...rest];
  });

  /** @type {string | null} */
  let pinBusy = $state(null);

  /** @param {any} event */
  async function togglePin(event) {
    if (!event?.id || pinBusy) return;
    pinBusy = event.id;
    try {
      if (isEntryPinned({ data: event }, pinnedPointers)) {
        await unpinEvent(event);
      } else {
        await pinEvent(event);
      }
    } catch (err) {
      console.error('ProfileContentTab: pin toggle failed:', err);
      showToast(m.profile_pin_error(), 'error');
    } finally {
      pinBusy = null;
    }
  }

  $effect(() => {
    const kinds = TAB_KINDS[tabId];
    if (!pubkey || !kinds) {
      rawEvents = [];
      return;
    }
    const sub = eventStore.model(TimelineModel, { kinds, authors: [pubkey] }).subscribe({
      next: (loaded) => {
        rawEvents = loaded || [];
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

{#snippet pinRow(/** @type {any} */ event)}
  {@const pinned = isEntryPinned({ data: event }, pinnedPointers)}
  {#if pinned || canPin}
    <div class="mb-1 flex items-center justify-between gap-2">
      {#if pinned}
        <span class="badge gap-1 badge-outline badge-sm text-warning" data-testid="pin-flag">
          <PinIcon class_="w-3 h-3" />
          {m.profile_pinned_divider()}
        </span>
      {:else}
        <span></span>
      {/if}
      {#if canPin}
        <button
          class="btn gap-1 btn-ghost btn-xs"
          data-testid="pin-toggle"
          disabled={pinBusy === event.id}
          onclick={() => togglePin(event)}
        >
          <PinIcon class_="w-3 h-3" />
          {pinned ? m.profile_unpin_action() : m.profile_pin_action()}
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

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
          <div>
            {@render pinRow(event)}
            <AMBResourceCard
              {resource}
              authorProfile={authorProfiles.get(event.pubkey) || null}
              compact={false}
            />
          </div>
        {/if}
      {/each}
    </div>
  {:else if tabId === 'articles'}
    <div class="space-y-4">
      {#each events as event (event.id)}
        <div>
          {@render pinRow(event)}
          <ArticleCard
            article={event}
            authorProfile={authorProfiles.get(event.pubkey) || null}
            compact={false}
          />
        </div>
      {/each}
    </div>
  {:else if tabId === 'events'}
    <div class="space-y-3">
      {#each events as event (event.id)}
        {@const calendarEvent = getCalendarEventMetadata(event)}
        {#if calendarEvent}
          <div>
            {@render pinRow(event)}
            <CalendarEventCard
              event={calendarEvent}
              compact={false}
              authorProfile={authorProfiles.get(event.pubkey) || null}
            />
          </div>
        {/if}
      {/each}
    </div>
  {:else if tabId === 'polls'}
    <div class="space-y-4">
      {#each events as event (event.id)}
        <div>
          {@render pinRow(event)}
          <PollCard {event} truncate={true} />
        </div>
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
