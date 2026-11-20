<script>
  // First outside model on this device: what goes to Anthropic instead of GWDG, and the own
  // allowance. The same wording as the privacy text; "Abbrechen" changes nothing.
  import * as m from '$lib/paraglide/messages';

  /** @type {{ model: string, total?: number, onCancel: () => void, onConfirm: () => void }} */
  let { model, total, onCancel, onConfirm } = $props();

  /** @type {HTMLButtonElement | undefined} */
  let cancelEl = $state();
  $effect(() => cancelEl?.focus());
</script>

<div
  class="modal-open modal"
  role="dialog"
  aria-modal="true"
  aria-labelledby="termi-outside-title"
  tabindex="-1"
  data-testid="termi-outside-confirm"
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    // Escape cancels here; it must not close Termi too
    e.stopPropagation();
    onCancel();
  }}
>
  <div class="modal-box max-w-sm text-sm">
    <h3 id="termi-outside-title" class="text-base font-bold">
      {m.termi_outside_confirm_title({ model })}
    </h3>
    <p class="mt-2">{m.termi_outside_confirm_intro()}</p>
    <ul class="mt-1 list-disc pl-5">
      <li>{m.termi_outside_confirm_questions()}</li>
      <li>{m.termi_outside_confirm_files()}</li>
      <li>{m.termi_outside_confirm_results()}</li>
    </ul>
    {#if total !== undefined}
      <p class="mt-2">{m.termi_outside_confirm_quota({ total })}</p>
    {/if}
    <div class="modal-action">
      <button type="button" class="btn btn-ghost" bind:this={cancelEl} onclick={onCancel}
        >{m.common_cancel()}</button
      >
      <button type="button" class="btn btn-primary" onclick={onConfirm}
        >{m.termi_outside_confirm_use({ model })}</button
      >
    </div>
  </div>
</div>
