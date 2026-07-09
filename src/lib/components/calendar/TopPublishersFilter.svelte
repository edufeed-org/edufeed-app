<!--
  TopPublishersFilter — quick chips for the most active event publishers in
  the current calendar view (issue #28). Chart-legend convention:
    - clicking the chip body SOLOs the publisher (only their events show;
      click again to restore),
    - the eye button toggles hiding that publisher.

  `events` must be the view-scoped event set BEFORE the hidden/solo filter
  is applied, so filtered publishers keep their chip and can be re-enabled.
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
  const solo = $derived(calendarFilters.soloAuthorPubkey);

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
      {@const isSolo = solo === publisher.pubkey}
      {@const dimmed = isHidden || (solo !== null && !isSolo)}
      {@const picture = getProfilePicture(getProfiles().get(publisher.pubkey))}
      <span
        class="join rounded-full {dimmed ? 'opacity-45' : ''}"
        data-testid="publisher-chip"
        data-pubkey={publisher.pubkey}
      >
        <button
          type="button"
          class="btn join-item h-auto gap-1 pr-1 pl-2 btn-xs {isSolo ? 'btn-primary' : 'btn-ghost'}"
          onclick={() => calendarFilters.toggleSoloAuthor(publisher.pubkey)}
          aria-pressed={isSolo}
          aria-label={isSolo
            ? m.calendar_top_publishers_unsolo_aria({ name: nameFor(publisher.pubkey) })
            : m.calendar_top_publishers_solo_aria({ name: nameFor(publisher.pubkey) })}
          title={isSolo
            ? m.calendar_top_publishers_unsolo_aria({ name: nameFor(publisher.pubkey) })
            : m.calendar_top_publishers_solo_aria({ name: nameFor(publisher.pubkey) })}
        >
          {#if picture}
            <img src={picture} alt="" class="h-4 w-4 rounded-full object-cover" />
          {/if}
          <span class={isHidden ? 'line-through' : ''}>{nameFor(publisher.pubkey)}</span>
          <span class="badge badge-ghost badge-xs">{publisher.count}</span>
        </button>
        <button
          type="button"
          class="btn join-item h-auto px-1.5 btn-ghost btn-xs"
          onclick={() => calendarFilters.toggleHiddenAuthor(publisher.pubkey)}
          aria-pressed={isHidden}
          aria-label={isHidden
            ? m.calendar_top_publishers_show_aria({ name: nameFor(publisher.pubkey) })
            : m.calendar_top_publishers_hide_aria({ name: nameFor(publisher.pubkey) })}
          title={isHidden
            ? m.calendar_top_publishers_show_aria({ name: nameFor(publisher.pubkey) })
            : m.calendar_top_publishers_hide_aria({ name: nameFor(publisher.pubkey) })}
        >
          {#if isHidden}
            <EyeOffIcon class_="w-3 h-3" />
          {:else}
            <EyeIcon class_="w-3 h-3" />
          {/if}
        </button>
      </span>
    {/each}
  </div>
{/if}
