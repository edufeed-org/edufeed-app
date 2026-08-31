<!--
  ChatComposer — the reply-preview strip plus the rounded send form, extracted
  from GroupChat so the main timeline and the thread panel share one
  implementation. Two composers are live at once (one per surface), so `value`
  and `replyTo` are bindable rather than owned here; publishing stays with the
  caller.
-->
<script>
  import * as m from '$lib/paraglide/messages';

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
    onOpenApps = null
  } = $props();
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
  class="m-4 mt-2 flex shrink-0 items-center gap-2 rounded-full border border-base-300 bg-base-200 p-1.5"
  onsubmit={(e) => {
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
  <input
    class="input flex-1 input-ghost focus:outline-none"
    data-testid={testid}
    bind:value
    {placeholder}
    {disabled}
  />
  <button
    class="btn btn-circle btn-sm btn-neutral"
    type="submit"
    disabled={sending || !value.trim()}>➤</button
  >
</form>
