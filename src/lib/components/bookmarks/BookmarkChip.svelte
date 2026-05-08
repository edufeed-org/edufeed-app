<!--
  BookmarkChip — Author avatar + name chip for "bookmarked by" section.
  Optionally clickable: when an `onclick` is provided, the chip becomes a button
  and reader view uses it to surface a per-bookmark social panel.
-->
<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import ImageWithFallback from '../shared/ImageWithFallback.svelte';

  /**
   * @type {{
   *   profile?: any,
   *   timestamp?: number,
   *   onclick?: () => void,
   *   active?: boolean
   * }}
   */
  let { profile = null, timestamp = 0, onclick = undefined, active = false } = $props();

  const name = $derived(profile ? getDisplayName(profile) : 'Unknown');
  const avatar = $derived(profile ? getProfilePicture(profile) : null);
  const date = $derived(timestamp ? formatCalendarDate(new Date(timestamp * 1000), 'short') : '');

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (!onclick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onclick();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="flex items-center gap-2 rounded-full bg-base-200 px-3 py-1.5{onclick
    ? ' cursor-pointer transition-colors hover:bg-base-300'
    : ''}{active ? ' ring-2 ring-primary' : ''}"
  role={onclick ? 'button' : undefined}
  tabindex={onclick ? 0 : undefined}
  {onclick}
  onkeydown={handleKeydown}
>
  {#if avatar}
    <div class="avatar">
      <div class="w-5 rounded-full">
        <ImageWithFallback
          src={avatar}
          alt={name}
          size="avatar_sm"
          class="h-full w-full rounded-full object-cover"
        />
      </div>
    </div>
  {/if}
  <span class="text-xs font-medium">{name}</span>
  {#if date}
    <span class="text-xs text-base-content/50">{date}</span>
  {/if}
</div>
