<!--
  DmFileMessage
  One NIP-17 encrypted file message (kind 15). The rumor carries the blob URL
  in its content and the AES-GCM material in tags; the bytes are fetched and
  decrypted in the browser, so the relay/host never sees the plaintext.
  Images render inline, anything else becomes a download. Every failure is
  shown — a silent blank bubble is exactly the bug this work removes.
-->
<script>
  import { parseFileRumor } from '$lib/helpers/dm-rumors.js';
  import { decryptFileBytes } from '$lib/helpers/dm-file-crypto.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ rumor: any }} */
  let { rumor } = $props();

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
    (async () => {
      try {
        const response = await fetch(target.url);
        if (!response.ok) throw new Error(`http ${response.status}`);
        const plain = await decryptFileBytes(await response.arrayBuffer(), target);
        if (cancelled) return;
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(plain)], { type: target.mimeType || 'application/octet-stream' })
        );
        created = url;
        objectUrl = url;
      } catch (err) {
        if (!cancelled) failed = true;
        console.warn('[dm] file message could not be shown', err);
      } finally {
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      created = null;
    };
  });

  const isImage = $derived(!!file?.mimeType?.startsWith('image/'));
  const fileName = $derived(file?.url?.split('/').pop() || 'file');
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
    alt=""
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
