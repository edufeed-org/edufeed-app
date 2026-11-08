<script>
  // Termi content results (tier 1 and tier 2 tool parts) as one card per item,
  // plus the sources note. Blocked authors are dropped; hidden calendar
  // sources follow the calendar's "Importierte Termine anzeigen" setting.
  import { uniqueBy } from '$lib/helpers/unique.js';
  import { isBlockedAuthor } from '$lib/services/blocked-authors.svelte.js';
  import { isHiddenCalendarSource } from '$lib/services/calendar-sources.svelte.js';
  import { appSettings } from '$lib/stores/app-settings.svelte.js';
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
   *   onRetry?: () => void,
   *   onSearchAuthor?: (name: string) => void
   * }}
   */
  let { items = [], sourcesUnavailable = [], onRetry, onSearchAuthor } = $props();

  const CARDS = {
    community: CommunityCard,
    event: EventCard,
    resource: ResourceCard,
    person: PersonCard,
    passage: PassageCard
  };

  /** Person/community ids are pubkeys; event/resource ids are `kind:pubkey:d`. @param {Item} it */
  const pubkeyOf = (it) =>
    it.type === 'person' || it.type === 'community' ? it.id : String(it.id).split(':')[1];

  /** @param {Item} it */
  const keep = (it) =>
    !!it?.title &&
    Object.hasOwn(CARDS, it.type) &&
    !isBlockedAuthor(pubkeyOf(it)) &&
    !(
      it.type === 'event' &&
      !appSettings.showHiddenCalendarSources &&
      isHiddenCalendarSource(pubkeyOf(it))
    );

  const shown = $derived(
    uniqueBy((Array.isArray(items) ? items : []).filter(keep), (it) => `${it.type}:${it.id}`)
  );
</script>

{#if shown.length > 0 || sourcesUnavailable.length > 0}
  <div class="mt-2 flex min-w-0 flex-col gap-2">
    {#each shown as item (`${item.type}:${item.id}`)}
      {@const Card = CARDS[item.type]}
      <Card {item} {onSearchAuthor} />
    {/each}
    <SourcesNote sources={sourcesUnavailable} {onRetry} />
  </div>
{/if}
