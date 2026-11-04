<!--
  PinnedMessagesBar — above a NIP-29 channel's timeline: the channel's pinned
  messages (kind 39005 / latest 9010, see groups/pins.js), newest first.
  Collapsed it is one line — "<pin> N angepinnt · Nina: Neueste Regel …" —
  that jumps to the newest pin; the chevron expands the full list, each row
  jumping to its message. Unpin is offered on the rows when `onUnpin` is
  given (moderators). Hidden without pins. Purely presentational: the caller
  resolves names, timestamps and whether the message is loaded.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { ChevronDownIcon, ChevronUpIcon, CloseIcon, PinIcon } from '$lib/components/icons';

  /**
   * @typedef {{id: string, displayName: string, content: string, timestamp: string, missing: boolean}} PinRow
   * @typedef {object} Props
   * @property {PinRow[]} pins - newest first; `missing` = the message is not in the loaded window
   * @property {(id: string) => void} onJump - scroll the chat to the message
   * @property {((id: string) => void) | undefined} [onUnpin] - moderators only; absent = no unpin buttons
   */
  /** @type {Props} */
  let { pins, onJump, onUnpin = undefined } = $props();

  let expanded = $state(false);
  const newest = $derived(pins[0]);

  /** The excerpt: URLs dropped (an attachment's link says nothing), whitespace folded. @param {string} content */
  const excerpt = (content) =>
    content
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  /** @param {PinRow} pin */
  function jump(pin) {
    if (pin.missing) return;
    onJump(pin.id);
  }
</script>

{#if pins.length > 0}
  <div
    class="border-b border-base-300 bg-base-100 text-sm"
    role="region"
    aria-label={m.groups_pinned_bar_label()}
    data-testid="pinned-bar"
  >
    <div class="flex items-center gap-2 px-4 py-2">
      <PinIcon class_="w-4 h-4 shrink-0 text-primary" title="" />
      <span class="shrink-0 text-xs text-base-content/70"
        >{m.groups_pinned_count({ count: pins.length })}</span
      >
      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left {newest.missing
          ? 'cursor-default'
          : 'hover:underline'}"
        data-testid="pinned-bar-newest"
        title={newest.missing ? m.groups_pinned_missing() : m.groups_pinned_jump()}
        onclick={() => jump(newest)}
      >
        {#if newest.missing}
          <span class="text-base-content/60 italic">{m.groups_pinned_missing()}</span>
        {:else}
          <span class="font-semibold">{newest.displayName}:</span>
          <span>{excerpt(newest.content)}</span>
        {/if}
      </button>
      <button
        type="button"
        class="btn btn-circle shrink-0 btn-ghost btn-xs"
        data-testid="pinned-bar-toggle"
        aria-expanded={expanded}
        title={expanded ? m.groups_pinned_hide() : m.groups_pinned_show()}
        onclick={() => (expanded = !expanded)}
      >
        {#if expanded}
          <ChevronUpIcon class_="w-4 h-4" title="" />
        {:else}
          <ChevronDownIcon class_="w-4 h-4" title="" />
        {/if}
      </button>
    </div>
    {#if expanded}
      <ul class="max-h-48 overflow-y-auto border-t border-base-300">
        {#each pins as pin (pin.id)}
          <li class="flex items-center gap-2 px-4 py-1.5" data-testid="pinned-bar-row">
            <button
              type="button"
              class="min-w-0 flex-1 text-left {pin.missing ? 'cursor-default' : 'hover:underline'}"
              data-testid="pinned-bar-jump"
              title={pin.missing ? m.groups_pinned_missing() : m.groups_pinned_jump()}
              onclick={() => jump(pin)}
            >
              {#if pin.missing}
                <span class="text-base-content/60 italic">{m.groups_pinned_missing()}</span>
              {:else}
                <span class="font-semibold">{pin.displayName}</span>
                <span class="text-xs text-base-content/60">· {pin.timestamp}</span>
                <span class="block truncate">{excerpt(pin.content)}</span>
              {/if}
            </button>
            {#if onUnpin}
              <button
                type="button"
                class="btn btn-circle shrink-0 btn-ghost btn-xs"
                data-testid="pinned-bar-unpin"
                title={m.groups_message_unpin()}
                onclick={() => onUnpin(pin.id)}
              >
                <CloseIcon class_="w-3.5 h-3.5" title="" />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
