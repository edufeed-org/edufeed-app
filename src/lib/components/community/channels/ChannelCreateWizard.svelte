<script>
  // Imports founding.js DIRECTLY (never the barrel): founding.js only pulls
  // pointer.js + client.svelte.js at the top level (both SSR-clean), but the
  // barrel (index.js) also re-exports storage.js, which statically imports
  // applesauce-core-concord/nostr-tools — see index.js's header comment and
  // PrivateChannelsView's identical rule for community.svelte.js.
  import { foundConcordArea } from '$lib/concord/founding.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast';
  import { getVerifiedMembers } from '$lib/helpers/contentTypes.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
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
      const channelId = await target.createChannel(name.trim(), { private: true });
      for (const pubkey of selected) {
        await target.grantChannelAccess(channelId, pubkey);
      }
      showToast(
        m.concord_channel_created({ name: name.trim(), count: selected.length }),
        'success'
      );
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
      🔒 {m.concord_wizard_title()}
      <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h3>
    <p class="mb-4 text-sm text-base-content/60">{m.concord_wizard_subtitle()}</p>

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
          bind:value={name}
          placeholder={m.concord_wizard_name_placeholder()}
        />
      </label>
      <div class="alert text-sm">{m.concord_wizard_invisible_hint()}</div>
    {:else if step === 1}
      <p class="mb-3 text-sm text-base-content/70">{m.concord_wizard_invite_lead()}</p>
      <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
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
        <input type="checkbox" class="checkbox mt-0.5 checkbox-sm" bind:checked={acknowledged} />
        {m.concord_wizard_ack()}
      </label>
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
          disabled={step === 0 && !name.trim()}
          onclick={() => (step += 1)}>{m.concord_next()}</button
        >
      {:else}
        <button class="btn btn-neutral" disabled={!acknowledged || busy} onclick={create}>
          {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
          🔒 {m.concord_wizard_create()}
        </button>
      {/if}
    </div>
  </div>
</div>
