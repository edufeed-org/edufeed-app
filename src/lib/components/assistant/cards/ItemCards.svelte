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
  import SourcesNote from './SourcesNote.svelte';

  /** @typedef {import('$lib/server/termi/items.js').Item} Item */
  /**
   * @type {{
   *   items?: Item[],
   *   sourcesUnavailable?: string[],
   *   query?: string,
   *   onRetry?: () => void,
   *   onSearchAuthor?: (item: Item) => void,
   *   fold?: number
   * }}
   */
  let {
    items = [],
    sourcesUnavailable = [],
    query = '',
    onRetry,
    onSearchAuthor,
    fold = 3
  } = $props();

  // Folded: 3 cards always shown + 3 more revealed only once the panel is
  // wide enough (@sm, two columns) via CSS — no JS width measurement.
  let showAll = $state(false);

  const CARDS = {
    community: CommunityCard,
    event: EventCard,
    resource: ResourceCard,
    person: PersonCard,
    passage: PassageCard
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

  const visible = $derived(showAll ? shown : shown.slice(0, fold * 2));

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
    <div class="grid min-w-0 gap-2 @sm:grid-cols-2">
      {#each visible as item, i (`${item.type}:${item.id}`)}
        {@const Card = CARDS[item.type]}
        <div class={i >= fold && !showAll ? 'hidden @sm:block' : ''}>
          <Card {item} {onSearchAuthor} />
        </div>
      {/each}
    </div>
    {#if !showAll && shown.length > fold}
      <div class="flex min-w-0 flex-wrap gap-1.5">
        <button type="button" class="btn w-full btn-ghost btn-sm" onclick={() => (showAll = true)}>
          {m.termi_cards_more({ n: shown.length - fold })}
        </button>
      </div>
    {/if}
    {#if allLinks.length > 0}
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
