<!--
  InviteInboxModal — Task 11.
  Surfaces the user's Direct Invite watcher (CORD-05 §6): locked (undecrypted)
  gift wraps behind an explicit "Unlock" action (the client never auto-
  decrypts — see client.svelte.js's `autoUnlock: false` — so this is the one
  deliberate signer-decrypt point), and decrypted invites the user can accept
  or decline.

  Verified against node_modules/applesauce-concord/dist (see
  .superpowers/sdd/task-11-report.md):
  - `client.directInviteWatcher` is a getter, undefined until the watcher has
    started (only happens when the signer supports nip44 — client.svelte.js
    passes `watchDirectInvites: !!account.signer?.nip44`). PrivateChannelsView
    already only renders the "Einladungen" entry point when
    `concord.signerHasNip44` is true, so `watcher` is expected to exist
    whenever this modal opens; the `?.` chains here are just defensive.
  - For an invite to a community we're ALREADY a member of, the channel keys
    are folded in automatically the moment the invite is decrypted (the
    client's own `invites$` subscription calls `onDirectInvite` synchronously,
    which calls `community.receiveChannelKeys(...)`) — well before the user
    ever clicks Accept here. `client.joinByBundle(bundle)` early-returns the
    existing engine with NO re-publish when `communities.has(community_id)`
    is already true (see joinFromBundle in client.js), so calling it
    unconditionally on Accept is safe for both the "new community" and
    "already a member, just a channel grant" cases — no special-casing
    needed. Accept for the latter case is effectively just a dismiss.

  Imports getConcordClient/useObservable DIRECTLY from their submodules (not
  the $lib/concord barrel): this modal is statically imported by
  PrivateChannelsView, part of the /c/[pubkey] page tree, so the barrel's
  re-export of storage.js (a static `applesauce-core-concord` import) would
  otherwise pull that dependency tree into the page's SSR chunk — see
  index.js's header comment and community.svelte.js's identical rule.
-->
<script>
  import { getConcordClient } from '$lib/concord/client.svelte.js';
  import { useObservable } from '$lib/concord/bridge.svelte.js';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  let { onClose } = $props();
  const client = getConcordClient();
  const watcher = client?.directInviteWatcher;

  const getPending = useObservable(() => watcher?.pending$, /** @type {any[]} */ ([]));
  const getInvites = useObservable(() => watcher?.invites$, /** @type {any[]} */ ([]));
  let unlocking = $state(false);
  /** @type {string | null} */
  let acceptingId = $state(null);

  async function unlock() {
    if (!watcher || unlocking) return;
    unlocking = true;
    try {
      await watcher.readPending(); // deliberate decrypt — may prompt the signer
    } finally {
      unlocking = false;
    }
  }

  /** @param {any} invite */
  async function accept(invite) {
    if (!watcher || !client) return;
    acceptingId = invite.rumor?.id ?? invite.communityId;
    try {
      if (invite.bundle) await client.joinByBundle(invite.bundle);
      await watcher.dismiss(invite.rumor ?? invite);
      showToast(m.concord_invite_accepted(), 'success');
      onClose();
    } catch (error) {
      console.error('concord: accept failed', error);
      showToast(m.concord_invite_accept_failed(), 'error');
    } finally {
      acceptingId = null;
    }
  }

  /** @param {any} invite */
  async function decline(invite) {
    if (!watcher) return;
    await watcher.dismiss(invite.rumor ?? invite);
  }
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="mb-3 text-lg font-extrabold">{m.concord_invites()}</h3>
    {#if getPending().length > 0}
      <div class="mb-3 alert text-sm">
        {m.concord_pending_locked({ count: getPending().length })}
        <button class="btn btn-xs btn-neutral" onclick={unlock} disabled={unlocking}
          >{m.concord_unlock()}</button
        >
      </div>
    {/if}
    {#if getInvites().length === 0 && getPending().length === 0}
      <p class="text-sm text-base-content/60">{m.concord_no_invites()}</p>
    {/if}
    {#each getInvites() as invite (invite.rumor?.id ?? invite.communityId)}
      <div class="mb-2 rounded-xl border border-base-300 p-4">
        <b class="flex items-center gap-2"
          >🔒 {invite.bundle?.label ?? invite.bundle?.name ?? m.concord_invite_generic()}</b
        >
        <p class="my-2 text-xs text-base-content/60">
          {m.concord_invite_from({ inviter: invite.inviter?.slice(0, 12) ?? '?' })}
        </p>
        <div class="flex justify-end gap-2">
          <button class="btn btn-ghost btn-sm" onclick={() => decline(invite)}
            >{m.concord_decline()}</button
          >
          <button
            class="btn btn-sm btn-neutral"
            onclick={() => accept(invite)}
            disabled={!invite.valid || invite.expired?.() || acceptingId !== null}
          >
            {#if acceptingId === (invite.rumor?.id ?? invite.communityId)}
              <span class="loading loading-xs loading-spinner"></span>
            {/if}
            {m.concord_accept()}
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>
