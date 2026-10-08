<!--
  BreakoutAssignmentModal — "Du wurdest „Breakout 2 · Seminar“ zugeteilt".
  Shown by ModalManager (type 'breakoutAssignment') when the breakout store
  (groups/breakout.svelte.js) finds this seat in a host's assignment.
  "Wechseln" confirms at once; otherwise the switch happens on its own when
  the countdown runs out; "Bleiben" cancels it. Pure presentation — the
  store does the switching. Small-modal grammar: ghost cancel + primary
  action, no native <dialog>.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {object} Props
   * @property {string} roomName
   * @property {number} [autoMs] after this long the switch happens by itself
   * @property {() => void} onConfirm
   * @property {() => void} onCancel
   */
  /** @type {Props} */
  let { roomName, autoMs = 5000, onConfirm, onCancel } = $props();

  let seconds = $state(0);
  $effect(() => {
    const started = Date.now();
    seconds = Math.ceil(autoMs / 1000);
    const timer = setInterval(() => {
      const left = Math.ceil((autoMs - (Date.now() - started)) / 1000);
      seconds = Math.max(0, left);
      if (left <= 0) {
        clearInterval(timer);
        onConfirm();
      }
    }, 250);
    return () => clearInterval(timer);
  });
</script>

<div
  class="modal-open modal"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="breakout-assignment-title"
  data-testid="breakout-assignment"
>
  <div class="modal-box max-w-sm">
    <h3 id="breakout-assignment-title" class="font-bold">
      {m.groups_call_breakout_assigned_title({ room: roomName })}
    </h3>
    <p class="py-2 text-sm" data-testid="breakout-assignment-countdown">
      {m.groups_call_breakout_assigned_body({ seconds })}
    </p>
    <div class="modal-action">
      <button class="btn btn-ghost" data-testid="breakout-assignment-stay" onclick={onCancel}>
        {m.groups_call_breakout_stay()}
      </button>
      <button class="btn btn-primary" data-testid="breakout-assignment-switch" onclick={onConfirm}>
        {m.groups_call_breakout_switch()}
      </button>
    </div>
  </div>
</div>
