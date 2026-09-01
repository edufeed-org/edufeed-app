<!--
  AddRelayModal — single-input dialog for adding a custom feed relay.
  Validates/normalizes via normalizeRelayInput; onadd receives the
  normalized URL.
-->
<script>
  import { normalizeRelayInput } from '$lib/helpers/relay-input.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ open: boolean, onadd: (url: string) => void, onclose: () => void }} */
  let { open, onadd, onclose } = $props();

  let input = $state('');
  let showError = $state(false);
  /** @type {HTMLDialogElement | null} */
  let dialog = $state(null);

  $effect(() => {
    // Read the reactive dep BEFORE the dialog guard — an effect that returns
    // early without reading `open` never re-runs (dead-effect gotcha).
    const isOpen = open;
    if (!dialog) return;
    if (isOpen) {
      input = '';
      showError = false;
      dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  });

  function confirm() {
    const url = normalizeRelayInput(input);
    if (!url) {
      showError = true;
      return;
    }
    onadd(url);
  }
</script>

<dialog bind:this={dialog} class="modal" {onclose}>
  <div class="modal-box max-w-sm">
    <h3 class="mb-3 text-lg font-bold">{m.add_relay_modal_title()}</h3>
    <input
      type="text"
      class="input-bordered input w-full"
      class:input-error={showError}
      placeholder={m.add_relay_modal_placeholder()}
      bind:value={input}
      onkeydown={(e) => e.key === 'Enter' && confirm()}
    />
    {#if showError}
      <p class="mt-2 text-sm text-error">{m.add_relay_modal_invalid()}</p>
    {/if}
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={onclose}>{m.add_relay_modal_cancel()}</button>
      <button class="btn btn-primary" onclick={confirm}>{m.add_relay_modal_confirm()}</button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button aria-label="close"></button></form>
</dialog>
