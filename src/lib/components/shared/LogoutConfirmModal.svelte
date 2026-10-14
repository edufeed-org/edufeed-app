<!--
  LogoutConfirmModal — "Ohne Sicherung abmelden?" (issue ddce9cc0, E).

  Shown by ModalManager (type 'logoutConfirm') before an account whose key
  was never backed up is removed: a local-key account that is logged out
  without a backup file is gone for good. Offers the backup download right
  there. Also the confirm for "Alle Konten abmelden" (mode 'all'), which
  used to be a native confirm(). Small-modal grammar: ghost cancel, outline
  backup action, error logout action; Escape and the backdrop cancel.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {object} Props
   * @property {'current' | 'all'} [mode]
   * @property {number} [count] - accounts that were never backed up
   * @property {boolean} [canDownload] - the active account is among them
   * @property {() => void} onConfirm
   * @property {() => void} onCancel
   * @property {() => void} [onBackup]
   */
  /** @type {Props} */
  let {
    mode = 'current',
    count = 1,
    canDownload = false,
    onConfirm,
    onCancel,
    onBackup
  } = $props();

  /** @type {HTMLButtonElement | undefined} */
  let cancelEl = $state(undefined);
  $effect(() => {
    cancelEl?.focus();
  });

  const unsaved = $derived(count > 0);
  const title = $derived(unsaved ? m.auth_logout_unsaved_title() : m.auth_logout_all_title());
  const body = $derived(
    !unsaved
      ? m.navbar_logout_all_confirm()
      : count === 1
        ? m.auth_logout_unsaved_body_one()
        : m.auth_logout_unsaved_body_many({ count: String(count) })
  );
  const action = $derived(
    unsaved
      ? m.auth_logout_anyway_action()
      : mode === 'all'
        ? m.navbar_logout_all()
        : m.navbar_logout_current()
  );

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
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="logout-confirm-title"
  tabindex="-1"
  data-testid="logout-confirm"
  onkeydown={onKeyDown}
>
  <div class="modal-box max-w-sm">
    <h3 id="logout-confirm-title" class="font-bold">{title}</h3>
    <p class="py-2 text-sm">{body}</p>
    <div class="modal-action flex-wrap">
      <button
        bind:this={cancelEl}
        class="btn btn-ghost"
        data-testid="logout-confirm-cancel"
        onclick={onCancel}
      >
        {m.common_cancel()}
      </button>
      {#if unsaved && canDownload && onBackup}
        <button class="btn btn-outline" data-testid="logout-confirm-backup" onclick={onBackup}>
          {m.auth_logout_backup_action()}
        </button>
      {/if}
      <button class="btn btn-error" data-testid="logout-confirm-action" onclick={onConfirm}>
        {action}
      </button>
    </div>
  </div>
  <button
    type="button"
    class="modal-backdrop"
    aria-label={m.common_cancel()}
    tabindex="-1"
    data-testid="logout-confirm-backdrop"
    onclick={onCancel}
  ></button>
</div>
