<!--
  EncodingPreview
  Inline preview for an AMB resource encoding (uploaded file).

  - PDFs render via <object type="application/pdf"> in an 80vh container.
  - Images render via a lazy <img> in the same container.
  - For URLs the browser cannot embed as a sub-resource (non-http(s) schemes),
    we render a compact fallback card with an "Open in new tab" link instead
    of an empty viewer.
  - Anything else (unknown file type) renders nothing — the parent's file row
    stays the only UI.

  Decision is mime-first with a filename-extension fallback for generic mimes
  like application/octet-stream. `http://` URLs are upgraded to `https://`
  before embedding to avoid mixed-content blocks on HTTPS pages.
-->

<script>
  import * as m from '$lib/paraglide/messages.js';

  /**
   * @typedef {Object} Props
   * @property {string} url
   * @property {string} mimeType
   * @property {string} name
   */

  /** @type {Props} */
  let { url, mimeType, name } = $props();

  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'];

  /**
   * Decide what kind of preview (if any) to render.
   * @param {string} mime
   * @param {string} filename
   * @returns {'pdf' | 'image' | null}
   */
  function pickPreviewKind(mime, filename) {
    const lower = (mime || '').toLowerCase();
    if (lower === 'application/pdf') return 'pdf';
    if (lower.startsWith('image/')) return 'image';
    const lowerName = (filename || '').toLowerCase();
    if (lowerName.endsWith('.pdf')) return 'pdf';
    if (IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return 'image';
    return null;
  }

  /**
   * Return a URL safe to embed as a sub-resource (<object data>, <img src>).
   * Upgrades http://→https:// so HTTPS pages don't trigger mixed-content blocks.
   * Returns null for non-http(s) schemes — callers render a compact fallback.
   * @param {string} src
   * @returns {string | null}
   */
  function toEmbedSrc(src) {
    if (!src || typeof src !== 'string') return null;
    if (src.startsWith('https://')) return src;
    if (src.startsWith('http://')) return 'https://' + src.slice('http://'.length);
    return null;
  }

  const kind = $derived(pickPreviewKind(mimeType, name));
  const embedSrc = $derived(toEmbedSrc(url));
</script>

{#if kind === 'pdf' && embedSrc}
  <div class="mt-2 mb-1 overflow-hidden rounded-lg border border-base-300 bg-base-200/30">
    <object type="application/pdf" data={embedSrc} title={name} class="block h-[80vh] w-full"
    ></object>
  </div>
{:else if kind === 'pdf'}
  <div
    class="mt-2 mb-1 flex flex-col items-start gap-2 rounded-lg border border-base-300 bg-base-200/30 p-4 text-sm"
  >
    <span class="font-medium text-base-content">{name}</span>
    <!-- eslint-disable svelte/no-navigation-without-resolve -- external: Blossom file URL -->
    <a href={url} target="_blank" rel="noopener noreferrer" class="link link-primary">
      {m.amb_resource_open_pdf_inline_fallback()}
    </a>
    <!-- eslint-enable svelte/no-navigation-without-resolve -->
  </div>
{:else if kind === 'image' && embedSrc}
  <div class="mt-2 mb-1 overflow-hidden rounded-lg border border-base-300 bg-base-200/30">
    <img
      src={embedSrc}
      alt={name}
      loading="lazy"
      class="block max-h-[80vh] w-full object-contain"
    />
  </div>
{/if}
