<!--
  ChannelInviteSheet — Task 11.
  Two tabs: a revocable public Link & QR invite, and Direct invites to
  verified community members (delivered via a NIP-59 gift-wrapped Direct
  Invite, CORD-05 §6).

  Verified against node_modules/applesauce-concord/dist (see
  .superpowers/sdd/task-11-report.md for the full trail):
  - `community.createInvite(options)` mints + publishes a public invite link
    AND records it into the user's private Invite List (13303) via the
    onInviteCreated callback wired in ConcordClient — but that record step
    no-ops silently without signer.nip44 (ConcordInviteManager.save() just
    returns early). So creating a link works with ANY signer; only its
    cross-session persistence degrades without nip44. The "direct" tab is the
    one gated on signerHasNip44 (grantChannelAccess requires it to seal the
    gift wrap).
  - `client.invites.forCommunity(id)` returns ALL entries (live + revoked) —
    filtering is our job, extracted as pickLatestChannelInvite().

  Imports getConcordClient DIRECTLY from client.svelte.js (not the $lib/concord
  barrel): this component is statically imported by PrivateChannelsView, which
  is part of the /c/[pubkey] page tree, so the barrel's re-export of
  storage.js (a static `applesauce-core-concord` import) would otherwise pull
  that dependency tree into the page's SSR chunk — see index.js's header
  comment and the project's prior @noble/hashes v2 SSR-chunk incident (commit
  a9af9c87: a hoisted top-level dep resolving to the wrong subpath export
  took down every route with a 500). invite-helpers.js has no package
  imports at all, so importing it directly is SSR-safe regardless.
