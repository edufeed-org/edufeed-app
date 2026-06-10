<!--
  EncodingPreview
  Inline preview for an AMB resource encoding (uploaded file).

  - PDFs render via <object type="application/pdf"> with a fallback link
    inside (used by browsers without a built-in PDF viewer, e.g. mobile Safari).
  - Images render via a lazy <img>.
  - Anything else renders nothing — the parent's file row stays the only UI.

  Decision is mime-first with a filename-extension fallback for generic mimes
  like application/octet-stream.
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

  const kind = $derived(pickPreviewKind(mimeType, name));
</script>

{#if kind === 'pdf'}
  <div class="mt-2 mb-1 overflow-hidden rounded-lg border border-base-300 bg-base-200/30">
    <object type="application/pdf" data={url} title={name} class="block h-[80vh] w-full">
      <div class="flex flex-col items-start gap-2 p-4 text-sm">
        <span class="font-medium text-base-content">{name}</span>
        <!-- eslint-disable svelte/no-navigation-without-resolve -- external: Blossom file URL -->
        <a href={url} target="_blank" rel="noopener noreferrer" class="link link-primary">
          {m.amb_resource_open_pdf_inline_fallback()}
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </div>
    </object>
  </div>
{:else if kind === 'image'}
  <div class="mt-2 mb-1 overflow-hidden rounded-lg border border-base-300 bg-base-200/30">
    <img src={url} alt={name} loading="lazy" class="block max-h-[80vh] w-full object-contain" />
  </div>
{/if}
