/**
 * Upload queue for chat composers whose messages carry files as NIP-92
 * `imeta` tags (NIP-29 channel chat, community kind-9 chat).
 *
 * A composer hands over the files it received — from the 📎 picker, a paste
 * with files in the clipboard, or a drop onto the pill — and this hook
 * uploads them to the user's Blossom server one after another, handing each
 * blob URL to the draft as soon as it exists. The NIP-94 fields of every
 * upload wait in `pending()` until a send whose content still contains the
 * URL goes out (`markSent`); URLs the user edited out of the draft stay
 * pending for the next send, exactly as GroupChat did before this was shared.
 *
 * Reactive (`uploading` is `$state`): MUST be called during component init.
 */
/* eslint-disable svelte/prefer-svelte-reactivity -- the map is read at send time only, never rendered */
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { uploadChatAttachment } from '$lib/helpers/chat-attachment-upload.js';
import { showToast } from '$lib/helpers/toast';
import * as m from '$lib/paraglide/messages';

/**
 * @typedef {Awaited<ReturnType<typeof uploadChatAttachment>>} ChatAttachment
 */

/**
 * Put an uploaded URL after the draft's text, separated by one space, or
 * alone when the draft is empty.
 * @param {string} draft
 * @param {string} url
 */
export function appendUrlToDraft(draft, url) {
  return draft.trim() ? `${draft.trimEnd()} ${url}` : url;
}

/**
 * @param {() => ({ signer?: any } | null | undefined)} getUser - reactive
 *   getter for the active user (its signer uploads and picks the server)
 */
export function useChatAttachments(getUser) {
  /** Uploaded-but-not-yet-sent attachments, keyed by blob URL. */
  /** @type {Map<string, ChatAttachment>} */
  const pendingByUrl = new Map();
  let uploading = $state(false);

  /**
   * Upload `files` in order; `onUrl` receives each blob URL as it lands.
   * A file over the Blossom size cap or a failed upload is reported with a
   * toast and skipped — the rest of the batch still goes up.
   * @param {File[]} files
   * @param {(url: string) => void} onUrl
   */
  async function attach(files, onUrl) {
    const signer = getUser()?.signer;
    if (!signer || files.length === 0) return;
    uploading = true;
    try {
      for (const file of files) {
        const max = runtimeConfig.blossom?.maxFileSize;
        if (max && file.size > max) {
          showToast(
            m.chat_attach_error_too_large({ size: Math.round(max / (1024 * 1024)) }),
            'error'
          );
          continue;
        }
        try {
          const att = await uploadChatAttachment(file, { signer });
          pendingByUrl.set(att.url, att);
          onUrl(att.url);
        } catch (err) {
          console.error('chat attachment upload failed', err);
          showToast(m.chat_attach_error_upload_failed(), 'error');
        }
      }
    } finally {
      uploading = false;
    }
  }

  return {
    get uploading() {
      return uploading;
    },
    attach,
    /** Every uploaded attachment no send has carried yet, oldest first. */
    pending: () => [...pendingByUrl.values()],
    /**
     * A message with `content` went out: forget the attachments it carried.
     * @param {string} content
     */
    markSent(content) {
      for (const url of [...pendingByUrl.keys()]) {
        if (content.includes(url)) pendingByUrl.delete(url);
      }
    }
  };
}