-->
<script>
  import QRCode from 'qrcode';
  import { getConcordClient } from '$lib/concord/client.svelte.js';
  import { pickLatestChannelInvite, createChannelInviteOnce } from '$lib/concord/invite-helpers.js';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { getContext } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let { community, channel, communikeyEvent = undefined, canDirect = false, onClose } = $props();

  let tab = $state('link');
  /** @type {any} */
  let invite = $state.raw(undefined);
  let qrDataUrl = $state('');
  let copied = $state(false);
  let revokedNotice = $state(false);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let revokedNoticeTimer;
  /** @type {string[]} */
  let sent = $state.raw([]);

  const client = getConcordClient();

  // Reuse the newest live link for this channel, or mint one. Creation is
  // deduped across concurrent component instances by createChannelInviteOnce
  // (module-level, keyed on communityId+channelId) — PrivateChannelsView
  // mounts once per responsive layout variant (community-layout-double-mount
  // project note), so more than one ChannelInviteSheet instance could
  // otherwise race here for the same channel and each mint a redundant link.
  $effect(() => {
    if (invite || !client || !community) return;
    const existing = pickLatestChannelInvite(
      client.invites.forCommunity(community.communityId),
      channel.channel_id
    );
    if (existing) {
      invite = existing;
      return;
    }
    createChannelInviteOnce(community, channel.channel_id, {
      base: window.location.origin,
      label: channel.name,
      channels: [channel.channel_id]
    })
      .then((created) => (invite = created))
      .catch((error) => {
        console.error('concord: createInvite failed', error);
        showToast(m.concord_invite_create_failed(), 'error');
      });
  });

  $effect(() => {
    if (invite?.url)
      QRCode.toDataURL(invite.url).then((/** @type {string} */ url) => (qrDataUrl = url));
  });

  async function copy() {
    await navigator.clipboard.writeText(invite.url);
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  async function revoke() {
    try {
      await client.invites.revoke(invite);
      invite = undefined; // effect creates a fresh link
      // Transient notice: shown alongside the (re-armed) revoke button, then
      // auto-cleared — a sticky notice that REPLACED the button would lock
      // the fresh replacement link out of ever being revoked in this mount.
      revokedNotice = true;
      clearTimeout(revokedNoticeTimer);
      revokedNoticeTimer = setTimeout(() => (revokedNotice = false), 8000);
    } catch (error) {
      console.error('concord: revoke failed', error);
      showToast(m.concord_revoke_failed(), 'error');
    }
  }

  $effect(() => () => clearTimeout(revokedNoticeTimer));

  /** @param {string} pubkey */
  async function directInvite(pubkey) {
    try {
      await community.grantChannelAccess(channel.channel_id, pubkey);
      // "Sent", not "invited": grantChannelAccess resolves as soon as the
      // gift wrap is built — its relay publish is best-effort and failures
      // are swallowed internally (community.js: `.catch((err) =>
      // console.warn("channel grant publish failed", err))`), so delivery is
      // unobservable from here. Only permission errors reject (caught below).
      sent = [...sent, pubkey];
    } catch (error) {
      console.error('concord: direct invite failed', error);
      showToast(m.concord_direct_invite_failed(), 'error');
    }
  }

  // Invitable people: community members (kind-30000 profile lists + owner),
  // minus self. Mirrors ChannelCreateWizard.svelte exactly — reuses the SAME
  // profileAccess instance set up once in c/[pubkey]/+layout.svelte (not a
  // fresh useProfileListAccess() call, whose real signature differs from
  // what the task-11 brief assumed).
  /** @type {import('$lib/stores/profile-list-access.svelte.js').ProfileListAccess} */
  const profileAccess = getContext('profileAccess');
  const invitable = $derived.by(() => {
    const self = manager.active?.pubkey;
    const { allMembers } = getVerifiedMembers(profileAccess, communikeyEvent);
    return allMembers.filter((p) => p !== self);
  });
  const getProfiles = useProfileMap(() => invitable);
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="mb-3 text-lg font-extrabold">{m.concord_invite_title({ name: channel.name })}</h3>
    <div class="tabs-boxed mb-4 tabs">
      <button class="tab {tab === 'link' ? 'tab-active' : ''}" onclick={() => (tab = 'link')}
        >{m.concord_invite_tab_link()}</button
      >
      <button
        class="tab {tab === 'direct' ? 'tab-active' : ''}"
        onclick={() => (tab = 'direct')}
        disabled={!canDirect}
        title={canDirect ? '' : m.concord_direct_needs_nip44()}
        >{m.concord_invite_tab_direct()}</button
      >
    </div>

    {#if tab === 'link'}
      <p class="mb-3 text-sm text-base-content/60">{m.concord_invite_link_lead()}</p>
      {#if !canDirect}
        <!-- Without nip44, ConcordInviteManager.save() silently no-ops (see
          header comment): the link works, but is never persisted to the
          private Invite List — after a reload it can no longer be revoked
          from this UI. Warn so the user can revoke while it's still held. -->
        <div class="mb-3 alert text-sm alert-warning">{m.concord_link_no_persist_warning()}</div>
      {/if}
      {#if invite}
        <div class="mb-3 flex items-center gap-2 rounded-xl border border-base-300 p-2 pl-3">
          <code class="flex-1 truncate text-xs">{invite.url}</code>
          <button class="btn btn-ghost btn-xs" onclick={copy}
            >{copied ? m.concord_copied() : m.concord_copy()}</button
          >
        </div>
        {#if qrDataUrl}
          <div class="grid place-items-center pb-3">
            <img src={qrDataUrl} alt="QR" class="w-44 rounded-xl border border-base-300" />
          </div>
        {/if}
        {#if revokedNotice}
          <div class="mb-3 alert text-sm alert-success">{m.concord_revoked_notice()}</div>
        {/if}
        <button class="btn w-full justify-start btn-outline btn-sm btn-error" onclick={revoke}>
          {m.concord_revoke_link()}
          <span class="block text-xs font-normal opacity-70">{m.concord_revoke_hint()}</span>
        </button>
      {:else}
        <div class="grid place-items-center py-6">
          <span class="loading loading-spinner"></span>
        </div>
      {/if}
    {:else}
      <p class="mb-3 text-sm text-base-content/60">{m.concord_invite_direct_lead()}</p>
      <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {#each invitable as pubkey (pubkey)}
          <div class="flex items-center gap-2 px-2 py-1">
            <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
            <span class="flex-1 truncate text-sm"
              >{getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}</span
            >
            {#if sent.includes(pubkey)}
              <span class="text-xs font-semibold text-success">✓ {m.concord_invited()}</span>
            {:else}
              <button class="btn btn-ghost btn-xs" onclick={() => directInvite(pubkey)}
                >{m.concord_invite_action()}</button
              >
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
