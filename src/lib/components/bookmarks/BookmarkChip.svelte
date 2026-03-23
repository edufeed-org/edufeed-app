<!--
  BookmarkChip — Author avatar + name chip for "bookmarked by" section
-->
<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';

  /** @type {{ profile?: any, timestamp?: number }} */
  let { profile = null, timestamp = 0 } = $props();

  const name = $derived(profile ? getDisplayName(profile) : 'Unknown');
  const avatar = $derived(profile ? getProfilePicture(profile) : null);
  const date = $derived(timestamp ? formatCalendarDate(new Date(timestamp * 1000), 'short') : '');
</script>

<div class="flex items-center gap-2 rounded-full bg-base-200 px-3 py-1.5">
  {#if avatar}
    <div class="avatar">
      <div class="w-5 rounded-full">
        <img src={avatar} alt={name} />
      </div>
    </div>
  {/if}
  <span class="text-xs font-medium">{name}</span>
  {#if date}
    <span class="text-xs text-base-content/50">{date}</span>
  {/if}
</div>
