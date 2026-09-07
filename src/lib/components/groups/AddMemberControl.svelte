<!--
  AddMemberControl — the add-member surface extracted from GroupMembersModal
  so MembersView can offer it inline too (issue 7ca94a65). Two modes: direct
  put-user via contact search, and the consent-based DM invite (Task A6) —
  mint a single-use NIP-29 invite code (9009, legal only on a CLOSED group,
  always the case at the root-group call sites) and deliver it as a NIP-17
  DM; the recipient accepts by clicking join on the community page.

  The DM tab is hidden without a communityId: minting is root-group-only, and
  GroupMembersModal is also used per-channel (GroupChat.svelte), which passes
  no communityId — that context stays direct-add only.
-->
<script>
  import {
    buildPutUserTemplate,
    buildCreateInviteTemplate,
    generateInviteCode,
    publishToGroupRelay
  } from '$lib/groups/group-management.js';
  import { sendWrappedDm } from '$lib/services/wrapped-dm.js';
  import { buildGroupInviteMessage } from '$lib/groups/invite-message.js';
  import { fetchRelaySelf } from '$lib/groups/relay-self.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { nip19 } from 'nostr-tools';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   pointer: {id: string, relay: string},
   *   metadata: any,
   *   communityId?: string | null,
   *   members: Set<string>,
   *   onRosterChanged?: () => void,
   *   onMemberAdded?: ((pubkey: string) => void | Promise<void>) | null
   * }}
   */
  let {
    pointer,
    metadata,
    communityId = null,
    members,
    onRosterChanged,
    onMemberAdded = null
  } = $props();

  const getActiveUser = useActiveUser();

  let busy = $state(false);

  /** @param {string} pubkey */
  async function addMember(pubkey) {
    const user = getActiveUser();
    if (!user) return;
    busy = true;
    try {
      await publishToGroupRelay(
        pool.relay(pointer.relay),
        buildPutUserTemplate(pointer.id, pubkey, []),
        user
      );
      onRosterChanged?.();
      // AFTER the roster refresh kick-off: the caller may fan the fresh
      // member out to further groups; a failing fan-out must not mask the
      // successful add.
      await onMemberAdded?.(pubkey);
    } catch (err) {
      console.error('groups: put-user failed', err);
      showToast(m.groups_members_action_failed(), 'error');
    } finally {
      busy = false;
    }
  }

  /** @type {'direct' | 'dm'} */
  let addMode = $state('direct');
  let inviteNpub = $state('');
  let inviteError = $state('');
  let sendingInvite = $state(false);

  /** @param {string} value @returns {string | null} hex pubkey, or null if not a valid npub */
  function decodeNpub(value) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const decoded = nip19.decode(trimmed);
      return decoded.type === 'npub' ? /** @type {string} */ (decoded.data) : null;
    } catch {
      return null;
    }
  }

  async function sendInvite() {
    const hex = decodeNpub(inviteNpub);
    if (!hex) {
      inviteError = m.group_invite_dm_invalid_npub();
      return;
    }
    const user = getActiveUser();
    // communityId is required to build the join URL's npub — the toggle
    // that reaches this pane is hidden without one (see template), so this
    // is a defensive no-op, not a user-facing path.
    if (!user || !communityId) return;
    inviteError = '';
    sendingInvite = true;
    try {
      // Mint first: a failure here means nothing was created — the generic
      // failure toast is correct and there is no code to hand over.
      /** @type {string} */
      let code;
      try {
        // A fresh code per send — single-use, one code = one person.
        code = generateInviteCode();
        await publishToGroupRelay(
          pool.relay(pointer.relay),
          buildCreateInviteTemplate(pointer.id, code),
          user
        );
      } catch (err) {
        console.error('groups: invite code mint failed', err);
        const reason = err instanceof Error ? err.message : String(err);
        showToast(m.group_invite_dm_failed({ reason }), 'error');
        return;
      }

      // The mint above already succeeded — the code is real and single-use.
      // A failure past this point must NOT reuse the generic failure toast:
      // that code is now orphaned (minted but never delivered), and the
      // admin needs it to hand over manually.
      try {
        // ?view=channels was dropped (controller ruling, 2026-08-19):
        // CommunityProfileHero — the only place reading ?join= — mounts
        // inside HomeView, not the channels view that param would route to.
        const npub = nip19.npubEncode(communityId);
        const joinUrl = `${location.origin}/c/${npub}?join=${code}`;

        // Cross-client naddr line is best-effort: a relay that won't answer
        // NIP-11 (or has no `self`) just means the DM ships without it —
        // the join URL alone is still a complete invite.
        const self = await fetchRelaySelf(pointer.relay);
        const naddr = self
          ? `${nip19.naddrEncode({
              kind: 39000,
              pubkey: self,
              identifier: pointer.id,
              relays: [pointer.relay]
            })}?invite=${code}`
          : null;

        const message = buildGroupInviteMessage({
          communityName: metadata?.name || '',
          joinUrl,
          naddr
        });
        await sendWrappedDm([hex], message);
        showToast(m.group_invite_dm_sent(), 'success');
        inviteNpub = '';
      } catch (err) {
        console.error('groups: dm invite send failed after a successful mint', err);
        showToast(m.group_invite_dm_failed_after_mint({ code }), 'error');
      }
    } finally {
      sendingInvite = false;
    }
  }
</script>

<div role="tablist" class="tabs-border mb-3 tabs">
  <button
    role="tab"
    class="tab {addMode === 'direct' ? 'tab-active' : ''}"
    data-testid="add-mode-direct"
    onclick={() => (addMode = 'direct')}
  >
    {m.groups_members_add_direct_action()}
  </button>
  {#if communityId}
    <button
      role="tab"
      class="tab {addMode === 'dm' ? 'tab-active' : ''}"
      data-testid="add-mode-dm"
      onclick={() => (addMode = 'dm')}
    >
      {m.group_invite_dm_action()}
    </button>
  {/if}
</div>

{#if addMode === 'dm' && communityId}
  <div class="flex flex-col gap-2">
    <input
      type="text"
      class="input-bordered input w-full"
      placeholder={m.group_invite_dm_npub_placeholder()}
      aria-label={m.group_invite_dm_npub_placeholder()}
      data-testid="dm-invite-npub-input"
      disabled={sendingInvite}
      value={inviteNpub}
      oninput={(e) => (inviteNpub = /** @type {HTMLInputElement} */ (e.target).value)}
    />
    {#if inviteError}
      <span class="text-xs text-error" data-testid="dm-invite-error">{inviteError}</span>
    {/if}
    <button
      class="btn btn-primary"
      data-testid="dm-invite-send"
      disabled={sendingInvite || !inviteNpub.trim()}
      onclick={sendInvite}
    >
      {#if sendingInvite}
        <span class="loading loading-xs loading-spinner"></span>
      {/if}
      {m.group_invite_dm_send()}
    </button>
  </div>
{:else}
  <ContactSearchInput
    acceptPubkeyInput
    inlineList
    disabled={busy}
    placeholder={m.groups_members_add_placeholder()}
    exclude={[...members]}
    onselect={(/** @type {{ pubkey: string }} */ c) => addMember(c.pubkey)}
    onrawpubkey={(/** @type {string} */ hex) => addMember(hex)}
  />
{/if}
