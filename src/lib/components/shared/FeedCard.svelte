<script>
  import {
    CalendarIcon,
    BookIcon,
    GraduationCapIcon,
    KanbanIcon,
    ScrollTextIcon,
    ForumIcon
  } from '$lib/components/icons';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { generateKindColorRGB } from '$lib/helpers/nostrUtils.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   title: string,
   *   subtitle?: string,
   *   typeKey: string,
   *   kind?: number,
   *   tags?: string[],
   *   description?: string,
   *   authorName?: string,
   *   authorAvatar?: string,
   *   timestamp: number,
   *   onclick?: () => void
   * }}
   */
  let {
    title,
    subtitle,
    typeKey,
    kind,
    tags = [],
    description,
    authorName,
    authorAvatar,
    timestamp,
    onclick
  } = $props();

  let kindColor = $derived(kind != null ? generateKindColorRGB(kind) : undefined);

  /** @type {Record<string, { label: () => string, icon: any }>} */
  const typeMeta = {
    calendar: { label: () => m.feed_badge_calendar(), icon: CalendarIcon },
    learning: { label: () => m.feed_badge_learning(), icon: GraduationCapIcon },
    article: { label: () => m.feed_badge_article(), icon: ScrollTextIcon },
    board: { label: () => m.feed_badge_board(), icon: KanbanIcon },
    wiki: { label: () => m.feed_badge_wiki(), icon: BookIcon },
    thread: { label: () => m.feed_badge_thread(), icon: ForumIcon }
  };

  let meta = $derived(typeMeta[typeKey]);

  /**
   * Format a calendar start string for display.
   * @param {string} startStr - Unix timestamp string or ISO date string
   * @returns {string}
   */
  function formatCalendarSubtitle(startStr) {
    const num = Number(startStr);
    if (!isNaN(num) && num > 0) {
      return new Date(num * 1000).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
    // ISO date string — show as-is (already readable)
    return startStr;
  }
</script>

<div
  class="relative flex gap-3 rounded-lg border border-base-300 bg-base-100 p-3 shadow-sm transition-shadow hover:border-primary hover:shadow-md {onclick
    ? 'cursor-pointer'
    : ''} {kindColor ? 'border-l-4' : ''}"
  role="button"
  tabindex="0"
  {onclick}
  style:border-left-color={kindColor
    ? `rgb(${kindColor.r},${kindColor.g},${kindColor.b})`
    : undefined}
>
  {#if authorAvatar}
    <div class="avatar flex-shrink-0">
      <div class="h-10 w-10 rounded-full">
        <img src={authorAvatar} alt={authorName || ''} loading="lazy" />
      </div>
    </div>
  {/if}

  <div class="min-w-0 flex-1">
    {#if authorName}
      <div class="flex items-center gap-1.5">
        <span class="truncate text-sm font-medium text-base-content">{authorName}</span>
        <span class="text-base-content/30">&middot;</span>
        <span class="shrink-0 text-xs text-base-content/50">
          {formatRelativeTime(timestamp)}
        </span>
      </div>
    {:else if timestamp}
      <span class="text-xs text-base-content/50">
        {formatRelativeTime(timestamp)}
      </span>
    {/if}

    <h3 class="mt-0.5 line-clamp-2 text-base font-bold text-base-content">{title}</h3>

    {#if subtitle}
      <p class="mt-0.5 text-xs text-base-content/60">
        {#if typeKey === 'calendar'}
          {formatCalendarSubtitle(subtitle)}
        {:else}
          {subtitle}
        {/if}
      </p>
    {/if}

    {#if description}
      <p class="mt-0.5 truncate text-sm text-base-content/60">{description}</p>
    {/if}

    {#if tags.length > 0}
      <div class="mt-1 flex flex-wrap gap-1">
        {#each tags as tag (tag)}
          <span class="badge badge-ghost badge-sm">{tag}</span>
        {/each}
      </div>
    {/if}
  </div>

  {#if meta}
    {@const Icon = meta.icon}
    <div
      class="absolute top-2 right-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium backdrop-blur-sm {kindColor
        ? ''
        : 'bg-base-300/80 text-base-content/70'}"
      style:background-color={kindColor
        ? `rgba(${kindColor.r},${kindColor.g},${kindColor.b},0.15)`
        : undefined}
      style:color={kindColor ? `rgb(${kindColor.r},${kindColor.g},${kindColor.b})` : undefined}
    >
      <Icon class_="w-3 h-3" />
      {meta.label()}
    </div>
  {/if}
</div>
