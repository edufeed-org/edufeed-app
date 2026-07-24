<!--
  ChannelMembersModal — Task 13, reworked for community-wide roster + roles
  (Armada-parity follow-up: this modal used to show only authors observed
  writing in ONE channel, e.g. 2 people vs Armada's 85+roles).

  DISPLAY vs MODERATION are deliberately split, and must stay split:

  - Display roster: `community.members$` (community-wide, banlist already
    folded in by `foldMembers` per node_modules/applesauce-concord/dist —
    verified in helpers/guestbook.js) bridged with `roles$`/`grants$` through
    `memberSections()` (roster.js, pure/unit-tested) into owner+role-holders
    ("leaders", ordered by authority) then plain members. Role names are
    arbitrary control-plane strings, rendered as-is (CSS-truncated).
  - Moderation keep-list: kick/ban still rotate the CHANNEL's key, so the
    `currentMembers` they receive MUST stay the channel-scoped approximation
    from `channelMemberList()` (observed-in-channel ∪ self, minus banned) —
    see moderation.js's header comment for the full rotateChannel trail.
    Widening this to the community-wide roster would fan out a fresh channel
    key to every community member on the next rotation, not just whoever
    actually held it. `concord_members_note` tells the user the DISPLAYED
    list is community-wide but per-channel activity can lag.
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
  import { memberSections } from '$lib/concord/roster.js';
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
  // community.banlist$ (Observable<Set<string>>, verified in
  // node_modules/applesauce-concord/dist/client/community.js) — still
  // subtracted from the channel-scoped keep-list passed to kick/ban
  // (defensive: members$ already folds the banlist in, but this keep-list
  // is built from `getRumors()`, not `members$`).
  const getBanlist = useObservable(
    () => community?.banlist$,
    /** @type {Set<string>} */ (new Set())
  );
  // CHANNEL-scoped approximate roster — used ONLY as the `currentMembers`
  // argument to kickFromChannel/banFromChannel below. Never render this as
  // the displayed list (see header comment).
  const channelMembers = $derived(
    channelMemberList({
      observed: getRumors().map((/** @type {any} */ r) => r.pubkey),
      granted: [],
      self: getActiveUser()?.pubkey,
      banned: getBanlist()
    })
  );

  // COMMUNITY-wide display roster: members$/roles$/grants$ bridged reactively,
  // folded into sections by the pure memberSections() helper.
  const getMembers = useObservable(
    () => community?.members$,
    /** @type {Set<string>} */ (new Set())
  );
  const getRoles = useObservable(() => community?.roles$, /** @type {any[]} */ ([]));
  const getGrants = useObservable(
    () => community?.grants$,
    /** @type {Map<string, string[]>} */ (new Map())
  );
  const sections = $derived(
    memberSections({
      members: getMembers(),
      roles: getRoles(),
      grants: getGrants(),
      owner: community?.material?.owner
    })
  );
  const rosterCount = $derived(sections.leaders.length + sections.members.length);
  const getProfiles = useProfileMap(() => [
    ...sections.leaders.map((l) => l.pubkey),
    ...sections.members
  ]);

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
      // channelMembers (NOT the community-wide sections above) — see the
      // header comment: kick/ban must only ever rotate the channel key to
      // the channel-scoped keep-list.
      if (kind === 'ban')
        await banFromChannel(
          community,
          channel.channel_id,
          pubkey,
          channelMembers,
          callerPubkey,
          getBanlist()
        );
      else
        await kickFromChannel(
          community,
          channel.channel_id,
          pubkey,
          channelMembers,
          callerPubkey,
          getBanlist()
        );
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

{#snippet memberRow(
  /** @type {string} */ pubkey,
  /** @type {string | null} */ chip,
  /** @type {boolean} */ chipIsOwner
)}
  {@const self = pubkey === getActiveUser()?.pubkey}
  <div class="flex items-center gap-3 py-2">
    <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
    <span class="flex-1 truncate text-sm font-semibold">
      {getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}{self
        ? ` ${m.concord_you_suffix()}`
        : ''}
    </span>
    {#if chip}
      <span
        class="badge max-w-[7rem] truncate badge-sm {chipIsOwner ? 'badge-primary' : 'badge-ghost'}"
        title={chip}
      >
        {chip}
      </span>
    {/if}
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
{/snippet}

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-lg font-extrabold">
      {m.concord_members_title()}
      <span class="font-mono text-sm text-base-content/50">{rosterCount}</span>
    </h3>
    <p class="mb-3 text-xs text-base-content/60">{m.concord_members_note()}</p>
    <div class="divide-y divide-base-300">
      {#each sections.leaders as leader (leader.pubkey)}
        {@render memberRow(
          leader.pubkey,
          leader.isOwner ? m.concord_role_owner() : leader.roleName,
          leader.isOwner
        )}
      {/each}
      {#each sections.members as pubkey (pubkey)}
        {@render memberRow(pubkey, null, false)}
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
