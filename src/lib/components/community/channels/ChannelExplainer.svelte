<!--
  ChannelExplainer — Task 14.

  Static "how is this protected?" modal, opened from ChannelChat's
  "How it works" link and its overflow menu. Four fixed rows (no dynamic
  data, so no loaders/models needed) translating the design prototype's
  German copy for: end-to-end encryption, invisibility from non-members,
  membership-as-key, and the open Concord protocol — plus a beta footnote.
  Same modal skeleton as Task 13's ChannelMembersModal confirm dialog.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  let { onClose } = $props();
</script>

<div class="modal-open modal" role="dialog">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-center text-lg font-extrabold">{m.concord_explainer_title()}</h3>

    <div class="mt-4 flex flex-col gap-3">
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">🔐</div>
        <div>
          <b class="text-sm">{m.concord_explainer_row1_title()}</b>
          <p class="text-xs text-base-content/60">{m.concord_explainer_row1_body()}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">🙈</div>
        <div>
          <b class="text-sm">{m.concord_explainer_row2_title()}</b>
          <p class="text-xs text-base-content/60">{m.concord_explainer_row2_body()}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">🔑</div>
        <div>
          <b class="text-sm">{m.concord_explainer_row3_title()}</b>
          <p class="text-xs text-base-content/60">{m.concord_explainer_row3_body()}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">🌐</div>
        <div>
          <b class="text-sm">{m.concord_explainer_row4_title()}</b>
          <p class="text-xs text-base-content/60">{m.concord_explainer_row4_body()}</p>
        </div>
      </div>
    </div>

    <p class="mt-4 text-center text-xs text-base-content/50">{m.concord_explainer_beta()}</p>

    <div class="modal-action justify-center">
      <button class="btn btn-neutral" onclick={onClose}>{m.concord_done()}</button>
    </div>
  </div>
</div>
