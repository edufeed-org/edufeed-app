<!--
  ConcordUnreadDot — Armada-style binary unread indicator (spec §4).
  Mention tier wins over plain unread; renders nothing when read. Purely
  presentational so it can sit next to ConcordAreaBadge, on channel rows, and
  on the Kanäle tab without pulling any service state itself.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  let { unread = false, mentioned = false, class: className = '' } = $props();
</script>

{#if mentioned}
  <span
    data-testid="concord-mention-pill"
    class="badge h-4 min-w-4 px-1 text-[10px] font-bold badge-secondary {className}"
    aria-label={m.concord_notif_mentioned()}>@</span
  >
{:else if unread}
  <span
    data-testid="concord-unread-dot"
    class="inline-block h-2 w-2 rounded-full bg-base-content {className}"
    aria-label={m.concord_notif_unread()}
  ></span>
{/if}
