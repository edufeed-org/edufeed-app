<!--
  ProfileQrModal — a profile as a QR code, and the scanner that opens other
  profiles from theirs (issue 9f7816e3, "quick profile scanning via QR").

  Shown by ModalManager (type 'profileQr') from the profile header's npub
  pill and the account menu's "Mein QR-Code" row. Show mode renders
  `nostr:<npub>` (NIP-21 — what Amethyst, Damus and Primal encode and read)
  with the avatar, name and copyable npub; scan mode swaps in `QrScanner`
  and routes a recognised code through `resolveScannedNostrRoute`.
  CSS-only modal (no native <dialog>), small-modal grammar.
-->
<script>
  import QRCode from 'qrcode';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import * as m from '$lib/paraglide/messages';
  import { showToast } from '$lib/helpers/toast.js';
  import {
    profileQrPayload,
    resolveScannedNostrRoute,
    containsPrivateKey
  } from '$lib/helpers/profile-qr.js';
  import { getDisplayName } from '$lib/helpers/displayName.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from '$lib/components/shared/ProfileAvatar.svelte';
  import QrScanner from './QrScanner.svelte';
  import { CheckIcon, CloseIcon, CopyIcon, QrCodeIcon } from '$lib/components/icons';

  /** @type {{ pubkey: string, npub: string, onClose: () => void }} */
  let { pubkey, npub, onClose } = $props();

  const getProfile = useUserProfile(() => pubkey);
  const displayName = $derived(getDisplayName(getProfile(), pubkey));
  const payload = $derived(profileQrPayload(npub, pubkey));
  const shownNpub = $derived(payload.replace(/^nostr:/, ''));

  /** @type {'show' | 'scan'} */
  let mode = $state('show');
  /** @type {HTMLDivElement | undefined} */
  let rootEl = $state(undefined);
  // Take focus so Escape reaches the dialog (there is no native <dialog>).
  $effect(() => {
    rootEl?.focus();
  });
  let qrDataUrl = $state('');
  let copied = $state(false);

  $effect(() => {
    const current = payload;
    qrDataUrl = '';
    if (!current) return;
    let cancelled = false;
    QRCode.toDataURL(current, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
      .then((/** @type {string} */ url) => {
        if (!cancelled) qrDataUrl = url;
      })
      .catch((/** @type {unknown} */ err) => console.error('profile QR generation failed', err));
    return () => {
      cancelled = true;
    };
  });

  async function copyNpub() {
    try {
      await navigator.clipboard.writeText(shownNpub);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  /**
   * @param {string} text
   * @returns {boolean} true when the code was a Nostr target and we navigated
   */
  function onScanned(text) {
    if (containsPrivateKey(text)) {
      showToast(m.profile_qr_scan_private_key(), 'error');
      return false;
    }
    const route = resolveScannedNostrRoute(text);
    if (!route) {
      showToast(m.profile_qr_scan_unrecognized(), 'error');
      return false;
    }
    onClose();
    goto(/** @type {any} */ (resolve)(route));
    return true;
  }

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }
</script>

<div
  class="modal-open modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="profile-qr-title"
  tabindex="-1"
  data-testid="profile-qr-modal"
  bind:this={rootEl}
  onkeydown={onKeyDown}
>
  <div class="modal-box max-w-sm">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h3 id="profile-qr-title" class="font-bold">
        {mode === 'scan' ? m.profile_qr_scan_title() : m.profile_qr_title()}
      </h3>
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        aria-label={m.common_close()}
        data-testid="profile-qr-close"
        onclick={onClose}
      >
        <CloseIcon class_="w-5 h-5" />
      </button>
    </div>

    {#if mode === 'scan'}
      <QrScanner onResult={onScanned} onCancel={() => (mode = 'show')} />
    {:else}
      <div class="flex flex-col items-center gap-3">
        <div class="flex items-center gap-2">
          <ProfileAvatar {pubkey} size="sm" fallbackType="robohash" loading="eager" />
          <span class="font-medium break-words">{displayName}</span>
        </div>
        <div
          class="flex aspect-square w-full max-w-[280px] items-center justify-center rounded-xl bg-white p-3"
        >
          {#if qrDataUrl}
            <img
              src={qrDataUrl}
              alt={m.profile_qr_alt()}
              class="h-full w-full"
              data-testid="profile-qr-image"
            />
          {:else}
            <span class="loading loading-md loading-spinner text-neutral"></span>
          {/if}
        </div>
        <p class="text-center text-sm text-base-content/70">{m.profile_qr_hint()}</p>
        <div class="flex w-full items-center gap-2">
          <code class="min-w-0 flex-1 rounded bg-base-200 px-2 py-1 font-mono text-xs break-all">
            {shownNpub}
          </code>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            title={m.profile_copy_pubkey()}
            aria-label={m.profile_copy_pubkey()}
            data-testid="profile-qr-copy"
            onclick={copyNpub}
          >
            {#if copied}
              <CheckIcon class_="w-4 h-4 text-success" />
            {:else}
              <CopyIcon class_="w-4 h-4" />
            {/if}
          </button>
        </div>
        <button
          type="button"
          class="btn w-full btn-primary"
          data-testid="profile-qr-scan"
          onclick={() => (mode = 'scan')}
        >
          <QrCodeIcon class_="w-5 h-5" />
          {m.profile_qr_scan_button()}
        </button>
      </div>
    {/if}
  </div>
  <button
    type="button"
    class="modal-backdrop"
    aria-label={m.common_close()}
    tabindex="-1"
    onclick={onClose}
  ></button>
</div>
