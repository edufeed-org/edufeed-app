<!--
  MessageAttachments — imeta chat attachments below a Concord message bubble.

  Armada/applesauce-concord convention: the kind-9 rumor's content carries the
  blob URL, the imeta tag decorates it — for encrypted media the blob is
  AES-256-GCM ciphertext and key/nonce ride in the tag (helpers/imeta.js). The
  decrypt/caching lives in blob-media.js (fetchDecryptedAttachmentUrl); this
  component only maps attachment -> media element:
    pending  -> skeleton (aspect-ratio from `dim` when present)
    resolved -> <img>/<video>/<audio>/download chip by mime class
    failed   -> "unavailable" chip (never a broken <img>)
-->
<script>
  import { classifyAttachment } from '$lib/concord/attachments.js';
  import { fetchDecryptedAttachmentUrl } from '$lib/concord/blob-media.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{attachments: import('$lib/concord/attachments.js').MediaAttachment[]}} */
  let { attachments = [] } = $props();

  /** url -> display URL (string) | null (failed). Key absent = still pending.
   *  $state deep proxy makes per-key assignment reactive. */
  let resolved = $state(/** @type {Record<string, string | null>} */ ({}));

  $effect(() => {
    for (const att of attachments) {
      const url = att?.url;
      if (!url || url in resolved) continue;
      fetchDecryptedAttachmentUrl(att).then((display) => {
        resolved[url] = display;
      });
    }
  });

  /** @param {import('$lib/concord/attachments.js').MediaAttachment} att */
  function fileLabel(att) {
    if (att.alt) return att.alt;
    try {
      const segments = new URL(att.url).pathname.split('/');
      return decodeURIComponent(segments[segments.length - 1] || att.url);
    } catch {
      return att.url;
    }
  }

  /**
   * "800x600" -> "800 / 600" for CSS aspect-ratio; null when absent/malformed.
   * @param {import('$lib/concord/attachments.js').MediaAttachment} att
   */
  function aspect(att) {
    const match = /^(\d+)x(\d+)$/.exec(att.dimensions ?? '');
    return match ? `${match[1]} / ${match[2]}` : null;
  }
</script>

{#if attachments.length > 0}
  <div class="mt-1 flex flex-col gap-2">
    {#each attachments as att (att.url)}
      {@const kind = classifyAttachment(att)}
      {@const display = resolved[att.url]}
      {#if display === undefined}
        <div
          class="max-h-64 w-48 skeleton rounded-lg"
          style={aspect(att) ? `aspect-ratio: ${aspect(att)}` : 'height: 6rem'}
        ></div>
      {:else if display === null}
        <span class="badge gap-1 badge-ghost text-xs" title={fileLabel(att)}>
          {m.concord_attachment_unavailable()}
        </span>
      {:else if kind === 'image'}
        <img
          src={display}
          alt={att.alt ?? fileLabel(att)}
          loading="lazy"
          class="max-h-64 max-w-full rounded-lg object-contain"
          style={aspect(att) ? `aspect-ratio: ${aspect(att)}` : undefined}
        />
      {:else if kind === 'video'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={display} controls class="max-h-64 max-w-full rounded-lg"></video>
      {:else if kind === 'audio'}
        <audio src={display} controls class="max-w-full"></audio>
      {:else}
        <a
          href={display}
          download={fileLabel(att)}
          class="badge gap-1 badge-outline py-3 text-xs no-underline hover:bg-base-200"
        >
          📎 {fileLabel(att)}{att.size ? ` (${Math.max(1, Math.round(att.size / 1024))} KB)` : ''}
        </a>
      {/if}
    {/each}
  </div>
{/if}
