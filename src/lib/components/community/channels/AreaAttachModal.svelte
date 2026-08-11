<script>
  // Attach an EXISTING protected area to this community (design spec: settings
  // card + founding pane secondary action). Two kinds of area, one modal:
  // a Concord area (encrypted) or a NIP-29 group as one channel (closed).
  // A community is extended by EXACTLY ONE of them (laoc 2026-08-05), so the
  // tabs on offer come from attachableAreaModes — once one side is taken, the
  // other stops being offered.
  //
  // Imports concord submodules DIRECTLY (never the barrel) — the convention
  // every Concord component follows (see CLAUDE.md's Concord section).
  import { attachConcordArea } from '$lib/concord/attach.js';
  import { useAttachableConcordAreas } from '$lib/concord/unlinked-areas.svelte.js';
  import { attachableAreaModes, attachGroupChannel } from '$lib/groups/community-attach.js';
  import { parseGroupInput } from '$lib/groups/groups.js';
  import { manager } from '$lib/stores/accounts.svelte';
  import { showToast } from '$lib/helpers/toast';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    communikeyEvent,
    onClose,
    onAttached = /** @type {(() => void) | null} */ (null)
  } = $props();

  const getAreas = useAttachableConcordAreas(() => manager.active?.pubkey);
  const areas = $derived(getAreas());

  const modes = $derived(attachableAreaModes(communikeyEvent));
  /** @type {'concord' | 'group'} */
  let tab = $state('concord');
  // The tab the community can still use wins over the default, so a community
  // already carrying group channels opens straight on the only usable side.
  const activeTab = $derived(modes[tab] ? tab : modes.group ? 'group' : 'concord');

  /** @type {string | null} */
  let selected = $state(null);
  let busy = $state(false);

  let groupAddress = $state('');
  /** @type {'members' | 'invited'} */
  let groupAccess = $state('invited');
  const groupPointer = $derived(parseGroupInput(groupAddress));
  // Only complain about something that was actually typed.
  const groupAddressInvalid = $derived(groupAddress.trim().length > 0 && !groupPointer);

  async function attachGroup() {
    if (!groupPointer || busy) return;
    busy = true;
    try {
      await attachGroupChannel({
        communikeyEvent,
        // The access marker is presentational only — the relay enforces
        // reading either way (see groups/channel-access.js).
        pointer: { id: groupPointer.id, relay: groupPointer.relay, access: groupAccess },
        communitySigner
      });
      showToast(m.groups_attach_success(), 'success');
      onAttached?.();
      onClose();
    } catch (error) {
      console.error('groups: attach channel failed', error);
      showToast(m.groups_attach_failed(), 'error');
    } finally {
      busy = false;
    }
  }

  // Same signer-resolution pattern as ChannelCreateWizard/EditCommunityModal:
  // whichever account in the manager holds this community's keypair.
  const communitySigner = $derived.by(() => {
    const pk = communikeyEvent?.pubkey;
    if (!pk) return null;
    return manager.getAccountForPubkey(pk)?.signer ?? null;
  });

  async function attach() {
    const area = areas.find((a) => a.communityId === selected);
    if (!area || busy) return;
    busy = true;
    try {
      await attachConcordArea({
        communikeyEvent,
        communityId: area.communityId,
        relay: area.relay,
        communitySigner
      });
      showToast(m.concord_attach_success({ name: area.name }), 'success');
      onAttached?.();
      onClose();
    } catch (error) {
      console.error('concord: attach failed', error);
      showToast(m.concord_attach_failed(), 'error');
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
    <h3 class="flex items-center gap-2 text-lg font-extrabold">
      🔗 {activeTab === 'group' ? m.groups_attach_title() : m.concord_attach_title()}
      <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h3>

    <!-- Tabs only when there is a choice left to make. -->
    {#if modes.concord && modes.group}
      <div role="tablist" class="tabs-box mt-3 mb-1 tabs">
        <button
          role="tab"
          class="tab {activeTab === 'concord' ? 'tab-active' : ''}"
          data-testid="attach-tab-concord"
          onclick={() => (tab = 'concord')}>🔒 {m.concord_attach_tab()}</button
        >
        <button
          role="tab"
          class="tab {activeTab === 'group' ? 'tab-active' : ''}"
          data-testid="attach-tab-group"
          onclick={() => (tab = 'group')}># {m.groups_attach_tab()}</button
        >
      </div>
    {/if}

    {#if modes.concord && modes.group}
      <p
        class="mb-2 rounded-lg bg-base-200 p-2.5 text-xs text-base-content/70"
        data-testid="protocol-notice"
      >
        {activeTab === 'group' ? m.groups_protocol_notice() : m.concord_protocol_notice()}
      </p>
    {/if}

    {#if activeTab === 'group'}
      <p class="mb-4 text-sm text-base-content/60">{m.groups_attach_lead()}</p>

      <label class="mb-1 block text-xs text-base-content/60" for="group-attach-address">
        {m.groups_attach_address_label()}
      </label>
      <input
        id="group-attach-address"
        class="input-bordered input input-sm w-full {groupAddressInvalid ? 'input-error' : ''}"
        data-testid="group-attach-input"
        placeholder={m.groups_join_placeholder()}
        bind:value={groupAddress}
      />
      {#if groupAddressInvalid}
        <p class="mt-1 text-xs text-error" data-testid="group-attach-error">
          {m.groups_invalid_pointer()}
        </p>
      {/if}

      <label class="mt-3 mb-1 block text-xs text-base-content/60" for="group-attach-access">
        {m.groups_attach_access_label()}
      </label>
      <select
        id="group-attach-access"
        class="select-bordered select w-full select-sm"
        data-testid="group-attach-access"
        bind:value={groupAccess}
      >
        <option value="invited">{m.groups_attach_access_invited()}</option>
        <option value="members">{m.groups_attach_access_members()}</option>
      </select>
      <p class="mt-3 rounded-lg bg-base-200 p-2.5 text-xs text-base-content/60">
        ⓘ {m.groups_attach_access_hint()}
      </p>

      <div class="modal-action">
        <button class="btn btn-ghost" onclick={onClose}>{m.concord_cancel()}</button>
        <button
          class="btn btn-neutral"
          data-testid="group-attach-confirm"
          disabled={!groupPointer || busy || !communitySigner}
          onclick={attachGroup}
        >
          {#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
          {m.groups_attach_action()}
        </button>
      </div>
    {:else}
      <p class="mb-4 text-sm text-base-content/60">{m.concord_attach_lead()}</p>

      {#if areas.length === 0}
        <p class="rounded-lg bg-base-200 p-3 text-sm text-base-content/70">
          {m.concord_attach_empty()}
        </p>
      {:else}
        <div class="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {#each areas as area (area.communityId)}
            <button
              class="flex items-center gap-3 rounded-xl border p-2 text-left transition-colors {selected ===
              area.communityId
                ? 'border-primary bg-primary/10'
                : 'border-base-300'} {area.linkedToJoined
                ? 'cursor-default opacity-50'
                : 'hover:bg-base-200'}"
              data-testid="concord-attach-area"
              disabled={area.linkedToJoined}
              onclick={() => (selected = selected === area.communityId ? null : area.communityId)}
            >
              <ConcordAreaBadge
                name={area.name}
                communityId={area.communityId}
                iconPointer={area.iconPointer}
                class="h-9 w-9"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold">{area.name}</span>
                <span class="block text-xs text-base-content/60">
                  {area.linkedToJoined
                    ? m.concord_attach_already_linked()
                    : m.concord_attach_owner_sub()}
                </span>
              </span>
              {#if selected === area.communityId}<span class="text-primary">✓</span>{/if}
            </button>
          {/each}
        </div>
      {/if}

      <div class="mt-3 space-y-2 text-xs text-base-content/60">
        <p class="rounded-lg bg-base-200 p-2.5">ⓘ {m.concord_attach_own_only_hint()}</p>
        <p class="rounded-lg bg-base-200 p-2.5">🙈 {m.concord_attach_public_hint()}</p>
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost" onclick={onClose}>{m.concord_cancel()}</button>
        <button
          class="btn btn-neutral"
          data-testid="concord-attach-confirm"
          disabled={!selected || busy || !communitySigner}
          onclick={attach}
        >
          {#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
          {m.concord_attach_action()}
        </button>
      </div>
    {/if}
  </div>
</div>
