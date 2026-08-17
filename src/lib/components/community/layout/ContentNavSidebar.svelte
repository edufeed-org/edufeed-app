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
    LockOpenIcon,
    PeopleIcon
  } from '$lib/components/icons';
  import { useConcordCommunity } from '$lib/concord/community.svelte.js';
  import { parseGroupPointers } from '$lib/groups/community-pointer.js';
  import { communityNavTabIds, buildSidebarZones } from './community-nav.js';
  import {
    areaUnreadState,
    channelUnreadState,
    getToastsEnabled,
    setToastsEnabled
  } from '$lib/concord/notifications.svelte.js';
  import {
    getSelectedConcordChannel,
    selectConcordChannel,
    requestChannelCreate
  } from '$lib/concord/active-channel.svelte.js';
  import { groupHref } from '$lib/groups/groups.js';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import ChannelRailRow from '../channels/ChannelRailRow.svelte';
  import { isCommunityOwner } from '$lib/helpers/community-signer.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    selectedContentType = $bindable(),
    onContentTypeSelect,
    communitySelected = true,
    communityProfile = /** @type {any} */ (null),
    communityPubkey: _communityPubkey = /** @type {string | null} */ (null),
    restrictedTabs = /** @type {Set<string>} */ (new Set()),
    accessibleTabs = /** @type {Set<string>} */ (new Set()),
    communityEvent = /** @type {any} */ (null),
    channelRows = /** @type {import('$lib/groups/community-channel-rows.js').ChannelRow[]} */ ([]),
    isMember = false
  } = $props();

  import { getProfilePicture } from 'applesauce-core/helpers';
  import ImageWithFallback from '../../shared/ImageWithFallback.svelte';

  const getConcord = useConcordCommunity(() => communityEvent);
  const concordCommunityId = $derived(getConcord().pointer?.communityId);
  const concordAreaFlags = $derived(areaUnreadState(concordCommunityId));
  const isOwner = $derived(isCommunityOwner(communityEvent?.pubkey));
  // Owner-UI appears because a key in THIS BROWSER holds the community —
  // possibly a different account than the active one (community-signer.js's
  // deliberate rule). The chip makes that legible instead of confusing:
  // "why do I see admin controls?" (laoc, 2026-08-17, option C).
  const getActiveUserForChip = useActiveUser();
  const managesViaKey = $derived(
    isOwner && getActiveUserForChip()?.pubkey !== communityEvent?.pubkey
  );

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
    settings: SettingsIcon,
    members: PeopleIcon,
    channels: LockIcon
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
    settings: () => m.community_layout_bottom_tab_bar_settings(),
    members: () => m.community_members_title(),
    channels: () => m.concord_tab_label()
  };

  // Tab ids (same rule BottomTabBar uses — see communityNavTabIds' doc
  // comment) feed buildSidebarZones, which splits them into the sidebar's
  // two zones + footer and filters/dedupes channelRows for the current
  // viewer. The 'channels' tab id itself is dropped by buildSidebarZones —
  // on desktop the Kanäle zone replaces it; BottomTabBar keeps it via its
  // own call to communityNavTabIds.
  let zones = $derived.by(() => {
    const concord = getConcord();
    const tabIds = communityNavTabIds({
      communityEvent,
      concordEnabled: concord.enabled,
      pointer: concord.pointer,
      isOwner,
      isMember: concord.membership === 'member',
      // Second source for the same tab, and not Concord: a community
      // extended by NIP-29 groups has none of the Concord inputs above.
      hasGroupChannels: parseGroupPointers(communityEvent).length > 0
    });
    return buildSidebarZones({ tabs: tabIds, channelRows, isMember, isOwner });
  });

  /**
   * @param {string} id
   * @returns {{id: string, label: string, icon: any}}
   */
  function tabRow(id) {
    return { id, label: labelMap[id]?.() ?? id, icon: iconMap[id] ?? ChatIcon };
  }

  /**
   * Handle content type selection
   * @param {string} type
   * @param {string} [channelId]
   */
  function handleContentTypeClick(type, channelId) {
    if (onContentTypeSelect) {
      onContentTypeSelect(type, channelId);
    }
  }

  /**
   * A Concord row click. The `?channel=` param on the resulting navigation
   * only seeds PrivateChannelsView's deep-link effect, which is guarded by
   * `!getSelectedConcordChannel(cid)` — after ANY channel has ever been
   * selected in this community this session, that guard is permanently
   * closed and later clicks would silently stop switching channels (bug:
   * review of 187b4c0b, critical 1). Set the shared selection directly at
   * the click source instead, so the row always drives the channel that
   * ends up rendered, independent of the deep-link effect's one-shot guard.
   * @param {string} channelId
   */
  function selectConcordRow(channelId) {
    if (concordCommunityId) selectConcordChannel(concordCommunityId, channelId);
    handleContentTypeClick('channels', channelId);
  }

  /**
   * A channel row's key is untrusted network-derived data (pointer id/relay,
   * or a Concord channel_id) and may contain characters a data-testid must
   * not — collapse anything that isn't alphanumeric to a dash.
   * @param {string} key
   */
  function rowTestId(key) {
    return `nav-channel-row-${key.replace(/[^a-zA-Z0-9]/g, '-')}`;
  }

  // Notification bell + invite-inbox entry, moved here from
  // PrivateChannelsView's rail when that rail became mobile-only
  // (2026-08-17, "double sidebar") — on desktop this zone is the only
  // channel surface, so its rail-only controls needed a home here. Same
  // toggle logic as the rail's bell.
  const concordSignerHasNip44 = $derived(getConcord().signerHasNip44);
  // Area exists but hasn't caught up to the relay tip ('idle' pre-sync,
  // 'syncing' during; only 'live' means the row list is complete) — shown as
  // a small spinner in the zone header so an empty-looking zone right after
  // boot/accept reads as "loading", not "no channels".
  const concordSyncing = $derived.by(() => {
    const concord = getConcord();
    return !!concord.community && (concord.phase === 'syncing' || concord.phase === 'idle');
  });
  const notificationSupported = typeof Notification !== 'undefined';
  let permissionDenied = $state(notificationSupported && Notification.permission === 'denied');
  const toastsOn = $derived(getToastsEnabled());

  async function toggleToasts() {
    if (getToastsEnabled()) {
      await setToastsEnabled(false);
      return;
    }
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      permissionDenied = permission === 'denied';
      if (permission !== 'granted') return;
    }
    await setToastsEnabled(true);
  }
