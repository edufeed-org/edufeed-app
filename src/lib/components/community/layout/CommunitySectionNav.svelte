<script>
  // Phone section switcher for a community: a sticky row (Bereiche chip +
  // current section) and a bottom sheet with every section as a tile.
  // Replaces the horizontally scrolling BottomTabBar (QA 2026-10-13: Kalender
  // and Einstellungen were two arrow taps away, locks unexplained).
  import {
    HomeIcon,
    ChatIcon,
    CalendarIcon,
    SettingsIcon,
    WikipediaIcon,
    GraduationCapIcon,
    KanbanIcon,
    ScrollTextIcon,
    ForumIcon,
    BookmarkShareIcon,
    PollIcon,
    LockIcon,
    LockOpenIcon,
    ChannelsIcon,
    GridIcon
  } from '$lib/components/icons';
  import { useConcordCommunity } from '$lib/concord/community.svelte.js';
  import { parseGroupPointers } from '$lib/groups/community-pointer.js';
  import { communityNavTabIds } from './community-nav.js';
  import { requestChannelList } from '$lib/groups/group-channel-selection.svelte.js';
  import { areaUnreadState } from '$lib/concord/notifications.svelte.js';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import BottomSheet from '$lib/components/shared/BottomSheet.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   selectedContentType: string,
   *   onContentTypeSelect: (type: string) => void,
   *   communityEvent?: any,
   *   restrictedTabs?: Set<string>,
   *   accessibleTabs?: Set<string>
   * }}
   */
  let {
    selectedContentType,
    onContentTypeSelect,
    communityEvent = null,
    restrictedTabs = new Set(),
    accessibleTabs = new Set()
  } = $props();

  let open = $state(false);

  const getConcord = useConcordCommunity(() => communityEvent);
  const concordAreaFlags = $derived(areaUnreadState(getConcord().pointer?.communityId));

  /** @type {Record<string, any>} */
  const iconMap = {
    home: HomeIcon,
    chat: ChatIcon,
    calendar: CalendarIcon,
    learning: GraduationCapIcon,
    boards: KanbanIcon,
    articles: ScrollTextIcon,
    forum: ForumIcon,
    wikis: WikipediaIcon,
    'social-bookmarks': BookmarkShareIcon,
    polls: PollIcon,
    settings: SettingsIcon,
    channels: ChannelsIcon
  };

  /** @type {Record<string, () => string>} */
  const labelMap = {
    home: () => m.community_layout_bottom_tab_bar_home(),
    chat: () => m.community_layout_bottom_tab_bar_chat(),
    calendar: () => m.community_layout_bottom_tab_bar_calendar(),
    learning: () => m.community_layout_bottom_tab_bar_learning(),
    boards: () => m.community_layout_bottom_tab_bar_boards(),
    articles: () => m.community_layout_bottom_tab_bar_articles(),
    forum: () => m.community_layout_bottom_tab_bar_forum(),
    wikis: () => m.community_wikis_title(),
    'social-bookmarks': () => m.community_layout_bottom_tab_bar_social_bookmarks(),
    polls: () => m.community_layout_bottom_tab_bar_polls(),
    settings: () => m.community_layout_bottom_tab_bar_settings(),
    channels: () => m.concord_tab_label()
  };

  const sections = $derived.by(() => {
    const concord = getConcord();
    return communityNavTabIds({
      communityEvent,
      concordEnabled: concord.enabled,
      pointer: concord.pointer,
      isMember: concord.membership === 'member',
      hasGroupChannels: parseGroupPointers(communityEvent).length > 0
    }).map((id) => ({ id, label: labelMap[id]?.() ?? id, icon: iconMap[id] ?? ChatIcon }));
  });
  const currentLabel = $derived(sections.find((s) => s.id === selectedContentType)?.label ?? '');

  /** @param {string} id */
  function select(id) {
    // Kanäle is also the way back: tapped while a channel is open, it returns
    // to the channel list instead of re-selecting the same view.
    if (id === 'channels') requestChannelList(communityEvent?.pubkey);
    open = false;
    onContentTypeSelect(id);
  }
</script>

<div
  data-testid="section-row"
  class="sticky top-0 z-20 flex items-center gap-2 bg-base-200 px-4 py-2"
>
  <button
    type="button"
    data-testid="section-open"
    class="btn gap-1.5 rounded-full btn-sm btn-neutral"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={m.community_sections_open_aria()}
    onclick={() => (open = true)}
  >
    <GridIcon class_="h-4 w-4" />
    {m.community_sections_title()}
  </button>
  <span data-testid="section-current" class="truncate text-sm font-medium">{currentLabel}</span>
</div>

<BottomSheet
  {open}
  title={m.community_sections_title()}
  onClose={() => (open = false)}
  testid="section-sheet"
>
  {#snippet legend()}
    <span class="inline-flex items-center gap-1">
      <LockIcon class_="h-3 w-3" />
      {m.community_sections_legend_members_only()}
    </span>
  {/snippet}
  <div class="grid grid-cols-3 gap-2">
    {#each sections as section (section.id)}
      {@const Icon = section.icon}
      {@const isActive = selectedContentType === section.id}
      {@const restricted = restrictedTabs.has(section.id)}
      <button
        type="button"
        data-testid="section-tile-{section.id}"
        aria-current={isActive ? 'page' : undefined}
        class="relative flex h-[76px] flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium {isActive
          ? 'bg-primary/10 text-primary'
          : 'bg-base-200 text-base-content'}"
        onclick={() => select(section.id)}
      >
        <Icon class_="h-6 w-6" />
        <span class="leading-tight">{section.label}</span>
        {#if restricted}
          <span
            data-testid="section-lock-{section.id}"
            data-state={accessibleTabs.has(section.id) ? 'open' : 'closed'}
            class="absolute top-1.5 right-2"
            title={accessibleTabs.has(section.id)
              ? m.community_content_tab_access_granted()
              : m.community_content_tab_restricted()}
          >
            {#if accessibleTabs.has(section.id)}
              <LockOpenIcon class_="h-3 w-3 text-success" />
            {:else}
              <LockIcon class_="h-3 w-3 opacity-60" />
            {/if}
          </span>
        {/if}
        {#if section.id === 'channels'}
          <span class="absolute top-1.5 left-2">
            <ConcordUnreadDot
              unread={concordAreaFlags.unread}
              mentioned={concordAreaFlags.mentioned}
            />
          </span>
        {/if}
      </button>
    {/each}
  </div>
</BottomSheet>
