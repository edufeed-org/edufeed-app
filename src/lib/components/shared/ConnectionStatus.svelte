<!--
  ConnectionStatus — tells "the app hangs" apart from "the internet is bad"
  (laoc, 2026-10-03). Silent while everything works; on a problem
  (laoc, 2026-10-05: an always-on dot was too present):

  - `badge`: a small amber/red dot for the corner of a trigger (the avatar,
    the mobile menu button). The parent must be `relative`.
  - `details`: the explanation with the unreachable servers, as menu rows
    for the top of the account / mobile menu.
  - `dot`: a bare dot with its own popover (logged out, no avatar to badge).
  - `strip`: an in-flow line for screens where the navbar is hidden
    (mobile community routes).

  Renders in root chrome outside the route error boundary, so the status
  read is guarded: a throw here must never blank the app.
-->
<script>
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    getConnectionStatus,
    startConnectionStatus
  } from '$lib/services/connection-status.svelte.js';
  import { isLikelyMobile } from '$lib/helpers/signer-wait.js';

  /** @type {{ variant?: 'badge' | 'details' | 'dot' | 'strip' }} */
  let { variant = 'badge' } = $props();

  onMount(() => startConnectionStatus());

  /** @type {ReturnType<typeof getConnectionStatus>} */
  const OK = { level: 'ok', reasons: [] };
  const status = $derived.by(() => {
    try {
      return getConnectionStatus();
    } catch (err) {
      console.warn('connection status failed', err);
      return OK;
    }
  });

  /** @type {Record<string, () => string>} */
  const CATEGORY_LABELS = {
    calendar: m.connection_category_calendar,
    communikey: m.connection_category_communikey,
    educational: m.connection_category_educational,
    longform: m.connection_category_longform,
    kanban: m.connection_category_kanban,
    groups: m.connection_category_groups
  };

  /**
   * @param {import('$lib/helpers/connection-status.js').ConnectionReason} reason
   * @returns {{title: string, detail: string, servers: Array<{host: string, serves: string}>}}
   */
  function describe(reason) {
    if (reason.kind === 'offline')
      return { title: m.connection_offline(), detail: m.connection_offline_detail(), servers: [] };
    if (reason.kind === 'signer')
      return {
        title: m.connection_signer(),
        detail: isLikelyMobile()
          ? m.connection_signer_detail_mobile()
          : m.connection_signer_detail(),
        servers: []
      };
    const servers = reason.servers.map((s) => ({
      host: s.host,
      serves: s.categories.map((c) => CATEGORY_LABELS[c]?.() ?? c).join(', ')
    }));
    if (reason.down === reason.total)
      return {
        title: m.connection_unreachable(),
        detail: m.connection_unreachable_detail(),
        servers
      };
    return {
      title: m.connection_relays_down({ down: reason.down, total: reason.total }),
      detail: m.connection_relays_down_detail(),
      servers
    };
  }

  const items = $derived(status.reasons.map(describe));
  const problem = $derived(status.level !== 'ok');
  const dotClass = $derived(status.level === 'degraded' ? 'bg-warning' : 'bg-error');
</script>

{#snippet explanation()}
  <!-- divs, not ul/li: inside a DaisyUI .menu a nested list is styled as a
    submenu (indent + rule). -->
  <div class="flex flex-col gap-2 text-sm" data-testid="connection-status-details">
    {#each items as item, i (i)}
      <div data-testid="connection-status-item">
        <p class="flex items-center gap-2 font-semibold">
          <span class="h-2 w-2 shrink-0 rounded-full {dotClass}"></span>{item.title}
        </p>
        {#each item.servers as server (server.host)}
          <p class="mt-1 pl-4" data-testid="connection-status-server">
            <span class="block font-medium [overflow-wrap:anywhere]">{server.host}</span>
            {#if server.serves}<span class="block text-base-content/70">{server.serves}</span>{/if}
          </p>
        {/each}
        <p class="mt-1 pl-4 text-base-content/70">{item.detail}</p>
      </div>
    {/each}
  </div>
{/snippet}

{#if problem}
  {#if variant === 'badge'}
    <span
      class="pointer-events-none absolute top-0 right-0 h-3 w-3 rounded-full ring-2 ring-base-200 {dotClass}"
      data-testid="connection-status-badge"
      data-level={status.level}
    ></span>
    <span class="sr-only">{m.connection_status_label()}: {items[0]?.title}</span>
  {:else if variant === 'details'}
    <!-- Menu rows (inside a DaisyUI .menu): informational, not clickable. -->
    <li class="pointer-events-none w-full min-w-0" data-level={status.level}>
      <div class="block w-full min-w-0 py-2">
        {@render explanation()}
      </div>
    </li>
    <li class="menu-disabled"><hr class="my-1 border-base-300" /></li>
  {:else if variant === 'dot'}
    <div class="dropdown dropdown-end" data-testid="connection-status" data-level={status.level}>
      <button
        class="btn btn-square btn-ghost btn-sm"
        aria-label="{m.connection_status_label()}: {items[0]?.title}"
        title={items[0]?.title}
      >
        <span class="h-2.5 w-2.5 rounded-full {dotClass}"></span>
      </button>
      <div class="dropdown-content z-[60] mt-2 w-72 rounded-box bg-base-100 p-3 shadow">
        {@render explanation()}
      </div>
    </div>
  {:else if variant === 'strip'}
    <!-- Quiet on purpose: a tint, one line, no explanation (that lives in
      the mobile menu behind the badge). -->
    <div
      class="flex items-center gap-2 px-4 py-0.5 text-xs text-base-content {status.level ===
      'degraded'
        ? 'bg-warning/15'
        : 'bg-error/15'}"
      role="status"
      data-testid="connection-status-strip"
      data-level={status.level}
    >
      <span class="h-2 w-2 shrink-0 rounded-full {dotClass}"></span>
      <span class="min-w-0 truncate"
        ><span class="font-semibold">{items[0]?.title}</span>{#if items[0]?.servers.length}<span
            class="text-base-content/70"
          >
            · {items[0].servers.map((s) => s.host).join(', ')}</span
          >{/if}</span
      >
    </div>
  {/if}
{/if}
