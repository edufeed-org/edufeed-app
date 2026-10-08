<!--
  ChatComposer — the reply-preview strip plus the rounded send form, extracted
  from GroupChat so the main timeline and the thread panel share one
  implementation. Two composers are live at once (one per surface), so `value`
  and `replyTo` are bindable rather than owned here; publishing stays with the
  caller.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { PollIcon } from '$lib/components/icons';
  import ComposerInput from '$lib/components/shared/ComposerInput.svelte';
  import { fileDropZone } from '$lib/helpers/file-drop.js';

  /**
   * @typedef {Object} Props
   * @property {string} value - bindable draft text
   * @property {string} placeholder
   * @property {boolean} [disabled] - no active user / cannot post here
   * @property {boolean} [sending]
   * @property {() => void} onSubmit
   * @property {{content: string} | null} [replyTo] - shows the quote strip when set
   * @property {(() => void) | null} [onCancelReply]
   * @property {string} [testid] - data-testid for the input
   * @property {(() => void) | null} [onOpenApps] - opt-in: renders the "+" apps
   *   button before the input. Only the timeline composer passes this; the
   *   ThreadPanel composer leaves it null (webxdc sessions are channel-scoped,
   *   not thread-scoped).
   * @property {((files: File[]) => void) | null} [onAttachFiles] - opt-in: renders
   *   the attach-file button and makes the pill accept pasted and dropped
   *   files, all landing here. The caller owns the upload; `uploading`
   *   mirrors its in-flight state back onto the button.
   * @property {boolean} [uploading]
   * @property {import('$lib/helpers/emoji-autocomplete.js').EmojiPack[]} [customEmojiSets]
   *   the user's NIP-30 packs, for the ':' autocomplete and inline rendering
   * @property {(() => void) | null} [onOpenPoll] - opt-in: renders the poll
   *   button before the input. Same timeline-only rule as onOpenApps (a poll
   *   is a room timeline row, not a thread reply).
   */

  /** @type {Props} */
  let {
    value = $bindable(''),
    placeholder,
    disabled = false,
    sending = false,
    onSubmit,
    replyTo = null,
    onCancelReply = null,
    testid = undefined,
    onOpenApps = null,
    onAttachFiles = null,
    uploading = false,
    onOpenPoll = null,
    customEmojiSets = []
  } = $props();

  let fileInput = $state(/** @type {HTMLInputElement | null} */ (null));

  /** @param {Event} e */
  function handleFileChange(e) {
    const input = /** @type {HTMLInputElement} */ (e.currentTarget);
    const files = Array.from(input.files ?? []);
    // Reset so picking the same file again re-fires change.
    input.value = '';
    if (files.length) onAttachFiles?.(files);
  }

  /** @param {File[]} files */
  function takeFiles(files) {
    if (!disabled && !uploading) onAttachFiles?.(files);
  }
</script>

{#if replyTo}
  <div
    class="flex items-center gap-2 border-t border-base-300 bg-base-200 px-4 py-1 text-xs"
    data-testid="chat-reply-strip"
  >
    <span class="truncate opacity-70">↩ {replyTo.content.slice(0, 80)}</span>
    {#if onCancelReply}
      <button type="button" class="btn ml-auto btn-ghost btn-xs" onclick={onCancelReply}>
        ✕
      </button>
    {/if}
  </div>
{/if}

<form
  class="m-4 mt-2 flex shrink-0 items-center gap-2 rounded-full border border-base-300 bg-base-200 p-1.5 data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/10 data-[dragging=true]:ring-2 data-[dragging=true]:ring-primary"
  data-testid="chat-composer-form"
  use:fileDropZone={{
    onFiles: takeFiles,
    enabled: Boolean(onAttachFiles) && !disabled && !uploading
  }}
  onsubmit={(/** @type {SubmitEvent} */ e) => {
    e.preventDefault();
    onSubmit();
  }}
>
  {#if onOpenApps}
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-sm"
      data-testid="chat-apps-button"
      title={m.webxdc_apps_button()}
      aria-label={m.webxdc_apps_button()}
      onclick={onOpenApps}
      {disabled}>+</button
    >
  {/if}
  {#if onAttachFiles}
    <input
      bind:this={fileInput}
      type="file"
      multiple
      class="hidden"
      data-testid="chat-attach-input"
      onchange={handleFileChange}
    />
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-sm"
      data-testid="chat-attach-button"
      title={m.chat_attach_file()}
      aria-label={m.chat_attach_file()}
      onclick={() => fileInput?.click()}
      disabled={disabled || uploading}
    >
      {#if uploading}
        <span class="loading loading-xs loading-spinner"></span>
      {:else}
        📎
      {/if}
    </button>
  {/if}
  {#if onOpenPoll}
    <button
      type="button"
      class="btn btn-circle btn-ghost btn-sm"
      data-testid="chat-poll-button"
      title={m.groups_poll_button()}
      aria-label={m.groups_poll_button()}
      onclick={onOpenPoll}
      {disabled}><PollIcon class_="h-4 w-4" /></button
    >
  {/if}
  <ComposerInput
    bind:value
    {customEmojiSets}
    {placeholder}
    {disabled}
    onFiles={onAttachFiles ? takeFiles : undefined}
    onSubmit={() => !disabled && !sending && value.trim() && onSubmit()}
    class="input flex items-center input-ghost focus:outline-none"
    {testid}
  />
  <button
    class="btn btn-circle btn-sm btn-neutral"
    type="submit"
    disabled={sending || !value.trim()}>➤</button
  >
</form>
