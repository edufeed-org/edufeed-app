<!--
  ConnectionStatus — tells "the app hangs" apart from "the internet is bad"
  (laoc, 2026-10-03). Quiet by design (laoc, 2026-10-05): nothing shows
  while everything works, and the explanation lives in a modal
  (ConnectionStatusModal, ModalManager type 'connectionStatus').

  - `badge`: a small amber/red dot for the corner of a trigger (the avatar,
    the mobile menu button), only on a problem. Parent must be `relative`.
  - `menu-item`: the "Connection" row of the account / mobile menu, always
    there, with the same dot on a problem; opens the modal.
  - `dot`: logged out on desktop (no avatar to badge) — a bare dot on a
    problem; opens the modal.
  - `strip`: a quiet one-line tint for screens where the navbar is hidden
    (mobile community routes), only on a problem; opens the modal.

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
  import { summaryOf } from '$lib/helpers/connection-status-text.js';
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import { RelayIcon } from '$lib/components/icons';

  /** @type {{ variant?: 'badge' | 'menu-item' | 'dot' | 'strip', onClose?: () => void }} */
  let { variant = 'badge', onClose = () => {} } = $props();

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

  const problem = $derived(status.level !== 'ok');
  const title = $derived(summaryOf(status).title);
  const dotClass = $derived(status.level === 'degraded' ? 'bg-warning' : 'bg-error');
  const firstServers = $derived.by(() => {
    const first = status.reasons[0];
    return first?.kind === 'relays' ? first.servers.map((s) => s.host).join(', ') : '';
  });

  function openDetails() {
    onClose();
    modalStore.openModal('connectionStatus');
  }
</script>

{#if variant === 'menu-item'}
  <li>
    <button type="button" onclick={openDetails} data-testid="connection-status-menu-item">
      <RelayIcon class_="w-4 h-4" />
      {m.connection_menu_entry()}
      {#if problem}
        <span
          class="ml-auto h-2.5 w-2.5 rounded-full {dotClass}"
          data-testid="connection-status-menu-dot"
          data-level={status.level}
          {title}
        ></span>
      {/if}
    </button>
  </li>
{:else if problem}
  {#if variant === 'badge'}
    <span
      class="pointer-events-none absolute top-0 right-0 h-3 w-3 rounded-full ring-2 ring-base-200 {dotClass}"
      data-testid="connection-status-badge"
      data-level={status.level}
    ></span>
    <span class="sr-only">{m.connection_status_label()}: {title}</span>
  {:else if variant === 'dot'}
    <button
      type="button"
      class="btn btn-square btn-ghost btn-sm"
      aria-label="{m.connection_status_label()}: {title}"
      {title}
      onclick={openDetails}
      data-testid="connection-status"
      data-level={status.level}
    >
      <span class="h-2.5 w-2.5 rounded-full {dotClass}"></span>
    </button>
  {:else if variant === 'strip'}
    <!-- Quiet on purpose: a tint, one line; tap for the details. -->
    <button
      type="button"
      class="flex w-full items-center gap-2 px-4 py-0.5 text-left text-xs text-base-content {status.level ===
      'degraded'
        ? 'bg-warning/15'
        : 'bg-error/15'}"
      onclick={openDetails}
      data-testid="connection-status-strip"
      data-level={status.level}
    >
      <span class="h-2 w-2 shrink-0 rounded-full {dotClass}"></span>
      <span class="min-w-0 truncate"
        ><span class="font-semibold">{title}</span>{#if firstServers}<span
            class="text-base-content/70"
          >
            · {firstServers}</span
          >{/if}</span
      >
    </button>
  {/if}
{/if}
