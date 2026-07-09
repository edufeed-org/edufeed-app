<!--
  TopPublishersFilter — quick chips for the most active event publishers in
  the current calendar view (issue #28). Clicking a chip hides/shows that
  author's events, letting users de-clutter views dominated by a few actors.

  `events` must be the view-scoped event set BEFORE the hidden-authors filter
  is applied, so hidden publishers keep their chip and can be re-enabled.
-->
<script>
  import { calendarFilters } from '$lib/stores/calendar-filters.svelte.js';
  import { topEventPublishers } from '$lib/helpers/topPublishers.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { EyeIcon, EyeOffIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ events: Array<{pubkey: string}>, limit?: number }} */
  let { events, limit = 5 } = $props();

  const topPublishers = $derived(topEventPublishers(events, limit));
  const hidden = $derived(calendarFilters.hiddenAuthorPubkeys);

  const getProfiles = useProfileMap(() => topPublishers.map((p) => p.pubkey));

  /** @param {string} pubkey */
  function nameFor(pubkey) {
    return getDisplayName(getProfiles().get(pubkey), pubkey.slice(0, 8) + '…');
  }
</script>

{#if topPublishers.length >= 2}
  <div class="flex flex-wrap items-center gap-1.5" data-testid="top-publishers-filter">
    <span class="text-xs text-base-content/60">{m.calendar_top_publishers_label()}:</span>
    {#each topPublishers as publisher (publisher.pubkey)}
      {@const isHidden = hidden.includes(publisher.pubkey)}
      {@const picture = getProfilePicture(getProfiles().get(publisher.pubkey))}
      <button
        type="button"
        class="btn h-auto gap-1 rounded-full px-2 py-0.5 btn-ghost btn-xs {isHidden
          ? 'opacity-45'
          : ''}"
        onclick={() => calendarFilters.toggleHiddenAuthor(publisher.pubkey)}
        aria-pressed={isHidden}
        aria-label={isHidden
          ? m.calendar_top_publishers_show_aria({ name: nameFor(publisher.pubkey) })
          : m.calendar_top_publishers_hide_aria({ name: nameFor(publisher.pubkey) })}
        title={isHidden
          ? m.calendar_top_publishers_show_aria({ name: nameFor(publisher.pubkey) })
          : m.calendar_top_publishers_hide_aria({ name: nameFor(publisher.pubkey) })}
      >
        {#if picture}
          <img src={picture} alt="" class="h-4 w-4 rounded-full object-cover" />
        {/if}
        <span class={isHidden ? 'line-through' : ''}>{nameFor(publisher.pubkey)}</span>
        <span class="badge badge-ghost badge-xs">{publisher.count}</span>
        {#if isHidden}
          <EyeOffIcon class_="w-3 h-3" />
        {:else}
          <EyeIcon class_="w-3 h-3" />
        {/if}
      </button>
    {/each}
  </div>
{/if}
