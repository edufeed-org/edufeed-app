<script>
  import { resolve } from '$app/paths';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import {
    CalendarIcon,
    WikipediaIcon,
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
  import CreatorAvatarStack from '$lib/components/shared/CreatorAvatarStack.svelte';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import {
    getResourceAttribution,
    formatCreatorNames
  } from '$lib/helpers/educational/resourceAttribution.js';
  import { formatRelativeTime } from '$lib/helpers/calendar.js';
  import { activeDateLocale } from '$lib/helpers/dates.js';
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
   *   location?: string,
   *   authorName?: string,
   *   authorAvatar?: string,
   *   authorPubkey?: string,
   *   communityName?: string,
   *   communityAvatar?: string,
   *   communityPubkey?: string,
   *   timestamp: number,
   *   event?: any,
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
    location,
    authorName,
    authorAvatar,
    authorPubkey,
    communityName,
    communityAvatar,
    communityPubkey,
    timestamp,
    event = undefined,
    onclick
  } = $props();

  let kindColor = $derived(kind != null ? generateKindColorRGB(kind) : undefined);

  // Indexer vs. author (kind 30142): when the AMB creator metadata names
  // someone other than the event pubkey, the pubkey is only the indexer —
  // the author slot shows the metadata creator instead (mirrors
  // AMBResourceCard). Callers opt in by passing the raw `event`.
  const attribution = $derived(
    event?.kind === 30142
      ? getResourceAttribution(event, { name: authorName })
      : { indexed: false, creators: [], sourceDomain: null }
  );
  const indexedCreators = $derived(attribution.indexed ? attribution.creators : []);
  // The creator name links to a profile only for a single pubkey creator —
  // mixed/multiple author groups stay plain text (the card itself navigates).
  const singleCreatorPubkey = $derived(
    indexedCreators.length === 1 ? indexedCreators[0].pubkey : undefined
  );
  const shownAuthorPubkey = $derived(indexedCreators.length ? singleCreatorPubkey : authorPubkey);
  const creatorNames = $derived(indexedCreators.map((c) => c.name ?? c.pubkey?.slice(0, 8) + '…'));
  const shownAuthorName = $derived(
    indexedCreators.length ? formatCreatorNames(creatorNames) : authorName
  );
  // Full author list as hover title — the visible line truncates/caps at +N.
  const fullCreatorNames = $derived(
    indexedCreators.length ? creatorNames.filter(Boolean).join(', ') : undefined
  );

  /** @type {Record<string, { label: () => string, icon: any }>} */
  const typeMeta = {
    calendar: { label: () => m.feed_badge_calendar(), icon: CalendarIcon },
    learning: { label: () => m.feed_badge_learning(), icon: GraduationCapIcon },
    article: { label: () => m.feed_badge_article(), icon: ScrollTextIcon },
    board: { label: () => m.feed_badge_board(), icon: KanbanIcon },
    wiki: { label: () => m.feed_badge_wiki(), icon: WikipediaIcon },
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
   * Parse a calendar start (unix timestamp string for timed events, ISO date
   * for all-day events) into date-row display parts. Returns null when the
   * value is unparseable so the caller can fall back to plain text.
   *
   * @param {string} startStr
   * @returns {{ day: string, month: string, when: string } | null}
   */
  function parseCalendarStart(startStr) {
    const num = Number(startStr);
    const isTimed = !isNaN(num) && num > 0;
    const date = isTimed ? new Date(num * 1000) : new Date(startStr);
    if (isNaN(date.getTime())) return null;
    const locale = activeDateLocale();
    const when = isTimed
      ? `${date.toLocaleDateString(locale, { year: 'numeric' })}, ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
      : `${date.toLocaleDateString(locale, { weekday: 'long' })}, ${date.toLocaleDateString(locale, { year: 'numeric' })}`;
    return {
      day: date.toLocaleDateString(locale, { day: 'numeric' }),
      month: date.toLocaleDateString(locale, { month: 'short' }),
      when
    };
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
  {#if indexedCreators.length}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="flex-shrink-0" onclick={(e) => e.stopPropagation()}>
      <CreatorAvatarStack creators={indexedCreators} size="md" />
    </div>
  {:else if shownAuthorPubkey}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="flex-shrink-0" onclick={(e) => e.stopPropagation()}>
      <ProfileAvatar pubkey={shownAuthorPubkey} size="md" linkToProfile showHoverCard />
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
    {#if shownAuthorName}
      <div class="flex items-center gap-1.5">
        {#if shownAuthorPubkey}
          <a
            href={resolve(profileLink(shownAuthorPubkey))}
            class="truncate text-sm font-medium text-base-content hover:underline"
            title={fullCreatorNames}
            onclick={(e) => e.stopPropagation()}
          >
            {shownAuthorName}
          </a>
        {:else}
          <span class="truncate text-sm font-medium text-base-content" title={fullCreatorNames}>
            {shownAuthorName}
          </span>
        {/if}
        {#if timestamp}
          <span class="text-base-content/30">&middot;</span>
          <span class="shrink-0 text-xs text-base-content/50">
            {formatRelativeTime(timestamp)}
          </span>
        {/if}
      </div>
      {#if indexedCreators.length && attribution.sourceDomain}
        <div
          class="truncate font-mono text-xs text-base-content/60"
          data-testid="metadata-attribution"
        >
          {attribution.sourceDomain}
        </div>
      {/if}
    {:else if timestamp}
      <span class="text-xs text-base-content/50">
        {formatRelativeTime(timestamp)}
      </span>
    {/if}

    <h3 class="mt-0.5 line-clamp-2 text-base font-bold text-base-content">{title}</h3>

    {#if subtitle}
      {#if typeKey === 'calendar'}
        {@const dateParts = parseCalendarStart(subtitle)}
        {#if dateParts}
          <div class="mt-2 mb-1 flex items-center gap-3.5 rounded-lg bg-base-200 px-3 py-2">
            <div class="min-w-7 text-center leading-none">
              <span class="block text-2xl font-extrabold tracking-tight text-secondary">
                {dateParts.day}
              </span>
              <span
                class="mt-1 block text-[10px] font-semibold tracking-widest text-base-content/60 uppercase"
              >
                {dateParts.month}
              </span>
            </div>
            <div class="min-w-0 text-sm font-medium">
              {dateParts.when}
              {#if location}
                <span class="mt-0.5 block truncate font-mono text-xs text-base-content/60">
                  {location}
                </span>
              {/if}
            </div>
          </div>
        {:else}
          <p class="mt-0.5 truncate text-xs text-base-content/60">{subtitle}</p>
        {/if}
      {:else}
        <p class="mt-0.5 truncate text-xs text-base-content/60">{subtitle}</p>
      {/if}
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
    <!-- In flex flow (not absolute) so long author names/titles truncate
         before the badge instead of running underneath it. -->
    <div
      class="flex flex-shrink-0 items-center gap-1 self-start rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap backdrop-blur-sm {kindColor
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