</script>

{#snippet tabButton(/** @type {{id: string, label: string, icon: any}} */ type)}
  {@const isActive = selectedContentType === type.id}
  {@const Icon = type.icon}
  <!-- The access badge trails at the row's right edge (Armada's rail
    pattern, laoc 2026-08-17) — a superscript lock floating over the label
    read as misalignment, not as a badge. -->
  <button
    data-testid="content-nav-{type.id}"
    onclick={() => handleContentTypeClick(type.id)}
    class="flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 {isActive
      ? 'bg-primary text-primary-content'
      : 'hover:bg-base-300/60'}"
  >
    <Icon class_="w-5 h-5" />
    <span class="min-w-0 flex-1 truncate text-left text-sm font-medium">{type.label}</span>
    {#if restrictedTabs.has(type.id)}
      {#if accessibleTabs.has(type.id)}
        <span class="shrink-0" title={m.community_content_tab_access_granted()}>
          <LockOpenIcon class_="w-3 h-3 text-success" />
        </span>
      {:else}
        <span class="shrink-0 opacity-60" title={m.community_content_tab_restricted()}>
          <LockIcon class_="w-3 h-3" />
        </span>
      {/if}
    {/if}
  </button>
{/snippet}

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
      {@const isHomeActive = selectedContentType === 'home'}
      <button
        type="button"
        data-testid="nav-header-home"
        onclick={() => handleContentTypeClick('home')}
        class="flex w-full items-center gap-3 p-4 text-left transition-all duration-200 {isHomeActive
          ? 'bg-primary text-primary-content'
          : 'hover:bg-base-300/60'}"
      >
        <div class="avatar">
          <div class="w-9 rounded-full ring-1 ring-base-300">
            <ImageWithFallback
              src={communityAvatarUrl}
              alt={communityDisplayName}
              fallbackType="community"
              size="avatar_md"
              class="h-full w-full rounded-full object-cover"
            />
          </div>
        </div>
        <span class="truncate text-sm font-semibold">{communityDisplayName}</span>
      </button>
      {#if managesViaKey}
        <div
          class="mx-4 mb-1 rounded-lg bg-base-300/50 px-2 py-1 text-[0.7rem] text-base-content/60"
          data-testid="manager-chip"
          title={m.community_manager_chip_hint()}
        >
          ⚙ {m.community_manager_chip()}
        </div>
      {/if}
    {/if}

    <nav class="menu w-full space-y-1 p-4 pb-0">
      <div
        data-testid="nav-zone-inhalte"
        class="px-4 pb-1 text-xs font-semibold text-base-content/50 uppercase"
      >
        {m.community_nav_inhalte()}
      </div>
      {#each zones.inhalte as id (id)}
        {@render tabButton(tabRow(id))}
      {/each}
    </nav>

    {#if zones.kanaele.length > 0 || zones.showLockHint || zones.showCreateEntry || concordSyncing}
      <nav class="menu w-full space-y-1 p-4 pt-2">
        <div
          data-testid="nav-zone-kanaele"
          class="flex items-center gap-1.5 px-4 pb-1 text-xs font-semibold text-base-content/50 uppercase"
        >
          <span>{m.community_nav_kanaele()}</span>
          <ConcordUnreadDot
            unread={concordAreaFlags.unread}
            mentioned={concordAreaFlags.mentioned}
          />
          {#if concordSyncing}
            <span
              class="loading loading-xs loading-spinner text-base-content/40"
              data-testid="nav-kanaele-syncing"
              title={m.concord_sync_title()}
            ></span>
          {/if}
          {#if notificationSupported && concordSignerHasNip44}
            <button
              class="btn ml-auto btn-circle btn-ghost btn-xs"
              data-testid="nav-concord-notif-bell"
              disabled={permissionDenied}
              title={permissionDenied
                ? m.concord_notif_bell_denied()
                : toastsOn
                  ? m.concord_notif_bell_on()
                  : m.concord_notif_bell_off()}
              onclick={toggleToasts}
            >
              {toastsOn ? '🔔' : '🔕'}
            </button>
          {/if}
        </div>
        {#each zones.kanaele as row (row.key)}
          {#if row.source === 'concord'}
            {@const flags = channelUnreadState(concordCommunityId, row.channel_id)}
            <ChannelRailRow
              symbol={row.symbol}
              name={row.name}
              locked={row.locked}
              testid={rowTestId(row.key)}
              active={selectedContentType === 'channels' &&
                getSelectedConcordChannel(concordCommunityId) === row.channel_id}
              dimmed={!row.accessible}
              bold={flags.unread}
              onclick={() => selectConcordRow(row.channel_id)}
            >
              {#snippet trailing()}
                <ConcordUnreadDot unread={flags.unread} mentioned={flags.mentioned} />
              {/snippet}
            </ChannelRailRow>
          {:else}
            <ChannelRailRow
              href={groupHref(row.pointer)}
              testid={rowTestId(row.key)}
              symbol={row.symbol}
              name={row.name}
              locked={row.locked}
              dimmed={row.pending}
              worldReadable={row.worldReadable}
            />
          {/if}
        {/each}
        {#if zones.showCreateEntry}
          <!-- The owner's desktop path to channel creation — the view's own
            rail is mobile-only since the double-sidebar cleanup. -->
          <button
            data-testid="nav-channels-create"
            onclick={() => {
              requestChannelCreate();
              handleContentTypeClick('channels');
            }}
            class="flex items-center gap-2 rounded-lg border border-dashed border-base-content/25 px-4 py-2 text-sm text-base-content/70 transition-all duration-200 hover:bg-base-300/60"
          >
            + {m.concord_new_channel()}
          </button>
        {/if}
        {#if zones.showLockHint}
          <p data-testid="nav-lock-hint" class="px-2 py-1 text-xs text-base-content/50">
            {m.community_nav_lock_hint()}
          </p>
        {/if}
      </nav>
    {/if}

    <nav class="menu mt-auto space-y-1 p-4">
      {#each zones.footer as id (id)}
        {@const type = tabRow(id)}
        {@const isActive = selectedContentType === type.id}
        {@const Icon = type.icon}
        <button
          data-testid="nav-footer-{type.id}"
          onclick={() => handleContentTypeClick(type.id)}
          class="flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 {isActive
            ? 'bg-primary text-primary-content'
            : 'hover:bg-base-300/60'}"
        >
          <Icon class_="w-5 h-5" />
          <span class="text-sm font-medium">{type.label}</span>
        </button>
      {/each}
    </nav>
  {/if}
</div>
