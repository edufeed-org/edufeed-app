<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';
  import { useJoinedCommunitiesList } from '$lib/stores/joined-communities-list.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  // Directly from the concord submodule, never the $lib/concord barrel —
  // convention every Concord call site follows (see CLAUDE.md's Concord
  // section) so this stays SSR-clean.
  import {
    useUnlinkedConcordAreas,
    useConcordListLocked
  } from '$lib/concord/unlinked-areas.svelte.js';
  import { useUnlinkedGroups } from '$lib/groups/unlinked-groups.svelte.js';

  import { getConcordState, unlockConcordLists } from '$lib/concord/client.svelte.js';
  import { areaUnreadState } from '$lib/concord/notifications.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { HomeIcon, LockOpenIcon, ChevronDownIcon, TrashIcon } from '$lib/components/icons';
  import { resolve } from '$app/paths';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  // The rail is one arrangeable list now (Armada parity, laoc 2026-08-06):
  // communities, unlinked Concord areas and unlinked NIP-29 groups share one
  // order the user controls, with Discord-style folders. Every rule is pure
  // and lives in $lib/rail; this component only wires the gesture to it.
  import { buildRailEntries, entriesOf } from '$lib/rail/rail-entries.js';
  import { relayHref } from '$lib/groups/relay-directory.js';
  import RailRelayIcon from './RailRelayIcon.svelte';
  import RelayLabel from './RelayLabel.svelte';
  import {
    folderAnchor,
    dropIntent,
    resolveDrop,
    renameFolder,
    dissolveFolder
  } from '$lib/rail/rail-layout.js';
  import {
    useRailLayout,
    writeRailLayout,
    readOpenFolders,
    writeOpenFolders,
    nextFolderId
  } from '$lib/rail/rail-layout-store.svelte.js';
  import RailEntryIcon from './RailEntryIcon.svelte';
  import RailFolderTile from './RailFolderTile.svelte';
  import {
    activeRailTarget,
    isEntryActive,
    shouldBringActiveIntoView
  } from '$lib/rail/rail-active.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { PlusIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  let {
    currentCommunityId,
    onCommunitySelect,
    isDashboardActive = false,
    onHomeSelect,
    // The route, because only a route can say which AREA or which HOST you are
    // looking at — `currentCommunityId` covers exactly one of the rail's three
    // kinds. Passed in rather than read from $app/stores here: every other
    // input this component has arrives as a prop, and the two layouts that
    // mount it already hold the page store.
    currentPath = ''
  } = $props();

  const getJoinedCommunities = useJoinedCommunitiesList();
  const joinedCommunities = $derived(getJoinedCommunities());

  // Create non-mutating copy to avoid Svelte 5 state mutation error
  const sortedCommunities = $derived([...joinedCommunities]);

  // NIP-29 groups the user belongs to that no followed community shows as a
  // channel — the same idea as the unlinked Concord areas, one protocol over
  // (laoc 2026-08-06: "wie vorher die Concord Gruppen").
  const getUnlinkedGroups = useUnlinkedGroups();
  const unlinkedGroupRows = $derived(getUnlinkedGroups());

  const getUnlinkedAreas = useUnlinkedConcordAreas();
  const unlinkedAreas = $derived(
    runtimeConfig.concord?.enabled ? getUnlinkedAreas() : /** @type {any[]} */ ([])
  );

  // "Sync private areas" affordance (Fix 2) — see the matching comment in
  // Sidebar.svelte for the full rationale. Shown even with zero unlinked
  // areas: a locked list is exactly why the list looks empty.
  const getListLocked = useConcordListLocked();
  const listLocked = $derived(runtimeConfig.concord?.enabled ? getListLocked() : false);
  const concordReady = $derived(getConcordState().phase === 'ready');
  const signerHasNip44 = $derived(!!getConcordState().client?.signer?.nip44);
  const unlocking = $derived(getConcordState().unlocking);
  const showUnlockAffordance = $derived(
    runtimeConfig.concord?.enabled && concordReady && listLocked
  );

  async function handleUnlockAreas() {
    const ok = await unlockConcordLists();
    if (!ok) showToast(m.concord_unlock_failed(), 'error');
  }

  /**
   * Handle community selection - uses route-based navigation
   * @param {string} pubkey
   */
  function handleCommunityClick(pubkey) {
    if (onCommunitySelect) {
      onCommunitySelect(pubkey);
    }
  }

  // ---- the arrangeable rail -------------------------------------------------

  const getActiveUser = useActiveUser();
  const me = $derived(getActiveUser()?.pubkey ?? null);

  // Dissolved areas leave the arrangeable list: read-only history has no
  // business between the living containers (laoc, 2026-08-18) — they render
  // as a dimmed archive cluster at the rail's bottom instead.
  const activeAreas = $derived(unlinkedAreas.filter((area) => !area.dissolved));
  const dissolvedAreas = $derived(unlinkedAreas.filter((area) => area.dissolved));

  const railEntries = $derived(
    buildRailEntries({
      communityPubkeys: sortedCommunities,
      areas: activeAreas,
      groups: unlinkedGroupRows
    })
  );
  const entriesByKey = $derived(new Map(railEntries.map((entry) => [entry.key, entry])));
  const getLayout = useRailLayout(
    () => me,
    () => railEntries.map((entry) => entry.key)
  );
  const layout = $derived(getLayout());
  const openFolders = $derived(readOpenFolders(me));

  // Where you are, as a container: one rule for all three kinds, so a Concord
  // area and a NIP-29 host get the same "you are here" a community always had.
  const activeTarget = $derived(
    activeRailTarget({
      pathname: currentPath,
      communityPubkey: currentCommunityId,
      isDashboardActive
    })
  );
  /** @param {import('$lib/rail/rail-entries.js').RailEntry} entry */
  const isActiveEntry = (entry) => isEntryActive(entry, activeTarget);
  /** @param {import('$lib/rail/rail-entries.js').RailEntry[]} entries */
  const holdsActive = (entries) => entries.some((entry) => isEntryActive(entry, activeTarget));
  /** The anchor of the active row, for the scroll-into-view effect below. */
  const activeAnchor = $derived(
    railEntries.find((entry) => isEntryActive(entry, activeTarget))?.key ?? null
  );

  /** The entry currently being dragged, or a `folder:<id>` anchor. */
  let dragAnchor = $state(/** @type {string | null} */ (null));
  /** Where it would land right now: the row under the pointer and how. */
  let dropAt = $state(/** @type {{anchor: string, intent: string} | null} */ (null));
  /** The folder whose name is being edited. */
  let editingFolder = $state(/** @type {string | null} */ (null));
  let editingName = $state('');

  /** @param {string} id */
  function toggleFolder(id) {
    const next = openFolders.includes(id)
      ? openFolders.filter((f) => f !== id)
      : [...openFolders, id];
    writeOpenFolders(me, next);
  }

  /**
   * @param {DragEvent} event
   * @param {string} anchor
   */
  function onRowDragOver(event, anchor) {
    if (!dragAnchor || anchor === dragAnchor) return;
    // Without preventDefault the browser refuses the drop entirely, so this
    // has to run before any decision about where the entry would land.
    event.preventDefault();
    const rect = /** @type {HTMLElement} */ (event.currentTarget).getBoundingClientRect();
    dropAt = { anchor, intent: dropIntent(event.clientY - rect.top, rect.height) };
  }

  /**
   * @param {DragEvent} event
   * @param {string} anchor
   */
  function onRowDrop(event, anchor) {
    event.preventDefault();
    const source = dragAnchor;
    const intent = dropAt?.anchor === anchor ? dropAt.intent : 'into';
    dragAnchor = null;
    dropAt = null;
    if (!source) return;
    const next = resolveDrop(
      layout,
      source,
      anchor,
      /** @type {any} */ (intent),
      m.rail_folder_default_name(),
      () => nextFolderId(layout)
    );
    if (next !== layout) writeRailLayout(me, next);
  }

  function endDrag() {
    dragAnchor = null;
    dropAt = null;
  }

  /** @param {string} id */
  function startRename(id) {
    editingFolder = id;
    const node = layout.find((n) => n.type === 'folder' && n.id === id);
    editingName = node?.type === 'folder' ? node.name : '';
  }

  function commitRename() {
    if (!editingFolder) return;
    const next = renameFolder(layout, editingFolder, editingName);
    if (next !== layout) writeRailLayout(me, next);
    editingFolder = null;
  }

  /** @param {string} id */
  function removeFolder(id) {
    const next = dissolveFolder(layout, id);
    if (next !== layout) writeRailLayout(me, next);
    writeOpenFolders(
      me,
      openFolders.filter((f) => f !== id)
    );
    editingFolder = null;
  }

  /**
   * The ring a row wears while a drag hovers it. 'into' means "these belong
   * together", so it reads as a highlight; the reorder readings draw a line on
   * the edge the entry would land on.
   * @param {string} anchor
   */
  function dropClass(anchor) {
    if (dropAt?.anchor !== anchor) return '';
    if (dropAt.intent === 'into') return 'rail-drop-into';
    return dropAt.intent === 'before' ? 'rail-drop-before' : 'rail-drop-after';
  }

  // Scroll affordance for the hidden-scrollbar rail (design page "Rail Fix"):
  // edge fades + a chevron appear only while more content exists in that
  // direction. `railEl` is $state so the effect below re-runs once bind:this
  // lands (project gotcha: bind:this as DOM-ready signal).
  /** @type {HTMLElement | undefined} */
  let railEl = $state();
  let canScrollUp = $state(false);
  let canScrollDown = $state(false);

  function updateScrollHints() {
    if (!railEl) return;
    canScrollUp = railEl.scrollTop > 4;
    canScrollDown = railEl.scrollTop + railEl.clientHeight < railEl.scrollHeight - 4;
  }

  $effect(() => {
    // Read list lengths first so the effect re-runs when entries are added or
    // removed (avatars/areas loading in changes scrollHeight without a scroll
    // or resize event).
    void sortedCommunities.length;
    void unlinkedAreas.length;
    const el = railEl;
    if (!el) return;
    updateScrollHints();
    const observer = new ResizeObserver(updateScrollHints);
    observer.observe(el);
    return () => observer.disconnect();
  });

  // The rail is taller than the screen for anyone with a dozen containers, so
  // a ring on a row below the fold says nothing. This is the answer to "hosts
  // first, or keep the order?": neither reorders anything — the row you are in
  // is brought to you, and the order you arranged stays yours.
  /** Bookkeeping for shouldBringActiveIntoView, not UI state. */
  let lastAnchorScrolledTo = /** @type {string | null} */ (null);
  $effect(() => {
    // Read the layout so this re-runs when the row appears (entries arrive
    // after the first paint) and when a folder opens or closes. Those two
    // moments are the ONLY ones allowed to move the rail — the effect also
    // fires on every streaming rebuild, and shouldBringActiveIntoView is
    // what keeps those re-runs from yanking the rail mid-scroll.
    void layout.length;
    void openFolders.length;
    const anchor = activeAnchor;
    const el = railEl;
    if (!el) return;
    const row = anchor
      ? [...el.querySelectorAll('[data-rail-anchor]')].find(
          (node) => node.getAttribute('data-rail-anchor') === anchor
        )
      : undefined;
    // jsdom has no scrollIntoView at all, and a folded-away row has no node.
    const rowPresent = !!row && typeof (/** @type {any} */ (row).scrollIntoView) === 'function';
    const { scroll, nextLast } = shouldBringActiveIntoView({
      anchor,
      rowPresent,
      lastAnchor: lastAnchorScrolledTo
    });
    lastAnchorScrolledTo = nextLast;
    if (scroll && row) {
      // Already on screen: leave the rail exactly where the reader put it.
      // Off screen: 'center' rather than 'nearest', which parks the row on the
      // very edge — half of a 48px icon at the fold reads as clipped, not as
      // selected (measured in Chrome, the row landed at y=875 of 900).
      const rail = el.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      const onScreen = box.top >= rail.top && box.bottom <= rail.bottom;
      if (!onScreen) /** @type {HTMLElement} */ (row).scrollIntoView({ block: 'center' });
    }
  });
