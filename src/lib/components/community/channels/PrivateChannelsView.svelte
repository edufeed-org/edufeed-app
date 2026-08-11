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
    getSelectedConcordChannel
  } from '$lib/concord/active-channel.svelte.js';
  // NIP-29 channels of the same community. A community is extended by ONE
  // protected area — a Concord area OR a set of NIP-29 groups — but the rail
  // is one list either way, so both sources are merged before rendering.
  import { parseGroupPointers, sharedRelayOf } from '$lib/groups/community-pointer.js';
  import { relayBadges } from '$lib/groups/group-badges.js';
  import { relayRequiresAuth } from '$lib/groups/relay-directory.js';
  import { useRelayInformation } from '$lib/groups/relay-information.svelte.js';
  import { attachableAreaModes } from '$lib/groups/community-attach.js';
  import { buildChannelRows } from '$lib/groups/community-channel-rows.js';
  import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
  import { groupHref } from '$lib/groups/groups.js';
  import ConcordUnreadDot from '$lib/components/shared/ConcordUnreadDot.svelte';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import ChannelRailRow from './ChannelRailRow.svelte';
  import ChannelStatePane from './ChannelStatePane.svelte';
  import ChannelOverview from './ChannelOverview.svelte';
  import ChannelChat from './ChannelChat.svelte';
  import ChannelCreateWizard from './ChannelCreateWizard.svelte';
  import AreaAttachModal from './AreaAttachModal.svelte';
  import ChannelInviteSheet from './ChannelInviteSheet.svelte';
  import ChannelMembersModal from './ChannelMembersModal.svelte';
  import ChannelExplainer from './ChannelExplainer.svelte';
  import KeyBackupModal from './KeyBackupModal.svelte';
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
  const isCommunikeyOwner = $derived(
    !!communikeyEvent?.pubkey && communikeyEvent.pubkey === getActiveUser()?.pubkey
  );
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
  // A community is extended by exactly ONE protected area, so once it carries
  // group channels the Concord founding offer has to stop — it would invite the
  // owner into precisely the mixed state the design rules out.
  const extendedByGroups = $derived(groupPointers.length > 0);
  const canAttachGroup = $derived(isCommunikeyOwner && attachableAreaModes(communikeyEvent).group);
  const getChannelMeta = useChannelMetadata(() => groupPointers);
  // Relay badges on the overview describe ONE host, so they are only fetched
  // and shown when every channel of this community lives on the same relay —
  // see sharedRelayOf. Two relays means the badges are dropped, never guessed.
  const getOverviewRelayInfo = useRelayInformation(() => sharedRelayOf(groupPointers));
  const channelHostBadges = $derived(relayBadges(getOverviewRelayInfo()));
  const channelRows = $derived(
    buildChannelRows({
      concordChannels: channels,
      groupPointers,
      metadataByKey: getChannelMeta().byKey,
      hostRequiresAuth: relayRequiresAuth(getOverviewRelayInfo())
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

  // Typed confirmation for the permanent, whole-area dissolve.
  let dissolveConfirmText = $state('');
  const dissolveExpected = $derived(
    (communityProfile?.name || '').trim() || m.concord_dissolve_confirm_fallback()
  );
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
{#if concord.enabled || groupPointers.length > 0}
  <div class="flex h-full min-h-0">
    <!-- rail — full width in mobile single-column mode (below md, only one
      of rail/pane is ever visible at once via mobileChat), fixed 288px once
      both show side by side. A bare `w-72` here would leave the remainder
      of a narrow viewport blank instead of the visible pane filling it.
      Surfaces follow the app convention (design page "Channel Surfaces"):
      nav chrome = base-200 (this rail joins the content-nav's beige zone),
      content = base-100 (the chat pane) — previously inverted, which put a
      stark paper column between two beige nav zones. -->
    <aside
      class="flex w-full shrink-0 flex-col gap-1 overflow-y-auto bg-base-200 p-3 md:w-72 {mobileChat
        ? 'hidden md:flex'
        : 'flex'}"
    >
      <div class="flex items-center justify-between px-2 pt-2 pb-1">
        <span class="text-xs font-bold tracking-wider text-base-content/60 uppercase"
          >{m.concord_rail_channels()}</span
        >
        <span class="flex items-center gap-1">
          {#if concord.phase === 'syncing'}
            <span
              class="loading loading-xs loading-spinner text-base-content/40"
              title={m.concord_sync_title()}
            ></span>
          {/if}
          {#if notificationSupported}
            <button
              class="btn btn-circle btn-ghost btn-xs"
              data-testid="concord-notif-bell"
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
          <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
        </span>
      </div>
      {#if channels.length > 0}
        <p class="px-2 pb-1 text-[0.65rem] leading-tight text-base-content/50">
          <span class="block">{m.concord_legend_public()}</span>
          <span class="block">{m.concord_legend_private()}</span>
        </p>
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
          <!-- A NIP-29 channel is a group of its own, and the group chat that
            renders it already exists at /groups/<host'id> — so the rail links
            there rather than duplicating the chat stack. -->
          <ChannelRailRow
            href={groupHref(row.pointer)}
            testid="group-channel-row"
            symbol={row.symbol}
            name={row.name}
            dimmed={row.pending}
            worldReadable={row.worldReadable}
          />
        {/if}
      {/each}
      {#if extendedByGroups && canAttachGroup}
        <button
          class="btn justify-start border-dashed btn-outline btn-sm"
          data-testid="group-attach-open"
          onclick={() => (overlay = 'attach-area')}
        >
          + {m.groups_attach_action()}
        </button>
      {/if}
      {#if concord.community && concord.canManageChannels && !concord.dissolved}
        <button
          class="btn justify-start border-dashed btn-outline btn-sm"
          data-testid="concord-new-channel"
          onclick={() => (overlay = 'create')}
        >
          + {m.concord_new_channel()}
        </button>
      {/if}
      {#if concord.signerHasNip44}
        <button
          class="btn justify-start text-base-content/70 btn-ghost btn-sm"
          onclick={() => (overlay = 'inbox')}
        >
          ✉ {m.concord_invites()}
        </button>
      {/if}
    </aside>

    <!-- pane — the paper content surface (base-100), matching the public
      community chat; the beige rail beside it reads as chrome. -->
    <section
      class="flex min-w-0 flex-1 flex-col bg-base-100 {mobileChat ? 'flex' : 'hidden md:flex'}"
    >
      {#if extendedByGroups && !concord.community}
        <!-- Each NIP-29 channel opens its own route, so this pane never holds a
          chat — but it must not be the Concord founding offer either, and a
          bare "pick a channel" placard said nothing the rail beside it did not
          already say. It is the channel overview instead (Armada parity:
          ServerPage's welcome pane). -->
        <ChannelOverview rows={channelRows} hostBadges={channelHostBadges} />
      {:else if !concord.community && isCommunikeyOwner}
        <ChannelStatePane title={m.concord_found_title()} body={m.concord_found_body()}>
          <div class="mt-4 flex flex-wrap justify-center gap-2">
            <button
              class="btn btn-neutral"
              data-testid="concord-new-channel"
              onclick={() => (overlay = 'create')}
            >
              🔒 {m.concord_new_channel()}
            </button>
            <button
              class="btn btn-outline"
              data-testid="concord-attach-open"
              onclick={() => (overlay = 'attach-area')}
            >
              🔗 {m.concord_attach_secondary()}
            </button>
          </div>
          <p class="mx-auto mt-3 max-w-sm text-xs text-base-content/60">
            {m.concord_attach_pane_hint()}
          </p>
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
        <ChannelStatePane title={m.concord_locked_title()} body={m.concord_locked_body()} />
      {:else}
        <ChannelStatePane
          title={m.concord_no_channels_title()}
          body={m.concord_no_channels_body()}
        />
      {/if}
    </section>
  </div>

  {#if overlay === 'create'}
    <ChannelCreateWizard
      {communikeyEvent}
      {communityProfile}
      community={concord.dissolved ? undefined : concord.community}
      onClose={() => (overlay = null)}
      onCreated={(/** @type {string} */ channelId) => {
        overlay = null;
        if (concord.communityId) selectConcordChannel(concord.communityId, channelId);
        mobileChat = true;
      }}
    />
  {:else if overlay === 'attach-area'}
    <AreaAttachModal {communikeyEvent} onClose={() => (overlay = null)} />
  {:else if overlay === 'invite' && concord.community && activeChannel}
    <ChannelInviteSheet
      {communikeyEvent}
      community={concord.community}
      channel={activeChannel}
      canDirect={concord.signerHasNip44}
      onClose={() => (overlay = null)}
    />
  {:else if overlay === 'inbox'}
    <InviteInboxModal onClose={() => (overlay = null)} />
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
          {m.concord_dissolve_confirm_label({ name: dissolveExpected })}
        </label>
        <input
          id="concord-dissolve-confirm-input"
          class="input-bordered input input-sm mb-3 w-full"
          data-testid="concord-dissolve-confirm-input"
          placeholder={m.concord_dissolve_confirm_placeholder()}
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
{/if}
