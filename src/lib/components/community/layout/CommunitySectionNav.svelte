<script>
  // Phone section switcher for a community: a sticky full-width button
  // (current section's icon + name, "N Bereiche", chevron) and a bottom
  // sheet with every section as a tile. The button replaced a "Bereiche"
  // chip nobody read as the menu (issue "mobile: navigation is too
  // complicated", round 2); the sheet replaced the horizontally scrolling
  // BottomTabBar (QA 2026-10-13: Kalender and Einstellungen were two arrow
  // taps away, locks unexplained).
  import { LockIcon, LockOpenIcon, ChevronDownIcon } from '$lib/components/icons';
  import { useConcordCommunity } from '$lib/concord/community.svelte.js';
  import { parseGroupPointers } from '$lib/groups/community-pointer.js';
  import { communityNavTabIds, buildSidebarZones } from './community-nav.js';
  import { sectionLabel, sectionIcon } from './section-labels.js';
  import {
    requestChannelList,
    selectGroupChannel,
    getSelectedGroupChannel
  } from '$lib/groups/group-channel-selection.svelte.js';
  import {
    selectConcordChannel,
    getSelectedConcordChannel,
    requestChannelCreate
  } from '$lib/concord/active-channel.svelte.js';
  import { channelKey } from '$lib/groups/community-pointer.js';
  import { splitFavouriteRows } from '$lib/groups/channel-sections.js';
  import { readFavouriteChannels } from '$lib/groups/favourite-channels.svelte.js';
  import { hasUnreadChannelMention } from '$lib/groups/channel-mentions.svelte.js';
  import { areaUnreadState, channelUnreadState } from '$lib/concord/notifications.svelte.js';
  import { isCommunityOwner } from '$lib/helpers/community-signer.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import ChannelRailRow from '../channels/ChannelRailRow.svelte';
  import BottomSheet from '$lib/components/shared/BottomSheet.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   selectedContentType: string,
   *   onContentTypeSelect: (type: string, channelId?: string) => void,
   *   communityEvent?: any,
   *   restrictedTabs?: Set<string>,
   *   accessibleTabs?: Set<string>,
   *   channelRows?: import('$lib/groups/community-channel-rows.js').ChannelRow[],
   *   isMember?: boolean,
   *   isRootAdmin?: boolean
   * }}
   */
  let {
    selectedContentType,
    onContentTypeSelect,
    communityEvent = null,
    restrictedTabs = new Set(),
    accessibleTabs = new Set(),
    channelRows = [],
    isMember = false,
    isRootAdmin = false
  } = $props();

  let open = $state(false);

  const getConcord = useConcordCommunity(() => communityEvent);
  const concordAreaFlags = $derived(areaUnreadState(getConcord().pointer?.communityId));

  const tabIds = $derived.by(() => {
    const concord = getConcord();
    return communityNavTabIds({
      communityEvent,
      concordEnabled: concord.enabled,
      pointer: concord.pointer,
      isMember: concord.membership === 'member',
      hasGroupChannels: parseGroupPointers(communityEvent).length > 0
    });
  });
  const sections = $derived(
    tabIds.map((id) => ({ id, label: sectionLabel(id), icon: sectionIcon(id) }))
  );

  // Kanäle zone: the same split + visitor filter + create gate the desktop
  // sidebar uses (ContentNavSidebar), so a channel is two taps away on a
  // phone: button → row.
  const isOwner = $derived(isCommunityOwner(communityEvent?.pubkey));
  const zones = $derived(
    buildSidebarZones({ tabs: tabIds, channelRows, isMember, isOwner, isRootAdmin })
  );
  const getActiveUser = useActiveUser();
  const favouritePubkey = $derived(getActiveUser()?.pubkey);
  const kanaele = $derived(
    splitFavouriteRows(zones.kanaele, readFavouriteChannels(favouritePubkey))
  );
  const showChannelZone = $derived(
    zones.kanaele.length > 0 || zones.showLockHint || zones.showCreateEntry
  );
  const concordCommunityId = $derived(getConcord().pointer?.communityId);

  /** @param {string} key */
  function rowTestId(key) {
    return `section-channel-row-${key.replace(/[^a-zA-Z0-9]/g, '-')}`;
  }

  /** @param {string} channelId */
  function selectConcordRow(channelId) {
    if (concordCommunityId) selectConcordChannel(concordCommunityId, channelId);
    open = false;
    onContentTypeSelect('channels', channelId);
  }

  /** @param {{id: string, relay: string}} pointer */
  function selectGroupRow(pointer) {
    const key = channelKey(pointer);
    if (key && communityEvent?.pubkey) selectGroupChannel(communityEvent.pubkey, key);
    open = false;
    onContentTypeSelect('channels', pointer.id);
  }

  function createChannel() {
    requestChannelCreate();
    open = false;
    onContentTypeSelect('channels');
  }
  const current = $derived(sections.find((s) => s.id === selectedContentType));
  const currentLabel = $derived(current?.label ?? '');
  const currentIcon = $derived(current?.icon ?? null);

  /** @param {string} id */
  function select(id) {
    // Kanäle is also the way back: tapped while a channel is open, it returns
    // to the channel list instead of re-selecting the same view.
    if (id === 'channels') requestChannelList(communityEvent?.pubkey);
    open = false;
    onContentTypeSelect(id);
  }
