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
        await unpinEvent(event, pubkey);
      } else {
        await pinEvent(event, pubkey);
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

<!-- Pinned cards carry the flag on the card itself (design: in-card pin pill
     + tinted border). The wrapper calling this must be `relative`; pinned
     wrappers also get `pf-pinned-card` + top margin for the straddling pill. -->
{#snippet pinRow(/** @type {any} */ event)}
  {@const pinned = isEntryPinned({ data: event }, pinnedPointers)}
  {#if pinned}
    <div class="absolute -top-2.5 right-4 z-10 flex items-center gap-1.5">
      <span class="pf-pin-flag" data-testid="pin-flag">
        <PinIcon class_="w-3 h-3" />
        {m.profile_pinned_divider()}
      </span>
      {#if canPin}
        <button
          class="pf-pin-flag pf-pin-unpin"
          data-testid="pin-toggle"
          disabled={pinBusy === event.id}
          onclick={() => togglePin(event)}
        >
          {m.profile_unpin_action()}
        </button>
      {/if}
    </div>
  {:else if canPin}
    <div class="absolute -top-2.5 right-4 z-10">
      <button
        class="pf-pin-flag pf-pin-unpin opacity-70 hover:opacity-100"
        data-testid="pin-toggle"
        disabled={pinBusy === event.id}
        onclick={() => togglePin(event)}
      >
        <PinIcon class_="w-3 h-3" />
        {m.profile_pin_action()}
      </button>
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
    <!-- CSS-columns masonry: cards of different heights flow naturally
         instead of leaving rigid grid gaps -->
    <div class="columns-1 gap-4 md:columns-2">
      {#each events as event (event.id)}
        {@const resource = formatAMBResource(event)}
        {#if resource}
          <div
            class="relative mb-4 inline-block w-full break-inside-avoid"
            class:pf-pinned-card={isEntryPinned({ data: event }, pinnedPointers)}
            class:mt-3={isEntryPinned({ data: event }, pinnedPointers)}
          >
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
        <div
          class="relative"
          class:pf-pinned-card={isEntryPinned({ data: event }, pinnedPointers)}
          class:mt-3={isEntryPinned({ data: event }, pinnedPointers)}
        >
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
          <div
            class="relative"
            class:pf-pinned-card={isEntryPinned({ data: event }, pinnedPointers)}
            class:mt-3={isEntryPinned({ data: event }, pinnedPointers)}
          >
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
        <div
          class="relative"
          class:pf-pinned-card={isEntryPinned({ data: event }, pinnedPointers)}
          class:mt-3={isEntryPinned({ data: event }, pinnedPointers)}
        >
          {@render pinRow(event)}
          <PollCard {event} truncate={true} />
        </div>
      {/each}
    </div>
  {:else if tabId === 'bookmarks'}
    <div class="columns-1 gap-4 md:columns-2">
      {#each bookmarkGroups.urls as group (group.url)}
        <div class="mb-4 inline-block w-full break-inside-avoid">
          <UrlCard {group} {authorProfiles} />
        </div>
      {/each}
      {#each bookmarkGroups.refs as group (group.aTagValue)}
        <div class="mb-4 inline-block w-full break-inside-avoid">
          <EventHighlightCard {group} {authorProfiles} />
        </div>
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

  /* Pinned card treatment (shared look with the feed) */
  .pf-pin-flag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-display, inherit);
    font-weight: 700;
    font-size: 10px;
    line-height: 1;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: color-mix(in oklch, var(--color-warning) 70%, var(--color-base-content));
    background: color-mix(in oklch, var(--color-warning) 18%, var(--color-base-100));
    border: 1px solid color-mix(in oklch, var(--color-warning) 45%, transparent);
    border-radius: 999px;
    padding: 5px 10px;
  }
  .pf-pin-unpin {
    cursor: pointer;
  }
  .pf-pin-unpin:hover {
    background: color-mix(in oklch, var(--color-warning) 32%, var(--color-base-100));
  }
  .pf-pinned-card > :global(*:last-child) {
    border-color: color-mix(in oklch, var(--color-warning) 55%, transparent);
  }
</style>
