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
  import { LockIcon } from '$lib/components/icons';
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
   *   locked?: boolean,
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
    locked = false,
    testid = null,
    trailing
  } = $props();

  // Deliberately NOT `btn` (its min-height/border/shadow chrome reads as a
  // toolbar, not a channel list). The active treatment is the app's existing
  // subtle active-nav one (BottomTabBar.svelte: bg-primary/10 text-primary).
  // Same metrics as ContentNavSidebar's tab rows (px-4 py-3 gap-3, w-5 icon
  // column) — the KANÄLE rows sat visibly tighter and less indented than the
  // INHALTE rows right above them (laoc, 2026-08-18).
  const rowClass = $derived(
    'flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm transition-colors duration-150 ' +
      (active
        ? 'bg-primary/10 font-semibold text-primary'
        : 'text-base-content/80 hover:bg-base-300/60')
  );
  const glyphTitle = $derived(locked ? m.concord_legend_private() : m.concord_legend_public());
  const nameClass = $derived(
    'min-w-0 flex-1 truncate font-medium ' +
      (dimmed ? 'opacity-50 ' : '') +
      (bold ? 'font-bold' : '')
  );
</script>

{#snippet body()}
  <span aria-hidden="true" title={glyphTitle} class="flex w-5 shrink-0 justify-center"
    >{symbol}</span
  >
  <span class={nameClass}>{name}</span>
  {#if trailing}
    <!-- Fixed-width slot: a dot that arrives late must land in space the row
         already reserved, not push the rail sideways. Renders BEFORE the
         access badges so those end on the same right-edge column as the
         INHALTE rows' locks (laoc, 2026-08-18). -->
    <span data-testid="rail-trailing-slot" class="flex min-w-4 shrink-0 items-center justify-center"
      >{@render trailing()}</span
    >
  {/if}
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
  {#if locked}
    <!-- Invite-only: same LockIcon as the INHALTE rows' restriction badge —
         the amber emoji read as a different vocabulary (laoc, 2026-08-18).
         Mutually exclusive with the globe by construction. -->
    <span
      aria-hidden="true"
      data-testid="locked-badge"
      title={m.concord_legend_private()}
      class="shrink-0 opacity-60"><LockIcon class_="w-3 h-3" /></span
    >
  {/if}
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
