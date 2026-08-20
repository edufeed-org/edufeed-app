<script>
  // Imports directly from the concord submodule (not the barrel) — the
  // convention every Concord component follows (see CLAUDE.md's Concord
  // section): community.svelte.js has no top-level package imports, so this
  // stays SSR-clean. The c/[pubkey] community route is ssr=false anyway (see
  // src/routes/c/+layout.js), so this is defense-in-depth + consistency with
  // the rest of the components under channels/, not a load-bearing SSR
  // requirement for THIS route. Signer capability comes reactively from
  // the hook (concord.signerHasNip44), NOT client.svelte.js's raw
  // signerHasNip44() helper — that one reads a plain module variable, so a
  // template call evaluates once at mount and misses a client that finishes
  // its async setup afterwards.
  import { useConcordArea } from '$lib/concord/community.svelte.js';
  import { parseConcordPointer } from '$lib/concord/pointer.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { isCommunityOwner } from '$lib/helpers/community-signer.js';
  import { deleteChannelCascade } from '$lib/groups/community-teardown.js';
  import { TrashIcon } from '$lib/components/icons';
  import {
    channelUnreadState,
    markChannelRead,
    getToastsEnabled,
    setToastsEnabled
  } from '$lib/concord/notifications.svelte.js';
  import {
    setActiveConcordChannel,
    clearActiveConcordChannel,
    selectConcordChannel,
    getSelectedConcordChannel,
    getChannelCreateRequested,
    clearChannelCreateRequest
  } from '$lib/concord/active-channel.svelte.js';
  // NIP-29 channels of the same community. A community is extended by ONE
  // protected area — a Concord area OR a set of NIP-29 groups — but the rail
  // is one list either way, so both sources are merged before rendering.
  import { parseGroupPointers, sharedRelayOf, channelKey } from '$lib/groups/community-pointer.js';
  import {
    selectGroupChannel,
    getSelectedGroupChannel
  } from '$lib/groups/group-channel-selection.svelte.js';
  import GroupChat from '$lib/components/groups/GroupChat.svelte';
  import { parseMembershipPointer } from '$lib/groups/community-membership.js';
  import { deriveCommunityType } from '$lib/groups/community-membership.js';
  import { relayBadges } from '$lib/groups/group-badges.js';
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
  import { useCommunityChannels } from '$lib/groups/community-channels.svelte.js';
  import { communityGroupsEndpoint, flatGroupsRelay } from '$lib/groups/community-endpoint.js';
  import { useRootRoster } from '$lib/groups/root-roster.svelte.js';
  import { resolveZoneMembership } from '$lib/components/community/layout/community-nav.js';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import ChannelRailRow from './ChannelRailRow.svelte';
  import ChannelStatePane from './ChannelStatePane.svelte';
  import ChannelOverview from './ChannelOverview.svelte';
  import ChannelChat from './ChannelChat.svelte';
  import ChannelCreateWizard from './ChannelCreateWizard.svelte';
  import AreaMembersModal from './AreaMembersModal.svelte';
  import ChannelInviteSheet from './ChannelInviteSheet.svelte';
  import ChannelMembersModal from './ChannelMembersModal.svelte';
  import ChannelExplainer from './ChannelExplainer.svelte';
  import KeyBackupModal from './KeyBackupModal.svelte';
  import {
    BellIcon,
    BellSlashIcon,
    EnvelopeIcon,
    KeyIcon,
    LockIcon,
    PeopleIcon,
    SettingsIcon
  } from '$lib/components/icons';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { hexToNpub } from '$lib/helpers/nostrUtils.js';
  import InviteInboxModal from './InviteInboxModal.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  // communityPubkey is currently unused by this component — kept in the
  // prop list so MainContentArea doesn't need to change if a future overlay
  // needs it. communityProfile is used by the create wizard (Task 9) to
  // name the Concord area after the community.
  //
  // communikeyEvent is optional (Concord follow-up 1): the standalone
  // `/private/<id>` route for UNLINKED memberships (no Communikey community
  // points at them) has no 10222 event to pass and instead passes
  // `communityId` directly. Exactly one of the two should be set by any
  // given caller; `communityId` wins if somehow both are.
  let {
    communikeyEvent = null,
    communityId = undefined,
    communityProfile = null,
    communityPubkey: _communityPubkey = ''
  } = $props();

  const getConcord = useConcordArea(
    () => communityId ?? parseConcordPointer(communikeyEvent)?.communityId
  );
  const getActiveUser = useActiveUser();

  /** @type {string|null} */
  let overlay = $state(null);
  let mobileChat = $state(false);

  const concord = $derived(getConcord());

  // XOR guard (journey-test bug #7): founding/attaching a Concord area on a
  // MODERIERT community replaces its NIP-29 membership — withConcordPointer
  // strips the membership pointer, deriving the type as "Offen + privater
  // Bereich". That trade must be explicit, so the create/attach overlays are
  // gated behind a confirm step. Once an area is already linked the
  // trade has happened; no re-confirm on later channel creation.
  const isModeratedCommunity = $derived(
    deriveCommunityType(communikeyEvent) === 'moderated' && !concord.community
  );
  /** @type {string|null} */
  let pendingOverlay = null;

  /** @param {'create'} which */
  function openAreaOverlay(which) {
    if (isModeratedCommunity) {
      pendingOverlay = which;
      overlay = 'confirm-demote';
    } else {
      overlay = which;
    }
  }

  // Shared per-community selection (final review, IMPORTANT — see
  // active-channel.svelte.js's doc comment). Component-local $state here
  // used to diverge across the community layout's 2-3 responsive
  // double-mounted instances: hidden instances never receive row clicks,
  // stayed at the default channels[0], and could overwrite the shared
  // active-channel store back to that stale default on any channels$
  // re-emission — losing unread truth for the channel actually on screen.
  // Reading it as a $derived means every mounted instance agrees.
  const selectedChannelId = $derived(getSelectedConcordChannel(concord.communityId));

  // ?channel= deep link (spec §6: toast click target; also makes channels
  // linkable) — applied once per communityId, and only if no selection is
  // stored yet, so double-mounted instances don't fight over seeding it (the
  // second instance to run this effect finds a selection already present and
  // no-ops). Optional-chained: component tests that render this component
  // without a SvelteKit page context (see PrivateChannelsView.test.js) get
  // `{}` back from `get(page)`, not a populated page object.
  let deepLinkChecked = false;
  $effect(() => {
    const cid = concord.communityId;
    if (!cid || deepLinkChecked) return;
    deepLinkChecked = true;
    const channelParam = get(page)?.url?.searchParams.get('channel');
    if (channelParam && !getSelectedConcordChannel(cid)) {
      selectConcordChannel(cid, channelParam);
    }
  });

  // Same one-shot seeding for NIP-29 channels: ?channel=<group id> picks the
  // matching group pointer. Separate flag — a community has either engine,
  // but the concord effect above only ever runs once an area id exists.
  let groupDeepLinkChecked = false;
  $effect(() => {
    const communityPubkey = communikeyEvent?.pubkey;
    const pointers = groupPointers;
    if (!communityPubkey || pointers.length === 0 || groupDeepLinkChecked) return;
    groupDeepLinkChecked = true;
    const channelParam = get(page)?.url?.searchParams.get('channel');
    if (!channelParam || getSelectedGroupChannel(communityPubkey)) return;
    const match = pointers.find((pointer) => pointer.id === channelParam);
    const key = match ? channelKey(match) : null;
    if (key) selectGroupChannel(communityPubkey, key);
  });

  // ?invites=1 opens the invite inbox — the sidebar's KANÄLE zone links here
  // since the desktop rail (the inbox's old entry point) became mobile-only.
  // One-shot like the channel deep link, and independent of communityId so it
  // also works before/without a founded area.
  let invitesLinkChecked = false;
  $effect(() => {
    if (invitesLinkChecked) return;
    invitesLinkChecked = true;
    if (get(page)?.url?.searchParams.get('invites')) {
      overlay = 'inbox';
    }
  });
  // Two distinct owner questions conflated as one variable would be wrong:
  // "is the active user the Communikey community's own keypair holder"
  // (relevant ONLY to the founding affordance below — you can't found a
  // Concord area before one exists, so there's no `concord.community` yet
  // to read an owner off) vs. "is the active user the Concord community's
  // own owner" (relevant to everything else: new-channel, moderation,
  // dissolve — all of which only apply once `concord.community` exists).
  // These agree once a community IS founded (founding.js: the Concord owner
  // IS the personal key of whoever founds it, i.e. the same human who must
  // pass the communikey check to see the founding button in the first
  // place) but diverge on the standalone route, where there is no
  // communikeyEvent at all: isCommunikeyOwner is always false there (no
  // founding pane — correct, you can't found an unlinked area from here),
  // while isConcordOwner still resolves correctly from `material.owner` so
  // the real owner keeps their moderation/dissolve/new-channel controls.
  // isCommunikeyOwner is now key-holding-based (getCommunitySigner /
  // isCommunityOwner) rather than active-account equality — see handoff #12.
  const isCommunikeyOwner = $derived(isCommunityOwner(communikeyEvent?.pubkey));
  const isConcordOwner = $derived(
    !!concord.community && concord.community.material?.owner === getActiveUser()?.pubkey
  );
  // Alphabetical, locale-aware (Armada-parity cleanup: the rail used to keep
  // insertion order, which drifts from creation order once channels are
  // renamed). 'de' as the compare locale matches this app's base locale;
  // German/English channel names sort sensibly either way under it.
  const channels = $derived(
    [...(concord.channels ?? [])].sort((a, b) => (a?.name ?? '').localeCompare(b?.name ?? '', 'de'))
  );
  const activeChannel = $derived(
    channels.find((c) => c.channel_id === selectedChannelId) ?? channels[0]
  );

  // The community's NIP-29 channels, each a standalone group listed on the
  // 10222. Sorting happens in buildChannelRows so both sources interleave by
  // name; `channels` above stays as it is because the Concord chat pane,
  // deletion and unread logic all key off it.
  const groupPointers = $derived(parseGroupPointers(communikeyEvent));
  // The NIP-29 root membership group (moderated communities only). Surfaced as
  // the "General" channel — pinned first in buildChannelRows — so the community
  // has a home for community-wide chat and the app agrees with what generic
  // clients (Armada) already list for the root (laoc, 2026-08-20).
  const rootPointer = $derived(parseMembershipPointer(communikeyEvent));
  // A community is extended by exactly ONE protected area, so once it carries
  // group channels the Concord founding offer has to stop — it would invite the
  // owner into precisely the mixed state the design rules out.
  const extendedByGroups = $derived(groupPointers.length > 0);
  // Moderated community before its first channel: zero group pointers, but
  // the membership pointer already commits it to NIP-29 — same overview
  // pane and rail actions as extendedByGroups, never the Concord founding
  // offer (laoc, 2026-08-18).
  const isNip29Community = $derived(extendedByGroups || !!parseMembershipPointer(communikeyEvent));
  // The community's picked NIP-29 channel (shared store — see its header for
  // why community channels render HERE instead of the standalone /groups
  // route). Validated against the CURRENT pointer list, so a stale or
  // cross-account selection falls back to the overview, never to a foreign
  // chat.
  const selectedGroupPointer = $derived.by(() => {
    const key = getSelectedGroupChannel(communikeyEvent?.pubkey);
    if (!key) return null;
    // Search the DISCOVERED subtree channels + the root — their pointers carry
    // the /c endpoint relay the selection key was built from. The root pointer
    // is left unnamed so GroupChat's fallback title reads "General", not the
    // community name its own 39000 carries.
    const root = getCommunityChannels().rootChannel;
    const all = [
      ...(root ? [{ id: root.id, relay: root.relay }] : []),
      ...getCommunityChannels().channels.map((c) => ({ id: c.id, relay: c.relay, name: c.name }))
    ];
    return all.find((pointer) => channelKey(pointer) === key) ?? null;
  });
  // GroupChat's fallback title: a channel pointer's own name, or "General" for
  // the root (which has no name — its 39000 name is the community name).
  const selectedFallbackName = $derived(
    /** @type {any} */ (selectedGroupPointer)?.name ?? m.groups_general_channel()
  );
  // Same population that sees a "+ Neuer Kanal" button somewhere — the shared
  // The locked pane's direct contact: the area owner (material.owner) —
  // always known, always able to invite.
  const lockedContactPubkey = $derived(concord.community?.material?.owner ?? null);
  const lockedContactHref = $derived.by(() => {
    const npub = lockedContactPubkey ? hexToNpub(lockedContactPubkey) : null;
    return npub ? `/p/${npub}` : null;
  });
  const getLockedContactProfiles = useProfileMap(() =>
    lockedContactPubkey ? [lockedContactPubkey] : []
  );
  function getLockedContactName() {
    return getUserDisplayName(
      lockedContactPubkey ?? '',
      getLockedContactProfiles().get(lockedContactPubkey ?? '')
    );
  }

  async function toggleAreaToasts() {
    await setToastsEnabled(!getToastsEnabled());
  }

  const getRootRoster = useRootRoster(() => communikeyEvent);
  // A 39001 admin of the ROOT group can create and manage channels even
  // without holding the community key: a NIP-29 channel is a subgroup (9007 +
  // 9002 with parent=rootId) signed by the admin's OWN key, and the relay
  // enforces the admin-of-parent rule — no owner-signed kind-10222 edit is
  // involved any more (channels are discovered from the subtree, not pointers).
  const isRootAdmin = $derived.by(() => {
    const user = getActiveUser();
    return !!user && getRootRoster().admins.some((a) => a.pubkey === user.pubkey);
  });
  // create intent must not open the wizard for anyone the buttons exclude.
  const canOpenCreateWizard = $derived(
    (concord.community && concord.canManageChannels && !concord.dissolved) ||
      isRootAdmin ||
      isCommunikeyOwner
  );
  // Member/owner gate for the area-members-open entry (handoff #11c): a
  // visitor who merely follows the community (kind-30000, a social bookmark
  // — deliberately NOT used here, see resolveZoneMembership's own comment)
  // must not see the area's member-management door. Same three-signal rule
  // ContentNavSidebar's Kanäle zone already uses (owner OR the moderated
  // community's root-group roster OR Concord area membership) — reused
  // here rather than threaded through as a prop; +layout.svelte's own
  // comment already notes this duplication as a known, accepted trade-off
  // for this plan.
  const isAreaMember = $derived(
    resolveZoneMembership({
      isOwner: isCommunikeyOwner,
      rosterIsMember: !!getActiveUser() && getRootRoster().isMember(getActiveUser().pubkey),
      concordIsMember: concord.membership === 'member'
    })
  );
  // The community's NIP-29 channels, DISCOVERED from the relay subtree
  // (/c/<rootId> → {kinds:[39000]}, parent==rootId), not from kind-10222
  // `group` pointers. Root is surfaced separately as the "General" row.
  const getCommunityChannels = useCommunityChannels(() => rootPointer);
  // Relay badges on the overview describe ONE host: the community's groups host
  // (the root membership pointer's relay).
  const getOverviewRelayInfo = useRelayInformation(() => rootPointer?.relay ?? null);
  const channelHostBadges = $derived(relayBadges(getOverviewRelayInfo()));
  const channelRows = $derived(
    buildChannelRows({
      concordChannels: channels,
      subtreeChannels: getCommunityChannels().channels,
      rootChannel: getCommunityChannels().rootChannel,
      rootLabel: m.groups_general_channel()
    })
  );

  // Mirror the on-screen channel into the shared active-channel store and
  // stamp it read. Reads deps BEFORE the early return (project gotcha:
  // effects that bail before reading reactive state capture no deps). The
  // responsive double-mount renders two instances tracking the same
  // selection — last-writer-wins is fine, both write the same value.
  $effect(() => {
    const cid = concord.communityId;
    const chid = activeChannel?.accessible ? activeChannel.channel_id : undefined;
    if (!cid || !chid) {
      clearActiveConcordChannel();
      return;
    }
    setActiveConcordChannel(cid, chid);
    markChannelRead(cid, chid);
    return () => clearActiveConcordChannel();
  });

  // community.dissolve() (dist/client/community.js) throws a plain
  // Error("only the owner can dissolve") when the caller isn't
  // material.owner — a defensive backstop behind the isConcordOwner-gated menu
  // item that triggers this. It publishes a tombstone rumor to the
  // community-wide "dissolved" plane (NOT per-channel — there is no
  // per-channel hard delete exposed in this UI) with an optimistic local
  // echo, so `concord.dissolved` (backed by `dissolved$`) flips before any
  // relay round-trip completes; Tasks 8/10 already render the resulting
  // tombstone banner + read-only composer off that same flag.
  // Notification API state. permissionDenied is a $state refreshed on toggle
  // attempts — the browser offers no permission-change event worth polling.
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

  let dissolving = $state(false);
  async function dissolve() {
    if (dissolving) return;
    dissolving = true;
    try {
      await concord.community.dissolve();
      showToast(m.concord_dissolved_toast(), 'success');
      overlay = null;
    } catch (error) {
      console.error('concord: dissolve failed', error);
      showToast(m.concord_dissolve_failed(), 'error');
    } finally {
      dissolving = false;
    }
  }

  let deletingChannel = $state(false);
  async function deleteActiveChannel() {
    if (deletingChannel || !activeChannel || channels.length <= 1) return;
    deletingChannel = true;
    try {
      const remaining = channels.filter((c) => c.channel_id !== activeChannel.channel_id);
      await concord.community.deleteChannel(activeChannel.channel_id);
      const next = remaining.find((c) => c.accessible) ?? remaining[0];
      if (next && concord.communityId) selectConcordChannel(concord.communityId, next.channel_id);
      showToast(m.concord_channel_deleted(), 'success');
      overlay = null;
    } catch (error) {
      console.error('concord: deleteChannel failed', error);
      showToast(m.concord_channel_delete_failed(), 'error');
    } finally {
      deletingChannel = false;
    }
  }

  // Per-channel delete for NIP-29 group channels (root admin ∪ owner). Reuses
  // the same cascade GroupChat's in-channel delete runs: 9008 on the relay
  // (the subgroup drops out of the /c subtree) + prune the owner's own 10009.
  /** @type {{id: string, relay: string, name?: string} | null} */
  let deletingGroup = $state(null);
  let deletingGroupBusy = $state(false);

  async function confirmDeleteGroupChannel() {
    if (!deletingGroup || deletingGroupBusy) return;
    deletingGroupBusy = true;
    const pointer = deletingGroup;
    try {
      // A 9008 is all it takes: the relay drops the subgroup from the /c
      // subtree, so it vanishes from every client's discovery — no 10222
      // pointer to unlink. Any admin of the channel (or its parent) may do it.
      await deleteChannelCascade({ pointer, user: getActiveUser() });
      showToast(m.groups_settings_deleted(), 'success');
      deletingGroup = null;
    } catch (error) {
      console.error('groups: channel delete failed', error);
      showToast(m.groups_settings_delete_failed(), 'error');
    } finally {
      deletingGroupBusy = false;
    }
  }

  // Typed confirmation for the permanent, whole-area dissolve. The name to
  // re-type is the AREA's own (decrypted engine metadata) — communityProfile
  // is a linked-mode prop the standalone /private page never passes, so
  // reading only it made every standalone dissolve fall back to the generic
  // word while the label still demanded "the area's name" (laoc,
  // 2026-08-18).
  let dissolveConfirmText = $state('');
  const dissolveAreaName = $derived(
    (concord.community?.metadata?.name || communityProfile?.name || '').trim()
  );
  const dissolveExpected = $derived(dissolveAreaName || m.concord_dissolve_confirm_fallback());
  const dissolveConfirmed = $derived(
    dissolveConfirmText.trim().toLowerCase() === dissolveExpected.toLowerCase()
  );
  // Clear the typed value whenever the dissolve modal isn't open.
  $effect(() => {
    if (overlay !== 'dissolve' && dissolveConfirmText) dissolveConfirmText = '';
  });

  // The dissolve confirm input is only ever created fresh when overlay ===
  // 'dissolve' (no keyed reuse), so an on-mount focus is exactly the moment
  // the modal opens — no autofocus attribute (a11y-lint-hostile).
  /** @param {HTMLElement} node */
  function focusOnMount(node) {
    node.focus();
  }
