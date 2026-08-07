<script>
  // Attach an EXISTING Concord area to this community (design spec: settings
  // card + founding pane secondary action). Imports concord submodules
  // DIRECTLY (never the barrel) — the convention every Concord component
  // follows (see CLAUDE.md's Concord section).
  import { attachConcordArea } from '$lib/concord/attach.js';
  import { useAttachableConcordAreas } from '$lib/concord/unlinked-areas.svelte.js';
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

  /** @type {string | null} */
  let selected = $state(null);
  let busy = $state(false);

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
      🔗 {m.concord_attach_title()}
      <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h3>
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
  </div>
</div>
