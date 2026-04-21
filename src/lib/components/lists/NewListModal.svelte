<!--
  NewListModal — Create a new addressable NIP-51 list (kind 30000 / 30002 /
  30003 / 30004 / 30015 / 30030 / 39089).

  Kind picker + title + optional description. Emits `oncreated(event)` on
  success so the caller can navigate to the created list. The actual build
  + sign + publish pipeline is delegated to `CreateList` from
  `$lib/actions/list-actions.js`, run through the app `actionRunner`.
-->
<script>
  import * as m from '$lib/paraglide/messages';
  import * as kinds from 'nostr-tools/kinds';
  import { actionRunner } from '$lib/stores/action-runner.svelte.js';
  import { CreateList } from '$lib/actions/list-actions.js';
  import { PARAMETERIZED_LIST_KINDS, getListKindSpec } from '$lib/helpers/list-kinds.js';
  import { showToast } from '$lib/helpers/toast.js';

  /**
   * @type {{
   *   open: boolean,
   *   defaultKind?: number,
   *   onclose: () => void,
   *   oncreated?: (kind: number) => void
   * }}
   */
  let { open, defaultKind, onclose, oncreated } = $props();

  // i18n labels keyed on LIST_KINDS spec.key
  /** @type {Record<string, () => string>} */
  const KIND_LABEL = {
    follow_set: () => m.dashboard_lists_follow_sets(),
    relay_set: () => m.dashboard_lists_relay_sets(),
    bookmark_set: () => m.dashboard_lists_bookmarks(),
    curation_set: () => m.dashboard_lists_curation_sets(),
    interest_set: () => m.dashboard_lists_interests(),
    emoji_set: () => m.dashboard_lists_emoji_sets(),
    starter_pack: () => m.dashboard_lists_starter_packs()
  };

  const KIND_OPTIONS = PARAMETERIZED_LIST_KINDS.map((kind) => {
    const spec = getListKindSpec(kind);
    const label = spec ? KIND_LABEL[spec.key]?.() : undefined;
    return { kind, label: label ?? `Kind ${kind}`, spec };
  }).filter((o) => o.label);

  let selectedKind = $state(kinds.Followsets);
  let title = $state('');
  let description = $state('');
  let submitting = $state(false);

  // Reset local state whenever the modal reopens
  $effect(() => {
    if (open) {
      selectedKind = defaultKind ?? kinds.Followsets;
      title = '';
      description = '';
      submitting = false;
    }
  });

  function close() {
    if (submitting) return;
    onclose();
  }

  async function submit() {
    if (!title.trim() || submitting) return;
    submitting = true;
    try {
      await actionRunner.run(CreateList, {
        kind: selectedKind,
        title: title.trim(),
        description: description.trim() || undefined
      });
      showToast(m.list_detail_updated(), 'success');
      oncreated?.(selectedKind);
      onclose();
    } catch (err) {
      console.error('Failed to create list:', err);
      showToast(m.list_detail_update_error(), 'error');
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
  <dialog class="modal-open modal">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">{m.new_list_modal_title()}</h3>
      <form
        onsubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div class="space-y-4">
          <div class="form-control">
            <label class="label" for="new-list-kind">
              <span class="label-text">{m.new_list_modal_kind_label()}</span>
            </label>
            <select
              id="new-list-kind"
              class="select-bordered select w-full"
              bind:value={selectedKind}
              disabled={submitting}
            >
              {#each KIND_OPTIONS as option (option.kind)}
                <option value={option.kind}>{option.label}</option>
              {/each}
            </select>
          </div>

          <div class="form-control">
            <label class="label" for="new-list-title">
              <span class="label-text">{m.list_detail_edit_title_label()}</span>
            </label>
            <input
              id="new-list-title"
              type="text"
              class="input-bordered input w-full"
              bind:value={title}
              disabled={submitting}
            />
          </div>

          <div class="form-control">
            <label class="label" for="new-list-description">
              <span class="label-text">{m.list_detail_edit_description_label()}</span>
            </label>
            <textarea
              id="new-list-description"
              class="textarea-bordered textarea w-full"
              rows="3"
              placeholder={m.list_detail_edit_description_placeholder()}
              bind:value={description}
              disabled={submitting}
            ></textarea>
          </div>
        </div>

        <div class="modal-action">
          <button type="button" class="btn" onclick={close} disabled={submitting}>
            {m.common_cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={!title.trim() || submitting}>
            {#if submitting}
              <span class="loading loading-sm loading-spinner"></span>
            {/if}
            {m.new_list_modal_create()}
          </button>
        </div>
      </form>
    </div>
    <button class="modal-backdrop" onclick={close} aria-label="Close">close</button>
  </dialog>
{/if}
