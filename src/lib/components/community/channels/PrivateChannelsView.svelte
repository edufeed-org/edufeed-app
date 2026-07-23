<script>
  // Imports directly from the concord submodule (not the barrel):
  // community.svelte.js has no top-level package imports, so this stays
  // SSR-clean even though the c/[pubkey] community route renders server-side
  // — see community.svelte.js's header comment and Task 7's report for the
  // verified import-path decision. Signer capability comes reactively from
  // the hook (concord.signerHasNip44), NOT client.svelte.js's raw
  // signerHasNip44() helper — that one reads a plain module variable, so a
  // template call evaluates once at mount and misses a client that finishes
  // its async setup afterwards.
  import { useConcordCommunity } from '$lib/concord/community.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import ChannelStatePane from './ChannelStatePane.svelte';
  // TODO(task-10): channel chat pane — uncomment once ChannelChat.svelte exists.
  // import ChannelChat from './ChannelChat.svelte';
  import ChannelCreateWizard from './ChannelCreateWizard.svelte';
  // TODO(task-11): invite sheet + inbox — uncomment once ChannelInviteSheet.svelte exists.
  // import ChannelInviteSheet from './ChannelInviteSheet.svelte';
  // TODO(task-13): members modal + moderation — uncomment once ChannelMembersModal.svelte exists.
  // import ChannelMembersModal from './ChannelMembersModal.svelte';
  // TODO(task-14): explainer/backup/dissolve — uncomment once ChannelExplainer.svelte exists.
  // import ChannelExplainer from './ChannelExplainer.svelte';
  // TODO(task-14): explainer/backup/dissolve — uncomment once KeyBackupModal.svelte exists.
  // import KeyBackupModal from './KeyBackupModal.svelte';
  // TODO(task-11): invite sheet + inbox — uncomment once InviteInboxModal.svelte exists.
  // import InviteInboxModal from './InviteInboxModal.svelte';
  import * as m from '$lib/paraglide/messages';

  // communityPubkey is unused until Tasks 11/13/14 uncomment the overlay
  // components that need it (see TODOs above and the commented overlay block
  // below) — kept in the prop list so MainContentArea doesn't need to change
  // again when those land. communityProfile is used by the create wizard
  // (Task 9) to name the Concord area after the community.
  let {
    communikeyEvent,
    communityProfile = null,
    communityPubkey: _communityPubkey = ''
  } = $props();

  const getConcord = useConcordCommunity(() => communikeyEvent);
  const getActiveUser = useActiveUser();

  let selectedChannelId = $state('');
  /** @type {string|null} */
  let overlay = $state(null);
  let mobileChat = $state(false);

  const concord = $derived(getConcord());
  const isOwner = $derived(
    !!communikeyEvent?.pubkey && communikeyEvent.pubkey === getActiveUser()?.pubkey
  );
  const channels = $derived(concord.channels);
  const activeChannel = $derived(
    channels.find((c) => c.channel_id === selectedChannelId) ?? channels[0]
  );
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
          >{m.concord_rail_private()}</span
        >
        <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
      </div>
      {#each channels as channel (channel.channel_id)}
        <button
          class="btn justify-start gap-2 btn-ghost btn-sm {activeChannel?.channel_id ===
          channel.channel_id
            ? 'btn-active font-bold'
            : ''}"
          onclick={() => {
            selectedChannelId = channel.channel_id;
            mobileChat = true;
          }}
          disabled={!channel.accessible}
        >
          🔒 <span class="truncate">{channel.name}</span>
        </button>
      {/each}
      {#if concord.community && isOwner && !concord.dissolved}
        <button
          class="btn justify-start border-dashed btn-outline btn-sm"
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
      {#if !concord.community && isOwner}
        <ChannelStatePane title={m.concord_found_title()} body={m.concord_found_body()}>
          <button class="btn mt-4 btn-neutral" onclick={() => (overlay = 'create')}>
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
        <!-- TODO(task-10): swap for the real ChannelChat pane once it exists:
          <ChannelChat
            community={concord.community}
            channel={activeChannel}
            dissolved={concord.dissolved}
            {isOwner}
            openOverlay={(name) => (overlay = name)}
            onBack={() => (mobileChat = false)}
          /> -->
        <ChannelStatePane title={activeChannel.name} />
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
  {:else if overlay}
    <!-- Real (uncommented) so `overlay` stays a genuine read, not just a write —
      the per-modal branches themselves stay commented until each task's
      component exists; uncomment the matching branch as each task lands.
    {#if overlay === 'invite' && concord.community && activeChannel}
      TODO(task-11): ChannelInviteSheet — uncomment once it exists.
      <ChannelInviteSheet community={concord.community} channel={activeChannel} onClose={() => (overlay = null)} />
    {:else if overlay === 'members' && concord.community && activeChannel}
      TODO(task-13): ChannelMembersModal — uncomment once it exists.
      <ChannelMembersModal community={concord.community} channel={activeChannel} {isOwner} onClose={() => (overlay = null)} />
    {:else if overlay === 'explainer'}
      TODO(task-14): ChannelExplainer — uncomment once it exists.
      <ChannelExplainer onClose={() => (overlay = null)} />
    {:else if overlay === 'backup'}
      TODO(task-14): KeyBackupModal — uncomment once it exists.
      <KeyBackupModal onClose={() => (overlay = null)} />
    {:else if overlay === 'inbox'}
      TODO(task-11): InviteInboxModal — uncomment once it exists.
      <InviteInboxModal onClose={() => (overlay = null)} />
    {/if}
    -->
  {/if}
{/if}
