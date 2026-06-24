<!--
  MarkdownEditor Component
  Reusable markdown editor with toolbar, write/preview tabs, and Blossom image upload.
  Extracted from the article editor for shared use across article and wiki editors.
-->

<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { uploadAndFindLicense } from '$lib/helpers/upload-and-find-license.js';
  import { buildTulluCaption } from '$lib/helpers/tullu-caption.js';
  import LicenseModal from './LicenseModal.svelte';
  import MarkdownRenderer from './MarkdownRenderer.svelte';
  import ImageSourceChooserModal from './ImageSourceChooserModal.svelte';
  import ImageLibraryPickerModal from './ImageLibraryPickerModal.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {string} content - Markdown content (two-way binding)
   * @property {string} [placeholder] - Placeholder text
   * @property {string} [minHeight] - Minimum editor height
   */

  /** @type {{ content: string, placeholder?: string, minHeight?: string }} */
  let { content = $bindable(''), placeholder = '', minHeight = '400px' } = $props();

  let activeTab = $state(/** @type {'write' | 'preview'} */ ('write'));
  let imageUploading = $state(false);

  /** @type {HTMLTextAreaElement | null} */
  let textareaRef = $state(null);
  /** @type {HTMLInputElement | null} */
  let imageInputRef = $state(null);

  // pending-upload pattern (4th instance; extract a composable if a 5th appears).
  /**
   * @typedef {{ url: string, hash: string, mime: string, size: number, alt: string }} PendingUpload
   */
  let pendingUpload = $state(/** @type {PendingUpload | null} */ (null));
  /** @type {any} */
  let pendingExistingLicense = $state(null);
  let modalOpen = $state(false);
  let chooserOpen = $state(false);
  let libraryOpen = $state(false);

  /**
   * Insert markdown syntax at cursor position in textarea
   * @param {string} before - Text to insert before selection
   * @param {string} after - Text to insert after selection
   * @param {string} [defaultText] - Default text if nothing selected
   */
  function insertMarkdown(before, after, defaultText = '') {
    if (!textareaRef) return;

    const start = textareaRef.selectionStart;
    const end = textareaRef.selectionEnd;
    const selected = content.substring(start, end) || defaultText;

    const newText =
      content.substring(0, start) + before + selected + after + content.substring(end);

    content = newText;

    requestAnimationFrame(() => {
      if (!textareaRef) return;
      const cursorPos = start + before.length + selected.length;
      textareaRef.focus();
      textareaRef.setSelectionRange(cursorPos, cursorPos);
    });
  }

  function toolbarBold() {
    insertMarkdown('**', '**', 'bold text');
  }
  function toolbarItalic() {
    insertMarkdown('*', '*', 'italic text');
  }
  function toolbarHeading() {
    insertMarkdown('## ', '', 'Heading');
  }
  function toolbarLink() {
    insertMarkdown('[', '](url)', 'link text');
  }
  function toolbarList() {
    insertMarkdown('- ', '', 'list item');
  }
  function toolbarQuote() {
    insertMarkdown('> ', '', 'quote');
  }
  function toolbarCode() {
    insertMarkdown('```\n', '\n```', 'code');
  }

  function toolbarImage() {
    chooserOpen = true;
  }

  /**
   * Insert a library-picked image as markdown. The picked event already carries
   * a license attestation, so we skip the upload + LicenseModal gate and insert
   * the image plus its TULLU caption directly.
   * @param {{ url: string, hash: string, licenseEvent: any }} picked
   */
  function handleLibraryPick(picked) {
    const alt =
      picked.licenseEvent?.tags?.find((/** @type {string[]} */ t) => t[0] === 'title')?.[1] ?? '';
    const caption = buildTulluCaption(picked.licenseEvent, { alt });
    const tail = caption ? `)\n\n${caption}\n\n` : ')';
    insertMarkdown(`![${alt}](`, tail, picked.url);
  }

  /**
   * Handle image file selected for inline insertion. Uploads via Blossom,
   * checks the network for an existing license event, and either inserts
   * the markdown image immediately (if a license is already attested) or
   * opens the mandatory LicenseModal. Cancel on the modal discards the
   * upload — nothing is inserted into the markdown.
   *
   * @param {Event} e
   */
  async function handleImageUpload(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const activeUser = manager.active;
    if (!activeUser?.signer) return;

    imageUploading = true;
    try {
      const result = await uploadAndFindLicense(file, { signer: activeUser });

      // Always open the modal. If an existing license was found, the modal
      // shows it in Accept / Create-my-own mode; otherwise the standard form.
      // Nothing is inserted into the markdown until the modal saves.
      pendingUpload = {
        url: result.url,
        hash: result.sha256,
        mime: result.type,
        size: result.size,
        alt: file.name
      };
      pendingExistingLicense = result.existingLicense;
      modalOpen = true;
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      imageUploading = false;
    }
  }

  /** @type {{label: string, action: () => void, icon: string}[]} */
  const toolbarButtons = [
    { label: 'Bold', action: toolbarBold, icon: 'B' },
    { label: 'Italic', action: toolbarItalic, icon: 'I' },
    { label: 'Heading', action: toolbarHeading, icon: 'H' },
    { label: 'Link', action: toolbarLink, icon: '🔗' },
    { label: 'Image', action: toolbarImage, icon: '🖼' },
    { label: 'List', action: toolbarList, icon: '•' },
    { label: 'Quote', action: toolbarQuote, icon: '❝' },
    { label: 'Code', action: toolbarCode, icon: '</>' }
  ];
