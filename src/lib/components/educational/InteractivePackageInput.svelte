<script>
  /**
   * Step-2 field of the `interactive` resource variant. Normalizes any upload
   * (.h5p / .xdc / .html) into a .xdc, defers the Blossom upload to the
   * license modal's beforeAttest (same pattern as LicensedFileInput), uploads
   * the extracted icon alongside, and publishes ONE kind-1063 that is both
   * license attestation and NIP-DC discovery event (m=application/x-webxdc,
   * alt, image).
   */
  import * as m from '$lib/paraglide/messages';
  import { BlossomClient } from 'blossom-client-sdk';
  import LicenseModal from '$lib/components/shared/LicenseModal.svelte';
  import WebxdcPlayer from '$lib/webxdc/WebxdcPlayer.svelte';
  import { manager } from '$lib/stores/accounts.svelte';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import { reconcileBlobUrlScheme } from '$lib/helpers/blossom-trust.js';
  import { findExistingLicense } from '$lib/helpers/image-license.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import {
    unzipXdc,
    zipXdc,
    extractXdcMeta,
    wrapHtml,
    sha256Bytes,
    ensureDefaultIcon
  } from '$lib/webxdc/xdc-archive.js';
  import { isH5pArchive, wrapH5p } from '$lib/webxdc/h5p-wrap.js';

  const SIZE_WARN_BYTES = 50 * 1024 * 1024;

  let { value = $bindable(null), disabled = false, activeUserDisplayName = '' } = $props();

  let error = $state('');
  let sizeWarning = $state(false);
  let busy = $state(false);
  let modalOpen = $state(false);
  let showPreview = $state(false);

  // Pending package between file selection and license save. Plain refs +
  // small $state mirrors for the bits the template shows.
  /** @type {{ file: File, bytes: Uint8Array, sha256: string, name: string,
   *    iconBytes: Uint8Array|null, iconMime: string|null } | null} */
  let pending = null;
  let pendingName = $state('');
  let pendingFileName = $state('');
  let pendingHash = $state('');
  let pendingSize = $state(0);
  let existingLicense = $state(/** @type {import('nostr-tools').NostrEvent | null} */ (null));
  let iconUrl = $state('');
  let pendingBytes = $state.raw(/** @type {Uint8Array|null} */ (null));
  // Prefill for the license modal, sourced from h5p.json metadata (license +
  // authors). Null for non-h5p inputs (raw .xdc / wrapped .html) — the
  // educator can still change everything in the modal, this is prefill only.
  let pendingLicenseUrl = $state(/** @type {string | null} */ (null));
  let pendingCredit = $state(/** @type {string | null} */ (null));

  /** @param {string} fileName */
  function stripExt(fileName) {
    return fileName.replace(/\.(h5p|xdc|html?)$/i, '');
  }

  /** @param {Event} e */
  async function onFileChange(e) {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) return;
    error = '';
    sizeWarning = false;
    busy = true;
    try {
      const inputBytes = new Uint8Array(await file.arrayBuffer());
      const lower = file.name.toLowerCase();
      let files;
      let name = stripExt(file.name);
      let licenseUrl = /** @type {string | null} */ (null);
      let credit = /** @type {string | null} */ (null);

      if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        files = wrapHtml(inputBytes, name);
      } else {
        const unzipped = unzipXdc(inputBytes);
        if (isH5pArchive(unzipped)) {
          const wrapped = await wrapH5p(unzipped, name);
          files = wrapped.files;
          name = wrapped.name;
          licenseUrl = wrapped.licenseUrl;
          credit = wrapped.credit;
        } else {
          files = unzipped;
          const meta = extractXdcMeta(files);
          if (meta.name) name = meta.name;
        }
      }

      if (!files.get('index.html')) {
        error = m.interactive_input_invalid();
        return;
      }

      // Spec requires every wrapped archive to ship an icon. Fetched here
      // (not inside wrapHtml/wrapH5p) so the pure archive modules stay
      // network-free, and applied uniformly across all three input paths
      // (raw .xdc passthrough included) rather than duplicated per-wrapper.
      if (!files.get('icon.png') && !files.get('icon.jpg')) {
        try {
          const iconRes = await fetch('/icon-192x192.png');
          if (iconRes.ok) {
            files = ensureDefaultIcon(files, new Uint8Array(await iconRes.arrayBuffer()));
          }
        } catch {
          // best-effort default icon — a missing one never blocks publishing
        }
      }

      const meta = extractXdcMeta(files);
      const xdcBytes = zipXdc(files);
      const hash = await sha256Bytes(xdcBytes);
      sizeWarning = xdcBytes.byteLength > SIZE_WARN_BYTES;

      const slug =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'app';
      pending = {
        file: new File([/** @type {BlobPart} */ (xdcBytes)], `${slug}.xdc`, {
          type: 'application/x-webxdc'
        }),
        bytes: xdcBytes,
        sha256: hash,
        name,
        iconBytes: meta.iconBytes,
        iconMime: meta.iconMime
      };
      pendingName = name;
      pendingFileName = pending.file.name;
      pendingHash = hash;
      pendingSize = xdcBytes.byteLength;
      pendingBytes = xdcBytes;
      iconUrl = '';
      pendingLicenseUrl = licenseUrl;
      pendingCredit = credit;
      existingLicense = await findExistingLicense(hash);
      modalOpen = true;
    } catch (err) {
      error = m.interactive_input_invalid();
      console.error('Package processing failed:', err);
    } finally {
      busy = false;
      /** @type {HTMLInputElement} */ (e.target).value = '';
    }
  }

  /** Deferred upload: package + icon, run when the license modal saves. */
  async function beforeAttest() {
    const activeUser = manager.active;
    if (!pending || !activeUser?.pubkey) throw new Error('No pending package or user');
    const signerFn = async (/** @type {any} */ ev) => activeUser.signEvent(ev);
    const serverUrl = getActiveBlossomServer(activeUser.pubkey, eventStore);
    const client = new BlossomClient(serverUrl, signerFn);

    if (pending.iconBytes) {
      const iconFile = new File(
        [/** @type {BlobPart} */ (pending.iconBytes)],
        pending.iconMime === 'image/jpeg' ? 'icon.jpg' : 'icon.png',
        { type: pending.iconMime ?? 'image/png' }
      );
      const iconBlob = await client.uploadBlob(iconFile);
      iconUrl = reconcileBlobUrlScheme(iconBlob.url, serverUrl);
    }

    const blob = await client.uploadBlob(pending.file);
    const finalUrl = reconcileBlobUrlScheme(blob.url, serverUrl);
    return {
      url: finalUrl,
      hash: blob.sha256,
      mime: 'application/x-webxdc',
      size: blob.size ?? pending.file.size
    };
  }

  /** Discard the pending selection so no stale state (warning, card, refs)
   *  survives a cancelled license flow. */
  function onLicenseCancelled() {
    modalOpen = false;
    error = '';
    sizeWarning = false;
    pending = null;
    pendingName = '';
    pendingFileName = '';
    pendingHash = '';
    pendingSize = 0;
    existingLicense = null;
    iconUrl = '';
    pendingBytes = null;
    pendingLicenseUrl = null;
    pendingCredit = null;
  }

  /** @param {import('nostr-tools').NostrEvent} licenseEvent */
  function onLicenseSaved(licenseEvent) {
    if (!pending) return;
    const url = licenseEvent.tags.find((/** @type {string[]} */ t) => t[0] === 'url')?.[1] ?? '';
    value = {
      url,
      name: pending.name,
      type: 'application/x-webxdc',
      size: pending.file.size,
      sha256: pending.sha256,
      licenseEvent,
      iconUrl
    };
    modalOpen = false;
  }
