<!--
  ChatMessageList — renders the flat separator/message array produced by
  `groupMessagesByDate` (message-utils.js). Extracted from Chat.svelte;
  reused by ChannelChat.svelte. Each message is rendered via the `row`
  snippet so callers keep full control over per-row props (avatar, reply
  resolution, reactions) — this component only owns the date-divider +
  keyed-each loop.
-->
<script>
  /**
   * @typedef {{ type: 'separator', date: string } | { type: 'message', message: any }} GroupedItem
   */

  /**
   * @typedef {Object} Props
   * @property {GroupedItem[]} items
   * @property {import('svelte').Snippet<[any]>} row - receives the message for a 'message' item
   */

  /** @type {Props} */
  let { items, row } = $props();
</script>

{#each items as item, i (item.type === 'separator' ? `sep-${item.date}-${i}` : item.message.id)}
  {#if item.type === 'separator'}
    <div class="divider text-xs text-base-content/40">{item.date}</div>
  {:else}
    {@render row(item.message)}
  {/if}
{/each}
