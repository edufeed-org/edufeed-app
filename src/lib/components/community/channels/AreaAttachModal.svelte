<script>
  // One picker for "link something that already exists" — spec
  // docs/superpowers/specs/2026-08-12-attach-modal-redesign-design.md.
  // Picking a row implies the protocol, so the tabs and the protocol notice
  // are gone. The XOR (one area kind per community) still comes from
  // attachableAreaModes; this component only decides what to OFFER.
  //
  // Imports concord submodules DIRECTLY (never the barrel) — the convention
  // every Concord component follows (see CLAUDE.md's Concord section).
  import { attachableAreaModes, attachGroupChannel } from '$lib/groups/community-attach.js';
  import {
    groupAttachCandidates,
    parseGroupAddress,
    attachAccessQuestion
  } from '$lib/groups/attach-candidates.js';
  import { fetchGroupPreview } from '$lib/groups/group-preview.js';
  import { useMyGroups } from '$lib/groups/unlinked-groups.svelte.js';
  import { useChannelMetadata } from '$lib/groups/channel-metadata.svelte.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getCommunitySigner } from '$lib/helpers/community-signer.js';
  import { showToast } from '$lib/helpers/toast';
  import ConcordAreaBadge from '$lib/components/shared/ConcordAreaBadge.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    communikeyEvent,
    onClose,
    onAttached = /** @type {(() => void) | null} */ (null)
  } = $props();

  const modes = $derived(attachableAreaModes(communikeyEvent));

  // --- candidate list: everything the app already knows -------------------
  const getMyGroups = useMyGroups();
  const getChannelMeta = useChannelMetadata(() => getMyGroups());

  /** @typedef {{kind: 'concord'|'group', key: string, name: string, category: string, worldReadable: boolean, disabled?: boolean, area?: any, pointer?: {id: string, relay: string}}} Candidate */
  const candidates = $derived.by(() => {
    /** @type {Candidate[]} */
    const rows = [];
    // Concord-area candidates removed (laoc, 2026-08-18): linking an
    // EXISTING area is a flow nobody realistically needs yet — communities
    // found fresh areas; existing links keep working and can be detached.
    // This modal now only serves the NIP-29 group-channel attach.
    if (modes.group) {
      for (const row of groupAttachCandidates({
        groups: getMyGroups(),
        communikeyEvent,
        metadataByKey: getChannelMeta().byKey
      })) {
        rows.push({
          kind: 'group',
          key: `group:${row.key}`,
          name: row.name,
          category: row.worldReadable ? m.attach_category_world() : m.attach_category_closed(),
          worldReadable: row.worldReadable,
          pointer: row.pointer
        });
      }
    }
    return rows;
  });

  /** @type {string | null} */
  let selectedKey = $state(null);
  const selected = $derived(candidates.find((c) => c.key === selectedKey) ?? null);

  // --- paste fallback ------------------------------------------------------
  let showPaste = $state(false);
  let pasteInput = $state('');
  const pastePointer = $derived(parseGroupAddress(pasteInput));
  const pasteInvalid = $derived(pasteInput.trim().length > 0 && !pastePointer);
  /** @type {{name: string, picture: string|null, worldReadable: boolean} | null} */
  let preview = $state(null);
  let previewMissing = $state(false);
  let previewBusy = $state(false);

  // Fetch the preview whenever the parsed pointer changes. A stale response
  // must not overwrite a newer one — compare against the current pointer.
  $effect(() => {
    const pointer = pastePointer;
    preview = null;
    previewMissing = false;
    if (!pointer || !modes.group) {
      previewBusy = false;
      return;
    }
    previewBusy = true;
    fetchGroupPreview(pool.relay(pointer.relay), pointer, manager.active?.signer).then((result) => {
      if (pastePointer !== pointer) return;
      preview = result;
      previewMissing = result === null;
      previewBusy = false;
      // A resolved preview is an explicit target too — it must not be
      // shadowed by a leftover row pick (the vice-versa of the row onclick's
      // `pasteInput = ''` above).
      if (result) selectedKey = null;
    });
  });

  // --- the access question -------------------------------------------------
  /** The active attach target: a picked row or the previewed paste. */
  const target = $derived.by(() => {
    if (showPaste && pastePointer && preview) {
      return {
        kind: /** @type {const} */ ('group'),
        worldReadable: preview.worldReadable,
        pointer: pastePointer
      };
    }
    if (selected) {
      return {
        kind: selected.kind,
        worldReadable: selected.worldReadable,
        pointer: selected.pointer,
        area: selected.area
      };
    }
    return null;
  });
  const askAccess = $derived(
    !!target && attachAccessQuestion({ kind: target.kind, worldReadable: target.worldReadable })
  );
  /** @type {'members' | 'invited'} */
  let access = $state('invited');
  // Reset to the safe default whenever the target changes — a wider tier
  // picked for one group must never carry over to the next selection.
  $effect(() => {
    selectedKey;
    pastePointer;
    access = 'invited';
  });

  // --- dispatch ------------------------------------------------------------
  let busy = $state(false);
  const communitySigner = $derived.by(() => getCommunitySigner(communikeyEvent?.pubkey));

  async function attach() {
    if (!target || busy) return;
    busy = true;
    try {
      {
        const groupPointer = /** @type {{id: string, relay: string}} */ (target.pointer);
        const pointer = target.worldReadable
          ? { id: groupPointer.id, relay: groupPointer.relay }
          : { id: groupPointer.id, relay: groupPointer.relay, access };
        await attachGroupChannel({ communikeyEvent, pointer, communitySigner });
        showToast(m.groups_attach_success(), 'success');
      }
      onAttached?.();
      onClose();
    } catch (error) {
      console.error('attach failed', error);
      showToast(
        target.kind === 'concord' ? m.concord_attach_failed() : m.groups_attach_failed(),
        'error'
      );
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
      🔗 {m.attach_modal_title()}
      <span class="badge badge-xs font-bold uppercase badge-accent">Beta</span>
    </h3>
    <p class="mt-1 mb-4 text-sm text-base-content/60">{m.attach_modal_lead()}</p>

    {#if candidates.length === 0}
      <p class="rounded-lg bg-base-200 p-3 text-sm text-base-content/70">{m.attach_empty()}</p>
    {:else}
      <div class="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {#each candidates as candidate (candidate.key)}
          <button
            class="flex items-center gap-3 rounded-xl border p-2 text-left transition-colors {selectedKey ===
            candidate.key
              ? 'border-primary bg-primary/10'
              : 'border-base-300'} {candidate.disabled
              ? 'cursor-default opacity-50'
              : 'hover:bg-base-200'}"
            data-testid="attach-candidate"
            disabled={candidate.disabled}
            onclick={() => {
              selectedKey = selectedKey === candidate.key ? null : candidate.key;
              // A row pick is an explicit choice — it must not be shadowed by
              // a leftover pasted preview (or vice versa, see below).
              pasteInput = '';
            }}
          >
            {#if candidate.kind === 'concord'}
              <ConcordAreaBadge
                name={candidate.name}
                communityId={candidate.area.communityId}
                iconPointer={candidate.area.iconPointer}
                class="h-9 w-9"
              />
            {:else}
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full bg-base-200 text-base"
              >
                {candidate.worldReadable ? '#🌐' : '#'}
              </span>
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{candidate.name}</span>
              <span class="block text-xs text-base-content/60">
                {candidate.disabled ? m.concord_attach_already_linked() : candidate.category}
              </span>
            </span>
            {#if selectedKey === candidate.key}<span class="text-primary">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/if}

    {#if modes.group}
      <button
        class="btn mt-3 self-start px-0 text-base-content/60 btn-link btn-sm"
        data-testid="attach-paste-toggle"
        onclick={() => {
          showPaste = !showPaste;
          // Hiding the field clears its state too — reopening starts fresh
          // rather than showing a stale preview from a previous paste.
          if (!showPaste) pasteInput = '';
        }}
      >
        {m.attach_paste_toggle()} →
      </button>
      {#if showPaste}
        <input
          class="input-bordered input input-sm w-full {pasteInvalid ? 'input-error' : ''}"
          data-testid="attach-paste-input"
          placeholder={m.attach_paste_placeholder()}
          bind:value={pasteInput}
        />
        {#if pasteInvalid}
          <p class="mt-1 text-xs text-error" data-testid="attach-paste-error">
            {m.attach_paste_unparseable()}
          </p>
        {:else if previewMissing && !previewBusy}
          <p class="mt-1 text-xs text-error" data-testid="attach-paste-error">
            {m.attach_paste_not_found()}
          </p>
        {/if}
        {#if previewBusy}
          <p class="mt-2 text-xs text-base-content/60" data-testid="attach-preview-busy">
            <span class="loading loading-xs loading-spinner"></span>
          </p>
        {/if}
        {#if preview}
          <div
            class="mt-2 flex items-center gap-3 rounded-xl border border-base-300 p-2"
            data-testid="attach-preview"
          >
            {#if preview.picture}
              <img src={preview.picture} alt="" class="h-9 w-9 rounded-full object-cover" />
            {:else}
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full bg-base-200 text-base"
              >
                {preview.worldReadable ? '#🌐' : '#'}
              </span>
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{preview.name}</span>
              <span class="block text-xs text-base-content/60">
                {preview.worldReadable ? m.attach_category_world() : m.attach_category_closed()}
              </span>
            </span>
          </div>
        {/if}
      {/if}
    {/if}

    {#if askAccess}
      <fieldset class="mt-4">
        <legend class="mb-1 text-xs text-base-content/60">{m.attach_access_question()}</legend>
        <label class="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-base-200">
          <input
            type="radio"
            class="radio mt-0.5 radio-sm"
            name="attach-access"
            value="members"
            data-testid="attach-access-members"
            bind:group={access}
          />
          <span>
            <span class="block text-sm font-medium">{m.wizard_access_members()}</span>
            <span class="block text-xs text-base-content/60"
              >{m.wizard_access_members_hint_closed()}</span
            >
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-2 rounded-lg p-1.5 hover:bg-base-200">
          <input
            type="radio"
            class="radio mt-0.5 radio-sm"
            name="attach-access"
            value="invited"
            data-testid="attach-access-invited"
            bind:group={access}
          />
          <span>
            <span class="block text-sm font-medium">{m.wizard_access_invited()}</span>
            <span class="block text-xs text-base-content/60">{m.wizard_access_invited_hint()}</span>
          </span>
        </label>
      </fieldset>
    {/if}

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={onClose}>{m.concord_cancel()}</button>
      <button
        class="btn btn-neutral"
        data-testid="attach-confirm"
        disabled={!target || busy || !communitySigner}
        onclick={attach}
      >
        {#if busy}<span class="loading loading-xs loading-spinner"></span>{/if}
        {m.attach_action()}
      </button>
    </div>
  </div>
</div>