</script>

<div class="space-y-2">
  <label class="label" for="interactive-package-file-input"
    ><span class="label-text">{m.interactive_input_label()}</span></label
  >
  {#if value}
    <div class="flex items-center gap-3 rounded-xl border border-base-300 p-3">
      {#if value.iconUrl}<img
          src={value.iconUrl}
          alt=""
          class="size-9 rounded-lg object-cover"
        />{/if}
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold">{value.name}</p>
        <p class="text-xs text-base-content/60">{(value.size / 1024 / 1024).toFixed(1)} MB</p>
      </div>
      {#if pendingBytes}
        <button type="button" class="btn btn-sm" onclick={() => (showPreview = !showPreview)}
          >{m.interactive_input_preview()}</button
        >
      {/if}
      <button
        type="button"
        class="btn btn-sm"
        onclick={() => {
          value = null;
          pendingBytes = null;
        }}
        {disabled}>{m.interactive_input_replace()}</button
      >
    </div>
    {#if showPreview && pendingBytes}
      <WebxdcPlayer bytes={pendingBytes} name={value.name} appKey={`preview:${value.sha256}`} />
    {/if}
  {:else}
    <input
      id="interactive-package-file-input"
      type="file"
      class="file-input-bordered file-input w-full"
      accept=".h5p,.xdc,.html,.htm,text/html,application/x-webxdc"
      onchange={onFileChange}
      disabled={disabled || busy}
    />
    <p class="text-xs text-base-content/60">{m.interactive_input_help()}</p>
  {/if}
  {#if error}<p class="text-sm text-error">{error}</p>{/if}
  {#if sizeWarning}<p class="text-sm text-warning">{m.interactive_input_too_large()}</p>{/if}
</div>

<LicenseModal
  bind:open={modalOpen}
  hash={pendingHash}
  url=""
  mime="application/x-webxdc"
  size={pendingSize}
  fileName={pendingFileName}
  {activeUserDisplayName}
  {existingLicense}
  initialLicense={pendingLicenseUrl}
  initialCredit={pendingCredit}
  {beforeAttest}
  attestExtras={{ alt: `Webxdc app: ${pendingName}`, image: iconUrl }}
  onsave={onLicenseSaved}
  oncancel={onLicenseCancelled}
/>
