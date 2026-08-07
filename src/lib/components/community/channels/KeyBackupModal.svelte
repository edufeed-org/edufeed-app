<!--
  KeyBackupModal — Task 14.

  Guidance-only (spec decision 5): Phase 1 doesn't add a new export flow,
  it points at what already exists. Two options:
  - "sign in on a second device" — always shown, no action needed beyond
    the existing login flow (channel keys live in ConcordStorage/IndexedDB
    and resync from the network on any device holding the account key).
  - "export your key" — only for accounts where a real secret actually
    lives locally and is exportable in this app:
      - `type === 'nsec'` (applesauce-accounts PrivateKeyAccount) — gated
        the same way as the Recovery File Card in
        `src/routes/settings/+page.svelte` (`activeAccount?.type === 'nsec'`).
      - Pomegranate/Google-login FROST accounts, tagged
        `metadata.pomegranateCentral` — exportable via
        `PomegranateExportCard.svelte`, which self-gates on that same field.
    Extension (NIP-07) and bunker (nostr-connect) accounts keep the key
    outside the app entirely, so neither option applies to them — no export
    link is shown and the copy doesn't promise one.
  The brief's original guess (`metadata?.privateKey || type === 'nsec'`) was
  checked against accounts.svelte.js / applesauce-accounts' registered
  types (extension, ncryptsec/password, readonly, nsec, nostr-connect) —
  there is no `metadata.privateKey` field on any of them, so that half of
  the guess was dropped in favor of the Pomegranate check above.
-->
<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import * as m from '$lib/paraglide/messages';

  let { onClose } = $props();

  const hasLocalKey = $derived(
    manager.active?.type === 'nsec' || !!manager.active?.metadata?.pomegranateCentral
  );
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md text-center">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <div class="text-2xl">🔑</div>
    <h3 class="mt-1 text-lg font-extrabold">{m.concord_backup_title()}</h3>
    <p class="my-3 text-sm text-base-content/70">{m.concord_backup_body()}</p>
    <div class="flex flex-col gap-2 text-left">
      <div class="rounded-xl border border-base-300 p-4">
        <b class="text-sm">{m.concord_backup_device_title()}</b>
        <p class="text-xs text-base-content/60">{m.concord_backup_device_body()}</p>
      </div>
      {#if hasLocalKey}
        <a class="rounded-xl border border-base-300 p-4 hover:border-primary" href="/settings">
          <b class="text-sm">{m.concord_backup_export_title()}</b>
          <p class="text-xs text-base-content/60">{m.concord_backup_export_body()}</p>
        </a>
      {/if}
    </div>
    <div class="modal-action justify-center">
      <button class="btn btn-neutral" onclick={onClose}>{m.concord_done()}</button>
    </div>
  </div>
</div>
