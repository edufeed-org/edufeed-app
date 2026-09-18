<!--
  DmFileMessage
  One NIP-17 encrypted file message (kind 15). The rumor carries the blob URL
  in its content and the AES-GCM material in tags; the bytes are fetched and
  decrypted in the browser, so the relay/host never sees the plaintext.
  Images render inline, anything else becomes a download. Every failure is
  shown — a silent blank bubble is exactly the bug this work removes.

  The URL is attacker-supplied, so the fetch is bounded on all three axes:
  aborted on unmount/prop change, aborted after FETCH_TIMEOUT_MS, and refused
  above MAX_FILE_BYTES (checked from Content-Length before the body is read,
  and again on the bytes actually received). The Blob for the download path
  gets application/octet-stream — an attacker-chosen MIME on a same-origin
  blob: URL is a content-sniffing footgun; the real type is only used to
  render an inline image, and only when it is an image type.
-->
<script>
  import { parseFileRumor } from '$lib/helpers/dm-rumors.js';
  import { decryptFileBytes } from '$lib/helpers/dm-file-crypto.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ rumor: any }} */
  let { rumor } = $props();

  /** 25 MB — comfortably above any sane DM attachment, far below "hangs the tab". */
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const FETCH_TIMEOUT_MS = 30_000;

  const file = $derived(parseFileRumor(rumor));
  let objectUrl = $state(/** @type {string | null} */ (null));
  let failed = $state(false);
  let loading = $state(true);

  // Plain let: the URL is revoked by the effect's cleanup, never rendered from.
  /** @type {string | null} */
  let created = null;

  $effect(() => {
    const target = file;
    loading = true;
    failed = false;
    objectUrl = null;
    if (!target) {
      loading = false;
      failed = true;
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    // The Blob type is only ever the rumor's when we render it as an <img>.
    const imageType = /^image\//.test(target.mimeType ?? '') ? target.mimeType : null;
    (async () => {
      try {
        const response = await fetch(target.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`http ${response.status}`);
        const declared = Number(response.headers?.get?.('content-length'));
        if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
          throw new Error(`file too large (${declared} bytes)`);
        }
        const encrypted = await response.arrayBuffer();
        if (encrypted.byteLength > MAX_FILE_BYTES) {
          throw new Error(`file too large (${encrypted.byteLength} bytes)`);
        }
        const plain = await decryptFileBytes(encrypted, target);
        if (cancelled) return;
        if (plain.byteLength > MAX_FILE_BYTES) {
          throw new Error(`file too large (${plain.byteLength} bytes)`);
        }
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(plain)], { type: imageType || 'application/octet-stream' })
        );
        created = url;
        objectUrl = url;
      } catch (err) {
        if (!cancelled) failed = true;
        console.warn('[dm] file message could not be shown', err);
      } finally {
        clearTimeout(timeout);
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      if (created) URL.revokeObjectURL(created);
      created = null;
    };
  });

  const isImage = $derived(/^image\//.test(file?.mimeType ?? ''));
  const fileName = $derived(file?.url?.split('/').pop() || 'file');
  const imageAlt = $derived(file?.alt || m.dm_file_image_alt());
</script>

{#if loading}
  <span class="flex items-center gap-2 text-sm opacity-70" data-testid="dm-file-loading">
    <span class="loading loading-xs loading-spinner"></span>{m.dm_file_decrypting()}
  </span>
{:else if failed || !objectUrl}
  <span class="text-sm text-error" data-testid="dm-file-error">{m.dm_file_failed()}</span>
{:else if isImage}
  <img
    src={objectUrl}
    alt={imageAlt}
    class="max-h-80 max-w-full rounded-lg object-contain"
    data-testid="dm-file-image"
  />
{:else}
  <a
    href={objectUrl}
    download={fileName}
    class="btn btn-ghost btn-sm"
    data-testid="dm-file-download">{m.dm_file_download()}</a
  >
{/if}
