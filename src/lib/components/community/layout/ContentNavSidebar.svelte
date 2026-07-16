<script>
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
    MeetIcon,
    PollIcon,
    LockIcon,
    LockOpenIcon
  } from '$lib/components/icons';
  import { getCommunityTabs } from '$lib/helpers/contentTypes.js';
  import * as m from '$lib/paraglide/messages';

  let {
    selectedContentType = $bindable(),
    onContentTypeSelect,
    communitySelected = true,
    communityProfile = /** @type {any} */ (null),
    communityPubkey: _communityPubkey = /** @type {string | null} */ (null),
    restrictedTabs = /** @type {Set<string>} */ (new Set()),
    accessibleTabs = /** @type {Set<string>} */ (new Set()),
    communityEvent = /** @type {any} */ (null)
  } = $props();

  import { getProfilePicture } from 'applesauce-core/helpers';
  import ImageWithFallback from '../../shared/ImageWithFallback.svelte';

  let communityDisplayName = $derived(
    communityProfile?.name || communityProfile?.display_name || 'Community'
  );
  let communityAvatarUrl = $derived(getProfilePicture(communityProfile));

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
    meet: MeetIcon,
    polls: PollIcon,
    settings: SettingsIcon
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
    meet: () => m.community_layout_bottom_tab_bar_meet(),
    polls: () => m.community_layout_bottom_tab_bar_polls(),
    settings: () => m.community_layout_bottom_tab_bar_settings()
  };

  let contentTypes = $derived(
    getCommunityTabs(communityEvent).map((id) => ({
      id,
      label: labelMap[id]?.() ?? id,
      icon: iconMap[id] ?? ChatIcon
    }))
  );

  /**
   * Handle content type selection
   * @param {string} type
   */
  function handleContentTypeClick(type) {
    if (onContentTypeSelect) {
      onContentTypeSelect(type);
    }
  }
</script>

<!-- Desktop: Flex sibling in chrome row -->
<div
  data-testid="content-nav-sidebar"
  class="hidden w-(--sidebar-nav-w) flex-col overflow-y-auto bg-base-200 lg:flex"
>
  {#if !communitySelected}
    <div
      class="flex h-full flex-col items-center justify-center p-6 text-center text-base-content/60"
    >
      <p class="text-sm">{m.community_layout_content_nav_select_community()}</p>
    </div>
  {:else}
    {#if communityProfile}
      <div class="flex items-center gap-3 p-4">
        <div class="avatar">
          <div class="w-9 rounded-full ring-1 ring-base-300">
            <ImageWithFallback
              src={communityAvatarUrl}
              alt={communityDisplayName}
              size="avatar_md"
              class="h-full w-full rounded-full object-cover"
            />
          </div>
        </div>
        <h2 class="truncate text-sm font-semibold text-base-content">{communityDisplayName}</h2>
      </div>
    {/if}
    <nav class="menu space-y-1 p-4">
      {#each contentTypes as type (type.id)}
        {@const isActive = selectedContentType === type.id}
        {@const Icon = type.icon}
        <button
          onclick={() => handleContentTypeClick(type.id)}
          class="flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 {isActive
            ? 'bg-primary text-primary-content'
            : 'hover:bg-base-300/60'}"
        >
          <Icon class_="w-5 h-5" />
          <span class="relative">
            <span class="text-sm font-medium">{type.label}</span>
            {#if restrictedTabs.has(type.id)}
              {#if accessibleTabs.has(type.id)}
                <span
                  class="absolute -top-1.5 -right-3"
                  title={m.community_content_tab_access_granted()}
                >
                  <LockOpenIcon class_="w-2.5 h-2.5 text-success" />
                </span>
              {:else}
                <span
                  class="absolute -top-1.5 -right-3 opacity-60"
                  title={m.community_content_tab_restricted()}
                >
                  <LockIcon class_="w-2.5 h-2.5" />
                </span>
              {/if}
            {/if}
          </span>
        </button>
      {/each}
    </nav>
  {/if}
</div>