</script>

<!-- Hidden file input for inline image uploads -->
<input
  type="file"
  accept="image/*"
  class="hidden"
  bind:this={imageInputRef}
  onchange={handleImageUpload}
/>

<div class="overflow-hidden rounded-lg border border-base-300">
  <!-- Tab bar + toolbar -->
  <div class="flex flex-wrap items-center gap-1 border-b border-base-300 bg-base-200 px-2 py-1">
    <!-- Tabs -->
    <button
      class="btn btn-xs"
      class:btn-active={activeTab === 'write'}
      onclick={() => (activeTab = 'write')}
    >
      {m.article_editor_tab_write()}
    </button>
    <button
      class="btn btn-xs"
      class:btn-active={activeTab === 'preview'}
      onclick={() => (activeTab = 'preview')}
    >
      {m.article_editor_tab_preview()}
    </button>

    <!-- Separator -->
    <div class="mx-1 h-4 w-px bg-base-300"></div>

    <!-- Toolbar (only in write mode) -->
    {#if activeTab === 'write'}
      {#each toolbarButtons as btn (btn.label)}
        <button
          class="btn font-mono btn-ghost btn-xs"
          title={btn.label}
          onclick={btn.action}
          disabled={imageUploading && btn.label === 'Image'}
        >
          {#if imageUploading && btn.label === 'Image'}
            <span class="loading loading-xs loading-spinner"></span>
          {:else}
            {btn.icon}
          {/if}
        </button>
      {/each}
    {/if}
  </div>

  <!-- Editor / Preview area -->
  {#if activeTab === 'write'}
    <textarea
      bind:this={textareaRef}
      class="w-full resize-y bg-base-100 p-4 font-mono text-sm focus:outline-none"
      style="min-height: {minHeight};"
      {placeholder}
      bind:value={content}
    ></textarea>
  {:else}
    <div class="p-4" style="min-height: {minHeight};">
      {#if content.trim()}
        <MarkdownRenderer
          {content}
          class="prose prose-lg max-w-none prose-a:text-primary prose-img:rounded-lg"
        />
      {:else}
        <p class="text-base-content/50 italic">{placeholder}</p>
      {/if}
    </div>
  {/if}
</div>

<LicenseModal
  bind:open={modalOpen}
  hash={pendingUpload?.hash ?? ''}
  url={pendingUpload?.url ?? ''}
  mime={pendingUpload?.mime ?? ''}
  size={pendingUpload?.size ?? 0}
  defaultSelfCreator={false}
  existingLicense={pendingExistingLicense}
  onsave={(/** @type {any} */ license) => {
    if (pendingUpload) {
      // Insert the image, then a TULLU attribution line beneath it so the
      // attribution is preserved in the raw markdown (independent of any
      // future render-side license lookup).
      const caption = buildTulluCaption(license, { alt: pendingUpload.alt });
      const tail = caption ? `)\n\n${caption}\n\n` : ')';
      insertMarkdown(`![${pendingUpload.alt}](`, tail, pendingUpload.url);
    }
    pendingUpload = null;
    pendingExistingLicense = null;
  }}
  oncancel={() => {
    pendingUpload = null;
    pendingExistingLicense = null;
  }}
/>

<ImageSourceChooserModal
  bind:open={chooserOpen}
  onupload={() => imageInputRef?.click()}
  onlibrary={() => {
    libraryOpen = true;
  }}
/>

<ImageLibraryPickerModal
  bind:open={libraryOpen}
  onpick={handleLibraryPick}
  onupload={() => imageInputRef?.click()}
/>
