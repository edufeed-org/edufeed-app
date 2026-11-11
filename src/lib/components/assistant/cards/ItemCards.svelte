<script>
  // Termi content results (tier 1 and tier 2 tool parts) as one card per item,
  // one "Alle anzeigen" link per shown type, plus the sources note.
  import * as m from '$lib/paraglide/messages';
  import { uniqueBy } from '$lib/helpers/unique.js';
  import { getBlockedAuthorsVersion } from '$lib/services/blocked-authors.svelte.js';
  import { getHiddenCalendarSourcesVersion } from '$lib/services/calendar-sources.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { isDiscoverTypeEnabled } from '$lib/helpers/discover-content-types.js';
  import { discoverHref } from '../termi-router.js';
  import { keepItem } from './filter.js';
  import CommunityCard from './CommunityCard.svelte';
  import EventCard from './EventCard.svelte';
  import ResourceCard from './ResourceCard.svelte';
  import PersonCard from './PersonCard.svelte';
  import PassageCard from './PassageCard.svelte';
  import CurriculumCard from './CurriculumCard.svelte';
  import SourcesNote from './SourcesNote.svelte';

  /** @typedef {import('$lib/termi/items.d.js').Item} Item */
  /**
   * @type {{
   *   items?: Item[],
   *   sourcesUnavailable?: string[],
   *   query?: string,
   *   onRetry?: () => void,
   *   onSearchAuthor?: (item: Item) => void,
   *   fold?: number,
   *   collapsed?: boolean
   * }} `collapsed`: the cards start hidden behind "Quellen (N) anzeigen" (under a document)
   */
  let {
    items = [],
    sourcesUnavailable = [],
    query = '',
    onRetry,
    onSearchAuthor,
    fold = 3,
    collapsed = false
  } = $props();

  // one card per row, folded to `fold`
  let showAll = $state(false);
  // the turn's default (it can flip while the answer streams); her click owns it from then on
  let toggled = $state(/** @type {boolean | undefined} */ (undefined));
  const open = $derived(toggled ?? !collapsed);
  // Passages: one column below the grid (a quote needs the width), folded at 2.
  let showAllPassages = $state(false);
  const PASSAGE_FOLD = 2;

  const CARDS = {
    community: CommunityCard,
    event: EventCard,
    resource: ResourceCard,
    person: PersonCard,
    curriculum: CurriculumCard
  };

  /** Item type → /discover tab and its label; passages have no listing. */
  const ALL_LINKS = /** @type {const} */ ([
    ['resource', 'learning', m.discover_tab_learning],
    ['event', 'events', m.discover_tab_events],
    ['community', 'communities', m.discover_tab_communities],
    ['person', 'people', m.discover_tab_people]
  ]);

  const shown = $derived.by(() => {
    // Lists that resolve after the answer re-filter the cards.
    void getBlockedAuthorsVersion();
    void getHiddenCalendarSourcesVersion();
    return uniqueBy(
      (Array.isArray(items) ? items : []).filter(keepItem),
      (it) => `${it.type}:${it.id}`
    );
  });

  const gridItems = $derived(shown.filter((it) => it.type !== 'passage'));
  const passages = $derived(shown.filter((it) => it.type === 'passage'));
  const visible = $derived(showAll ? gridItems : gridItems.slice(0, fold));
  const visiblePassages = $derived(showAllPassages ? passages : passages.slice(0, PASSAGE_FOLD));

  const allLinks = $derived.by(() => {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const topic = q.length > 40 ? `${q.slice(0, 39)}…` : q;
    const enabled = runtimeConfig.discover?.contentTypes ?? [];
    return ALL_LINKS.filter(
      ([type, tab]) => shown.some((it) => it.type === type) && isDiscoverTypeEnabled(tab, enabled)
    ).map(([, tab, label]) => ({
      tab,
      href: discoverHref(tab, q),
      label: m.termi_card_all({ type: label(), topic })
    }));
  });
</script>

{#if shown.length > 0 || sourcesUnavailable.length > 0}
  <div class="mt-2 flex min-w-0 flex-col gap-2">
    {#if collapsed && shown.length > 0}
      <button
        type="button"
        class="btn w-full btn-ghost btn-sm"
        data-testid="termi-cards-toggle"
        aria-expanded={open}
        onclick={() => (toggled = !open)}
      >
        {open ? m.termi_cards_hide() : m.termi_cards_show({ n: shown.length })}
      </button>
    {/if}
    {#if open && gridItems.length > 0}
      <!-- explicit minmax(0,1fr) track: an implicit auto track takes a card's min-content width
           (its truncated lines count unwrapped) and pushes the popover into horizontal scrolling -->
      <div class="grid min-w-0 grid-cols-1 gap-2">
        {#each visible as item (`${item.type}:${item.id}`)}
          {@const Card = CARDS[/** @type {Exclude<Item['type'], 'passage'>} */ (item.type)]}
          <div class="min-w-0">
            <Card {item} {onSearchAuthor} />
          </div>
        {/each}
      </div>
    {/if}
    {#if open && !showAll && gridItems.length > fold}
      <div class="flex min-w-0 flex-wrap gap-1.5">
        <button type="button" class="btn w-full btn-ghost btn-sm" onclick={() => (showAll = true)}>
          {m.termi_cards_more({ n: gridItems.length - fold })}
        </button>
      </div>
    {/if}
    {#if open && passages.length > 0}
      <div class="flex min-w-0 flex-col gap-2">
        {#each visiblePassages as item (item.id)}
          <PassageCard {item} />
        {/each}
      </div>
    {/if}
    {#if open && !showAllPassages && passages.length > PASSAGE_FOLD}
      <div class="flex min-w-0 flex-wrap gap-1.5">
        <button
          type="button"
          class="btn w-full btn-ghost btn-sm"
          onclick={() => (showAllPassages = true)}
        >
          {m.termi_cards_more({ n: passages.length - PASSAGE_FOLD })}
        </button>
      </div>
    {/if}
    {#if open && allLinks.length > 0}
      <div class="flex min-w-0 flex-wrap gap-1.5">
        {#each allLinks as link (link.tab)}
          <a href={link.href} class="btn max-w-full btn-ghost btn-sm">
            <span class="min-w-0 truncate">{link.label}</span>
          </a>
        {/each}
      </div>
    {/if}
    <SourcesNote sources={sourcesUnavailable} {onRetry} />
  </div>
{/if}