</script>

<!-- top-18 = the /c mobile header's 4.5rem (p-4 + btn), which pins above
     this row at z-30 in the same scroll surface. -->
<div data-testid="section-row" class="sticky top-18 z-20 bg-base-200 px-4 py-2">
  <button
    type="button"
    data-testid="section-open"
    class="flex h-13 w-full items-center gap-2.5 rounded-2xl border border-base-300 bg-base-100 px-3 text-left"
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open = true)}
  >
    {#if currentIcon}
      {@const CurrentIcon = currentIcon}
      <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <CurrentIcon class_="h-4 w-4" />
      </span>
    {/if}
    <span data-testid="section-current" class="flex min-w-0 flex-1 items-center gap-1.5">
      <span class="truncate text-base font-semibold">{currentLabel}</span>
      <ConcordUnreadDot unread={concordAreaFlags.unread} mentioned={concordAreaFlags.mentioned} />
    </span>
    <span data-testid="section-count" class="shrink-0 text-xs text-base-content/60"
      >{m.community_sections_count({ count: sections.length })}</span
    >
    <ChevronDownIcon class_="h-5 w-5 shrink-0 text-base-content/60" />
  </button>
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
  {#if showChannelZone}
    <div data-testid="section-channels" class="mt-4">
      <div class="mb-1 px-1 text-xs font-semibold tracking-wide text-base-content/60 uppercase">
        {m.community_nav_kanaele()}
      </div>
      {#snippet channelRow(/** @type {any} */ row)}
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
            testid={rowTestId(row.key)}
            symbol={row.symbol}
            name={row.name}
            locked={row.locked}
            active={selectedContentType === 'channels' &&
              getSelectedGroupChannel(communityEvent?.pubkey) === channelKey(row.pointer)}
            dimmed={row.pending}
            worldReadable={row.worldReadable}
            hidden={row.hidden === true}
            onclick={() => selectGroupRow(row.pointer)}
          >
            {#snippet trailing()}
              <ConcordUnreadDot mentioned={hasUnreadChannelMention(row.pointer?.id)} />
            {/snippet}
          </ChannelRailRow>
        {/if}
      {/snippet}
      <div class="flex flex-col">
        {#each kanaele.favourites as row (row.key)}
          {@render channelRow(row)}
        {/each}
        {#if kanaele.favourites.length > 0 && kanaele.rest.length > 0}
          <div class="my-1 border-t border-base-content/10"></div>
        {/if}
        {#each kanaele.rest as row (row.key)}
          {@render channelRow(row)}
        {/each}
      </div>
      {#if zones.showCreateEntry}
        <button
          type="button"
          data-testid="section-channel-create"
          onclick={createChannel}
          class="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-base-content/25 px-4 py-2.5 text-left text-sm text-base-content/70"
        >
          + {m.concord_new_channel()}
        </button>
      {/if}
      {#if zones.showLockHint}
        <p data-testid="section-lock-hint" class="px-4 py-2 text-xs text-base-content/50">
          {m.community_nav_lock_hint()}
        </p>
      {/if}
    </div>
  {/if}
</BottomSheet>
