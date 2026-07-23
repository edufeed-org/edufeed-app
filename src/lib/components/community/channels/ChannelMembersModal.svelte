<!--
  ChannelMembersModal — Task 13.

  Lists the channel's approximate roster and lets the owner kick (channel-only
  rotate) or ban (community banlist + channel rotate) a member. Verified
  against node_modules/applesauce-concord/dist (full trail in
  .superpowers/sdd/task-13-report.md):

  - There is no authoritative per-channel roster (key possession IS
    membership) — the list here is `channelMemberList()`'s approximation:
    authors observed writing in the channel (any kind — `.timeline([{}])`) ∪
    self. We pass `granted: []`: this app has no local record of channel
    grants independent of what's already observable, so it's an honest no-op
    input rather than a fabricated one. `concord_members_note` tells the user
    the list can lag.
  - `rotateChannel`/`ban` both require the phase-1 moderator to be the
    community owner in this UI (the `isOwner` prop, same gate the rest of
    PrivateChannelsView uses) — `rotateChannel` itself also throws if the
    caller lacks MANAGE_CHANNELS, which the owner always holds.
  - `rotateChannel`'s key delivery is wrapped via NIP-44
    (`buildChannelRekey` throws synchronously without `signer.nip44`) — both
    actions are gated on `signerHasNip44`, buttons disabled with an honest
    tooltip otherwise (same pattern as ChannelInviteSheet's `canDirect`).
-->
<script>
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import { channelMemberList, kickFromChannel, banFromChannel } from '$lib/concord/moderation.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { community, channel, isOwner = false, signerHasNip44 = false, onClose } = $props();

  const getActiveUser = useActiveUser();
  // Every rumor kind ever routed to this channel's plane (chat, reactions,
  // threads, …) — broader than ChannelChat's kind-9-only timeline, since a
  // member who only reacted should still count as "observed". See
  // moderation.js's header comment for why `.pubkey` is safe to read off
  // these (same ConcordRumorStore/RumorStore the rest of the chat pane uses).
  const getRumors = useObservable(
    () => community?.channelStore(channel.channel_id).timeline([{}]),
    /** @type {any[]} */ ([])
  );
  const members = $derived(
    channelMemberList({
      observed: getRumors().map((/** @type {any} */ r) => r.pubkey),
      granted: [],
      self: getActiveUser()?.pubkey
    })
  );
  const getProfiles = useProfileMap(() => members);

  /** @type {{kind: 'kick'|'ban', pubkey: string}|null} */
  let confirm = $state(null);
  let busy = $state(false);

  async function run() {
    if (!confirm || busy) return;
    busy = true;
    const { kind, pubkey } = confirm;
    // callerPubkey backs moderation.js's self-target guard — the `!self`
    // button gating below is UI convenience only, not the defense (an owner
    // self-exclude would pass rotateChannel's checks and lose the key).
    const callerPubkey = getActiveUser()?.pubkey;
    try {
      if (kind === 'ban')
        await banFromChannel(community, channel.channel_id, pubkey, members, callerPubkey);
      else await kickFromChannel(community, channel.channel_id, pubkey, members, callerPubkey);
      showToast(kind === 'ban' ? m.concord_banned_toast() : m.concord_kicked_toast(), 'success');
      confirm = null;
    } catch (error) {
      console.error('concord: moderation failed', error);
      showToast(m.concord_moderation_failed(), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-lg font-extrabold">
      {m.concord_members_title()}
      <span class="font-mono text-sm text-base-content/50">{members.length}</span>
    </h3>
    <p class="mb-3 text-xs text-base-content/60">{m.concord_members_note()}</p>
    <div class="divide-y divide-base-300">
      {#each members as pubkey (pubkey)}
        {@const self = pubkey === getActiveUser()?.pubkey}
        <div class="flex items-center gap-3 py-2">
          <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
          <span class="flex-1 truncate text-sm font-semibold">
            {getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}{self
              ? ` ${m.concord_you_suffix()}`
              : ''}
          </span>
          {#if isOwner && !self}
            <button
              class="btn btn-ghost btn-xs"
              title={signerHasNip44 ? m.concord_kick() : m.concord_moderate_needs_nip44()}
              disabled={!signerHasNip44}
              onclick={() => (confirm = { kind: 'kick', pubkey })}>−</button
            >
            <button
              class="btn text-error btn-ghost btn-xs"
              data-testid="concord-member-ban"
              title={signerHasNip44 ? m.concord_ban() : m.concord_moderate_needs_nip44()}
              disabled={!signerHasNip44}
              onclick={() => (confirm = { kind: 'ban', pubkey })}>⦸</button
            >
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

{#if confirm}
  {@const profile = getProfiles().get(confirm.pubkey)}
  {@const name = profile?.name ?? confirm.pubkey.slice(0, 12)}
  <div class="modal-open modal" role="dialog">
    <div class="modal-box max-w-sm text-center">
      <h3 class="text-lg font-extrabold">
        {confirm.kind === 'ban'
          ? m.concord_ban_confirm_title({ name })
          : m.concord_kick_confirm_title({ name })}
      </h3>
      <p class="my-3 text-sm text-base-content/70">
        {confirm.kind === 'ban'
          ? m.concord_ban_confirm_body({ name })
          : m.concord_kick_confirm_body({ name })}
      </p>
      {#if confirm.kind === 'ban'}
        <p class="rounded-xl bg-base-200 p-3 text-xs text-base-content/50">
          {m.concord_ban_confirm_note({ name })}
        </p>
      {/if}
      <div class="modal-action justify-center">
        <button class="btn btn-ghost" onclick={() => (confirm = null)}>{m.concord_cancel()}</button>
        <button
          class="btn {confirm.kind === 'ban' ? 'btn-error' : 'btn-neutral'}"
          data-testid="concord-confirm-action"
          disabled={busy}
          onclick={run}
        >
          {confirm.kind === 'ban' ? m.concord_ban() : m.concord_kick()}
        </button>
      </div>
    </div>
  </div>
{/if}
