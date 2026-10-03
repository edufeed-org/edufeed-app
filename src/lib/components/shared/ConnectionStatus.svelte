<!--
  ConnectionStatus — tells "the app hangs" apart from "the internet is bad"
  (laoc, 2026-10-03). `dot`: a coloured dot in the navbar that opens the
  details. `strip`: an in-flow line shown only while something is wrong,
  for screens where the navbar is hidden (mobile community routes).

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

  /** @type {{ variant?: 'dot' | 'strip' }} */
  let { variant = 'dot' } = $props();

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

  /** @param {import('$lib/helpers/connection-status.js').ConnectionReason} reason */
  function describe(reason) {
    if (reason.kind === 'offline')
      return { title: m.connection_offline(), detail: m.connection_offline_detail() };
    if (reason.kind === 'signer')
      return {
        title: m.connection_signer(),
        detail: isLikelyMobile()
          ? m.connection_signer_detail_mobile()
          : m.connection_signer_detail()
      };
    if (reason.down === reason.total)
      return { title: m.connection_unreachable(), detail: m.connection_unreachable_detail() };
    return {
      title: m.connection_relays_down({ down: reason.down, total: reason.total }),
      detail: m.connection_relays_down_detail()
    };
  }

  const items = $derived(status.reasons.map(describe));
  const summary = $derived(items[0]?.title ?? m.connection_ok());
  const dotClass = $derived(
    status.level === 'ok' ? 'bg-success' : status.level === 'degraded' ? 'bg-warning' : 'bg-error'
  );
</script>

{#if variant === 'dot'}
  <div class="dropdown dropdown-end" data-testid="connection-status" data-level={status.level}>
    <button
      class="btn btn-circle btn-ghost btn-sm"
      aria-label="{m.connection_status_label()}: {summary}"
      title={summary}
    >
      <span class="h-2.5 w-2.5 rounded-full {dotClass}" data-testid="connection-status-dot"></span>
    </button>
    <div
      class="dropdown-content z-[60] mt-2 w-72 rounded-box bg-base-100 p-3 text-sm shadow"
      data-testid="connection-status-details"
    >
      {#if items.length === 0}
        <p class="font-semibold">{m.connection_ok()}</p>
        <p class="mt-1 text-base-content/70">{m.connection_ok_detail()}</p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each items as item, i (i)}
            <li>
              <p class="font-semibold">{item.title}</p>
              <p class="mt-0.5 text-base-content/70">{item.detail}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{:else if status.level !== 'ok'}
  <div
    class="px-4 py-1 text-sm {status.level === 'degraded'
      ? 'bg-warning text-warning-content'
      : 'bg-error text-error-content'}"
    role="status"
    data-testid="connection-status-strip"
    data-level={status.level}
  >
    <span class="font-semibold">{items[0]?.title}</span>
    {#if items[0]?.detail}<span class="opacity-80"> — {items[0].detail}</span>{/if}
  </div>
{/if}
