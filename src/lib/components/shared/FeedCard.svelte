<script>
  import { resolve } from '$app/paths';
  import {
    CalendarIcon,
    BookIcon,
    GraduationCapIcon,
    KanbanIcon,
    ScrollTextIcon,
    ForumIcon,
    BookmarkIcon,
    ReplyIcon,
    FilesIcon,
    PollIcon
  } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { generateKindColorRGB, hexToNpub } from '$lib/helpers/nostrUtils.js';
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
   *   authorPubkey?: string,
   *   communityName?: string,
   *   communityAvatar?: string,
   *   communityPubkey?: string,
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
    authorPubkey,
    communityName,
    communityAvatar,
    communityPubkey,
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
    thread: { label: () => m.feed_badge_thread(), icon: ForumIcon },
    bookmark: { label: () => m.feed_badge_bookmark(), icon: BookmarkIcon },
    highlight: { label: () => m.feed_badge_highlight(), icon: BookmarkIcon },
    note: { label: () => m.feed_badge_note(), icon: BookmarkIcon },
    'page-note': { label: () => m.feed_badge_page_note(), icon: BookmarkIcon },
    reply: { label: () => m.feed_badge_reply(), icon: ReplyIcon },
    form: { label: () => m.feed_badge_form(), icon: FilesIcon },
    poll: { label: () => m.feed_badge_poll(), icon: PollIcon }
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
  onkeydown={(e) => {
    if (onclick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onclick();
    }
  }}
  style:border-left-color={kindColor
    ? `rgb(${kindColor.r},${kindColor.g},${kindColor.b})`
    : undefined}
>
  {#if authorPubkey}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="flex-shrink-0" onclick={(e) => e.stopPropagation()}>
      <ProfileAvatar pubkey={authorPubkey} size="md" linkToProfile showHoverCard />
    </div>
  {:else if authorAvatar}
    <div class="avatar flex-shrink-0">
      <div class="h-10 w-10 rounded-full">
        <ImageWithFallback
          src={authorAvatar}
          alt={authorName || ''}
          size="avatar_md"
          class="h-full w-full rounded-full object-cover"
        />
      </div>
    </div>
  {/if}

  <div class="min-w-0 flex-1">
    {#if authorName}
      <div class="flex items-center gap-1.5">
        <span class="truncate text-sm font-medium text-base-content">{authorName}</span>
        {#if timestamp}
          <span class="text-base-content/30">&middot;</span>
          <span class="shrink-0 text-xs text-base-content/50">
            {formatRelativeTime(timestamp)}
          </span>
        {/if}
      </div>
    {:else if timestamp}
      <span class="text-xs text-base-content/50">
        {formatRelativeTime(timestamp)}
      </span>
    {/if}

    <h3 class="mt-0.5 line-clamp-2 text-base font-bold text-base-content">{title}</h3>

    {#if subtitle}
      <p class="mt-0.5 truncate text-xs text-base-content/60">
        {#if typeKey === 'calendar'}
          {formatCalendarSubtitle(subtitle)}
        {:else}
          {subtitle}
        {/if}
      </p>
    {/if}

    {#if communityName}
      <div class="mt-0.5 flex items-center gap-1.5">
        {#if communityAvatar}
          <img
            src={communityAvatar}
            alt={communityName}
            class="h-4 w-4 rounded-full object-cover"
          />
        {/if}
        {#if communityPubkey}
          <a
            href={resolve(`/c/${hexToNpub(communityPubkey) || communityPubkey}`)}
            class="truncate text-xs text-base-content/60 hover:text-primary"
            onclick={(e) => e.stopPropagation()}
          >
            {communityName}
          </a>
        {:else}
          <span class="truncate text-xs text-base-content/60">{communityName}</span>
        {/if}
      </div>
    {:else if description}
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
