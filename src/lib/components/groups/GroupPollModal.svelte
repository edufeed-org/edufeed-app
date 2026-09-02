<!--
  GroupPollModal — compose a NIP-88 poll for a NIP-29 room. Collects the
  question, 2+ options, single/multiple choice, and a duration (Armada's
  7/3/1-days-or-none menu, default 7). The caller owns the wire format and
  publishing (buildPollTemplate + publishToGroupRelay); onCreate resolving
  true closes the modal, false keeps the draft for a retry.
-->
<script>
  import { generateOptionId } from '$lib/helpers/polls.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{onCreate: (details: {question: string, options: {id: string, label: string}[], pollType: 'singlechoice'|'multiplechoice', endsAt?: number}) => Promise<boolean>, onClose: () => void}} */
  let { onCreate, onClose } = $props();

  let question = $state('');
  /** @type {string[]} */
  let optionLabels = $state(['', '']);
  let multipleChoice = $state(false);
  let durationDays = $state(7);
  let submitting = $state(false);

  const filledOptions = $derived(optionLabels.map((l) => l.trim()).filter(Boolean));
  const canSubmit = $derived(question.trim().length > 0 && filledOptions.length >= 2);

  function addOption() {
    optionLabels = [...optionLabels, ''];
  }

  async function submit() {
    if (!canSubmit || submitting) return;
    submitting = true;
    try {
      const ok = await onCreate({
        question: question.trim(),
        options: filledOptions.map((label) => ({ id: generateOptionId(), label })),
        pollType: multipleChoice ? 'multiplechoice' : 'singlechoice',
        endsAt: durationDays > 0 ? Math.floor(Date.now() / 1000) + durationDays * 86_400 : undefined
      });
      if (ok) onClose();
    } finally {
      submitting = false;
    }
  }
</script>

<div class="modal-open modal">
  <div class="modal-box max-w-sm">
    <h3 class="text-sm font-bold">{m.groups_poll_title()}</h3>
    <form
      class="mt-3 flex flex-col gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        class="input input-sm w-full"
        data-testid="group-poll-question"
        placeholder={m.groups_poll_question_placeholder()}
        bind:value={question}
      />
      {#each optionLabels as _, i (i)}
        <input
          class="input input-sm w-full"
          data-testid="group-poll-option-{i}"
          placeholder={m.groups_poll_option_placeholder({ number: i + 1 })}
          bind:value={optionLabels[i]}
        />
      {/each}
      <button
        type="button"
        class="btn self-start btn-ghost btn-sm"
        data-testid="group-poll-add-option"
        onclick={addOption}>+ {m.groups_poll_add_option()}</button
      >
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" class="checkbox checkbox-sm" bind:checked={multipleChoice} />
        {m.groups_poll_multiple()}
      </label>
      <label class="flex items-center justify-between gap-2 text-sm">
        {m.groups_poll_duration()}
        <select class="select select-sm" bind:value={durationDays}>
          <option value={7}>{m.groups_poll_duration_days({ count: 7 })}</option>
          <option value={3}>{m.groups_poll_duration_days({ count: 3 })}</option>
          <option value={1}>{m.groups_poll_duration_days({ count: 1 })}</option>
          <option value={0}>{m.groups_poll_duration_none()}</option>
        </select>
      </label>
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={onClose}>{m.common_cancel()}</button>
        <button
          type="submit"
          class="btn btn-primary"
          data-testid="group-poll-create"
          disabled={!canSubmit || submitting}>{m.groups_poll_create()}</button
        >
      </div>
    </form>
  </div>
</div>