</script>

<!-- Flag off must hide the UI entirely (global constraint): the tab is
  already gated, but ?view=channels is reachable by direct URL — render
  nothing when the feature is disabled. -->
<!-- A community extended by NIP-29 groups has no Concord area at all, so the
  rail has to render for those too — otherwise the feature is invisible in
  exactly the case it was built for. The Concord flag still gates every
  Concord-specific surface below. -->
{#if concord.enabled || isNip29Community}
  <div class="flex h-full min-h-0">
    <!-- rail — MOBILE ONLY when hosted inside a community layout (the app
      sidebar's KANÄLE zone is the desktop channel surface there; rendering
      this rail beside it produced a double sidebar — laoc, 2026-08-17). On
      the STANDALONE /private/<id> route there is no community sidebar, so
      the rail stays the desktop channel list too (regression fix, same
      day: hiding it unconditionally left that page with no channel list
      at all). Hosted-ness = a communikeyEvent was passed. -->
    <aside
      class="w-full shrink-0 flex-col gap-1 overflow-y-auto bg-base-200 p-3 {communikeyEvent
        ? 'md:hidden'
        : 'md:flex md:w-72'} {mobileChat ? 'hidden' : 'flex'}"
    >
      <!-- Same header grammar as the linked sidebar's KANÄLE zone: px-4
        inset matching the rows, plain bell glyph on the badge column, no
        BETA badge (the page header above already carries one) — laoc,
        2026-08-18. -->
      <div
        class="flex items-center gap-1.5 px-4 pt-2 pb-1 text-xs font-bold tracking-wider text-base-content/50 uppercase"
      >
        <span>{m.concord_rail_channels()}</span>
        {#if concord.phase === 'syncing'}
          <span
            class="loading loading-xs loading-spinner text-base-content/40"
            title={m.concord_sync_title()}
          ></span>
        {/if}
        {#if notificationSupported}
          <button
            class="ml-auto cursor-pointer text-sm leading-none opacity-70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="concord-notif-bell"
            disabled={permissionDenied}
            title={permissionDenied
              ? m.concord_notif_bell_denied()
              : toastsOn
                ? m.concord_notif_bell_on()
                : m.concord_notif_bell_off()}
            onclick={toggleToasts}
          >
            {#if toastsOn}
              <BellIcon class_="w-3.5 h-3.5" title="" />
            {:else}
              <BellSlashIcon class_="w-3.5 h-3.5" title="" />
            {/if}
          </button>
        {/if}
      </div>
      {#if channels.length > 0}
        <!-- Legend glyphs sit in the same w-5 icon column as the rows below. -->
        <div class="px-4 pb-1 text-[0.65rem] leading-tight text-base-content/50">
          <span class="flex items-center gap-3">
            <span class="flex w-5 shrink-0 justify-center">#</span>{m.concord_legend_public()}
          </span>
          <span class="flex items-center gap-3">
            <span class="flex w-5 shrink-0 justify-center"
              ><LockIcon class_="w-3 h-3" title="" /></span
            >{m.concord_legend_private()}
          </span>
        </div>
      {/if}
      <!-- Tighter, list-style rows (Armada-parity cleanup). The row markup
        itself lives in ChannelRailRow, shared with the host sidebar — the two
        rails must not drift apart channel by channel. -->
      {#each channelRows as row (row.key)}
        {#if row.source === 'concord'}
          {@const flags = channelUnreadState(concord.communityId, row.channel_id)}
          <ChannelRailRow
            symbol={row.symbol}
            name={row.name}
            locked={row.locked}
            active={activeChannel?.channel_id === row.channel_id}
            dimmed={!row.accessible}
            bold={flags.unread}
            onclick={() => {
              if (concord.communityId && row.channel_id)
                selectConcordChannel(concord.communityId, row.channel_id);
              mobileChat = true;
            }}
          >
            {#snippet trailing()}
              <ConcordUnreadDot unread={flags.unread} mentioned={flags.mentioned} />
            {/snippet}
          </ChannelRailRow>
        {:else}
          <!-- A NIP-29 channel opens IN the community pane (selection store),
            not on the standalone /groups route: that route's sidebar is the
            host's ENTIRE directory, which on a big public relay is a wall of
            foreign groups and a frozen tab (laoc, 2026-08-19). -->
          <!-- Owner rows get a hover/focus-revealed delete affordance beside
               (never inside — nested interactive) the row. -->
          <div class="group/ch flex items-center gap-1">
            <div class="min-w-0 flex-1">
              <ChannelRailRow
                testid="group-channel-row"
                symbol={row.symbol}
                name={row.name}
                locked={row.locked}
                active={!!selectedGroupPointer &&
                  channelKey(selectedGroupPointer) === channelKey(row.pointer)}
                dimmed={row.pending}
                worldReadable={row.worldReadable}
                onclick={() => {
                  if (communikeyEvent?.pubkey) {
                    const key = channelKey(row.pointer);
                    if (key) selectGroupChannel(communikeyEvent.pubkey, key);
                  }
                  mobileChat = true;
                }}
              />
            </div>
            <!-- No delete on the General (root) row: it is the community's
                 membership group — removing it is the whole-community teardown
                 in Settings, not a per-channel delete. -->
            {#if isNip29Community && (isRootAdmin || isCommunikeyOwner) && row.pointer.id !== rootPointer?.id}
              <button
                type="button"
                class="btn btn-square opacity-0 btn-ghost transition-opacity btn-xs group-hover/ch:opacity-100 focus:opacity-100"
                data-testid="group-channel-delete"
                title={m.groups_channel_delete()}
                aria-label={m.groups_channel_delete()}
                onclick={() => (deletingGroup = row.pointer)}
              >
                <TrashIcon class="h-4 w-4" />
              </button>
            {/if}
          </div>
        {/if}
      {/each}
      {#if (!!rootPointer || groupPointers.length > 0) && isAreaMember}
        <button
          class="btn justify-start btn-outline btn-sm"
          data-testid="area-members-open"
          onclick={() => (overlay = 'area-members')}
        >
          {m.area_members_title()}
        </button>
      {/if}
      {#if (concord.community && concord.canManageChannels && !concord.dissolved) || (isNip29Community && (isRootAdmin || isCommunikeyOwner))}
        <button
          class="btn justify-start border-dashed btn-outline btn-sm"
          data-testid="concord-new-channel"
          onclick={() => (overlay = 'create')}
        >
          + {m.concord_new_channel()}
        </button>
      {/if}
      <!-- Invites moved into the Einstellungen pane (laoc, 2026-08-18) —
        the rail row was the linked sidebar's already-removed redundancy,
        surviving here. The ?invites=1 deep link and the global inbox still
        reach the same overlay. -->

      <!-- Standalone-area footer (laoc, 2026-08-18): mirror the community
        sidebar's Mitglieder/Einstellungen entries — an unlinked area is a
        community too, and its rail is the only chrome it has. Linked mode
        skips this (the community sidebar footer already exists there). -->
      {#if !communikeyEvent && concord.community && !concord.dissolved}
        <!-- Same row markup as ContentNavSidebar's footer (icons, padding,
          hover) — the two rails must not read as different apps. -->
        <nav class="menu mt-auto w-full space-y-1 pt-2">
          {#if activeChannel}
            <button
              class="flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 hover:bg-base-300/60"
              data-testid="area-footer-members"
              onclick={() => (overlay = 'members')}
            >
              <PeopleIcon class_="w-5 h-5" title="" />
              <span class="text-sm font-medium">{m.community_members_title()}</span>
            </button>
          {/if}
          <button
            class="flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 hover:bg-base-300/60"
            data-testid="area-footer-settings"
            onclick={() => (overlay = 'area-settings')}
          >
            <SettingsIcon class_="w-5 h-5" title="" />
            <span class="text-sm font-medium">{m.area_settings_title()}</span>
          </button>
        </nav>
      {/if}
    </aside>

    <!-- pane — the paper content surface (base-100), matching the public
      community chat; the beige rail beside it reads as chrome. -->
    <section
      class="flex min-w-0 flex-1 flex-col bg-base-100 {mobileChat ? 'flex' : 'hidden md:flex'}"
    >
      {#if overlay === 'area-settings'}
        <!-- Standalone-area settings as a PANE, not a modal — same visual
          grammar as the community settings page (grouped uppercase headers,
          cards, Gefahrenzone last), so the two settings surfaces read as one
          app (laoc, 2026-08-18). -->
        <div class="overflow-y-auto p-6">
          <div class="container mx-auto max-w-3xl">
            <div class="mb-6 flex items-center gap-3">
              <SettingsIcon class_="w-6 h-6 text-primary" title="" />
              <h1 class="text-2xl font-bold">{m.area_settings_title()}</h1>
            </div>

            <h2 class="mb-3 text-xs font-bold tracking-wider text-base-content/50 uppercase">
              {m.community_views_settings_type_title()}
            </h2>
            <div class="card mb-6 bg-base-100 shadow-xl">
              <div class="card-body">
                <p class="flex items-center gap-2 font-semibold">
                  {m.community_type_closed_title()}
                  <span class="badge badge-ghost badge-sm">Concord</span>
                  <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
                </p>
                <p class="text-sm text-base-content/70">{m.concord_unlinked_note()}</p>
              </div>
            </div>

            <h2 class="mb-3 text-xs font-bold tracking-wider text-base-content/50 uppercase">
              {m.area_settings_section_general()}
            </h2>
            <!-- Same row idiom as the nav rails: w-5 icon column, gap-3,
              px-4 py-3, hover surface — no emoji, no bare ghost buttons
              (laoc, 2026-08-18). -->
            <div class="card mb-6 bg-base-100 shadow-xl">
              <div class="card-body gap-1 p-3">
                <button
                  class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-all duration-200 hover:bg-base-300/60"
                  data-testid="area-settings-backup"
                  onclick={() => (overlay = 'backup')}
                >
                  <KeyIcon class_="w-5 h-5" title="" />
                  <span class="text-sm font-medium">{m.concord_backup_title()}</span>
                </button>
                <button
                  class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-all duration-200 hover:bg-base-300/60"
                  data-testid="area-settings-toasts"
                  onclick={toggleAreaToasts}
                >
                  {#if getToastsEnabled()}
                    <BellIcon class_="w-5 h-5" title="" />
                  {:else}
                    <BellSlashIcon class_="w-5 h-5" title="" />
                  {/if}
                  <span class="min-w-0 flex-1 text-sm font-medium"
                    >{m.area_settings_notifications()}</span
                  >
                  <span class="badge badge-ghost badge-sm"
                    >{getToastsEnabled() ? m.area_settings_on() : m.area_settings_off()}</span
                  >
                </button>
                <button
                  class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-all duration-200 hover:bg-base-300/60"
                  onclick={() => (overlay = 'inbox')}
                >
                  <EnvelopeIcon class_="w-5 h-5" title="" />
                  <span class="text-sm font-medium">{m.concord_invites()}</span>
                </button>
              </div>
            </div>

            {#if isConcordOwner}
              <div class="card border border-error/40 bg-base-100 shadow-xl">
                <div class="card-body">
                  <h2 class="mb-2 card-title text-error">
                    {m.community_views_settings_danger_title()}
                  </h2>
                  <button
                    class="btn w-full btn-outline btn-error"
                    data-testid="area-settings-dissolve"
                    onclick={() => (overlay = 'dissolve')}
                  >
                    {m.concord_dissolve_action()}
                  </button>
                </div>
              </div>
            {/if}

            <button class="btn mt-6 btn-ghost btn-sm" onclick={() => (overlay = null)}>
              {m.concord_cancel()}
            </button>
          </div>
        </div>
      {:else if isNip29Community && !concord.community}
        {#if selectedGroupPointer}
          <!-- The picked channel's chat, IN the community layout — the
            standalone /groups route stays reserved for directory browsing
            (see group-channel-selection.svelte.js). Keyed on the channel:
            switching must remount the chat, or a draft typed in one would
            still be in the composer of the next (same rule as the /groups
            route). -->
          <!-- Mobile-only back to the rail: GroupChat has no onBack of its
            own (the /groups route never needed one), and without this the
            rail would be unreachable once mobileChat flips. -->
          <button
            class="flex items-center gap-2 border-b border-base-300 px-4 py-2 text-sm text-base-content/70 md:hidden"
            data-testid="group-chat-back"
            onclick={() => (mobileChat = false)}
          >
            ← {m.concord_rail_channels()}
          </button>
          {#key channelKey(selectedGroupPointer)}
            <GroupChat pointer={selectedGroupPointer} fallbackName={selectedFallbackName} />
          {/key}
        {:else}
          <!-- No channel picked: the channel overview (Armada parity:
            ServerPage's welcome pane). The members action renders here on
            desktop because the rail carrying it is mobile-only now. -->
          {#if groupPointers.length > 0 && isAreaMember}
            <div class="hidden flex-wrap gap-2 p-3 pb-0 md:flex">
              <button
                class="btn btn-outline btn-sm"
                data-testid="area-members-open-pane"
                onclick={() => (overlay = 'area-members')}
              >
                {m.area_members_title()}
              </button>
            </div>
          {/if}
          <ChannelOverview
            rows={channelRows}
            hostBadges={channelHostBadges}
            onSelect={(/** @type {{id: string, relay: string}} */ pointer) => {
              if (communikeyEvent?.pubkey) {
                const key = channelKey(pointer);
                if (key) selectGroupChannel(communikeyEvent.pubkey, key);
              }
              mobileChat = true;
            }}
          />
        {/if}
      {:else if !concord.community && isCommunikeyOwner}
        <ChannelStatePane title={m.concord_found_title()} body={m.concord_found_body()}>
          <div class="mt-4 flex flex-wrap justify-center gap-2">
            <button
              class="btn btn-neutral"
              data-testid="concord-new-channel"
              onclick={() => openAreaOverlay('create')}
            >
              🔒 {m.concord_new_channel()}
            </button>
          </div>
        </ChannelStatePane>
      {:else if !concord.community}
        <ChannelStatePane
          title={m.concord_no_membership_title()}
          body={m.concord_no_membership_body()}
        />
      {:else if concord.phase === 'syncing' && channels.length === 0}
        <!-- Full-screen sync pane ONLY on a cold cache (first join / new
          device). Decrypted rumors persist per channel in the per-account
          IDB and the community state folds over those stores in the
          ConcordCommunity CONSTRUCTOR — i.e. before the network epoch walk —
          so on a warm cache the rail + chat render instantly from disk while
          the sync finishes behind the rail header's spinner. -->
        <ChannelStatePane title={m.concord_sync_title()} body={m.concord_sync_body()} progress />
      {:else if concord.phase === 'removed'}
        <ChannelStatePane
          title={m.concord_removed_title()}
          body={m.concord_removed_body()}
          small={m.concord_removed_small()}
        />
      {:else if activeChannel?.accessible}
        <!-- Keyed so switching channels remounts ChannelChat: per-channel
          composer state (draft text, replyTo) must not leak — a reply started
          in channel A would otherwise be sent into channel B with a q tag
          pointing at a message from a different channel/plane. A full remount
          also resets scroll position naturally. -->
        {#key activeChannel.channel_id}
          <ChannelChat
            community={concord.community}
            channel={activeChannel}
            dissolved={concord.dissolved}
            isOwner={isConcordOwner}
            canCreateInvite={concord.canCreateInvite}
            canManageChannels={concord.canManageChannels}
            channelCount={channels.length}
            openOverlay={(/** @type {string} */ name) => (overlay = name)}
            onBack={() => (mobileChat = false)}
          />
        {/key}
      {:else if activeChannel}
        <!-- Task 8 carry-forward: the channel exists (it folded into channels$
          from public metadata) but we don't hold its key — give this an
          honest "locked" message instead of the generic "no channels yet"
          copy, which would otherwise wrongly imply no channel was selected. -->
        <ChannelStatePane title={m.concord_locked_title()} body={m.concord_locked_body()}>
          {#if lockedContactPubkey && lockedContactHref}
            <!-- Direct path instead of "ask an admin" homework (laoc,
              2026-08-18): the area owner is always known from material.owner
              and is always able to invite. -->
            <div class="mt-4 flex flex-col items-center gap-2">
              <span class="text-xs text-base-content/60">{m.concord_locked_contact_lead()}</span>
              <a
                class="btn btn-outline btn-sm"
                data-testid="locked-contact-owner"
                href={lockedContactHref}
              >
                <ProfileAvatar pubkey={lockedContactPubkey} size="xs" />
                {getLockedContactName()}
              </a>
            </div>
          {/if}
        </ChannelStatePane>
      {:else if concord.channels.length === 0 && (concord.phase === 'syncing' || concord.phase === 'idle')}
        <!-- Freshly accepted invite OR client boot: the engine has not
          caught up to the relay tip yet (phase 'idle' before the first
          sync starts, 'syncing' during it — only 'live' means the channel
          list is trustworthy). "No channels" here would be a lie for a few
          seconds (journey-test 2026-08-17: an invitee saw an empty group
          and reloaded to make the channels appear; widened same day to
          cover the boot window where phase is still 'idle'). -->
        <ChannelStatePane title={m.concord_syncing_title()} body={m.concord_syncing_body()}>
          <span class="loading mt-2 loading-md loading-spinner text-primary"></span>
        </ChannelStatePane>
      {:else}
        <ChannelStatePane
          title={m.concord_no_channels_title()}
          body={m.concord_no_channels_body()}
        />
      {/if}
    </section>
  </div>

  <!-- The shared create intent (sidebar's "+ Neuer Kanal") opens the wizard
    alongside the local overlay path; both close through the same handlers,
    which also clear the intent so every responsive mount hides in lockstep. -->
  {#if overlay === 'create' || (getChannelCreateRequested() && canOpenCreateWizard)}
    <ChannelCreateWizard
      {communikeyEvent}
      {communityProfile}
      community={concord.dissolved ? undefined : concord.community}
      adminPubkeys={getRootRoster().admins.map((a) => a.pubkey)}
      onClose={() => {
        overlay = null;
        clearChannelCreateRequest();
      }}
      onCreated={(/** @type {string} */ channelId) => {
        overlay = null;
        clearChannelCreateRequest();
        // Which backend just created the channel is the same call the
        // wizard itself made (isGroupMode = groupPointers.length > 0, off
        // the same communikeyEvent) — a NIP-29 channel has its own route
        // (the rail already links group rows there), while a Concord
        // channel lives inside this pane, selected via the shared store.
        if (isNip29Community) {
          // Select the fresh channel IN the community pane (no goto: the
          // standalone /groups route is for directory browsing and drowns on
          // big public hosts — laoc, 2026-08-19). Discovered channels carry the
          // /c/<rootId> endpoint relay, so the selection key must too. Refresh
          // discovery so the new subgroup's 39000 is fetched into the store.
          getCommunityChannels().refresh();
          const relay = rootPointer
            ? communityGroupsEndpoint(flatGroupsRelay(rootPointer.relay), rootPointer.id)
            : (sharedRelayOf(groupPointers) ?? parseMembershipPointer(communikeyEvent)?.relay);
          const key = relay ? channelKey({ id: channelId, relay }) : null;
          if (key && communikeyEvent?.pubkey) {
            selectGroupChannel(communikeyEvent.pubkey, key);
          }
        } else if (concord.communityId) {
          selectConcordChannel(concord.communityId, channelId);
        }
        mobileChat = true;
      }}
    />
  {:else if overlay === 'confirm-demote'}
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm text-center">
        <h3 class="text-lg font-extrabold">{m.groups_demote_confirm_title()}</h3>
        <p class="my-3 text-sm text-base-content/70">
          {m.groups_demote_confirm_body()}
        </p>
        <div class="modal-action justify-center">
          <button class="btn btn-ghost" onclick={() => (overlay = null)}
            >{m.concord_cancel()}</button
          >
          <button
            class="btn btn-warning"
            data-testid="groups-demote-confirm"
            onclick={() => (overlay = pendingOverlay)}
          >
            {m.groups_demote_confirm_action()}
          </button>
        </div>
      </div>
    </div>
  {:else if overlay === 'area-members'}
    <AreaMembersModal {communikeyEvent} onClose={() => (overlay = null)} />
  {:else if overlay === 'invite' && concord.community && activeChannel}
    <ChannelInviteSheet
      {communikeyEvent}
      community={concord.community}
      channel={activeChannel}
      canDirect={concord.signerHasNip44}
      onClose={() => (overlay = null)}
    />
  {:else if overlay === 'inbox'}
    <InviteInboxModal
      onClose={() => (overlay = null)}
      linkedCommunityId={concord.communityId}
      communikeyPubkey={communikeyEvent?.pubkey}
    />
  {:else if overlay === 'members' && concord.community && activeChannel}
    <ChannelMembersModal
      community={concord.community}
      channel={activeChannel}
      isOwner={isConcordOwner}
      signerHasNip44={concord.signerHasNip44}
      canModerate={concord.canModerate}
      canManageRoles={concord.canManageRoles}
      canPromoteAdmin={concord.canPromoteAdmin}
      myTier={concord.myTier}
      onClose={() => (overlay = null)}
    />
  {:else if overlay === 'explainer'}
    <ChannelExplainer onClose={() => (overlay = null)} />
  {:else if overlay === 'backup'}
    <KeyBackupModal onClose={() => (overlay = null)} />
  {:else if overlay === 'delete-channel' && concord.community && activeChannel}
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm text-center">
        <h3 class="text-lg font-extrabold">{m.concord_delete_channel_title()}</h3>
        <p class="my-3 text-sm text-base-content/70">
          {m.concord_delete_channel_body({ name: activeChannel.name })}
        </p>
        <div class="modal-action justify-center">
          <button class="btn btn-ghost" onclick={() => (overlay = null)}
            >{m.concord_cancel()}</button
          >
          <button
            class="btn btn-error"
            data-testid="concord-delete-channel-confirm"
            disabled={deletingChannel}
            onclick={deleteActiveChannel}>{m.concord_delete_channel_action()}</button
          >
        </div>
      </div>
    </div>
  {:else if overlay === 'dissolve' && concord.community}
    <!-- Same confirm skeleton as Task 13's ChannelMembersModal kick/ban
      dialog. Scope is honest in the copy: dissolve() is community-level (it
      tombstones the whole private area, all channels), matching the dist —
      there is no per-channel hard delete surfaced in Phase 1. Typed
      confirmation (dissolveConfirmed) guards the permanent, whole-area
      action behind re-typing the area name (or the fallback word when the
      area has no name), matching the delete-channel modal's higher bar for
      a destructive action that can't be scoped to just one channel. -->
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm text-center">
        <h3 class="text-lg font-extrabold">{m.concord_dissolve_title()}</h3>
        <p class="my-3 text-sm text-base-content/70">{m.concord_dissolve_body()}</p>
        <label
          class="mb-1 block text-left text-xs text-base-content/60"
          for="concord-dissolve-confirm-input"
        >
          {dissolveAreaName
            ? m.concord_dissolve_confirm_label({ name: dissolveExpected })
            : m.concord_dissolve_confirm_label_fallback({ word: dissolveExpected })}
        </label>
        <input
          id="concord-dissolve-confirm-input"
          class="input-bordered input input-sm mb-3 w-full"
          data-testid="concord-dissolve-confirm-input"
          placeholder={dissolveExpected}
          bind:value={dissolveConfirmText}
          use:focusOnMount
        />
        <div class="modal-action justify-center">
          <button class="btn btn-ghost" onclick={() => (overlay = null)}
            >{m.concord_cancel()}</button
          >
          <button
            class="btn btn-error"
            data-testid="concord-dissolve-confirm"
            disabled={dissolving || !dissolveConfirmed}
            onclick={dissolve}>{m.concord_dissolve_action()}</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if deletingGroup}
    <!-- Plain confirm (single channel) — the whole-community teardown lives in
         Settings behind a typed gate. -->
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm text-center">
        <h3 class="text-lg font-extrabold text-error">{m.groups_channel_delete_title()}</h3>
        <p class="my-3 text-sm text-base-content/70">
          {m.groups_channel_delete_confirm({ name: deletingGroup.name || deletingGroup.id })}
        </p>
        <div class="modal-action justify-center">
          <button
            class="btn btn-ghost"
            disabled={deletingGroupBusy}
            onclick={() => (deletingGroup = null)}>{m.concord_cancel()}</button
          >
          <button
            class="btn btn-error"
            data-testid="group-channel-delete-confirm"
            disabled={deletingGroupBusy}
            onclick={confirmDeleteGroupChannel}
          >
            {#if deletingGroupBusy}<span class="loading loading-xs loading-spinner"></span>{/if}
            {m.groups_channel_delete_action()}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}
