<!--
  GroupExplainer — the NIP-29 counterpart of Concord's ChannelExplainer:
  a static "what is a relay channel?" modal opened from the creation
  surfaces (GroupCreateModal, ChannelCreateWizard's NIP-29 branch). Four
  fixed rows: relay-hosted (and relay-bound), NOT end-to-end encrypted,
  admin-managed roles, and the open NIP-29 standard. No dynamic data.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  let { onClose } = $props();
</script>

<div class="modal-open modal" role="dialog" data-testid="group-explainer">
  <div class="modal-box max-w-md">
    <button class="btn absolute top-3 right-3 btn-circle btn-ghost btn-sm" onclick={onClose}
      >✕</button
    >
    <h3 class="text-center text-lg font-extrabold">{m.groups_explainer_title()}</h3>

    <div class="mt-4 flex flex-col gap-3">
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">📡</div>
        <div>
          <b class="text-sm">{m.groups_explainer_row1_title()}</b>
          <p class="text-xs text-base-content/60">{m.groups_explainer_row1_body()}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">👁️</div>
        <div>
          <b class="text-sm">{m.groups_explainer_row2_title()}</b>
          <p class="text-xs text-base-content/60">{m.groups_explainer_row2_body()}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">🛡️</div>
        <div>
          <b class="text-sm">{m.groups_explainer_row3_title()}</b>
          <p class="text-xs text-base-content/60">{m.groups_explainer_row3_body()}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <div class="shrink-0 text-xl">🌐</div>
        <div>
          <b class="text-sm">{m.groups_explainer_row4_title()}</b>
          <p class="text-xs text-base-content/60">{m.groups_explainer_row4_body()}</p>
        </div>
      </div>
    </div>

    <div class="modal-action justify-center">
      <button class="btn btn-neutral" onclick={onClose}>{m.concord_done()}</button>
    </div>
  </div>
</div>
