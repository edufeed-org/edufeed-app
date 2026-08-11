<!--
  ThreadPanel — the replies to one root message, beside the timeline.

  Presentational: the caller resolves profiles, reactions and the reply target
  through the `row` snippet (the same contract ChatMessageList uses) and owns
  the composer, so the publish path is not duplicated per surface.

  The panel lists the root followed by its replies in one flat run, which is
  what Buzz draws. Depth is carried by each row's own reply-quote preview
  rather than by indentation: our own measurement found nesting at depth 3 in
  the live data, and an indent ladder has no bottom.
-->
<script>
  import { usePanelWidth } from '$lib/helpers/panel-width.svelte.js';

  /**
   * @typedef {Object} Props
   * @property {any} root - the message the thread hangs off
   * @property {any[]} replies - oldest first
   * @property {() => void} onClose
   * @property {string} title
   * @property {string} closeLabel
   * @property {string} [expandLabel]
   * @property {string} [collapseLabel]
   * @property {boolean} [expanded] - bindable; the caller hides its timeline
   *   while the panel is expanded
   * @property {import('svelte').Snippet<[any]>} row - receives a message
   * @property {import('svelte').Snippet} [composer]
   */

  /** @type {Props} */
  let {
    root,
    replies,
    onClose,
    title,
    closeLabel,
    expandLabel = '',
    collapseLabel = '',
    expanded = $bindable(false),
    row,
    composer = undefined
  } = $props();

  const panel = usePanelWidth('chat:thread-panel-width');
</script>

<aside
  class="relative flex h-full min-h-0 w-full flex-col border-l border-base-300 bg-base-100 {expanded
    ? 'md:w-full'
    : 'md:w-[var(--thread-panel-w)]'}"
  style="--thread-panel-w: {panel.width}px"
  data-testid="thread-panel"
>
  {#if !expanded}
    <!-- Left-edge drag handle; desktop only (mobile is always full width). -->
    <div
      role="separator"
      aria-orientation="vertical"
      data-testid="thread-resize-handle"
      class="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-primary/30 md:block"
      onpointerdown={panel.startResize}
    ></div>
  {/if}
  <header class="flex items-center gap-2 border-b border-base-300 px-4 py-3">
    <h3 class="flex-1 text-sm font-bold">{title}</h3>
    <button
      type="button"
      class="btn hidden btn-ghost btn-xs md:inline-flex"
      data-testid="thread-panel-expand"
      title={expanded ? collapseLabel : expandLabel}
      aria-label={expanded ? collapseLabel : expandLabel}
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? '⇥' : '⇤'}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="thread-panel-close"
      title={closeLabel}
      aria-label={closeLabel}
      onclick={onClose}
    >
      ✕
    </button>
  </header>

  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    {@render row(root)}
    {#if replies.length}
      <div class="divider my-0"></div>
    {/if}
    {#each replies as reply (reply.id)}
      {@render row(reply)}
    {/each}
  </div>

  {#if composer}
    {@render composer()}
  {/if}
</aside>
