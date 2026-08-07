<script>
  // Imports founding.js DIRECTLY (never the barrel) — the convention every
  // Concord component follows (see CLAUDE.md's Concord section and index.js's
  // header comment): the barrel is reserved for non-component/dynamic-import
  // call sites and deliberately never re-exports storage.js (a static
  // applesauce-core-concord import) to stay SSR-clean.
  import { foundConcordArea } from '$lib/concord/founding.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { getContext } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    communikeyEvent,
    communityProfile = null,
    community = undefined,
    onClose,
    onCreated
  } = $props();

  let step = $state(0);
  let name = $state('');
  let isPrivate = $state(true);
  // NOTE: no description field — CORD ChannelMetadata has no description and
  // createChannel only takes {private, voice}; don't collect what we can't store.
  /** @type {string[]} */
  let selected = $state.raw([]);
  let acknowledged = $state(false);
  let busy = $state(false);

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
    const { allMembers } = getVerifiedMembers(profileAccess, communikeyEvent);
    return allMembers.filter((p) => p !== self);
  });
  const getProfiles = useProfileMap(() => invitable);

  // Resolve the signer that can edit this community's 10222 (same pattern as
  // EditCommunityModal.svelte:404-412): current-keypair → own signer;
  // new-keypair → the community account's signer registered in the manager.
  const communitySigner = $derived.by(() => {
    const pk = communikeyEvent?.pubkey;
    if (!pk) return null;
    const account = manager.getAccountForPubkey(pk);
    return account?.signer ?? null;
  });

  function toggle(/** @type {string} */ pubkey) {
    selected = selected.includes(pubkey)
      ? selected.filter((p) => p !== pubkey)
      : [...selected, pubkey];
  }

  async function create() {
    if (busy) return;
    busy = true;
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
      if (failed > 0) {
        showToast(
          m.concord_channel_created_partial({
            name: name.trim(),
            failed,
            total: selected.length
          }),
          'warning'
        );
      } else {
        showToast(
          m.concord_channel_created({ name: name.trim(), count: selected.length }),
          'success'
        );
      }
      onCreated(channelId);
    } catch (error) {
      console.error('concord: channel creation failed', error);
      showToast(m.concord_channel_create_failed(), 'error');
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
    <p class="mb-4 text-sm text-base-content/60">
      {isPrivate ? m.concord_wizard_subtitle() : m.concord_channel_visibility_public_hint()}
    </p>

    <ul class="steps steps-horizontal mb-4 w-full text-xs">
      <li class="step {step >= 0 ? 'step-neutral' : ''}">{m.concord_wizard_step1()}</li>
      <li class="step {step >= 1 ? 'step-neutral' : ''}">{m.concord_wizard_step2()}</li>
      <li class="step {step >= 2 ? 'step-neutral' : ''}">{m.concord_wizard_step3()}</li>
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
            name="concord-channel-visibility"
            data-testid="concord-visibility-private"
            checked={isPrivate}
            onchange={() => (isPrivate = true)}
          />
          <span
            >🔒 <b>{m.concord_channel_visibility_private()}</b> — {m.concord_channel_visibility_private_hint()}</span
          >
        </label>
        <label class="flex cursor-pointer items-start gap-2 py-1 text-sm">
          <input
            type="radio"
            class="radio mt-0.5 radio-sm"
            name="concord-channel-visibility"
            data-testid="concord-visibility-public"
            checked={!isPrivate}
            onchange={() => (isPrivate = false)}
          />
          <span
            ># <b>{m.concord_channel_visibility_public()}</b> — {m.concord_channel_visibility_public_hint()}</span
          >
        </label>
      </fieldset>
      <div class="alert text-sm">{m.concord_wizard_invisible_hint()}</div>
    {:else if step === 1}
      <p class="mb-3 text-sm text-base-content/70">{m.concord_wizard_invite_lead()}</p>
      <ContactSearchInput
        acceptPubkeyInput
        placeholder={m.concord_invite_search_placeholder()}
        exclude={selected}
        onselect={(/** @type {{ pubkey: string }} */ c) => toggle(c.pubkey)}
        onrawpubkey={(/** @type {string} */ hex) => toggle(hex)}
      />
      <div class="mt-2 flex max-h-52 flex-col gap-1 overflow-y-auto">
        {#each invitable as pubkey (pubkey)}
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
      <div class="mt-3 alert text-sm">{m.concord_wizard_link_hint()}</div>
    {:else}
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
      {#if step < 2}
        <button
          class="btn btn-neutral"
          data-testid="concord-wizard-next"
          disabled={step === 0 && !name.trim()}
          onclick={() => (step += 1)}>{m.concord_next()}</button
        >
      {:else}
        <button
          class="btn btn-neutral"
          data-testid="concord-wizard-create"
          disabled={!acknowledged || busy}
          onclick={create}
        >
          {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
          {isPrivate ? '🔒' : '#'}
          {m.concord_wizard_create()}
        </button>
      {/if}
    </div>
  </div>
</div>
