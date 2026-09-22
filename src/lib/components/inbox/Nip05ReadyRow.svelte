<!--
  Nip05ReadyRow - "your verified address is ready, activate it" pinned row.

  Rendered by the bell dropdown, the inbox page and the dashboard inbox card;
  decides its own visibility from the nip05-ready-alert store so callers just
  drop it in. Activation is the same one-click flow as the Termi hint card
  (shared through activateGrantedHandle); the x sets the per-account dismiss
  flag Termi's card honours too, so dismissing here silences both.
-->

<script>
  import {
    getNip05ReadyAlert,
    activateGrantedHandle,
    dismissNip05ReadyAlert,
    isActivatingHandle
  } from '$lib/stores/nip05-ready-alert.svelte.js';
  import { CloseIcon } from '$lib/components/icons';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages.js';

  /** @type {{ class_?: string }} */
  let { class_ = '' } = $props();

  const alert = $derived(getNip05ReadyAlert());

  async function handleActivate() {
    const result = await activateGrantedHandle();
    if (result === 'failed') showToast(m.error_generic(), 'error');
  }
</script>

{#if alert}
  <!-- Text and actions wrap independently: in the 20rem bell dropdown the
    address alone fills a line, so the buttons drop below it instead of
    squeezing the copy into a three-line column. -->
  <div
    class="flex w-full flex-wrap items-center gap-x-3 gap-y-2 bg-primary/5 px-4 py-3 text-left {class_}"
    data-testid="inbox-nip05-ready-row"
  >
    <span class="flex min-w-0 flex-1 basis-48 items-start gap-3">
      <span aria-hidden="true">🎉</span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium break-words">
          {m.inbox_nip05_ready_row_title({ address: alert.address })}
        </span>
        <span class="block text-xs text-base-content/60">{m.inbox_nip05_ready_row_body()}</span>
      </span>
    </span>
    <span class="ml-auto flex items-center gap-1">
      <button
        type="button"
        class="btn btn-sm btn-primary"
        data-testid="inbox-nip05-ready-activate"
        disabled={isActivatingHandle()}
        onclick={handleActivate}
      >
        {isActivatingHandle() ? m.inbox_nip05_ready_row_doing() : m.inbox_nip05_ready_row_action()}
      </button>
      <button
        type="button"
        class="btn btn-circle text-base-content/40 btn-ghost btn-xs hover:text-base-content"
        data-testid="inbox-nip05-ready-dismiss"
        aria-label={m.inbox_nip05_ready_row_dismiss_aria()}
        title={m.inbox_nip05_ready_row_dismiss_aria()}
        onclick={dismissNip05ReadyAlert}
      >
        <CloseIcon class_="h-3.5 w-3.5" />
      </button>
    </span>
  </div>
{/if}