</script>

<!-- Desktop: Flex sibling in chrome row -->
<div
  data-testid="community-sidebar"
  class="scrollbar-none hidden w-(--sidebar-icon-w) flex-col overflow-x-hidden overflow-y-auto bg-base-200 lg:flex"
  bind:this={railEl}
  onscroll={updateScrollHints}
>
  <!-- Sticky edge fades: pinned to the visible top/bottom of the scroll
    container, negative margins keep them out of the layout flow. They replace
    the (hidden) scrollbar as the "there is more" signal. -->
  <div
    class="pointer-events-none sticky top-0 z-10 -mb-7 h-7 shrink-0 bg-gradient-to-b from-base-200 to-transparent transition-opacity duration-200 {canScrollUp
      ? 'opacity-100'
      : 'opacity-0'}"
  ></div>
  <div class="flex flex-col items-center space-y-3 py-4">
    <!-- Home button. Native `title` tooltips throughout this rail (NOT
      DaisyUI .tooltip): the scroll container's overflow clips CSS
      pseudo-element tooltips at the rail edge — a browser-native title
      renders in its own layer and is never clipped. -->
    <button
      title={m.dashboard_home_tooltip()}
      onclick={() => onHomeSelect?.()}
      class="btn btn-circle h-12 w-12 shrink-0 p-0 btn-ghost transition-transform duration-200 hover:scale-110 {isDashboardActive
        ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200'
        : ''}"
    >
      <HomeIcon class_="w-6 h-6" />
    </button>
    <div class="w-8 border-b border-base-300"></div>

    <!-- One arrangeable list. Drag an icon onto another to fold them into a
      folder; drag to an icon's top or bottom edge to reorder (dropIntent
      splits each row — a 48px column has no room for separate targets). -->
    {#each layout as node (node.type === 'item' ? node.key : folderAnchor(node.id))}
      {#if node.type === 'item'}
        {@const entry = entriesByKey.get(node.key)}
        {#if entry}
          <div
            role="listitem"
            draggable="true"
            data-testid="rail-slot"
            data-rail-anchor={node.key}
            data-rail-active={isActiveEntry(entry) ? 'true' : 'false'}
            class="rail-slot {dragAnchor === node.key ? 'opacity-40' : ''} {dropClass(node.key)}"
            ondragstart={() => (dragAnchor = node.key)}
            ondragend={endDrag}
            ondragover={(e) => onRowDragOver(e, node.key)}
            ondrop={(e) => onRowDrop(e, node.key)}
          >
            <RailEntryIcon
              {entry}
              isActive={isActiveEntry(entry)}
              onSelect={handleCommunityClick}
            />
          </div>
        {/if}
      {:else}
        {@const anchor = folderAnchor(node.id)}
        {@const members = entriesOf(node.keys, entriesByKey)}
        <div
          role="listitem"
          draggable="true"
          data-testid="rail-slot"
          data-rail-anchor={anchor}
          class="rail-slot {dragAnchor === anchor ? 'opacity-40' : ''} {dropClass(anchor)}"
          ondragstart={() => (dragAnchor = anchor)}
          ondragend={endDrag}
          ondragover={(e) => onRowDragOver(e, anchor)}
          ondrop={(e) => onRowDrop(e, anchor)}
        >
          <RailFolderTile
            name={node.name}
            entries={members}
            open={openFolders.includes(node.id)}
            holdsActive={holdsActive(members)}
            onToggle={() => toggleFolder(node.id)}
          />
        </div>
        {#if openFolders.includes(node.id)}
          <!-- Members render in place under the tile, indented, and stay
            draggable: dragging one out to a top-level edge is how you leave a
            folder, and the model dissolves a folder that loses its last one. -->
          {#each members as entry (entry.key)}
            <div
              role="listitem"
              draggable="true"
              data-testid="rail-slot"
              data-rail-anchor={entry.key}
              data-rail-active={isActiveEntry(entry) ? 'true' : 'false'}
              class="rail-slot rail-slot-nested {dragAnchor === entry.key
                ? 'opacity-40'
                : ''} {dropClass(entry.key)}"
              ondragstart={() => (dragAnchor = entry.key)}
              ondragend={endDrag}
              ondragover={(e) => onRowDragOver(e, entry.key)}
              ondrop={(e) => onRowDrop(e, entry.key)}
            >
              <RailEntryIcon
                {entry}
                size="h-10 w-10"
                isActive={isActiveEntry(entry)}
                onSelect={handleCommunityClick}
              />
            </div>
          {/each}
          <button
            type="button"
            class="btn h-6 min-h-0 w-12 shrink-0 px-0 text-[0.6rem] btn-ghost"
            data-testid="rail-folder-edit"
            onclick={() => startRename(node.id)}>{m.rail_folder_edit()}</button
          >
        {/if}
      {/if}
    {/each}

    <!-- Add a container: create a community (Armada parity — the rail is
      where you live, so the door is here too; laoc 2026-08-11). An action,
      not an entry, so it stays out of the arrangeable list. -->
    <div class="w-8 border-b border-base-300"></div>
    <button
      title={m.rail_add_community()}
      data-testid="rail-add-community"
      class="btn btn-circle h-12 w-12 shrink-0 p-0 btn-ghost transition-transform duration-200 hover:scale-110"
      onclick={() => modalStore.openModal('createCommunity')}
    >
      <PlusIcon class_="h-6 w-6" />
    </button>

    {#if dissolvedAreas.length > 0}
      <!-- Archive cluster (Armada's ARCHIVED parity): dissolved areas,
        dimmed and greyscale, still clickable — the history stays readable
        for members, new messages are impossible. -->
      <div class="w-8 border-b border-base-300"></div>
      {#each dissolvedAreas as area (area.communityId)}
        <a
          title="{area.name} · {m.rail_dissolved_tooltip()}"
          href={resolve(`/private/${area.communityId}`)}
          data-testid="rail-dissolved-area"
          class="btn btn-circle h-10 w-10 shrink-0 p-0 opacity-40 btn-ghost grayscale transition-all duration-200 hover:opacity-70"
        >
          <ConcordAreaBadge
            name={area.name}
            communityId={area.communityId}
            iconPointer={area.iconPointer}
            class="h-10 w-10"
          />
        </a>
      {/each}
    {/if}

    {#if showUnlockAffordance}
      <!-- The unlock TOOL keeps its divider: it is an action, not an entry,
        so it stays out of the arrangeable list entirely. -->
      <div class="w-8 border-b border-base-300"></div>
      <button
        title={signerHasNip44 ? m.concord_unlock_areas() : m.concord_direct_needs_nip44()}
        class="btn btn-circle h-12 w-12 shrink-0 p-0 btn-ghost transition-transform duration-200 hover:scale-110"
        data-testid="concord_unlock_areas"
        disabled={!signerHasNip44 || unlocking}
        onclick={handleUnlockAreas}
      >
        {#if unlocking}
          <span class="loading loading-sm loading-spinner"></span>
        {:else}
          <LockOpenIcon class_="h-5 w-5" />
        {/if}
      </button>
    {/if}
  </div>
  <div
    class="pointer-events-none sticky bottom-0 z-10 -mt-7 flex h-7 shrink-0 items-end justify-center bg-gradient-to-t from-base-200 to-transparent transition-opacity duration-200 {canScrollDown
      ? 'opacity-100'
      : 'opacity-0'}"
  >
    <ChevronDownIcon class_="h-3.5 w-3.5 text-base-content/50" />
  </div>
</div>

<!-- Mobile: Drawer content (will be used inside drawer in AppLayout) -->
<div class="flex h-full w-full flex-col bg-base-200 lg:hidden">
  <div class="flex-1 space-y-2 overflow-y-auto p-4">
    <!-- Home button -->
    <button
      onclick={() => onHomeSelect?.()}
      class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 {isDashboardActive
        ? 'bg-primary text-primary-content'
        : 'hover:bg-base-300'}"
    >
      <HomeIcon class_="w-5 h-5" />
      <span class="flex-1 truncate text-left text-sm font-medium">
        {m.dashboard_home_tooltip()}
      </span>
    </button>
    <div class="border-b border-base-300"></div>

    <!-- Same arrangement as the desktop rail, read-only: HTML5 drag events do
      not fire on touch at all, so a draggable row here would simply not work.
      A pointer-event drag is its own build (Armada does exactly that) — until
      then the order and the folders you set on a desktop are what shows. -->
    {#each layout as node (node.type === 'item' ? node.key : folderAnchor(node.id))}
      {#if node.type === 'item'}
        {@const entry = entriesByKey.get(node.key)}
        {#if entry}
          {@render mobileRow(entry)}
        {/if}
      {:else}
        <div class="border-b border-base-300"></div>
        <p
          class="px-3 pt-1 text-xs font-semibold tracking-wider text-base-content/50 uppercase"
          data-testid="rail-folder-heading"
        >
          {node.name}
        </p>
        {#each entriesOf(node.keys, entriesByKey) as entry (entry.key)}
          {@render mobileRow(entry)}
        {/each}
        <div class="border-b border-base-300"></div>
      {/if}
    {/each}

    <div class="border-b border-base-300"></div>
    <button
      class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 hover:bg-base-300"
      data-testid="rail-add-community"
      onclick={() => modalStore.openModal('createCommunity')}
    >
      <PlusIcon class_="h-5 w-5" />
      <span class="flex-1 truncate text-left text-sm font-medium">{m.rail_add_community()}</span>
    </button>

    {#if joinedCommunities.length === 0}
      <div class="py-8 text-center text-base-content/60">
        <p class="mb-3 text-sm">{m.community_layout_sidebar_no_communities()}</p>
        <a href={resolve('/discover?type=communities')} class="btn btn-sm btn-primary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {m.community_layout_sidebar_discover_button()}
        </a>
      </div>
    {/if}

    {#if showUnlockAffordance}
      <div class="border-b border-base-300"></div>
      <button
        class="btn btn-block gap-2 btn-outline btn-sm"
        data-testid="concord_unlock_areas"
        disabled={!signerHasNip44 || unlocking}
        title={signerHasNip44 ? undefined : m.concord_direct_needs_nip44()}
        onclick={handleUnlockAreas}
      >
        {#if unlocking}
          <span class="loading loading-xs loading-spinner"></span>
        {:else}
          <LockOpenIcon class_="h-4 w-4" />
        {/if}
        {m.concord_unlock_areas()}
      </button>
    {/if}
  </div>
</div>

<!--
  One drawer row per container. A snippet rather than a component: it needs
  exactly the markup the drawer already had, and every caller is in this file.
-->
{#snippet mobileRow(/** @type {import('$lib/rail/rail-entries.js').RailEntry} */ entry)}
  {#if entry.kind === 'community'}
    {@const getCommunityProfile = useUserProfile(entry.pubkey)}
    {@const communityProfile = getCommunityProfile()}
    <button
      onclick={() => handleCommunityClick(entry.pubkey)}
      data-rail-active={isActiveEntry(entry) ? 'true' : 'false'}
      class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 {isActiveEntry(
        entry
      )
        ? 'bg-primary text-primary-content'
        : 'hover:bg-base-300'}"
    >
      <div class="avatar">
        <div class="h-10 w-10 rounded-full">
          <ImageWithFallback
            src={getProfilePicture(communityProfile) || `https://robohash.org/${entry.pubkey}`}
            alt={getDisplayName(communityProfile)}
            fallbackType="community"
            class="h-full w-full rounded-full object-cover"
          />
        </div>
      </div>
      <span class="font-community flex-1 truncate text-left text-sm font-medium">
        {getDisplayName(communityProfile)}
      </span>
    </button>
  {:else if entry.kind === 'area'}
    {@const areaFlags = areaUnreadState(entry.area.communityId)}
    <a
      href={resolve(`/private/${entry.area.communityId}`)}
      data-rail-active={isActiveEntry(entry) ? 'true' : 'false'}
      class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 {isActiveEntry(
        entry
      )
        ? 'bg-primary text-primary-content'
        : 'hover:bg-base-300'} {entry.area.dissolved ? 'opacity-50' : ''}"
    >
      <span class="relative shrink-0">
        <ConcordAreaBadge
          name={entry.area.name}
          communityId={entry.area.communityId}
          iconPointer={entry.area.iconPointer}
          class="h-8 w-8 shrink-0"
        />
        <span class="absolute -top-0.5 -right-0.5">
          <ConcordUnreadDot unread={areaFlags.unread} mentioned={areaFlags.mentioned} />
        </span>
      </span>
      <span class="flex-1 truncate text-left text-sm font-medium">{entry.area.name}</span>
    </a>
  {:else}
    <!-- The drawer's row for a HOST. It names the relay and how many of its
         channels we can already name; the glyph belonged to a single channel
         and cannot stand for a set of them. -->
    <a
      href={relayHref(entry.relay)}
      data-testid="sidebar-relay-row"
      data-relay={entry.relay}
      data-rail-active={isActiveEntry(entry) ? 'true' : 'false'}
      class="flex w-full items-center gap-3 rounded-lg p-3 transition-all duration-200 {isActiveEntry(
        entry
      )
        ? 'bg-primary text-primary-content'
        : 'hover:bg-base-300'}"
    >
      <RailRelayIcon relay={entry.relay} size="h-8 w-8" rounded="rounded-lg" />
      <span class="flex-1 truncate text-left text-sm font-medium">
        <RelayLabel relay={entry.relay} />
      </span>
      <span class="shrink-0 text-[0.7rem] opacity-70">{entry.rows.length}</span>
    </a>
  {/if}
{/snippet}

{#if editingFolder}
  <!-- Rename and dissolve live in a modal, not inline: the rail is 48px wide
    and a text field cannot go there. Dissolving is not destructive — the
    members spill back into the folder's own slot — so it needs no confirm. -->
  <div class="modal-open modal" role="dialog" data-testid="rail-folder-modal">
    <div class="modal-box max-w-sm">
      <h3 class="mb-3 text-lg font-extrabold">{m.rail_folder_edit_title()}</h3>
      <input
        class="input-bordered input input-sm w-full"
        data-testid="rail-folder-name"
        bind:value={editingName}
        onkeydown={(e) => e.key === 'Enter' && commitRename()}
      />
      <div class="modal-action justify-between">
        <button
          class="btn gap-2 text-error btn-ghost btn-sm"
          data-testid="rail-folder-dissolve"
          onclick={() => editingFolder && removeFolder(editingFolder)}
        >
          <TrashIcon class="h-4 w-4" />
          {m.rail_folder_dissolve()}
        </button>
        <span class="flex gap-2">
          <button class="btn btn-ghost btn-sm" onclick={() => (editingFolder = null)}
            >{m.concord_cancel()}</button
          >
          <button
            class="btn btn-sm btn-primary"
            data-testid="rail-folder-save"
            onclick={commitRename}>{m.rail_folder_save()}</button
          >
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  /* The drop readings, drawn on the row the pointer is over. */
  .rail-slot {
    position: relative;
    display: flex;
    justify-content: center;
    width: 100%;
  }
  .rail-slot-nested {
    padding-left: 0.5rem;
  }
  .rail-drop-into :global(> *) {
    outline: 2px solid var(--color-primary, currentColor);
    outline-offset: 2px;
    border-radius: 9999px;
  }
  .rail-drop-before::before,
  .rail-drop-after::after {
    content: '';
    position: absolute;
    left: 15%;
    right: 15%;
    height: 3px;
    border-radius: 999px;
    background: var(--color-primary, currentColor);
  }
  .rail-drop-before::before {
    top: -4px;
  }
  .rail-drop-after::after {
    bottom: -4px;
  }
</style>
