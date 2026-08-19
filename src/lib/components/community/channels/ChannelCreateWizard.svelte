<script>
  // The ONE channel wizard. Which backend it talks to is decided by the
  // community itself: a 10222 already carrying `group` pointers means every
  // future channel of this community is a NIP-29 group too (Stufe B) — else
  // it's the existing Concord flow (founding included), unchanged.
  //
  // Imports founding.js DIRECTLY (never the barrel) — the convention every
  // Concord component follows (see CLAUDE.md's Concord section and index.js's
  // header comment): the barrel is reserved for non-component/dynamic-import
  // call sites and deliberately never re-exports storage.js (a static
  // applesauce-core-concord import) to stay SSR-clean.
  import { foundConcordArea } from '$lib/concord/founding.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getCommunitySigner } from '$lib/helpers/community-signer.js';
  import { showToast } from '$lib/helpers/toast';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { parseGroupPointers, sharedRelayOf } from '$lib/groups/community-pointer.js';
  import { parseMembershipPointer } from '$lib/groups/community-membership.js';
  import { accessChoiceToNip29 } from '$lib/groups/access-choice.js';
  import {
    createGroupOnRelay,
    generateGroupId,
    publishToGroupRelay,
    buildPutUserTemplate
  } from '$lib/groups/group-management.js';
  import { attachGroupChannel } from '$lib/groups/community-attach.js';
  import { updatePersonalGroupsList } from '$lib/groups/personal-groups-list.js';
  import { putUserOn, fanOut } from '$lib/groups/roster-fanout.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { unique } from '$lib/helpers/unique.js';
  import { normalizeURL } from 'applesauce-core/helpers/url';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { getContext } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    communikeyEvent,
    communityProfile = null,
    community = undefined,
    // Root-group admins (hex pubkeys), passed by the parent view (Task A3:
    // "admins are pre-joined") — every fresh NIP-29 channel gets them
    // put-user'd with the admin role, so a community admin is never locked
    // out of a channel someone else just created.
    adminPubkeys = [],
    onClose,
    onCreated
  } = $props();

  let step = $state(0);
  let name = $state('');
  // The access question (design B2, buzz thread round 4): who can read/write
  // here. 'invited' is the default — same starting point the old isPrivate
  // default gave Concord channels, so switching this wizard on changes
  // nothing for a community that never grows group pointers.
  /** @type {'members' | 'invited'} */
  let tier = $state('invited');
  // "Weltoffen" sub-toggle: readable from outside the community. Only makes
  // sense (and only renders) in NIP-29 mode while tier is 'members'. Checking
  // it makes this a world channel: accessChoiceToNip29 returns isOpen:true,
  // so relays auto-admit bare kind-9021 self-joins (no admin action needed).
  // Unchecked (or tier 'invited') stays closed — joining still needs relay
  // policy or an admin invite.
  let worldReadable = $state(false);
  // NOTE: no description field — CORD ChannelMetadata has no description and
  // createChannel only takes {private, voice}; don't collect what we can't store.
  /** @type {string[]} */
  let selected = $state.raw([]);
  let acknowledged = $state(false);
  let busy = $state(false);

  // Area detection: once the community's 10222 lists any group pointer,
  // every channel it grows from here is a NIP-29 group too (Stufe B) — else
  // this is the existing Concord flow, byte-for-byte. A moderated community
  // BEFORE its first channel has zero group pointers but a membership
  // pointer — that's NIP-29 territory too; falling through to Concord
  // founding there would bolt the wrong engine onto it (laoc, 2026-08-18).
  const groupPointers = $derived(parseGroupPointers(communikeyEvent));
  const membershipPointer = $derived(parseMembershipPointer(communikeyEvent));
  const isGroupMode = $derived(groupPointers.length > 0 || !!membershipPointer);
  // Shared glyph/derived-private for both modes: 'invited' always means
  // private/locked, regardless of backend.
  const isPrivate = $derived(tier === 'invited');
  // Group mode collapses to 2 steps (no key-loss disclosure to acknowledge —
  // a NIP-29 group holds no client-side secret) — the invite step doubles as
  // the final step, Create button and all.
  const lastStep = $derived(isGroupMode ? 1 : 2);

  const topSubtitle = $derived.by(() => {
    if (!isGroupMode) {
      // Concord: existing behavior, byte-for-byte.
      return isPrivate ? m.concord_wizard_subtitle() : m.concord_channel_visibility_public_hint();
    }
    if (tier === 'invited') return m.wizard_access_invited_hint();
    return worldReadable
      ? m.wizard_access_worldreadable_hint()
      : m.wizard_access_members_hint_closed();
  });

  // Invitable people: community members (kind-30000 profile lists + owner),
  // minus self. Reuses the SAME profileAccess instance MembersView/HomeView/
  // MainContentArea read (set up once in c/[pubkey]/+layout.svelte with the
  // community's actual relays) rather than a fresh useProfileListAccess call
  // — avoids a second concurrent kind-30000 subscription for data we already
  // have in context.
  /** @type {import('$lib/stores/profile-list-access.svelte.js').ProfileListAccess} */
  const profileAccess = getContext('profileAccess');
  const invitable = $derived.by(() => {
    const self = manager.active?.pubkey;
    // Also exclude the community's own pubkey — a separate-keypair owner
    // (active account distinct from the community) must not be offered the
    // community itself as an invitable "member" (handoff #12).
    const community = communikeyEvent?.pubkey;
    const { allMembers } = getVerifiedMembers(profileAccess, communikeyEvent);
    return allMembers.filter((p) => p !== self && p !== community);
  });
  // Rows shown on the invite step: community members PLUS anyone selected by
  // pasted npub who is not (yet) a member — a raw-pubkey selection previously
  // landed in `selected` without any visible row, so the field just cleared
  // and the user could not tell whether it worked (journey-test finding).
  const inviteRows = $derived(unique([...invitable, ...selected]));
  const getProfiles = useProfileMap(() => inviteRows);

  // Resolve the signer that can edit this community's 10222 (same pattern as
  // EditCommunityModal.svelte:404-412): current-keypair → own signer;
  // new-keypair → the community account's signer registered in the manager.
  const communitySigner = $derived.by(() => getCommunitySigner(communikeyEvent?.pubkey));

  function toggle(/** @type {string} */ pubkey) {
    selected = selected.includes(pubkey)
      ? selected.filter((p) => p !== pubkey)
      : [...selected, pubkey];
  }

  /** @param {number} failed @param {number} total */
  function toastCreateResult(failed, total) {
    if (failed > 0) {
      showToast(m.concord_channel_created_partial({ name: name.trim(), failed, total }), 'warning');
    } else {
      showToast(m.concord_channel_created({ name: name.trim(), count: total }), 'success');
    }
  }

  async function createConcordChannel() {
    try {
      let target = community;
      if (!target) {
        // communityProfile is the already-parsed kind-0 profile CONTENT
        // object (see c/[pubkey]/+layout.svelte's ProfileModel subscription),
        // not a raw event — no JSON.parse needed.
        const communityName = communityProfile?.name;
        ({ community: target } = await foundConcordArea({
          communikeyEvent,
          communityName: communityName || m.concord_default_area_name(),
          relays: runtimeConfig.concord.relays,
          communitySigner
        }));
      }
      const channelId = await target.createChannel(name.trim(), { private: isPrivate });
      // Past this point the channel EXISTS — a retry must never re-create it,
      // and the wizard must always close onto the channel. Each grant fails
      // in isolation (failed invitees can be re-invited later via the invite
      // sheet); only a founding/createChannel failure keeps the wizard open.
      let failed = 0;
      for (const pubkey of selected) {
        try {
          if (isPrivate) {
            await target.grantChannelAccess(channelId, pubkey);
          } else {
            // Public channels have no private key to hand over — invite via
            // the AREA (community-membership) path instead. See
            // area-invite.js's header comment. Dynamic import keeps
            // applesauce-concord out of this component's (and SSR's) bundle.
            const { directInviteToArea } = await import('$lib/concord/area-invite.js');
            await directInviteToArea(target, pubkey);
          }
        } catch (error) {
          console.error('concord: invite failed for', pubkey, error);
          failed++;
        }
      }
      toastCreateResult(failed, selected.length);
      onCreated(channelId);
    } catch (error) {
      console.error('concord: channel creation failed', error);
      showToast(m.concord_channel_create_failed(), 'error');
    }
  }

  async function createGroupChannel() {
    // Mixed-relay pointer lists are unaddressable — there is no single relay
    // to create the new channel on. Abort before touching the network. The
    // FIRST channel has no group pointers to share a relay yet: it lands on
    // the membership pointer's relay, next to the roster root group.
    const relay =
      groupPointers.length > 0 ? sharedRelayOf(groupPointers) : membershipPointer?.relay;
    if (!relay) {
      showToast(m.wizard_no_shared_relay(), 'error');
      return;
    }
    try {
      // Narrowed to a local so TS carries the non-null check through the
      // whole flow — `manager.active` is a getter, so re-reading it inline
      // stays `IAccount | undefined` at every call site below.
      const user = manager.active;
      if (!user) throw new Error('not signed in');
      const id = generateGroupId();
      const { isPublic, isOpen, access } = accessChoiceToNip29({ tier, worldReadable });
      const relayConn = pool.relay(relay);
      // NIP-29 Subgroups: declare the community root as this channel's
      // parent so a relay-side patch can auto-admit root-group members —
      // but only when both groups live on the same relay, since the tag is
      // relay-scoped and a root on a different relay is meaningless there.
      const sameRelay =
        !!membershipPointer && normalizeURL(relay) === normalizeURL(membershipPointer.relay);
      await createGroupOnRelay({
        relayConn,
        id,
        metadata: {
          name: name.trim(),
          isPublic,
          isOpen,
          parent: sameRelay ? membershipPointer.id : undefined
        },
        user
      });
      // Past this point the group EXISTS on the relay — a retry must never
      // re-create it. Attach failure gets its OWN try/catch: it tells a
      // different story from "nothing was created" (the group lives on,
      // orphaned; a blind retry from the outer catch would mint a second
      // one), so it gets a distinct warning toast, no fan-out, and the
      // wizard stays open rather than closing via onCreated.
      try {
        await attachGroupChannel({
          communikeyEvent,
          pointer: { id, relay, name: name.trim(), access },
          communitySigner
        });
        // Mirror the fresh channel into the CREATOR's kind-10009 list —
        // Armada/Flotilla build their UIs from it (r + group tags), and a
        // created-but-unlisted group is invisible there (laoc, 2026-08-19).
        // Best-effort: the channel exists and is attached either way.
        await updatePersonalGroupsList(user, { add: { id, relay } }).catch(() => {});
      } catch (error) {
        console.error('groups: attach failed after group creation', error);
        showToast(m.wizard_attach_failed({ id }), 'warning');
        return;
      }
      // Task A3: admins are pre-joined. The relay already made the CREATOR
      // an admin as part of createGroupOnRelay — only the OTHER root-group
      // admins need an explicit put-user, granted the admin role so they
      // can manage the channel they didn't create. Best-effort, same
      // fan-out machinery (retry-once + partial-failure toast) as
      // MembershipPane's fanOutNewMember.
      const otherAdmins = adminPubkeys.filter((/** @type {string} */ a) => a !== user.pubkey);
      if (otherAdmins.length > 0) {
        const adminAggregate = await fanOut(
          otherAdmins,
          (/** @type {string} */ a) => a,
          (/** @type {string} */ a) => putUserOn({ id, relay }, a, ['admin'], user)
        );
        if (adminAggregate.failed.length > 0) {
          // Dedicated key — area_members_fanout_partial's "{failed} of
          // {total} channels refused" is worded for the OTHER axis (one
          // member across many channels); this fan-out is one channel
          // across many admins, so reusing it would misreport counts as
          // channels instead of admins.
          showToast(
            m.channel_admins_fanout_partial({
              failed: adminAggregate.failed.length,
              total: otherAdmins.length
            }),
            'warning'
          );
        }
      }
      // Fan out put-user to every explicitly selected invitee. Members-tier
      // channels no longer seed the community's existing member union at
      // creation time — members self-join those channels themselves via
      // their own 9021 (A4, 2026-08-19). Self never needs a grant.
      const targets = unique(selected).filter((pubkey) => pubkey !== user.pubkey);
      let failed = 0;
      for (const pubkey of targets) {
        try {
          await publishToGroupRelay(relayConn, buildPutUserTemplate(id, pubkey), user);
        } catch (error) {
          console.error('groups: put-user failed for', pubkey, error);
          failed++;
        }
      }
      toastCreateResult(failed, targets.length);
      onCreated(id);
    } catch (error) {
      console.error('groups: channel creation failed', error);
      showToast(m.concord_channel_create_failed(), 'error');
    }
  }

  async function create() {
    if (busy) return;
    busy = true;
    try {
      if (isGroupMode) await createGroupChannel();
      else await createConcordChannel();
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-lg">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="flex items-center gap-2 text-lg font-extrabold">
      {isPrivate ? '🔒' : '#'}
      {m.concord_new_channel()}
      <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h3>
    <p class="mb-4 text-sm text-base-content/60">{topSubtitle}</p>

    <ul class="steps steps-horizontal mb-4 w-full text-xs">
      <li class="step {step >= 0 ? 'step-neutral' : ''}">{m.concord_wizard_step1()}</li>
      <li class="step {step >= 1 ? 'step-neutral' : ''}">{m.concord_wizard_step2()}</li>
      {#if !isGroupMode}
        <li class="step {step >= 2 ? 'step-neutral' : ''}">{m.concord_wizard_step3()}</li>
      {/if}
    </ul>

    {#if step === 0}
      <label class="form-control mb-3">
        <span class="label-text mb-1 font-bold">{m.concord_wizard_name_label()}</span>
        <input
          class="input-bordered input"
          data-testid="concord-channel-name-input"
          bind:value={name}
          placeholder={m.concord_wizard_name_placeholder()}
        />
      </label>
      <fieldset class="mb-3">
        <legend class="label-text mb-1 font-bold">{m.concord_channel_visibility_label()}</legend>
        <label class="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input
            type="radio"
            class="radio mt-0.5 radio-sm"
            name="wizard-access"
            data-testid="wizard-access-members"
            checked={tier === 'members'}
            onchange={() => (tier = 'members')}
          />
          <span
            ># <b>{m.wizard_access_members()}</b> — {isGroupMode
              ? m.wizard_access_members_hint_closed()
              : m.wizard_access_members_hint_encrypted()}</span
          >
        </label>
        {#if isGroupMode && tier === 'members'}
          <label class="ml-6 flex cursor-pointer items-start gap-2 py-1 text-xs">
            <input
              type="checkbox"
              class="checkbox mt-0.5 checkbox-xs"
              data-testid="wizard-access-worldreadable"
              bind:checked={worldReadable}
            />
            <span
              >🌐 <b>{m.wizard_access_worldreadable()}</b> — {m.wizard_access_worldreadable_hint()}</span
            >
          </label>
        {/if}
        <label class="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input
            type="radio"
            class="radio mt-0.5 radio-sm"
            name="wizard-access"
            data-testid="wizard-access-invited"
            checked={tier === 'invited'}
            onchange={() => (tier = 'invited')}
          />
          <span>🔒 <b>{m.wizard_access_invited()}</b> — {m.wizard_access_invited_hint()}</span>
        </label>
      </fieldset>
      {#if !isGroupMode}
        <div class="alert text-sm">{m.concord_wizard_invisible_hint()}</div>
      {/if}
    {:else if step === 1}
      <p class="mb-3 text-sm text-base-content/70">
        {isGroupMode ? m.wizard_invite_lead() : m.concord_wizard_invite_lead()}
      </p>
      <ContactSearchInput
        acceptPubkeyInput
        placeholder={m.concord_invite_search_placeholder()}
        exclude={selected}
        onselect={(/** @type {{ pubkey: string }} */ c) => toggle(c.pubkey)}
        onrawpubkey={(/** @type {string} */ hex) => toggle(hex)}
      />
      <div class="mt-2 flex max-h-52 flex-col gap-1 overflow-y-auto">
        {#each inviteRows as pubkey (pubkey)}
          <button
            class="btn justify-start gap-2 btn-ghost btn-sm {selected.includes(pubkey)
              ? 'btn-active'
              : ''}"
            onclick={() => toggle(pubkey)}
          >
            <ProfileAvatar {pubkey} profile={getProfiles().get(pubkey)} size="sm" />
            <span class="truncate">{getProfiles().get(pubkey)?.name ?? pubkey.slice(0, 12)}</span>
            <span class="ml-auto">{selected.includes(pubkey) ? '✓' : '+'}</span>
          </button>
        {/each}
      </div>
      {#if !isGroupMode}
        <div class="mt-3 alert text-sm">{m.concord_wizard_link_hint()}</div>
      {/if}
    {:else if !isGroupMode}
      <!-- Concord's key-loss disclosure — meaningless for a NIP-29 group,
        which holds no client-side secret to lose (access is server-enforced
        via put-user/remove-user, not a channel key). -->
      <div class="mb-3 space-y-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <p><b>{m.concord_wizard_keyloss_title()}</b><br />{m.concord_wizard_keyloss_body()}</p>
        <p><b>{m.concord_wizard_backup_title()}</b><br />{m.concord_wizard_backup_body()}</p>
      </div>
      <label class="flex cursor-pointer items-start gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          class="checkbox mt-0.5 checkbox-sm"
          data-testid="concord-wizard-ack-checkbox"
          bind:checked={acknowledged}
        />
        {m.concord_wizard_ack()}
      </label>
      {#if !isPrivate}
        <p class="mt-3 text-xs text-base-content/60">{m.concord_wizard_public_note()}</p>
      {/if}
    {/if}

    <div class="modal-action justify-between">
      {#if step > 0}
        <button class="btn btn-ghost" onclick={() => (step -= 1)}>{m.concord_back()}</button>
      {:else}
        <span></span>
      {/if}
      {#if step < lastStep}
        <button
          class="btn btn-neutral"
          data-testid="concord-wizard-next"
          disabled={step === 0 && !name.trim()}
          onclick={() => (step += 1)}>{m.concord_next()}</button
        >
      {:else}
        <div class="flex flex-col items-end gap-1">
          <button
            class="btn btn-neutral"
            data-testid="concord-wizard-create"
            disabled={(!isGroupMode && !acknowledged) || (isGroupMode && !communitySigner) || busy}
            onclick={create}
          >
            {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
            {isPrivate ? '🔒' : '#'}
            {m.concord_wizard_create()}
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
