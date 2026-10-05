<!--
  ConnectionStatusModal — "is it the app, my internet or a server?" in one
  place (laoc, 2026-10-05: the explanation inside the account menu was too
  present). Opened from the "Connection" menu entry, the logged-out dot and
  the mobile /c strip via ModalManager (type 'connectionStatus').
  Small-modal grammar: CSS modal, Escape and the backdrop close.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import {
    getConnectionDetails,
    getConnectionStatus,
    startConnectionStatus
  } from '$lib/services/connection-status.svelte.js';
  import { isLikelyMobile } from '$lib/helpers/signer-wait.js';
  import { categoryLabel, summaryOf } from '$lib/helpers/connection-status-text.js';

  /** @type {{ onClose: () => void }} */
  let { onClose } = $props();

  startConnectionStatus();

  const status = $derived(getConnectionStatus());
  const details = $derived(getConnectionDetails());
  const summary = $derived(summaryOf(status));

  /** @type {Record<string, string>} */
  const STATE_DOT = { connected: 'bg-success', failing: 'bg-error', idle: 'bg-base-300' };
  /** @type {Record<string, () => string>} */
  const STATE_TEXT = {
    connected: m.connection_server_connected,
    failing: m.connection_server_failing,
    idle: m.connection_server_idle
  };
  const levelDot = $derived(
    status.level === 'ok' ? 'bg-success' : status.level === 'degraded' ? 'bg-warning' : 'bg-error'
  );

  /** @type {HTMLButtonElement | undefined} */
  let closeEl = $state(undefined);
  $effect(() => {
    closeEl?.focus();
  });

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }
</script>

<div
  class="modal-open modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="connection-status-title"
  tabindex="-1"
  data-testid="connection-status-modal"
  onkeydown={onKeyDown}
>
  <div class="modal-box max-w-md">
    <h3 id="connection-status-title" class="text-lg font-bold">
      {m.connection_status_label()}
    </h3>

    <div class="mt-3 flex items-start gap-2" data-testid="connection-status-summary">
      <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full {levelDot}"></span>
      <div>
        <p class="font-semibold">{summary.title}</p>
        <p class="text-sm text-base-content/70">{summary.detail}</p>
      </div>
    </div>

    <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt class="text-base-content/70">{m.connection_modal_internet()}</dt>
      <dd data-testid="connection-status-internet">
        {details.online ? m.connection_modal_internet_online() : m.connection_offline()}
      </dd>
      {#if details.waitingForSigner}
        <dt class="text-base-content/70">{m.connection_modal_signer()}</dt>
        <dd data-testid="connection-status-signer">
          {m.connection_signer()} —
          {isLikelyMobile() ? m.connection_signer_detail_mobile() : m.connection_signer_detail()}
        </dd>
      {/if}
    </dl>

    <h4 class="mt-5 text-sm font-semibold">
      {m.connection_modal_servers({ appName: runtimeConfig.appName })}
    </h4>
    <ul class="mt-2 flex flex-col gap-2 text-sm">
      {#each details.servers as server (server.host)}
        <li class="flex items-start gap-2" data-testid="connection-status-server-row">
          <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full {STATE_DOT[server.state]}"></span>
          <div class="min-w-0">
            <p class="font-medium [overflow-wrap:anywhere]">{server.host}</p>
            <p class="text-base-content/70">
              {[STATE_TEXT[server.state](), server.categories.map(categoryLabel).join(', ')]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </li>
      {/each}
    </ul>
    <p class="mt-3 text-xs text-base-content/60">{m.connection_modal_servers_hint()}</p>

    <div class="modal-action">
      <button
        bind:this={closeEl}
        class="btn"
        onclick={onClose}
        data-testid="connection-status-close"
      >
        {m.common_close()}
      </button>
    </div>
  </div>
  <button class="modal-backdrop" aria-label={m.common_close()} onclick={onClose}></button>
</div>
