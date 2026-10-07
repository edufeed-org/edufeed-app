<!--
  CallPreJoinModal — the member's lobby before joining a channel call
  ("Bereit für den Anruf?"). Shown by ModalManager (type 'callPreJoin'),
  asked through `confirmCallJoin` (call-switch-confirm.svelte.js) from
  `joinGroupCallWithConfirm`: confirming hands the chosen media (camera /
  mic on) to the join, cancelling joins nothing — no token is requested.
  The lobby body (CallPreJoin) is loaded lazily: it brings livekit-client.
-->
<script>
  import { lazyComponent } from '$lib/helpers/lazy-component.svelte.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {object} Props
   * @property {string} title - the channel the call belongs to
   * @property {(media: {audio: boolean, video: boolean}) => void} onConfirm
   * @property {() => void} onCancel
   */
  /** @type {Props} */
  let { title, onConfirm, onCancel } = $props();

  const PreJoin = lazyComponent(() => import('./call/CallPreJoin.svelte'));

  /** @param {KeyboardEvent} event */
  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }
</script>

<div
  class="modal-open modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="call-prejoin-title"
  tabindex="-1"
  data-testid="call-prejoin-modal"
  onkeydown={onKeyDown}
>
  <div class="modal-box max-w-lg">
    <h3 id="call-prejoin-title" class="font-bold">{m.groups_call_prejoin_title()}</h3>
    <p class="py-1 text-sm text-base-content/70">
      {title ? m.groups_call_prejoin_hint_titled({ title }) : m.groups_call_prejoin_hint()}
    </p>
    <div class="pt-2">
      {#if PreJoin.Component}
        <PreJoin.Component
          joinLabel={m.groups_call_prejoin_join()}
          onJoin={(media) => onConfirm(media)}
          {onCancel}
        />
      {:else}
        <div class="flex justify-center py-8">
          <span class="loading loading-md loading-spinner text-primary"></span>
        </div>
      {/if}
    </div>
  </div>
  <button
    type="button"
    class="modal-backdrop"
    aria-label={m.common_cancel()}
    tabindex="-1"
    data-testid="call-prejoin-backdrop"
    onclick={onCancel}
  ></button>
</div>
