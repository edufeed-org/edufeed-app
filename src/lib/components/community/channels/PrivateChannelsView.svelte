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
  import ChannelStatePane from './ChannelStatePane.svelte';
  import ChannelChat from './ChannelChat.svelte';
  import ChannelCreateWizard from './ChannelCreateWizard.svelte';
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

  let selectedChannelId = $state('');
  /** @type {string|null} */
  let overlay = $state(null);
  let mobileChat = $state(false);

  const concord = $derived(getConcord());
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

  // community.dissolve() (dist/client/community.js) throws a plain
  // Error("only the owner can dissolve") when the caller isn't
  // material.owner — a defensive backstop behind the isConcordOwner-gated menu
  // item that triggers this. It publishes a tombstone rumor to the
  // community-wide "dissolved" plane (NOT per-channel — there is no
  // per-channel hard delete exposed in this UI) with an optimistic local
  // echo, so `concord.dissolved` (backed by `dissolved$`) flips before any
  // relay round-trip completes; Tasks 8/10 already render the resulting
  // tombstone banner + read-only composer off that same flag.
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
</script>

<!-- Flag off must hide the UI entirely (global constraint): the tab is
  already gated, but ?view=channels is reachable by direct URL — render
  nothing when the feature is disabled. -->
{#if concord.enabled}
  <div class="flex h-full min-h-0">
    <!-- rail -->
    <aside
      class="flex w-72 shrink-0 flex-col gap-1 overflow-y-auto border-r border-base-300 bg-base-100 p-3 {mobileChat
        ? 'hidden md:flex'
        : 'flex'}"
    >
      <div class="flex items-center justify-between px-2 pt-2 pb-1">
        <span class="text-xs font-bold tracking-wider text-base-content/60 uppercase"
          >{m.concord_rail_channels()}</span
        >
        <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
      </div>
      <!-- Tighter, list-style rows (Armada-parity cleanup) — deliberately NOT
        `btn` (its min-height/border/shadow chrome reads as a toolbar, not a
        channel list). Active state reuses the app's existing subtle
        active-nav treatment (BottomTabBar.svelte: bg-primary/10 text-primary)
        instead of the previous btn-active fill. -->
      {#each channels as channel (channel.channel_id)}
        <button
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 {activeChannel?.channel_id ===
          channel.channel_id
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-base-content/80 hover:bg-base-300/60'}"
          onclick={() => {
            selectedChannelId = channel.channel_id;
            mobileChat = true;
          }}
        >
          <span aria-hidden="true">{channel.private ? '🔒' : '#'}</span>
          <span class="min-w-0 flex-1 truncate {channel.accessible ? '' : 'opacity-50'}"
            >{channel.name}</span
          >
        </button>
      {/each}
      {#if concord.community && isConcordOwner && !concord.dissolved}
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

    <!-- pane -->
    <section class="flex min-w-0 flex-1 flex-col {mobileChat ? 'flex' : 'hidden md:flex'}">
      {#if !concord.community && isCommunikeyOwner}
        <ChannelStatePane title={m.concord_found_title()} body={m.concord_found_body()}>
          <button
            class="btn mt-4 btn-neutral"
            data-testid="concord-new-channel"
            onclick={() => (overlay = 'create')}
          >
            🔒 {m.concord_new_channel()}
          </button>
        </ChannelStatePane>
      {:else if !concord.community}
        <ChannelStatePane
          title={m.concord_no_membership_title()}
          body={m.concord_no_membership_body()}
        />
      {:else if concord.phase === 'syncing'}
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
      community={concord.community}
      onClose={() => (overlay = null)}
      onCreated={(/** @type {string} */ channelId) => {
        overlay = null;
        selectedChannelId = channelId;
        mobileChat = true;
      }}
    />
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
      onClose={() => (overlay = null)}
    />
  {:else if overlay === 'explainer'}
    <ChannelExplainer onClose={() => (overlay = null)} />
  {:else if overlay === 'backup'}
    <KeyBackupModal onClose={() => (overlay = null)} />
  {:else if overlay === 'dissolve' && concord.community}
    <!-- Same confirm skeleton as Task 13's ChannelMembersModal kick/ban
      dialog. Scope is honest in the copy: dissolve() is community-level (it
      tombstones the whole private area, all channels), matching the dist —
      there is no per-channel hard delete surfaced in Phase 1. -->
    <div class="modal-open modal" role="dialog">
      <div class="modal-box max-w-sm text-center">
        <h3 class="text-lg font-extrabold">{m.concord_dissolve_title()}</h3>
        <p class="my-3 text-sm text-base-content/70">{m.concord_dissolve_body()}</p>
        <div class="modal-action justify-center">
          <button class="btn btn-ghost" onclick={() => (overlay = null)}
            >{m.concord_cancel()}</button
          >
          <button class="btn btn-error" disabled={dissolving} onclick={dissolve}
            >{m.concord_dissolve_action()}</button
          >
        </div>
      </div>
    </div>
  {/if}
{/if}
