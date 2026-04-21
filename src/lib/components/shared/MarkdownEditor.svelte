<!--
  MarkdownEditor Component
  Reusable markdown editor with toolbar, write/preview tabs, and Blossom image upload.
  Extracted from the article editor for shared use across article and wiki editors.
-->

<script>
  import { manager } from '$lib/stores/accounts.svelte';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { BlossomClient } from 'blossom-client-sdk';
  import { getActiveBlossomServer } from '$lib/services/blossom-settings-service.js';
  import MarkdownRenderer from './MarkdownRenderer.svelte';
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
    imageInputRef?.click();
  }

  /**
   * Handle image file selected for inline insertion
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
      const signer = async (/** @type {any} */ event) => {
        if (!activeUser) throw new Error('User not available');
        return await activeUser.signEvent(event);
      };

      const serverUrl = getActiveBlossomServer(activeUser.pubkey, eventStore);
      const client = new BlossomClient(serverUrl, signer);
      const blob = await client.uploadBlob(file);

      insertMarkdown(`![${file.name}](`, ')', blob.url);
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
