<script>
  // A model has not started its step: which one Termi waits for, when the next takes over by
  // itself (or that Termi stops waiting on the last one), and the two ways out.
  import * as m from '$lib/paraglide/messages';
  import { untrack } from 'svelte';
  import TermiAvatar from './TermiAvatar.svelte';
  import { WAIT_NOTICE_MS, waitSeconds } from '$lib/termi/wait.js';

  /**
   * @type {{ model: string, next?: string, task: 'ask'|'lesson', onSwitch?: () => void, onCancel: () => void }}
   * `model`/`next` are labels; no `next` = the last candidate; `onSwitch` only when switching is offered
   */
  let { model, next, task, onSwitch, onCancel } = $props();

  // Computed once when the card appears (it shows after WAIT_NOTICE_MS of silence): a status
  // region announces every change. The window re-mounts the card for another model.
  const seconds = untrack(() => waitSeconds(task, !next, WAIT_NOTICE_MS));
</script>

<div class="flex items-end gap-2.5" role="status" data-testid="termi-wait">
  <TermiAvatar />
  <div
    class="max-w-[88%] rounded-2xl rounded-bl-md border border-base-300 bg-base-200 px-3.5 py-2.5 text-sm"
  >
    <div class="flex items-center gap-2 font-semibold">
      <span class="termi-typing" aria-hidden="true"><i></i><i></i><i></i></span>
      {m.termi_wait_title({ model })}
    </div>
    <p class="mt-1 text-[13px] leading-snug text-base-content/70">
      {next ? m.termi_wait_body({ seconds, next }) : m.termi_wait_body_last({ seconds })}
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      {#if onSwitch}
        <button type="button" class="btn btn-sm btn-primary" onclick={onSwitch}
          >{m.termi_wait_switch()}</button
        >
      {/if}
      <button type="button" class="btn btn-ghost btn-sm" onclick={onCancel}
        >{m.common_cancel()}</button
      >
    </div>
  </div>
</div>
