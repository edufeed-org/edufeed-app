<!--
  One container in the community rail, as an icon.

  Three kinds live in one arrangeable list now (buildRailEntries), and each of
  them was already drawn somewhere in CommunitySidebar; this is that markup in
  one place, so a top-level row and a row inside a folder cannot drift apart.

  Presentational: it draws an entry and reports a click. Dragging belongs to
  the slot AROUND it, because a folder tile has to be draggable in exactly the
  same way and knows nothing about entries.
-->
<script>
  import { areaUnreadState } from '$lib/concord/notifications.svelte.js';
  import { groupHref } from '$lib/groups/groups.js';
  import { resolve } from '$app/paths';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import RailCommunityIcon from './RailCommunityIcon.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   entry: import('$lib/rail/rail-entries.js').RailEntry,
   *   isActive?: boolean,
   *   size?: string,
   *   onSelect?: (pubkey: string) => void
   * }}
   */
  let { entry, isActive = false, size = 'h-12 w-12', onSelect } = $props();
</script>

{#if entry.kind === 'community'}
  <RailCommunityIcon pubkey={entry.pubkey} {isActive} {size} {onSelect} />
{:else if entry.kind === 'area'}
  {@const flags = areaUnreadState(entry.area.communityId)}
  <a
    title="{entry.area.name} · {m.concord_sidebar_area_tooltip()}"
    href={resolve(`/private/${entry.area.communityId}`)}
    data-testid="rail-area-icon"
    draggable="false"
    class="btn btn-circle {size} shrink-0 p-0 btn-ghost transition-transform duration-200 hover:scale-110 {entry
      .area.dissolved
      ? 'opacity-50'
      : ''}"
  >
    <span class="relative shrink-0">
      <ConcordAreaBadge
        name={entry.area.name}
        communityId={entry.area.communityId}
        iconPointer={entry.area.iconPointer}
        class={size}
      />
      <span class="absolute -top-0.5 -right-0.5">
        <ConcordUnreadDot unread={flags.unread} mentioned={flags.mentioned} />
      </span>
    </span>
  </a>
{:else}
  <a
    title={entry.row.name}
    href={groupHref(entry.row.pointer)}
    data-testid="sidebar-group-icon"
    draggable="false"
    class="btn btn-circle {size} shrink-0 p-0 btn-ghost transition-transform duration-200 hover:scale-110"
  >
    <span
      class="flex {size} items-center justify-center rounded-full bg-base-300 text-base"
      aria-hidden="true">{entry.row.symbol}</span
    >
  </a>
{/if}
