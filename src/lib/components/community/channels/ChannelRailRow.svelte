<!--
  One row of a channel list.

  Two rails draw the same row: a community's channel rail (PrivateChannelsView)
  and a host's channel sidebar (HostChannelSidebar). They differ in what a row
  DOES — a Concord channel selects in place, a NIP-29 channel is a route — and
  in nothing else. Left as two copies of the markup, the glyph, the truncation,
  the active treatment and the world-readable badge would drift apart channel
  by channel, and a reader would be able to tell which container produced a
  list. That is exactly what a reader should not be able to tell.

  `href` makes the row a link, otherwise it is a button. Nothing else changes.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   symbol?: string,
   *   name?: string,
   *   href?: string | null,
   *   onclick?: (() => void) | null,
   *   active?: boolean,
   *   dimmed?: boolean,
   *   bold?: boolean,
   *   worldReadable?: boolean,
   *   testid?: string | null,
   *   trailing?: import('svelte').Snippet
   * }}
   */
  let {
    symbol = '#',
    name = '',
    href = null,
    onclick = null,
    active = false,
    dimmed = false,
    bold = false,
    worldReadable = false,
    testid = null,
    trailing
  } = $props();

  // Deliberately NOT `btn` (its min-height/border/shadow chrome reads as a
  // toolbar, not a channel list). The active treatment is the app's existing
  // subtle active-nav one (BottomTabBar.svelte: bg-primary/10 text-primary).
  const rowClass = $derived(
    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 ' +
      (active
        ? 'bg-primary/10 font-semibold text-primary'
        : 'text-base-content/80 hover:bg-base-300/60')
  );
  const glyphTitle = $derived(
    symbol === '#' ? m.concord_legend_public() : m.concord_legend_private()
  );
  const nameClass = $derived(
    'min-w-0 flex-1 truncate ' + (dimmed ? 'opacity-50 ' : '') + (bold ? 'font-bold' : '')
  );
</script>

{#snippet body()}
  <span aria-hidden="true" title={glyphTitle}>{symbol}</span>
  <span class={nameClass}>{name}</span>
  {#if worldReadable}
    <!-- Weltoffen: readable from outside the community entirely. An addition
         to the # glyph, never a third category. -->
    <span
      aria-hidden="true"
      data-testid="world-readable-badge"
      title={m.groups_channel_world_readable()}
      class="shrink-0 text-[0.7rem] opacity-80">&#127760;</span
    >
  {/if}
  {@render trailing?.()}
{/snippet}

{#if href}
  <a {href} data-testid={testid} class={rowClass} aria-current={active ? 'page' : undefined}>
    {@render body()}
  </a>
{:else}
  <button type="button" data-testid={testid} class={rowClass} {onclick}>
    {@render body()}
  </button>
{/if}
